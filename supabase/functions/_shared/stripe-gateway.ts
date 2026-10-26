// Pure decision logic for the Stripe GATEWAY wallet top-up rail
// (edge functions `stripe-gateway-checkout` and
// `stripe-gateway-webhook`). Import-free on purpose: the exact file
// Deno runs is loaded by the vitest suite in
// tests/payments/stripeGateway.test.ts.
//
// This rail is the gateway-expansion build (brief:
// gateway-integrations-api-brief.md §3). It mirrors the proven PayPal
// deposit rail end to end — pending ledger row first, gateway second,
// settlement only from re-queried gateway state, exactly-once credit
// inside a SECURITY DEFINER RPC — with Stripe's own shapes:
//
//   - The ledger ID is OUR transactions.uuid_id. It travels to Stripe
//     as the Checkout Session's `client_reference_id` AND as session
//     metadata (`ledger_id`, mirrored into payment_intent_data), and
//     the session-create call carries `Idempotency-Key: <ledger id>`
//     so a retried create returns the same session.
//   - The webhook payload is only ever a HINT. Settlement re-queries
//     the session from Stripe and credits only when the re-queried
//     session says payment_status == "paid" with an amount and
//     currency matching the ledger row — the complete_stripe_
//     wallet_deposit RPC re-verifies both under the row lock.
//   - Secrets are the GATEWAY trio (STRIPE_GATEWAY_SECRET_KEY /
//     STRIPE_GATEWAY_WEBHOOK_SECRET / VITE_STRIPE_PUBLISHABLE_KEY).
//     The subscription feature's STRIPE_SECRET_KEY is a different
//     merchant flow and is never read here.
//
// ── Currency evidence (brief §3.1 open item, checked 2026-10-23) ──
// ZMW *is* a Stripe-recognised currency: Stripe's FX Quotes API
// documentation lists `zmw` among its supported conversion
// currencies, and Stripe's currency data treats ZMW as a two-decimal
// currency. But Stripe defines PRESENTMENT availability per account
// country (the Country Spec's supported_payment_currencies), and
// Zambia is not a Stripe account country — so no document can prove
// ZMW presentment for this account; only Stripe's answer at session
// creation can. The checkout function therefore ATTEMPTS the wallet's
// own currency (ZMW included) and, if Stripe rejects the currency,
// REFUSES the top-up honestly — the user may then start a USD top-up
// and type a dollar amount themselves (the PayPal precedent: that
// rail is USD-only from the start, with the amount always the user's
// own). There is NO automatic fallback charge in another currency:
// the previous same-amount USD fallback was removed by audit fix D1
// (2026-10-26) — it re-ran checkout with the UNCHANGED numeric amount
// against the USD wallet, so a K10,000 ZMW top-up would have become
// a $10,000 USD charge. An amount is only ever charged in the
// currency and value the user themselves entered.

// ── Money ────────────────────────────────────────────────────────────

/** Parse a money-ish value (number or numeric string) or return null. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compare money in minor units so float drift never decides a credit. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Convert a major-unit amount to Stripe minor units. Every currency
 * this rail can charge is two-decimal in Stripe's data (ZMW
 * included), so minor = major × 100, rounded.
 */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert Stripe minor units back to major units. */
export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

// ── Rail configuration / the not_configured decision ────────────────

export type StripeKeyMode = "test" | "live";

/**
 * Classify a Stripe secret/restricted key by prefix. Returns null for
 * anything that is not a usable gateway secret key — an absent,
 * truncated or wrong-kind value (e.g. a publishable key pasted into
 * the secret slot) must behave exactly like "not configured", never
 * like a key worth sending to Stripe.
 */
