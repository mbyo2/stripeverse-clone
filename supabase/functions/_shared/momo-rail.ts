// Merchant mobile-money rail — pure logic shared by the edge
// functions and the vitest suite (deliberately free of Deno-specific
// APIs, same pattern as _shared/connector-config.ts).
//
// Model (CEO decisions, 2026-11-09; build ordered 2026-11-11):
//   * Each merchant connects their OWN mobile-money gateway account
//     by pasting their own API keys. The platform never holds a
//     platform gateway account for merchant collections, never routes
//     merchant funds through one, and settlements inside the app
//     credit the merchant's own custodial wallet.
//   * The platform's 1% is a separate charge recorded against the
//     merchant on each settled collection — never deducted from the
//     settlement itself.
//   * Zambia only: the business-country gate lives in
//     merchant_accounts + the connector-config matrix; every money
//     path in this module's server companion re-checks it.
//   * WHITE-LABEL: the underlying rail's name appears NOWHERE in any
//     string a merchant or customer can see. Users see "Mobile
//     money", "MTN", "Airtel", "Zamtel" only. This module is internal
//     code; its exported strings are all user-safe by construction
//     and pinned by tests/payments/momoRail.test.ts.

export type MomoOperator = "mtn" | "airtel" | "zamtel";
export type MomoEnvironment = "sandbox" | "production";

/** Gateway base URLs per environment. Sandbox simulates with test
 *  phone numbers; production moves real money. The environment comes
 *  from the merchant's saved connection, never from a request. */
export function railBaseUrl(environment: MomoEnvironment, override?: string | null): string {
  if (override && /^https:\/\//.test(override)) return override.replace(/\/$/, "");
  return environment === "sandbox"
    ? "https://sandbox.lenco.co/access/v2"
    : "https://api.lenco.co/access/v2";
}

/** Normalise a Zambian MSISDN to the local 0-prefixed format the
 *  gateway's docs use (e.g. 0977433571): strip spaces/punctuation and
 *  a leading '+', convert a 260 country-code prefix to the trunk 0. */
export function normalizeZmPhone(raw: string): string {
  let p = String(raw || "").replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (/^260\d{9}$/.test(p)) p = "0" + p.slice(3);
  return p;
}

export function isValidZmPhone(raw: string): boolean {
  return /^0\d{9}$/.test(normalizeZmPhone(raw));
}

/** Detect the mobile-money operator from a Zambian number's prefix.
 *  Returns null for prefixes no Zambian operator owns. */
export function detectOperator(raw: string): MomoOperator | null {
  const p = normalizeZmPhone(raw);
  const prefix = p.slice(0, 3);
  if (prefix === "096" || prefix === "076") return "mtn";
  if (prefix === "097" || prefix === "077") return "airtel";
  if (prefix === "095") return "zamtel";
  return null;
}

export function operatorLabel(op: MomoOperator): string {
  return op === "mtn" ? "MTN" : op === "airtel" ? "Airtel" : "Zamtel";
}

/** One payment, one reference — generated before the gateway call and
 *  persisted with the ledger row (the gateway's only idempotency
 *  mechanism: a duplicate reference is refused upstream).
 *  Charset is the gateway's: alphanumerics plus - . _ only. */
export function generateCollectionReference(now = Date.now(), rand = Math.random()): string {
  const t = now.toString(36).toUpperCase();
  const r = Math.floor(rand * 0xffffffff).toString(36).toUpperCase().padStart(7, "0");
  return `BMG-${t}-${r}`;
}

export function isValidCollectionReference(ref: string): boolean {
  return /^[A-Za-z0-9\-._]{8,64}$/.test(ref);
}

/** Map a gateway collection status onto the platform's internal
 *  three-state model. 'pay-offline' means the customer still has to
 *  approve on their handset — money has NOT moved. */
export type MomoInternalStatus = "pending" | "successful" | "failed";
export function mapProviderStatus(raw: string | null | undefined): MomoInternalStatus {
  switch ((raw || "").toLowerCase()) {
    case "successful":
    case "success":
    case "completed":
      return "successful";
    case "failed":
    case "failure":
    case "cancelled":
    case "canceled":
    case "expired":
      return "failed";
    default:
      return "pending";
  }
}

/** The platform charge on a settled collection: 1% of the collected
 *  amount, rounded to the ngwee. Recorded as its own ledger entry —
 *  the settlement itself is always credited in full. */
export function platformChargeFor(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.round(amount * 0.01 * 100) / 100;
}

export const PLATFORM_CHARGE_PERCENT = 1;

/** Webhook signature per the gateway's published contract:
 *  header value = HMAC-SHA512 hex of the RAW request body, keyed with
 *  the SHA-256 hex of the merchant's API token (the token is the
 *  merchant's own secret — the platform derives the same key from the
 *  merchant's connected credential, per connection). */
export async function webhookSignatureFor(rawBody: string, apiToken: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(apiToken));
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(hashHex),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison for hex signatures. */
export function signatureMatches(expected: string, presented: string | null): boolean {
  if (!presented) return false;
  const clean = presented.replace(/^sha512=/i, "").trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (clean.length !== exp.length) return false;
  let diff = 0;
  for (let i = 0; i < exp.length; i++) diff |= clean.charCodeAt(i) ^ exp.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  rawBody: string,
  apiToken: string,
  presented: string | null,
): Promise<boolean> {
  if (!presented) return false;
  const expected = await webhookSignatureFor(rawBody, apiToken);
  return signatureMatches(expected, presented);
}

/** Plain-language failure reasons a customer may see. Upstream reason
 *  strings are never surfaced raw (error-presentation rule). */
export function friendlyFailureReason(providerStatusRaw: string | null | undefined, reasonForFailure?: string | null): string {
  const hay = `${providerStatusRaw ?? ""} ${reasonForFailure ?? ""}`.toLowerCase();
  if (hay.includes("insufficient") || hay.includes("not enough")) {
    return "The payment failed because the mobile money account didn't have enough balance.";
  }
  if (hay.includes("pin") || hay.includes("unauthor") || hay.includes("auth")) {
    return "The payment wasn't approved on the phone. Please try again and enter the correct PIN.";
  }
  if (hay.includes("timeout") || hay.includes("timed out") || hay.includes("expired")) {
    return "The payment timed out before it was approved on the phone. No money was taken — please try again.";
  }
  if (hay.includes("cancel")) {
    return "The payment was cancelled on the phone. No money was taken.";
  }
  return "The payment didn't go through. No money was taken — please try again.";
}

/** What a customer sees while a collection is in flight. */
export const MOMO_PENDING_MESSAGE =
  "Approve the payment prompt on your phone to complete this payment.";

/** Truthful refusal when a merchant has not connected mobile money. */
export const MOMO_NOT_CONFIGURED_MESSAGE =
  "Mobile money isn't set up for this business yet. The business needs to connect mobile money in their BMaGlass Pay settings before it can take mobile money payments.";

/** Truthful refusal when the feature itself is off for the business. */
export const MOMO_NOT_ENABLED_MESSAGE =
  "Mobile money isn't switched on for this business. It can be switched on in the business settings once a mobile money account is connected.";
