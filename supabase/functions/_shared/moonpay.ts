// Pure decision logic for the MoonPay card ON-RAMP (edge functions
// `moonpay-session`, `moonpay-webhook` and `moonpay-admin`).
// Import-free on purpose: the exact file Deno runs is loaded by the
// vitest suite in tests/payments/moonpay.test.ts.
//
// This rail is the card-based way to buy BTC (CEO decision
// 2026-10-24): the customer pays by card inside MoonPay's hosted
// widget, and MoonPay sends the BTC to the user's OWN platform
// deposit address (the btc-onchain assigned address). The existing
// deposit-detection pipeline credits the wallet when the deposit
// lands — this module builds NO crediting path. Webhooks are
// tracking / reconciliation only.
//
// Shapes (contract: moonpay-api-contract.md, researched 2026-10-24
// from MoonPay's developer docs + live API checks):
//   - Widget hosts: buy.moonpay.com (production) /
//     buy-sandbox.moonpay.com (sandbox). Environment derives from
//     the key prefix: pk_test_/sk_test_ = sandbox, pk_live_/sk_live_
//     = production. Switching to production is a keys-only change.
//   - URL signing: HMAC-SHA256 with the SECRET key over the query
//     string INCLUDING the leading '?', every value URL-encoded
//     before signing; signature = base64 digest, URL-encoded,
//     appended last as &signature=...
//   - Webhooks: header Moonpay-Signature-V2 `t=<unix>,s=<hex>` —
//     HMAC-SHA256 hex of "<t>.<rawBody>" keyed with the webhook API
//     key. Events transaction_created / transaction_updated /
//     transaction_failed carry data.externalTransactionId = OUR
//     reference (the reconciliation key).
//   - Zambia IS buy-supported; ZMW is NOT a MoonPay fiat. Sessions
//     default to USD (EUR / GBP allowed); ZMW is refused plainly.
//
// Secrets (Supabase, names only): MOONPAY_PUBLISHABLE_KEY,
// MOONPAY_SECRET_KEY, MOONPAY_WEBHOOK_KEY.

// ── Configuration ────────────────────────────────────────────────────

export type MoonpayEnvironment = "sandbox" | "production";

export const MOONPAY_BUY_HOST: Record<MoonpayEnvironment, string> = {
  sandbox: "https://buy-sandbox.moonpay.com",
  production: "https://buy.moonpay.com",
};

export function moonpayBuyHost(environment: MoonpayEnvironment): string {
  return MOONPAY_BUY_HOST[environment];
}

/** Our registered webhook endpoint (registered in MoonPay's dashboard). */
export const MOONPAY_WEBHOOK_URL =
  "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/moonpay-webhook";

/** Raw secret VALUES as read from the environment (never logged). */
export interface MoonpayEnvValues {
  publishableKey?: string | null;
  secretKey?: string | null;
  webhookKey?: string | null;
}

export interface MoonpayConfig {
  publishableKey: string | null;
  secretKey: string | null;
  webhookKey: string | null;
  /**
   * True only when BOTH widget keys exist. The session function
   * refuses `not_configured` before writing any row while this is
   * false. The webhook key gates only the webhook function.
   */
  configured: boolean;
  hasWebhookKey: boolean;
  environment: MoonpayEnvironment;
}

