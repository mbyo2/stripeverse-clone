// Pure decision logic for the Payoneer PAYOUTS rail (edge functions
// `payoneer-payouts` and `payoneer-webhook`). Import-free on purpose:
// the exact file Deno runs is loaded by the vitest suite in
// tests/payments/payoneer.test.ts.
//
// This rail is the gateway-expansion build (brief:
// gateway-integrations-api-brief.md §2). It mirrors the proven PayPal
// payout rail's invariants — ledger row first, webhook as hint only
// with a status re-query before any state change, exactly-once
// wallet reversal — with Payoneer's own shapes.
//
// ── CONFIRM-AT-ONBOARDING: provider-shape assumptions ──────────────
// Payoneer's v4 API reference lives inside the partner/developer
// portal; credentials (Client ID / Secret / Program ID) are ISSUED
// at partner onboarding, never self-created (brief §2.0). Every
// provider shape below is cross-checked against the brief §2.1
// integrator table and ISOLATED in this module so onboarding only
// ever has to touch this file:
//   1. OAuth: POST /v4/oauth2/token, client-credentials grant, form-
//      encoded body carrying client_id + client_secret; the answer
//      is { access_token, expires_in } with a ~1h lifetime.
//   2. Create payment: POST /v4/payments with JSON body
//      { payee_id, amount (JSON number, major units), currency,
//      description, client_reference_id }. A program-scoped variant
//      POST /v4/programs/{program_id}/payments/payout exists
//      (payoneerProgramPayoutPath below) — the plain /v4/payments
//      path is primary; confirm which form our program is issued.
//   3. Create / status responses carry the payment id under
//      `payment_id` (fallbacks: `payout_id`, `id`) and the status
//      under `status` (fallbacks: nested payment object) — see
//      extractProviderPayoutId / extractProviderStatus.
//   4. Provider status vocabulary: PENDING, COMPLETED, PAID,
//      FAILED, CANCELLED, REVERSED, RETURNED (mapProviderStatus).
//      Anything else maps to null — callers keep current state
//      rather than guessing at an unlisted status.
//   5. Webhooks: exact event names / payload nesting are portal
//      docs at onboarding (brief §2.1). We assume the payload (or a
//      nested payment/data/resource object) carries `payment_id` /
//      `payout_id` / `id` and `client_reference_id`
//      (extractWebhookIdentifiers), and that the portal issues a
//      shared secret verified as header `x-payoneer-signature` =
//      HMAC-SHA256 hex of the raw body with PAYONEER_WEBHOOK_SECRET
//      (verifyPayoneerWebhookSignature). The payload is only ever a
//      HINT either way: state changes come from re-querying the
//      payment, never from payload fields.
//      ⚠️ AUDIT 2026-10-26: Payoneer's PUBLIC docs do not specify
//      ANY webhook signature scheme (the integration guide covers
//      OAuth, response codes and status polling only — no signature
//      header exists in public documentation). The scheme above is
//      therefore a fail-closed PLACEHOLDER, not a documented
//      contract: at partner onboarding, obtain the real scheme (if
//      any) from the portal docs and re-verify this assumption
//      FIRST — if Payoneer signs differently (or not at all), every
//      webhook 401s until this is corrected, while polling via
//      refresh_status keeps payouts correct in the meantime.

// ── Configuration ────────────────────────────────────────────────────

export type PayoneerEnvName = "sandbox" | "production";

export const PAYONEER_SANDBOX_BASE_URL = "https://api.sandbox.payoneer.com";
export const PAYONEER_PRODUCTION_BASE_URL = "https://api.payoneer.com";

/** Our registered webhook endpoint (registered per program in the portal). */
export const PAYONEER_WEBHOOK_URL =
  "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/payoneer-webhook";

