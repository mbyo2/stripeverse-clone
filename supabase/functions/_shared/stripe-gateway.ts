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
// falls back to USD against the caller's USD wallet in the same
// account scope — the exact PayPal precedent in this app (PayPal
// cannot take ZMW at all, so that rail is USD-only from the start).
// The fallback is recorded on the ledger row and reported in the
// checkout response; nothing about it is silent.

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

// ── Stripe API errors ────────────────────────────────────────────────

export interface StripeApiErrorLike {
  type?: string | null;
  code?: string | null;
  param?: string | null;
  message?: string | null;
}

/**
 * True when a Stripe error is the currency rejection the ZMW attempt
 * can meet: an invalid_request_error whose message names the
 * currency. Deliberately narrow — any other failure must surface as a
 * failure, never trigger the USD fallback.
 */
export function isStripeCurrencyRejection(error: StripeApiErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "currency_not_supported") return true;
  if (error.type !== "invalid_request_error") return false;
  if (error.param && error.param.includes("currency")) return true;
  return typeof error.message === "string" && /currenc/i.test(error.message);
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

// ── Webhook signature verification ───────────────────────────────────

/**
 * Parse a `Stripe-Signature` header (`t=<ts>,v1=<hex>[,v1=<hex>...]`)
 * — multiple v1 values appear during signing-secret rotation and any
 * one of them may match. Returns null for anything malformed.
 */
export function parseStripeSignatureHeader(
  header: string | null | undefined,
): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
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
      encoder.encode(`${parsed.timestamp}.${rawBody}`),
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