function present(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Environment from a key prefix: _test_ keys are sandbox, _live_
 * keys are production. Unknown prefixes fall back to sandbox — a
 * malformed key must never silently point at the live host.
 */
export function moonpayEnvironmentFromKey(
  key: string | null | undefined,
): MoonpayEnvironment {
  const k = typeof key === "string" ? key.trim() : "";
  if (k.startsWith("pk_live_") || k.startsWith("sk_live_")) return "production";
  return "sandbox";
}

/**
 * Resolve the rail's configuration from the MOONPAY_* values.
 * Environment comes from the secret key when present, else the
 * publishable key.
 */
export function moonpayConfig(env: MoonpayEnvValues): MoonpayConfig {
  const publishableKey = present(env.publishableKey);
  const secretKey = present(env.secretKey);
  const webhookKey = present(env.webhookKey);
  return {
    publishableKey,
    secretKey,
    webhookKey,
    configured: publishableKey !== null && secretKey !== null,
    hasWebhookKey: webhookKey !== null,
    environment: moonpayEnvironmentFromKey(secretKey ?? publishableKey),
  };
}

// ── Plain-language messages (CEO error rule: never raw provider text) ─

export const MOONPAY_NOT_CONFIGURED_MESSAGE =
  "Card payments aren't switched on yet — MoonPay is still being connected. No money has moved.";

export const MOONPAY_COMING_SOON_MESSAGE =
  "Buying Bitcoin by card is coming soon — MoonPay is connected but not switched on yet. No money has moved.";

export const MOONPAY_ZMW_MESSAGE =
  "MoonPay can't take Zambian kwacha (ZMW) yet, so card purchases are in US dollars for now. " +
  "Choose USD to continue — your Bitcoin still lands in the same wallet.";

export const MOONPAY_UNSUPPORTED_CURRENCY_MESSAGE =
  "Card purchases can be made in USD, EUR or GBP. Choose one of those currencies to continue.";

export const MOONPAY_INVALID_AMOUNT_MESSAGE =
  "Enter an amount greater than zero, or leave the amount blank and choose it on MoonPay's page.";

export const MOONPAY_ADMIN_REFUSAL_MESSAGE =
  "The MoonPay console is available to administrators only.";

// ── Buy widget URL ───────────────────────────────────────────────────

export interface MoonpayBuyUrlInput {
  walletAddress: string;
  email?: string | null;
  externalTransactionId: string;
  externalCustomerId?: string | null;
  /** Fiat code (any case) — lowercased for the widget. Default USD. */
  baseCurrencyCode?: string | null;
  baseCurrencyAmount?: number | null;
  redirectUrl?: string | null;
  /** Crypto to buy — locked to BTC for this rail. Default 'btc'. */
  currencyCode?: string | null;
}

/**
 * Build the (unsigned) MoonPay buy widget URL. Parameters are
 * emitted in the fixed documented order and every value is
 * URL-encoded with encodeURIComponent — the signature is computed
 * over exactly this encoded query string, so the encoding here IS
 * part of the signing contract.
 */
export function buildMoonpayBuyUrl(
  config: MoonpayConfig,
  input: MoonpayBuyUrlInput,
): string {
  const host = moonpayBuyHost(config.environment);
  const params: Array<[string, string]> = [
    ["apiKey", config.publishableKey ?? ""],
    ["currencyCode", (input.currencyCode ?? "btc").trim().toLowerCase()],
    ["walletAddress", input.walletAddress],
  ];
  if (input.email) params.push(["email", input.email]);
  params.push(["externalTransactionId", input.externalTransactionId]);
  if (input.externalCustomerId) {
    params.push(["externalCustomerId", input.externalCustomerId]);
  }
  params.push([
    "baseCurrencyCode",
    (input.baseCurrencyCode ?? "USD").trim().toLowerCase(),
  ]);
  if (typeof input.baseCurrencyAmount === "number" && Number.isFinite(input.baseCurrencyAmount)) {
    params.push(["baseCurrencyAmount", String(input.baseCurrencyAmount)]);
  }
  if (input.redirectUrl) params.push(["redirectURL", input.redirectUrl]);
  const query = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${host}/?${query}`;
}

// ── URL signing ──────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function hmacSha256(keyText: string, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(mac);
}

/**
 * Sign a MoonPay widget URL: HMAC-SHA256 keyed with the secret key
 * over the query string INCLUDING the leading '?', base64 digest
 * URL-encoded and appended last as &signature=... The URL must
 * already carry its final, URL-encoded parameters (see
 * buildMoonpayBuyUrl) — sign exactly what leaves our system.
 */
export async function signMoonpayUrl(url: string, secretKey: string): Promise<string> {
  const qIndex = url.indexOf("?");
  const queryString = qIndex >= 0 ? url.slice(qIndex) : `?${url}`;
  const digest = await hmacSha256(secretKey, queryString);
  const signature = bytesToBase64(digest);
  return `${url}&signature=${encodeURIComponent(signature)}`;
}

/** Build the buy URL and sign it in one step. */
export async function buildSignedMoonpayBuyUrl(
  config: MoonpayConfig,
  input: MoonpayBuyUrlInput,
): Promise<string> {
  if (!config.secretKey) {
    throw new Error(MOONPAY_NOT_CONFIGURED_MESSAGE);
  }
  return signMoonpayUrl(buildMoonpayBuyUrl(config, input), config.secretKey);
}

// ── Roles ────────────────────────────────────────────────────────────

/** Roles allowed into the MoonPay admin console. */
// deno-lint-ignore no-explicit-any
type RolesReader = any;

/**
 * Admin gate for moonpay-admin / moonpay-session console actions:
 * the caller must hold an admin or super_admin row in user_roles
 * (mirrors canUseStripeGateway's role set, resolved server-side via
 * the service-role client).
 */
export async function canUseMoonpayAdmin(
  client: RolesReader,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(`Role lookup failed: ${error.message}`);
  const roles = ((data ?? []) as Array<{ role: string }>).map((r) => r.role);
  return canUseMoonpay(roles);
}

export const MOONPAY_ADMIN_ROLES = ["admin", "super_admin"] as const;

export function canUseMoonpay(roles: readonly string[]): boolean {
  return roles.some((r) => (MOONPAY_ADMIN_ROLES as readonly string[]).includes(r));
}

// ── Webhook signature verification ─────────────────────────────────

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
 * Parse a `Moonpay-Signature-V2` header (`t=<unix>,s=<hex>`).
 * Returns null for anything malformed.
 */
export function parseMoonpaySignatureHeader(
  header: string | null | undefined,
): { timestamp: string; signature: string } | null {
  if (!header) return null;
  let timestamp: string | null = null;
  let signature: string | null = null;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && value) timestamp = value;
    else if (key === "s" && value) signature = value;
  }
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

/**
 * Verify a MoonPay webhook: HMAC-SHA256 hex of `${t}.${rawBody}`
 * keyed with the webhook API key, compared in constant time.
 * FAILS CLOSED on every irregularity — missing header, missing key,
 * malformed header, no match. The RAW body is required: any JSON
 * re-serialisation changes the bytes and breaks the signature.
 */
export async function verifyMoonpayWebhookSignature(
  rawBody: string,
  headerValue: string | null | undefined,
  webhookKey: string | null | undefined,
): Promise<boolean> {
  if (!webhookKey) return false;
  const parsed = parseMoonpaySignatureHeader(headerValue);
  if (!parsed) return false;
  try {
    const mac = await hmacSha256(webhookKey, `${parsed.timestamp}.${rawBody}`);
    const expected = bytesToHex(mac);
    return timingSafeEqualHex(parsed.signature.toLowerCase(), expected);
  } catch {
    return false;
  }
}

// ── Status machine ───────────────────────────────────────────────────

export type MoonpayStatus =
  | "waiting_payment"
  | "pending"
  | "waiting_authorization"
  | "completed"
  | "failed";

/** Map a MoonPay raw status onto our lifecycle; unknown → null. */
export function mapMoonpayStatus(raw: string | null | undefined): MoonpayStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim()) {
    case "waitingPayment":
      return "waiting_payment";
    case "pending":
      return "pending";
    case "waitingAuthorization":
      return "waiting_authorization";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

export function isTerminalMoonpayStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

/**
 * May `next` replace `current`? MoonPay delivery is at-least-once
 * and UNORDERED, so terminal states (completed / failed) never
 * regress — a late event cannot rewrite a finished purchase. Any
 * non-terminal row may move to any mapped status.
 */
export function canApplyMoonpayStatus(
  current: string | null | undefined,
  next: MoonpayStatus | null | undefined,
): boolean {
  if (!next) return false;
  if (current && TERMINAL_STATUSES.has(current)) return false;
  return true;
}

// ── Webhook event parsing ────────────────────────────────────────────

export const MOONPAY_BUY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "transaction_created",
  "transaction_updated",
  "transaction_failed",
]);

export function isMoonpayBuyEvent(type: string | null | undefined): boolean {
  return typeof type === "string" && MOONPAY_BUY_EVENT_TYPES.has(type);
}

export interface ParsedMoonpayWebhookEvent {
  type: string | null;
  /** OUR reference (data.externalTransactionId). */
  externalReference: string | null;
  moonpayTransactionId: string | null;
  rawStatus: string | null;
  status: MoonpayStatus | null;
  fiatAmount: number | null;
  /** data.baseCurrency.code, uppercased. */
  fiatCurrency: string | null;
  cryptoAmount: number | null;
  feeAmount: number | null;
  walletAddress: string | null;
  cryptoTransactionId: string | null;
  failureReason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a MoonPay webhook body ({ type, data, externalCustomerId })
 * into the fields the tracking layer records. Tolerates missing
 * fields throughout — a partial payload records what it carries and
 * never throws. Amounts come from the payload for TRACKING only;
 * no crediting decision is ever made from them.
 */
export function parseMoonpayWebhookEvent(body: unknown): ParsedMoonpayWebhookEvent {
  const root = asRecord(body);
  const data = asRecord(root?.data) ?? {};
  const baseCurrency = asRecord(data.baseCurrency);
  const fiatCurrencyRaw = stringOrNull(baseCurrency?.code);
  return {
    type: stringOrNull(root?.type),
    externalReference: stringOrNull(data.externalTransactionId),
    moonpayTransactionId: stringOrNull(data.id),
    rawStatus: stringOrNull(data.status),
    status: mapMoonpayStatus(stringOrNull(data.status)),
    fiatAmount: numberOrNull(data.baseCurrencyAmount),
    fiatCurrency: fiatCurrencyRaw ? fiatCurrencyRaw.toUpperCase() : null,
    cryptoAmount: numberOrNull(data.quoteCurrencyAmount),
    feeAmount: numberOrNull(data.feeAmount),
    walletAddress: stringOrNull(data.walletAddress),
    cryptoTransactionId: stringOrNull(data.cryptoTransactionId),
    failureReason: stringOrNull(data.failureReason),
  };
}
