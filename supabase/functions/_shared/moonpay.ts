// Pure decision logic for the MoonPay card ON-RAMP (edge functions
// `moonpay-session`, `moonpay-webhook`, `moonpay-admin` and
// `moonpay-reconcile`).
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
  /**
   * Audit M-4: the publishable and secret keys carry DIFFERENT
   * environment prefixes (pk_live_ with sk_test_, or the reverse).
   * Such a pair can never work — the widget would load on one
   * host while URLs are signed for the other — so it is detected
   * here, refused by moonpay-session and reported by
   * moonpay-admin, instead of surfacing as MoonPay-side failures
   * after the rail is switched on.
   */
  keyEnvironmentMismatch: boolean;
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
 * The environment a key's prefix DECLARES, or null when the prefix
 * is not a recognisable MoonPay key prefix at all. Unlike
 * moonpayEnvironmentFromKey this never guesses — the M-4 mismatch
 * check must only fire on two keys that positively declare
 * different environments.
 */
export function moonpayDeclaredKeyEnvironment(
  key: string | null | undefined,
): MoonpayEnvironment | null {
  const k = typeof key === "string" ? key.trim() : "";
  if (k.startsWith("pk_live_") || k.startsWith("sk_live_")) return "production";
  if (k.startsWith("pk_test_") || k.startsWith("sk_test_")) return "sandbox";
  return null;
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
  const publishableEnv = moonpayDeclaredKeyEnvironment(publishableKey);
  const secretEnv = moonpayDeclaredKeyEnvironment(secretKey);
  return {
    publishableKey,
    secretKey,
    webhookKey,
    configured: publishableKey !== null && secretKey !== null,
    hasWebhookKey: webhookKey !== null,
    environment: moonpayEnvironmentFromKey(secretKey ?? publishableKey),
    keyEnvironmentMismatch:
      publishableEnv !== null && secretEnv !== null && publishableEnv !== secretEnv,
  };
}

// ── Plain-language messages (CEO error rule: never raw provider text) ─

export const MOONPAY_NOT_CONFIGURED_MESSAGE =
  "Card payments aren't switched on yet — MoonPay is still being connected. No money has moved.";

export const MOONPAY_MISCONFIGURED_MESSAGE =
  "Card payments are paused while we fix a configuration problem on our side. No money has moved — please try again later.";

/**
 * The custodial rail's off-state message (CEO directive 2026-10-27):
 * card buying into the CUSTODIAL wallet is "available soon", and the
 * user is pointed at the self-custody wallet, where card buying via
 * MoonPay (the Breez-arranged checkout in the user's own browser)
 * already works. This session function is custodial-only by
 * construction — it always delivers to the caller's platform deposit
 * address and ignores any caller-supplied address.
 */
export const MOONPAY_COMING_SOON_MESSAGE =
  "Buying Bitcoin by card into this wallet is available soon — MoonPay is connected but not switched on for the custodial wallet yet. " +
  "You can buy Bitcoin by card now in your self-custody wallet, where MoonPay delivers it straight to your own wallet. No money has moved.";

export const MOONPAY_ZMW_MESSAGE =
  "MoonPay can't take Zambian kwacha (ZMW) yet, so card purchases are in US dollars for now. " +
  "Choose USD to continue — your Bitcoin still lands in the same wallet.";

export const MOONPAY_UNSUPPORTED_CURRENCY_MESSAGE =
  "Card purchases can be made in USD, EUR or GBP. Choose one of those currencies to continue.";

export const MOONPAY_INVALID_AMOUNT_MESSAGE =
  "Enter an amount greater than zero, or leave the amount blank and choose it on MoonPay's page.";

/**
 * Gap closure 2026-10-27 (P1): MoonPay's current docs define
 * baseCurrencyAmount as a positive INTEGER. A fractional amount is
 * refused here rather than rounded — rounding would silently change
 * the amount the customer agreed to pay.
 */
export const MOONPAY_WHOLE_AMOUNT_MESSAGE =
  "Card purchases are in whole amounts — enter a whole number like 50, or leave the amount blank and choose it on MoonPay's page. No money has moved.";