export function stripeKeyMode(secretKey: string | null | undefined): StripeKeyMode | null {
  if (!secretKey) return null;
  const key = secretKey.trim();
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

/**
 * The not_configured gate for the checkout function: the rail is
 * configured only when STRIPE_GATEWAY_SECRET_KEY holds a recognisable
 * Stripe secret/restricted key. The mode travels with the decision so
 * responses and ledger rows can state test vs live truthfully.
 */
export function stripeGatewayConfig(secretKey: string | null | undefined): {
  configured: boolean;
  mode: StripeKeyMode | null;
} {
  const mode = stripeKeyMode(secretKey);
  return { configured: mode !== null, mode };
}

/** Roles allowed to use the rail while it is superadmin-only. */
export const STRIPE_GATEWAY_ROLES = ["admin", "super_admin"] as const;

export function canUseStripeGateway(roles: readonly string[]): boolean {
  return roles.some((r) => (STRIPE_GATEWAY_ROLES as readonly string[]).includes(r));
}

/**
 * The ONE Stripe API version every Stripe call in this repo is
 * pinned to (audit fix D3, 2026-10-26): the subscription functions
 * (create-checkout, customer-portal) pin `apiVersion: "2023-10-16"`
 * through stripe@14.21.0, and this gateway sends the same version as
 * its `Stripe-Version` header — one API dialect repo-wide. (An
 * earlier comment here claimed the gateway's 2024-06-20 pin was "the
 * same pin the subscription checkout uses"; it was not.)
 *
 * The gateway's WEBHOOK ENDPOINT must also be pinned to this version
 * when it is registered in the Dashboard — endpoints otherwise
 * inherit the account's default version, which drifts as Stripe
 * releases, and events would arrive in a shape this code did not
 * pin against. See docs/stripe-gateway-wallet-topup.md.
 */
export const STRIPE_API_VERSION = "2023-10-16";

/**
 * The kill-switch decision, shared by the checkout gate and the
 * admin status (audit fix D6, 2026-10-26): the rail is enabled ONLY
 * when platform_settings.stripe_gateway_enabled reads exactly true.
 * A missing settings row or a NULL value therefore reads as DISABLED
 * in both places — previously checkout treated a missing row as
 * enabled while the admin status reported it disabled. (The column
 * itself is `NOT NULL DEFAULT true`, and the live row currently
 * reads false, so this changes no live behaviour today; it makes
 * the two readers agree by construction.)
 */
export function stripeGatewayKillSwitchEnabled(value: unknown): boolean {
  return value === true;
}

// ── Server-side price guard ──────────────────────────────────────────

/**
 * Per-currency top-up limits enforced SERVER-SIDE in the checkout
 * function (the browser's amount is a request, never an instruction —
 * the same rule the PayPal rail enforces). Magnitudes mirror the
 * PayPal rail's per-deposit guard.
 */
export const STRIPE_TOPUP_LIMITS: Record<string, { min: number; max: number }> = {
  USD: { min: 1, max: 10_000 },
  EUR: { min: 1, max: 10_000 },
  GBP: { min: 1, max: 10_000 },
  ZMW: { min: 10, max: 100_000 },
  ZAR: { min: 10, max: 100_000 },
  NGN: { min: 500, max: 5_000_000 },
  KES: { min: 100, max: 1_000_000 },
  TZS: { min: 100, max: 1_000_000 },
  BWP: { min: 10, max: 100_000 },
};

export type TopUpValidation =
  | { ok: true }
  | { ok: false; reason: "unsupported_currency" | "invalid_amount" | "below_minimum" | "above_maximum" };

/** Validate a requested top-up against the rail's server-side guard. */
export function validateStripeTopUp(amount: unknown, currency: unknown): TopUpValidation {
  const cur = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const limits = STRIPE_TOPUP_LIMITS[cur];
  if (!limits) return { ok: false, reason: "unsupported_currency" };
  const value = parseMoney(amount);
  if (value === null || value <= 0) return { ok: false, reason: "invalid_amount" };
  if (value < limits.min) return { ok: false, reason: "below_minimum" };
  if (value > limits.max) return { ok: false, reason: "above_maximum" };
  return { ok: true };
}

// ── Checkout Session creation ────────────────────────────────────────

export interface CheckoutSessionInput {
  /** Our ledger ID (transactions.uuid_id) — client_reference_id + metadata. */
  ledgerId: string;
  userId: string;
  /** Major-unit amount the server validated. */
  amount: number;
  /** Charge currency (lowercase applied at encoding time). */
  currency: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  productName?: string;
}

/**
 * Build the application/x-www-form-urlencoded field set for
 * POST /v1/checkout/sessions. Kept pure so the exact field contract
 * (client_reference_id, mirrored metadata, minor units) is unit
 * tested; the caller adds the Idempotency-Key header (= ledgerId).
 */
export function buildCheckoutSessionParams(input: CheckoutSessionInput): Record<string, string> {
  const currency = input.currency.trim().toLowerCase();
  const params: Record<string, string> = {
    "mode": "payment",
    "payment_method_types[0]": "card",
    "client_reference_id": input.ledgerId,
    "success_url": input.successUrl,
    "cancel_url": input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(toMinorUnits(input.amount)),
    "line_items[0][price_data][product_data][name]":
      input.productName ?? "BMaGlass Pay wallet top-up",
    "metadata[ledger_id]": input.ledgerId,
    "metadata[user_id]": input.userId,
    "payment_intent_data[metadata][ledger_id]": input.ledgerId,
    "payment_intent_data[metadata][user_id]": input.userId,
  };
  if (input.customerEmail) params["customer_email"] = input.customerEmail;
  return params;
}

// ── Return URLs (audit fixes D9/D10, 2026-10-26) ────────────────────

/** The app's canonical origin — the default return destination. */
export const STRIPE_GATEWAY_CANONICAL_ORIGIN = "https://bmaglasspay.online";

/** Production origins a Checkout return may legitimately land on. */
export const STRIPE_GATEWAY_RETURN_ORIGINS: readonly string[] = [
  "https://bmaglasspay.online",
  "https://www.bmaglasspay.online",
];

/**
 * Resolve the origin the Checkout success/cancel URLs are built
 * from. The request's `Origin` header is attacker-influenceable, so
 * it is honoured ONLY when it is exactly one of the app's own
 * origins; anything else falls back to the canonical origin. Without
 * this, a crafted call could send a payer who just paid on Stripe's
 * trusted page onward to an arbitrary site. In TEST mode only,
 * loopback origins are also allowed so a sandbox proof can run
 * against a local dev server; a live key never honours them.
 */
export function resolveStripeReturnOrigin(
  originHeader: string | null | undefined,
  mode: StripeKeyMode | null,
): string {
  if (typeof originHeader === "string" && originHeader) {
    try {
      const parsed = new URL(originHeader);
      const origin = parsed.origin;
      if ((STRIPE_GATEWAY_RETURN_ORIGINS as readonly string[]).includes(origin)) {
        return origin;
      }
      if (
        mode === "test" &&
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      ) {
        return origin;
      }
    } catch {
      // Malformed header — fall through to the canonical origin.
    }
  }
  return STRIPE_GATEWAY_CANONICAL_ORIGIN;
}

// ── Stripe API errors ────────────────────────────────────────────────

export interface StripeApiErrorLike {
  type?: string | null;
  code?: string | null;
  param?: string | null;
  message?: string | null;
}

/**
 * True when a Stripe error is a currency rejection, judged ONLY on
 * documented error fields: an `invalid_request_error` whose `param`
 * names the currency parameter (both fields are part of Stripe's
 * documented error object). It deliberately does NOT match on the
 * human-readable `message` (undocumented, free to change) or on the
 * `currency_not_supported` code (not in Stripe's documented error
 * codes) — audit fix D4, 2026-10-26.
 *
 * Since audit fix D1 this verdict drives NO money decision: it only
 * chooses the truthful refusal copy and the trace fields recorded on
 * the failed ledger row. If detection ever misses, the refusal is
 * the generic one — safe either way, because nothing is charged.
 */
export function isStripeCurrencyRejection(error: StripeApiErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.type !== "invalid_request_error") return false;
  return typeof error.param === "string" && error.param.includes("currency");
}