/** Raw secret VALUES as read from the environment (never logged). */
export interface PayoneerEnvValues {
  clientId?: string | null;
  clientSecret?: string | null;
  programId?: string | null;
  /** PAYONEER_ENV: 'production' selects production; anything else is sandbox. */
  env?: string | null;
  /** PAYONEER_REGISTRATION_LINK: the hosted payee registration link. */
  registrationLink?: string | null;
}

export interface PayoneerConfig {
  /**
   * True only when the full issued credential trio exists. The
   * payouts function refuses `not_configured` before writing any row
   * or debit while this is false — credentials are issued at
   * onboarding (brief §2.0), so absent means "not connected yet",
   * never an error worth a raw provider response.
   */
  configured: boolean;
  env: PayoneerEnvName;
  baseUrl: string;
  programId: string | null;
  registrationLink: string | null;
  registrationLinkConfigured: boolean;
}

export function payoneerBaseUrl(env: PayoneerEnvName): string {
  return env === "production" ? PAYONEER_PRODUCTION_BASE_URL : PAYONEER_SANDBOX_BASE_URL;
}

function present(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the rail's configuration from the PAYONEER_* values.
 * `configured` needs the issued trio (client id + secret + program
 * id); the environment is explicit — only the exact string
 * 'production' selects production, so a typo can never point sandbox
 * keys at the live host unnoticed (it fails as not-usable instead).
 */
export function payoneerConfig(values: PayoneerEnvValues): PayoneerConfig {
  const env: PayoneerEnvName = values.env?.trim() === "production" ? "production" : "sandbox";
  const registrationLink = present(values.registrationLink);
  return {
    configured: Boolean(
      present(values.clientId) && present(values.clientSecret) && present(values.programId),
    ),
    env,
    baseUrl: payoneerBaseUrl(env),
    programId: present(values.programId),
    registrationLink,
    registrationLinkConfigured: registrationLink !== null,
  };
}

/** Roles allowed to use the rail while it is admin-only (brief §0 rule 5). */
export const PAYONEER_ROLES = ["admin", "super_admin"] as const;

export function canUsePayoneer(roles: readonly string[]): boolean {
  return roles.some((r) => (PAYONEER_ROLES as readonly string[]).includes(r));
}

// ── Payout input validation (server-side guard) ──────────────────────

/**
 * Payout currencies this rail will attempt: the majors Payoneer
 * Mass Payout advertises (70+ payout currencies, brief §2.1) kept
 * pragmatic — major world currencies, the region's currencies
 * (ZMW first among them), and common payout corridors. The check is
 * an allowlist (never a blocklist): a currency we have not listed
 * is refused plainly rather than sent to Payoneer to fail obscurely.
 * Availability still varies by payee country/method at Payoneer —
 * confirmed per corridor at onboarding.
 */
export const PAYONEER_PAYOUT_CURRENCIES: readonly string[] = [
  "USD", "EUR", "GBP", "ZMW",
  "ZAR", "KES", "NGN", "GHS", "TZS", "UGX", "RWF", "MWK", "BWP",
  "NAD", "MZN", "AOA", "XOF", "XAF", "MAD", "EGP",
  "AED", "SAR", "QAR", "KWD", "OMR", "ILS", "TRY",
  "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
  "AUD", "NZD", "CAD", "SGD", "HKD", "CNY", "JPY", "KRW",
  "INR", "PKR", "BDT", "LKR", "PHP", "THB", "VND", "MYR", "IDR",
];

export type PayoutValidation =
  | {
      ok: true;
      payeeId: string;
      amount: number;
      currency: string;
      description: string | null;
    }
  | {
      ok: false;
      reason: "missing_payee" | "invalid_amount" | "invalid_currency" | "unsupported_currency";
      message: string;
    };

/**
 * Validate a create-payout request server-side — the browser's
 * values are a request, never an instruction (the PayPal/Stripe
 * guard rule). Returns the NORMALISED values on success (payee id
 * trimmed, currency upper-cased) so callers persist/send exactly
 * what was validated.
 */
export function validatePayoutInput(input: {
  payee_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  description?: unknown;
}): PayoutValidation {
  const payeeId = typeof input.payee_id === "string" ? input.payee_id.trim() : "";
  if (!payeeId) {
    return {
      ok: false,
      reason: "missing_payee",
      message: "Choose the Payoneer payee for this payout, then try again.",
    };
  }
  const amount = typeof input.amount === "number"
    ? input.amount
    : typeof input.amount === "string"
      ? Number(input.amount)
      : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      reason: "invalid_amount",
      message: "Enter an amount greater than zero.",
    };
  }
  const currency = typeof input.currency === "string"
    ? input.currency.trim().toUpperCase()
    : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return {
      ok: false,
      reason: "invalid_currency",
      message: "Choose a valid three-letter currency for this payout.",
    };
  }
  if (!PAYONEER_PAYOUT_CURRENCIES.includes(currency)) {
    return {
      ok: false,
      reason: "unsupported_currency",
      message: `Payoneer payouts aren't supported in ${currency} yet.`,
    };
  }
  const description = typeof input.description === "string" && input.description.trim()
    ? input.description.trim()
    : null;
  return { ok: true, payeeId, amount, currency, description };
}