/**
 * Gap closure 2026-10-27 (P0): in production, a signed widget URL
 * MUST carry allowedIpAddress (MoonPay IP matching). When the
 * caller's IP cannot be derived server-side there is nothing honest
 * to bind the URL to, so the session refuses instead of minting an
 * unbound live URL.
 */
export const MOONPAY_IP_UNVERIFIED_MESSAGE =
  "We couldn't verify your connection to secure this purchase, so it hasn't been started. No money has moved — please reconnect and try again.";

// ── Fiat amount validation ───────────────────────────────────────────

export type MoonpayAmountRejection = "invalid" | "fractional";

/**
 * Classify a requested fiat amount: "invalid" (not a finite
 * positive number), "fractional" (positive but not a whole number —
 * MoonPay's baseCurrencyAmount is a positive integer per current
 * docs), or null when the amount may be sent as-is.
 */
export function moonpayAmountRejection(amount: number): MoonpayAmountRejection | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "invalid";
  }
  if (!Number.isInteger(amount)) return "fractional";
  return null;
}

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
  /**
   * IP matching (MoonPay docs, mandatory for going live): base64
   * HMAC-SHA256 of the customer's canonicalised public IP, computed
   * by computeMoonpayAllowedIpAddress. Part of the SIGNED query —
   * never appended after signing.
   */
  allowedIpAddress?: string | null;
  // NOTE: there is deliberately NO currencyCode input. The contract
  // (moonpay-api-contract.md) locks this rail to buying BTC, and a
  // caller-supplied currency once flowed straight through this
  // builder (audit M1, 2026-10-26) — the widget URL now always
  // carries currencyCode=btc, structurally.
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
    ["currencyCode", "btc"],
    ["walletAddress", input.walletAddress],
  ];
  if (input.email) params.push(["email", input.email]);
  params.push(["externalTransactionId", input.externalTransactionId]);
  if (input.externalCustomerId) {
    params.push(["externalCustomerId", input.externalCustomerId]);
  }
  if (input.allowedIpAddress) {
    params.push(["allowedIpAddress", input.allowedIpAddress]);
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

// ── IP matching (allowedIpAddress) ───────────────────────────────────
//
// MoonPay docs (dev.moonpay.com/widget/on-ramp/customization/
// ip-matching, updated 2026-08-20): IP matching is MANDATORY for
// going live. Every signed live widget URL carries
// `allowedIpAddress` = base64 HMAC-SHA256, keyed with the SECRET
// key, of the customer's canonicalised public IP, inside the signed
// query. When the widget loads, MoonPay hashes the IP it observes
// and compares — a mismatch blocks the widget with an "Unverified
// Connection" error. Sandbox enforces by default; production is
// logged-only until MoonPay switches enforcement on per account.
// Canonicalisation rules are MoonPay's, verbatim:
//   - IPv4: dotted-quad, no leading zeros.
//   - IPv6: RFC 5952 — lowercase, longest zero run (length ≥ 2,
//     first on a tie) compressed with "::", no leading zeros.
//   - IPv4-mapped IPv6 (::ffff:203.0.113.42) is UNMAPPED to plain
//     IPv4 before hashing.
//   - Ports and brackets are stripped before hashing.

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

function parseIpv6Groups(value: string): number[] | null {
  let rest = value;
  // An embedded dotted-quad tail (final 32 bits) is rewritten as two
  // hex groups first, so the group parser below sees one shape.
  if (rest.includes(".")) {
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIpv4(rest.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    rest = `${rest.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const out: number[] = [];
    for (const part of half.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };
  const halves = rest.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 2) {
    const left = parseHalf(halves[0]);
    const right = parseHalf(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null; // "::" must stand for ≥ 1 group
    return [...left, ...new Array<number>(missing).fill(0), ...right];
  }
  const all = parseHalf(rest);
  if (!all || all.length !== 8) return null;
  return all;
}

/**
 * Canonicalise an IP address exactly as MoonPay's IP-matching docs
 * prescribe (see the section comment). Returns the canonical string,
 * or null when the input is not a usable IPv4/IPv6 address.
 */
export function canonicaliseIpAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("[")) {
    // Bracketed form, optionally with a port: [2001:db8::1]:443
    const close = value.indexOf("]");
    if (close < 0) return null;
    value = value.slice(1, close);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    // IPv4 with a port: 203.0.113.42:8443
    value = value.slice(0, value.lastIndexOf(":"));
  }
  if (!value.includes(":")) {
    const v4 = parseIpv4(value);
    return v4 ? v4.join(".") : null;
  }
  const groups = parseIpv6Groups(value);
  if (!groups) return null;
  // IPv4-mapped IPv6 is unmapped to plain IPv4 (MoonPay's rule).
  if (
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && groups[5] === 0xffff
  ) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  // RFC 5952: compress the longest run of zero groups (length ≥ 2;
  // the FIRST run wins a tie) with "::".
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (runStart < 0) runStart = i;
      runLen++;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen >= 2 && bestStart >= 0) {
    const left = hex.slice(0, bestStart).join(":");
    const right = hex.slice(bestStart + bestLen).join(":");
    return `${left}::${right}`;
  }
  return hex.join(":");
}

/** Cloudflare pseudo-IPv4 placeholder range: 240.0.0.0/4. */
function isCloudflarePseudoIpv4(canonicalIp: string): boolean {
  if (canonicalIp.includes(":")) return false;
  const first = Number(canonicalIp.split(".")[0]);
  return Number.isInteger(first) && first >= 240;
}

export interface MoonpayHeaderReader {
  get(name: string): string | null;
}

/**
 * Derive the customer's public IP from the request headers,
 * canonicalised for hashing. Header priority follows MoonPay's
 * guidance first — True-Client-IP is the documented source — then
 * CF-Connecting-IP (with MoonPay's pseudo-IPv4 rule: when it holds
 * a 240.0.0.0/4 placeholder, CF-Connecting-IPv6 carries the real
 * address), then what the Supabase gateway actually populates in
 * this codebase: X-Forwarded-For's first hop (the precedent in
 * manage-virtual-card, pos and validate-card-access), then
 * X-Real-IP. An unusable header value never wins — the chain falls
 * through to the next source, and null means "no IP derivable".
 */
export function extractMoonpayClientIp(headers: MoonpayHeaderReader): string | null {
  const read = (name: string): string | null => {
    try {
      return headers.get(name);
    } catch {
      return null;
    }
  };
  const trueClientIp = canonicaliseIpAddress(read("true-client-ip"));
  if (trueClientIp) return trueClientIp;
  const cfIp = canonicaliseIpAddress(read("cf-connecting-ip"));
  if (cfIp && !isCloudflarePseudoIpv4(cfIp)) return cfIp;
  if (cfIp) {
    const cfIpv6 = canonicaliseIpAddress(read("cf-connecting-ipv6"));
    if (cfIpv6) return cfIpv6;
  }
  const forwardedFor = read("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = canonicaliseIpAddress(forwardedFor.split(",")[0]);
    if (firstHop) return firstHop;
  }
  return canonicaliseIpAddress(read("x-real-ip"));
}

/**
 * The allowedIpAddress value: base64 HMAC-SHA256 of the CANONICAL
 * IP, keyed with the secret key. The caller must pass the output of
 * canonicaliseIpAddress / extractMoonpayClientIp — HMAC is
 * formatting-sensitive, so hashing any other spelling would never
 * match the IP MoonPay observes.
 */
export async function computeMoonpayAllowedIpAddress(
  canonicalIp: string,
  secretKey: string,
): Promise<string> {
  const digest = await hmacSha256(secretKey, canonicalIp);
  return bytesToBase64(digest);
}

// ── Roles ────────────────────────────────────────────────────────────

/** Roles allowed into the MoonPay admin console. */
// deno-lint-ignore no-explicit-any
type RolesReader = any;

/**
 * Admin gate for moonpay-admin / moonpay-session console actions:
 * the caller must hold an admin or super_admin row in user_roles
 * (resolved server-side via the service-role client).
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
 *
 * NO timestamp freshness window (audit M-3, decided 2026-10-26):
 * MoonPay's docs prescribe no tolerance for `t`, and MoonPay
 * REDELIVERS webhooks by re-sending the original signed request —
 * the `t` on a legitimate retry can be hours old, so a window
 * would reject exactly the retries the endpoint exists to accept.
 * Replay safety comes from the signature itself plus the
 * (type + transaction id + updatedAt) dedupe / order guard in the
 * webhook (audit M-1), not from freshness.
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
  /**
   * OUR user id as MoonPay echoes it at the payload's TOP level
   * (externalCustomerId sits beside `type`/`data`, not inside
   * `data` — audit M-2). moonpay-session sets it to the caller's
   * user id, so an otherwise-unmatched webhook row can still be
   * linked back to its owner.
   */
  externalCustomerId: string | null;
  moonpayTransactionId: string | null;
  /**
   * data.updatedAt — when MoonPay last changed the transaction
   * (ISO 8601), and its epoch-ms form. The dedupe / order-guard
   * key (with type + transaction id) that keeps stale deliveries
   * from overwriting newer tracking state (audit M-1).
   */
  updatedAt: string | null;
  updatedAtMs: number | null;
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
  const updatedAt = stringOrNull(data.updatedAt);
  const updatedAtMs = updatedAt !== null ? Date.parse(updatedAt) : NaN;
  return {
    type: stringOrNull(root?.type),
    externalReference: stringOrNull(data.externalTransactionId),
    externalCustomerId: stringOrNull(root?.externalCustomerId),
    moonpayTransactionId: stringOrNull(data.id),
    updatedAt,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
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

/**
 * Order guard for webhook application (audit M-1): may an event
 * whose transaction was last changed at `eventUpdatedAtMs` write
 * to a row that already applied an event stamped
 * `storedUpdatedAtMs`? Delivery is at-least-once and unordered, so
 * an event is applied only when it is NEWER than what the row has
 * already applied — an equal stamp is the same change redelivered
 * (dedupe), an older stamp is stale and must not overwrite
 * tracking fields, least of all on terminal rows. When either
 * side carries no timestamp the event cannot be ordered and is
 * applied (the pre-M-1 behaviour, still bounded by the
 * terminal-sticky status machine).
 */
export function shouldApplyMoonpayEvent(
  storedUpdatedAtMs: number | null | undefined,
  eventUpdatedAtMs: number | null | undefined,
): boolean {
  if (storedUpdatedAtMs == null || eventUpdatedAtMs == null) return true;
  return eventUpdatedAtMs > storedUpdatedAtMs;
}

// ── Reconciliation poller (moonpay-reconcile) ────────────────────────
//
// Webhooks are at-least-once with up to ~9 retries — but a terminal
// event that exhausts its retries is lost for good, and without a
// backstop its row would sit non-terminal forever. The poller
// (edge function moonpay-reconcile, pg_cron every 15 minutes)
// re-reads stale non-terminal rows from MoonPay's API
// (GET /v1/transactions/{id}) and applies what it learns through
// planMoonpayEventApplication — the SAME application plan the
// webhook uses, so the order guard, the terminal-sticky status
// machine and the tracking-field semantics exist exactly once.
// There is deliberately no second settlement path: the poller can
// only ever write what a webhook event with the same updatedAt
// would have written, and re-polling an already-applied state is a
// no-op by the order guard (the event's stamp is no longer newer
// than the row's applied stamp).

/** A non-terminal row untouched for this long is re-read from MoonPay. */
export const MOONPAY_RECONCILE_STALE_MS = 15 * 60 * 1000;

export const MOONPAY_NON_TERMINAL_STATUSES: readonly string[] = [
  "initiated",
  "waiting_payment",
  "pending",
  "waiting_authorization",
];

export interface MoonpayReconcileCandidate {
  status: string | null;
  /** MoonPay's transaction id — the poller's lookup key. */
  moonpayTransactionId: string | null;
  /** Row's last-activity stamp (updated_at), epoch ms. */
  updatedAtMs: number | null;
}

/**
 * Is this row worth a MoonPay API read? Only a NON-TERMINAL row
 * MoonPay can be asked about (it carries a MoonPay transaction id —
 * a purely local 'initiated' row has nothing to look up) whose
 * last activity is at least MOONPAY_RECONCILE_STALE_MS old. A null
 * activity stamp means nothing has ever touched the row, which is
 * as stale as it gets.
 */
export function isStaleMoonpayTransaction(
  candidate: MoonpayReconcileCandidate,
  nowMs: number,
): boolean {
  if (!candidate.moonpayTransactionId) return false;
  if (!candidate.status) return false;
  if (!(MOONPAY_NON_TERMINAL_STATUSES as readonly string[]).includes(candidate.status)) {
    return false;
  }
  if (candidate.updatedAtMs == null) return true;
  return nowMs - candidate.updatedAtMs >= MOONPAY_RECONCILE_STALE_MS;
}

export function selectStaleMoonpayTransactions<T extends MoonpayReconcileCandidate>(
  rows: readonly T[],
  nowMs: number,
): T[] {
  return rows.filter((row) => isStaleMoonpayTransaction(row, nowMs));
}

/**
 * Parse a GET /v1/transactions/{id} response into the same shape
 * the webhook parser produces. The API returns the BARE transaction
 * object — the same fields a webhook carries inside `data`, with
 * externalCustomerId as a field of the transaction itself — so the
 * lookup is folded into the webhook envelope and parsed by the one
 * parser. The synthetic event type is "transaction_updated": a poll
 * learns the transaction's current state, nothing more specific.
 */
export function parseMoonpayTransactionLookup(
  payload: unknown,
): ParsedMoonpayWebhookEvent {
  const root = asRecord(payload);
  if (!root) return parseMoonpayWebhookEvent(null);
  return parseMoonpayWebhookEvent({
    type: "transaction_updated",
    data: root,
    externalCustomerId: stringOrNull(root.externalCustomerId),
  });
}

export interface MoonpayRowApplicationState {
  status: string | null;
  /** The row's applied-event stamp (last_event_updated_at), epoch ms. */
  lastEventUpdatedAtMs: number | null;
}

export interface MoonpayEventApplicationPlan {
  /** False when the event is a duplicate or stale (order guard). */
  apply: boolean;
  /** The moonpay_transactions update to write when apply is true. */
  update: Record<string, unknown> | null;
}

/**
 * THE event-application plan, shared verbatim by moonpay-webhook
 * and moonpay-reconcile: given a row's current state and a parsed
 * event (from a webhook payload or an API lookup — indistinguishable
 * here), decide whether the event applies and, if so, the exact
 * update to write. The order guard runs first (a duplicate or stale
 * event changes nothing); the status inside the update still passes
 * through the terminal-sticky machine, so a newer event may refresh
 * a terminal row's tracking fields but can never move its status.
 * `eventLabel` overrides the recorded last_webhook_event (the
 * poller passes "reconcile_poll" so the audit trail can tell a poll
 * apart from a delivered webhook).
 */
export function planMoonpayEventApplication(
  rowState: MoonpayRowApplicationState,
  parsed: ParsedMoonpayWebhookEvent,
  rawPayload: unknown,
  nowIso: string,
  eventLabel?: string,
): MoonpayEventApplicationPlan {
  if (!shouldApplyMoonpayEvent(rowState.lastEventUpdatedAtMs, parsed.updatedAtMs)) {
    return { apply: false, update: null };
  }
  const update: Record<string, unknown> = {
    raw_status: parsed.rawStatus,
    last_webhook_event: eventLabel ?? parsed.type,
    last_webhook_payload: rawPayload,
    updated_at: nowIso,
  };
  if (parsed.updatedAt) update.last_event_updated_at = parsed.updatedAt;
  if (parsed.status && canApplyMoonpayStatus(rowState.status, parsed.status)) {
    update.status = parsed.status;
  }
  if (parsed.moonpayTransactionId) {
    update.moonpay_transaction_id = parsed.moonpayTransactionId;
  }
  if (parsed.fiatAmount !== null) update.fiat_amount = parsed.fiatAmount;
  if (parsed.fiatCurrency) update.fiat_currency = parsed.fiatCurrency;
  if (parsed.cryptoAmount !== null) update.crypto_amount = parsed.cryptoAmount;
  if (parsed.feeAmount !== null) update.fee_amount = parsed.feeAmount;
  if (parsed.cryptoTransactionId) {
    update.crypto_transaction_id = parsed.cryptoTransactionId;
  }
  if (parsed.failureReason) update.failure_reason = parsed.failureReason;
  return { apply: true, update };
}