/**
 * Trace-safe view of a Stripe error body for logs (audit L1 rule,
 * mirroring paypalErrorTrace): status, error type and code only —
 * never the message, which can echo request values.
 */
export function stripeErrorTrace(
  status: number,
  bodyText: string,
): { status: number; type: string | null; code: string | null } {
  try {
    const parsed = JSON.parse(bodyText) as { error?: StripeApiErrorLike };
    return {
      status,
      type: typeof parsed?.error?.type === "string" ? parsed.error.type : null,
      code: typeof parsed?.error?.code === "string" ? parsed.error.code : null,
    };
  } catch {
    return { status, type: null, code: null };
  }
}

// ── Stripe API retry policy (audit fix D7, 2026-10-26) ──────────────

/** Hard cap on attempts for one logical Stripe API call. */
export const STRIPE_MAX_ATTEMPTS = 3;

/**
 * Whether a failed Stripe API attempt may be retried. Retryable
 * failures are transient by definition: a network error or timeout
 * (status 0), 429 (rate limited) and 5xx (Stripe-side). A 4xx is
 * Stripe's verdict on the request itself — retrying changes nothing.
 *
 * Safety: reads (GET) are always safe to retry. A POST is retried
 * ONLY when the call carries an Idempotency-Key — every POST this
 * rail makes does (session create = ledger id, refund create =
 * `refund:<ledger id>`), so a retry can never create a second
 * session or a second refund; Stripe replays the original response.
 */