// ── Provider request shapes (isolated assumptions — see header) ─────

/** Token endpoint path (brief §2.1). */
export const PAYONEER_TOKEN_PATH = "/v4/oauth2/token";
/** Primary create-payment path (brief §2.1). */
export const PAYONEER_PAYMENTS_PATH = "/v4/payments";

/**
 * The program-scoped payout variant (brief §2.1): ONE integrator
 * guide documents POST /v4/programs/{program_id}/payments/payout
 * with the same body fields. Kept here, unused by the server module,
 * so onboarding confirms ONE place which form our program is issued.
 */
export function payoneerProgramPayoutPath(programId: string): string {
  return `/v4/programs/${encodeURIComponent(programId)}/payments/payout`;
}

export function payoneerPaymentPath(paymentId: string): string {
  return `${PAYONEER_PAYMENTS_PATH}/${encodeURIComponent(paymentId)}`;
}

export function payoneerPayeePath(payeeId: string): string {
  return `/v4/payees/${encodeURIComponent(payeeId)}`;
}

/**
 * Build the OAuth2 client-credentials token request. Assumption
 * (header note 1): form-encoded body carrying client_id +
 * client_secret, the standard client-credentials shape. Pure so the
 * exact contract is unit-tested; the server module sends it.
 */
export function buildTokenRequest(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}): { url: string; method: string; headers: Record<string, string>; body: string } {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  return {
    url: `${input.baseUrl}${PAYONEER_TOKEN_PATH}`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  };
}

export interface CreatePaymentInput {
  payeeId: string;
  amount: number;
  currency: string;
  description?: string | null;
  /** OUR ledger identity (payoneer_payouts.uuid_id) — always sent. */
  clientReferenceId: string;
}

/**
 * Build the POST /v4/payments body (brief §2.1). The
 * client_reference_id is ALWAYS our uuid_id: it is the
 * idempotency/reconciliation anchor that ties the provider payment
 * back to exactly one ledger row on every retry and webhook.
 */
export function buildCreatePaymentBody(
  input: CreatePaymentInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    payee_id: input.payeeId,
    amount: input.amount,
    currency: input.currency.trim().toUpperCase(),
    client_reference_id: input.clientReferenceId,
  };
  if (input.description) body.description = input.description;
  return body;
}

// ── Provider response reading (isolated assumptions — header note 3) ─

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The payment object inside a provider response, wherever it nests. */
function paymentRecord(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  for (const key of ["payment", "payout", "data", "result"]) {
    const nested = asRecord(root[key]);
    if (nested) return nested;
  }
  return root;
}

/** Payoneer's payment id from a create/status response, if present. */
export function extractProviderPayoutId(payload: unknown): string | null {
  const record = paymentRecord(payload);
  if (!record) return null;
  return (
    stringOrNull(record.payment_id) ??
    stringOrNull(record.payout_id) ??
    stringOrNull(record.id)
  );
}

/** Payoneer's raw status string from a response, if present. */
export function extractProviderStatus(payload: unknown): string | null {
  const record = paymentRecord(payload);
  if (!record) return null;
  return stringOrNull(record.status) ?? stringOrNull(record.payment_status);
}

// ── Status machine ───────────────────────────────────────────────────

export type PayoneerPayoutStatus =
  | "pending"
  | "submitted"
  | "completed"
  | "failed"
  | "reversed";

export type PayoneerDebitState = "none" | "debited" | "reversed";

/**
 * Map a Payoneer status string onto our lifecycle. Deliberately
 * closed: an unlisted status maps to NULL, and callers keep the
 * row's current state — an unknown provider word must never move
 * money or mark a payout final (header note 4).
 */
export function mapProviderStatus(
  providerStatus: string | null | undefined,
): PayoneerPayoutStatus | null {
  if (typeof providerStatus !== "string") return null;
  switch (providerStatus.trim().toUpperCase()) {
    case "PENDING":
      return "submitted";
    case "COMPLETED":
    case "PAID":
      return "completed";
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
      return "failed";
    case "REVERSED":
    case "RETURNED":
      return "reversed";
    default:
      return null;
  }
}

export interface PayoutState {
  status: PayoneerPayoutStatus;
  /** Accepts the DB column name too, so rows pass straight through. */
  debit_state?: PayoneerDebitState;
  debitState?: PayoneerDebitState;
}

export interface StatusTransition {
  next: PayoneerPayoutStatus;
  shouldReverseDebit: boolean;
}

/**
 * Decide what a (re-queried) provider status may do to a payout row.
 *
 * Rules:
 *   - No mapped status (null) changes nothing.
 *   - Forward progress only: pending → submitted → completed.
 *     A late 'submitted' never drags a completed row backwards.
 *   - Confirmed failure states ('failed' / 'reversed') end the
 *     payout from pending/submitted — and a 'reversed' also ends a
 *     'completed' one (Payoneer returned money it had paid out).
 *     A 'failed' arriving after 'completed' contradicts the earlier
 *     completion: the row does NOT move and nothing reverses —
 *     operations reconciles it, code does not guess.
 *   - REVERSAL (the wallet credit-back) is allowed ONLY from a
 *     debited state and ONLY on those confirmed provider states.
 *     It is also still owed when the row already sits in the
 *     terminal state but debit_state is still 'debited' — the
 *     missed-reversal recovery case; the caller's guarded flip
 *     (debit_state 'debited' → 'reversed' in the same update as the
 *     status) is what makes acting on it exactly-once.
 */
export function decideStatusTransition(
  current: PayoutState,
  provider: PayoneerPayoutStatus | null,
): StatusTransition {
  const noChange: StatusTransition = { next: current.status, shouldReverseDebit: false };
  if (!provider) return noChange;
  const debitState = current.debitState ?? current.debit_state ?? "none";
  const debited = debitState === "debited";

  if (provider === "failed" || provider === "reversed") {
    if (current.status === "completed" && provider === "failed") return noChange;
    const next = current.status === "failed" || current.status === "reversed"
      ? current.status
      : provider;
    return { next, shouldReverseDebit: debited };
  }
  if (provider === "completed") {
    if (current.status === "pending" || current.status === "submitted") {
      return { next: "completed", shouldReverseDebit: false };
    }
    return noChange;
  }
  if (provider === "submitted") {
    if (current.status === "pending") {
      return { next: "submitted", shouldReverseDebit: false };
    }
    return noChange;
  }
  return noChange;
}

// ── Provider error classification ────────────────────────────────────

/**
 * Trace-safe name/code of a provider error body for logs (the audit
 * L1 rule — mirroring stripeErrorTrace / paypalErrorTrace): never
 * the message, which can echo request values.
 */