export function shouldRetryStripeRequest(input: {
  /** 1-based number of the attempt that just failed. */
  attempt: number;
  /** HTTP status of the failed attempt; 0 = network error/timeout. */
  status: number;
  method: string;
  hasIdempotencyKey: boolean;
}): boolean {
  if (input.attempt >= STRIPE_MAX_ATTEMPTS) return false;
  const transient = input.status === 0 || input.status === 429 || input.status >= 500;
  if (!transient) return false;
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  return input.hasIdempotencyKey;
}

/**
 * Delay before the next attempt: short exponential backoff (300ms,
 * 900ms), honouring Stripe's `Retry-After` when it sends one, capped
 * at 5s so a webhook invocation never waits out a long penalty box.
 */
export function stripeRetryDelayMs(attempt: number, retryAfterSeconds?: number | null): number {
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 5000);
  }
  return 300 * Math.pow(3, Math.max(0, attempt - 1));
}

// ── Webhook signature verification ───────────────────────────────────

/**
 * Parse a `Stripe-Signature` header (`t=<ts>,v1=<hex>[,v1=<hex>...]`)
 * — multiple v1 values appear during signing-secret rotation and any
 * one of them may match. Returns null for anything malformed.
 */
export function parseStripeSignatureHeader(
  header: string | null | undefined,
): { timestamp: number; timestampRaw: string; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  let timestampRaw: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) {
        timestamp = n;
        // Keep the LITERAL header text: the signed payload is
        // `${t}.${body}` with t exactly as sent (Stripe docs) — a
        // zero-padded or signed rendering must verify as sent, not
        // as re-rendered through Number().
        timestampRaw = value;
      }
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (timestamp === null || timestampRaw === null || signatures.length === 0) return null;
  return { timestamp, timestampRaw, signatures };
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
 * Verify a Stripe webhook signature: HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with the endpoint's signing secret,
 * compared in constant time against every v1 candidate, with a
 * timestamp tolerance (default 300s, Stripe's own default) against
 * replay. FAILS CLOSED on every irregularity — missing header,
 * missing secret, malformed header, stale timestamp, no match.
 *
 * The RAW body is required: any JSON re-serialisation changes the
 * bytes and breaks the signature, by design.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string | null | undefined,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!webhookSecret) return false;
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${parsed.timestampRaw}.${rawBody}`),
    );
    const expected = bytesToHex(new Uint8Array(mac));
    return parsed.signatures.some((sig) => timingSafeEqualHex(sig.toLowerCase(), expected));
  } catch {
    return false;
  }
}

// ── Webhook event routing ────────────────────────────────────────────

export type StripeEventAction = "settle" | "close_unsettled" | "refund" | "ignore";

/**
 * Route a Stripe event type. Settlement events re-query and credit;
 * failure/expiry events close the ledger row unsettled; refunds are
 * flagged for reconciliation; everything else is ignored. Events are
 * NOT ordered and may repeat — routing is by type only, and every
 * money decision is re-derived from the re-queried session.
 */
export function stripeEventAction(eventType: string | null | undefined): StripeEventAction {
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return "settle";
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return "close_unsettled";
    case "charge.refunded":
      return "refund";
    default:
      return "ignore";
  }
}

/** The Checkout Session id carried by a session event, if well-formed. */
export function sessionIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const record = object as { id?: unknown; object?: unknown };
  if (record.object !== "checkout.session") return null;
  return typeof record.id === "string" && record.id.startsWith("cs_") ? record.id : null;
}

/**
 * The client_reference_id (= our ledger uuid) carried by a session
 * event, if present. The close-unsettled path uses it as the same
 * defensive ledger lookup the settlement path performs
 * (findStripeDepositTransaction), so an expiry/failure event that
 * arrives before the checkout function has written the session
 * reference back can still find — and close — its row (audit fix
 * D5, 2026-10-26).
 */
export function clientReferenceIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const record = object as { client_reference_id?: unknown; object?: unknown };
  if (record.object !== "checkout.session") return null;
  return typeof record.client_reference_id === "string" && record.client_reference_id
    ? record.client_reference_id
    : null;
}

/** The PaymentIntent id a charge.refunded event refers to, if present. */
export function paymentIntentIdFromChargeEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const record = object as { payment_intent?: unknown };
  return typeof record.payment_intent === "string" ? record.payment_intent : null;
}

// ── Settlement verification ──────────────────────────────────────────

export interface StripeSessionLike {
  id: string;
  payment_status?: string | null;
  status?: string | null;
  /** Minor units, as Stripe reports them. */
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
}

export interface PendingStripeDeposit {
  /** Our ledger ID (transactions.uuid_id). */
  id: string;
  amount: number;
  currency: string;
  status: string;
  /** The Checkout Session id recorded at creation (transactions.reference). */
  sessionId: string | null;
}

export type StripeSessionVerification =
  | { ok: true; paymentIntentId: string | null }
  | {
      ok: false;
      reason:
        | "missing_session"
        | "not_paid"
        | "amount_mismatch"
        | "currency_mismatch"
        | "ledger_mismatch"
        | "session_mismatch";
    };

/**
 * Verify a RE-QUERIED Checkout Session against the pending ledger
 * row. This is the TS half of the settlement gate; the
 * complete_stripe_wallet_deposit RPC re-verifies amount and currency
 * under the row lock before crediting, so a bug here cannot credit
 * wrong money — it can only refuse or pass through to the RPC.
 */
export function verifyStripeSession(
  session: StripeSessionLike | null | undefined,
  pending: PendingStripeDeposit,
): StripeSessionVerification {
  if (!session || typeof session.id !== "string") return { ok: false, reason: "missing_session" };
  if (pending.sessionId && session.id !== pending.sessionId) {
    return { ok: false, reason: "session_mismatch" };
  }
  if (session.payment_status !== "paid") return { ok: false, reason: "not_paid" };
  const paidAmount = typeof session.amount_total === "number" ? fromMinorUnits(session.amount_total) : null;
  if (paidAmount === null || !moneyEquals(paidAmount, pending.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (!session.currency || session.currency.toUpperCase() !== pending.currency.toUpperCase()) {
    return { ok: false, reason: "currency_mismatch" };
  }
  // The session must name OUR ledger row — by client_reference_id or
  // by the mirrored metadata — so a session from any other flow (the
  // subscription checkout shares the Stripe account) can never settle
  // a wallet deposit.
  const ledgerRef = session.client_reference_id ?? session.metadata?.ledger_id ?? null;
  if (ledgerRef !== pending.id) return { ok: false, reason: "ledger_mismatch" };
  return { ok: true, paymentIntentId: session.payment_intent ?? null };
}

export type StripeSettlementPlan = "credit" | "already_completed" | "conflict" | "not_pending";

/**
 * Decide what a settlement attempt may do with the ledger row —
 * the same exactly-once shape as the PayPal rail's planCompletion:
 * a replay of the same session is a no-op, a different session on a
 * completed row is a conflict, a non-pending row is refused.
 */
export function planStripeSettlement(
  pending: PendingStripeDeposit,
  sessionId: string,
): StripeSettlementPlan {
  if (pending.status === "completed") {
    return pending.sessionId === sessionId ? "already_completed" : "conflict";
  }
  if (pending.status !== "pending") return "not_pending";
  return "credit";
}

// ── Admin: gateway status ──────────────────────────────────────────

/**
 * Pure status mapping for `stripe-gateway-admin` { action: "status" }.
 * `kill_switch_enabled` is exactly
 * `platform_settings.stripe_gateway_enabled === true`
 * (stripeGatewayKillSwitchEnabled — the same decision the checkout
 * gate makes, so the console and the gate can never disagree about
 * a missing row). `webhook_configured` is presence-only: the secret
 * value itself never leaves the function.
 */
export function stripeGatewayStatus(input: {
  secretKey: string | null | undefined;
  webhookSecret: string | null | undefined;
  gatewayEnabled: boolean | null | undefined;
}): {
  configured: boolean;
  mode: StripeKeyMode | null;
  kill_switch_enabled: boolean;
  webhook_configured: boolean;
} {
  const { configured, mode } = stripeGatewayConfig(input.secretKey);
  return {
    configured,
    mode,
    kill_switch_enabled: stripeGatewayKillSwitchEnabled(input.gatewayEnabled),
    webhook_configured:
      typeof input.webhookSecret === "string" && input.webhookSecret.trim().length > 0,
  };
}

// ── Admin: refunds ─────────────────────────────────────────────────

export interface StripeRefundRowLike {
  status: string;
  payment_method?: string | null;
  reference?: string | null;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The PaymentIntent id recorded on a settled deposit row. Settlement
 * (complete_stripe_wallet_deposit) merges `payment_intent_id` into
 * transactions.metadata; that — never the session id — is what a
 * refund is created against.
 */
export function stripePaymentIntentIdFromRow(
  row: StripeRefundRowLike | null | undefined,
): string | null {
  if (!row) return null;
  const id =
    metadataString(row.metadata, "payment_intent_id") ??
    metadataString(row.metadata, "payment_intent");
  return id && id.startsWith("pi_") ? id : null;
}

/** The Checkout Session id recorded on a deposit row, if any. */
export function stripeSessionIdFromRow(
  row: StripeRefundRowLike | null | undefined,
): string | null {
  if (!row) return null;
  const fromMetadata =
    metadataString(row.metadata, "session_id") ??
    metadataString(row.metadata, "stripe_session_id");
  if (fromMetadata) return fromMetadata;
  for (const candidate of [row.reference, row.external_reference]) {
    if (typeof candidate === "string" && candidate.startsWith("cs_")) return candidate;
  }
  return null;
}

export type StripeRefundEligibility =
  | { ok: true; paymentIntentId: string; sessionId: string | null }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_stripe"
        | "not_settled"
        | "missing_payment_reference"
        | "already_refunded";
      httpStatus: 400 | 404;
      message: string;
    };

/**
 * Decide whether a transactions row may be refunded through Stripe.
 * Pure and side-effect free: the admin function acts on this verdict
 * and changes nothing when it is not ok.
 */
export function decideStripeRefundEligibility(
  row: StripeRefundRowLike | null | undefined,
): StripeRefundEligibility {
  if (!row) {
    return {
      ok: false,
      reason: "not_found",
      httpStatus: 404,
      message: "That transaction could not be found.",
    };
  }
  if (row.payment_method != null && row.payment_method !== "stripe") {
    return {
      ok: false,
      reason: "not_stripe",
      httpStatus: 400,
      message: "That transaction was not paid by card through Stripe, so it cannot be refunded here.",
    };
  }
  if (metadataString(row.metadata, "refund_id")) {
    return {
      ok: false,
      reason: "already_refunded",
      httpStatus: 400,
      message: "A refund has already been requested for this deposit. No second refund was created.",
    };
  }
  if (row.status !== "completed" && row.status !== "settled") {
    return {
      ok: false,
      reason: "not_settled",
      httpStatus: 400,
      message: "Only a completed Stripe deposit can be refunded. This deposit has not settled, so nothing was refunded.",
    };
  }
  const paymentIntentId = stripePaymentIntentIdFromRow(row);
  if (!paymentIntentId) {
    return {
      ok: false,
      reason: "missing_payment_reference",
      httpStatus: 400,
      message: "This deposit carries no Stripe payment reference, so a refund cannot be created for it.",
    };
  }
  return { ok: true, paymentIntentId, sessionId: stripeSessionIdFromRow(row) };
}

/**
 * Build the form field set for POST /v1/refunds. A full refund of the
 * PaymentIntent — no amount is sent, so Stripe refunds exactly what
 * was charged and a partial-refund arithmetic bug is impossible here.
 */
export function buildStripeRefundParams(input: {
  paymentIntentId: string;
  ledgerId?: string | null;
}): Record<string, string> {
  const params: Record<string, string> = {
    payment_intent: input.paymentIntentId,
  };
  if (input.ledgerId) params["metadata[ledger_id]"] = input.ledgerId;
  return params;
}

/** The refund create call's Idempotency-Key — one refund per deposit. */
export function stripeRefundIdempotencyKey(ledgerId: string): string {
  return `refund:${ledgerId}`;
}

export type StripeRefundStatus = "pending" | "succeeded" | "failed" | "canceled" | "unknown";

/** Normalise a Stripe refund status to the set this app records. */
export function mapStripeRefundStatus(status: string | null | undefined): StripeRefundStatus {
  switch ((status ?? "").trim().toLowerCase()) {
    case "pending":
    case "requires_action":
      return "pending";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "unknown";
  }
}

/**
 * Classified plain language for a failed Stripe refund create —
 * the caller answers 502 with this and nothing from Stripe's raw
 * error message (which can echo request values) reaches the admin.
 */
export function plainStripeRefundError(error: StripeApiErrorLike | null | undefined): string {
  if (error?.code === "charge_already_refunded") {
    return "This payment has already been refunded in Stripe. No further refund was created.";
  }
  if (error?.code === "payment_intent_unexpected_state") {
    return "Stripe says this payment is not in a state that can be refunded. No money has moved.";
  }
  return "Stripe could not create this refund. No money has moved — please try again.";
}