export function payoneerErrorTrace(
  status: number,
  body: unknown,
): { status: number; name: string | null; code: string | null } {
  const record = asRecord(body);
  return {
    status,
    name: record ? stringOrNull(record.name) ?? stringOrNull(record.error) : null,
    code: record ? stringOrNull(record.code) ?? stringOrNull(record.error_code) : null,
  };
}

/**
 * Classify a non-2xx Payoneer answer into the plain-language message
 * a user/admin may see. Raw provider bodies are NEVER surfaced (CEO
 * error rule) — they go to logs as trace fields only.
 */
export function classifyPayoneerError(status: number, body?: unknown): string {
  const trace = payoneerErrorTrace(status, body);
  const nameOrCode = `${trace.name ?? ""} ${trace.code ?? ""}`;
  if (/insufficient/i.test(nameOrCode)) {
    return "The platform's Payoneer payout account does not have enough funds for this payout. No money has moved from your wallet.";
  }
  if (status === 0) {
    return "Payoneer could not be reached just now. No money has moved — please try again in a moment.";
  }
  if (status === 401 || status === 403) {
    return "Payoneer refused our platform credentials for this request. The payout was not sent — please let an administrator know.";
  }
  if (status === 404) {
    return "Payoneer could not find that payment or payee. Check the details, then try again.";
  }
  if (status === 409) {
    return "Payoneer says a payment with this reference already exists. Check the payout's status before trying again, so it is not sent twice.";
  }
  if (status === 429) {
    return "Payoneer is busy right now. The payout has been saved — check its status in a moment before trying again.";
  }
  if (status === 400 || status === 422) {
    return "Payoneer could not accept those payout details. Check the payee, amount and currency, then try again.";
  }
  if (status >= 500) {
    return "Payoneer is having trouble right now. The payout has been saved — check its status before trying again, so it is not sent twice.";
  }
  return "This payout could not be completed. It has been saved — check its status before trying again.";
}

// ── Webhook hint extraction + signature (header note 5) ─────────────

/**
 * Pull the hint identifiers out of a webhook payload: the provider
 * payout id and our client_reference_id, at the top level or one
 * level down (payment / data / resource). Hints ONLY — the webhook
 * re-queries the payment and decides from Payoneer's answer.
 */
export function extractWebhookIdentifiers(payload: unknown): {
  providerPayoutId: string | null;
  clientReferenceId: string | null;
} {
  const root = asRecord(payload);
  if (!root) return { providerPayoutId: null, clientReferenceId: null };
  const candidates: Record<string, unknown>[] = [root];
  for (const key of ["payment", "payout", "data", "resource"]) {
    const nested = asRecord(root[key]);
    if (nested) candidates.push(nested);
  }
  let providerPayoutId: string | null = null;
  let clientReferenceId: string | null = null;
  for (const record of candidates) {
    providerPayoutId ??=
      stringOrNull(record.payment_id) ??
      stringOrNull(record.payout_id) ??
      stringOrNull(record.provider_payment_id) ??
      stringOrNull(record.id);
    clientReferenceId ??= stringOrNull(record.client_reference_id);
    if (providerPayoutId && clientReferenceId) break;
  }
  return { providerPayoutId, clientReferenceId };
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Verify a Payoneer webhook under the documented assumption
 * (header note 5): the `x-payoneer-signature` header equals the
 * HMAC-SHA256 hex of the RAW body keyed with PAYONEER_WEBHOOK_SECRET,
 * compared in constant time. FAILS CLOSED on every irregularity —
 * missing header, missing secret, no match. The raw body is
 * required: any JSON re-serialisation changes the bytes and breaks
 * the signature, by design.
 */
export async function verifyPayoneerWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string | null | undefined,
): Promise<boolean> {
  if (!webhookSecret) return false;
  if (!signatureHeader || !signatureHeader.trim()) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const expected = bytesToHex(new Uint8Array(mac));
    return timingSafeEqualHex(signatureHeader.trim().toLowerCase(), expected);
  } catch {
    return false;
  }
}
