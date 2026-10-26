/**
 * BMaGlass Pay SDK for React Native / Expo.
 *
 * A thin typed client over the BMaGlass Pay developer API — the same
 * surface as the TypeScript, Python and PHP SDKs, adapted for React
 * Native: `fetch` is global, and webhook signature verification uses
 * the bundled pure-TS HMAC-SHA256 (src/sha256.ts) because Hermes has
 * no WebCrypto `subtle`.
 *
 * Auth: an API key created in the BMaGlass Pay app. `bmp_live_` keys
 * move real money; `bmp_test_` keys are READ-ONLY — BMaGlass Pay has
 * no test-mode ledger, so a test key can never move money. Writes
 * with a test key throw a BMaGlassError with code
 * `test_mode_read_only`.
 *
 * SECURITY: an API key is a secret. In a mobile app, hold it only
 * where your threat model allows (e.g. your own backend exchanging
 * short-lived calls, or the merchant's own device for their own
 * account) — never ship someone else's key in a public app binary.
 */
import { hmacSha256, timingSafeEqual, toHex, utf8 } from "./sha256.ts";

export const DEFAULT_BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api";
export const SITE_BASE = "https://bmaglasspay.online";
export const SUPPORTED_CURRENCIES = ["ZMW", "USD"] as const;

export class BMaGlassError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "BMaGlassError";
  }
  get isTestModeReadOnly(): boolean {
    return this.code === "test_mode_read_only";
  }
  /** Plain-language message safe to show a user — never raw. */
  userMessage(): string {
    switch (this.code) {
      case "test_mode_read_only":
        return "This BMaGlass API key is a test key. Test keys can check the connection and read wallets, but they can't take payments — BMaGlass Pay has no test-mode ledger, so a test key can never move money. Use a live key (bmp_live_...) to accept payments.";
      case "invalid_api_key":
      case "api_key_revoked":
      case "api_key_expired":
        return "That BMaGlass API key wasn't accepted. Check the key in your BMaGlass Pay account (Business settings or the API page) and try again.";
      case "insufficient_scope":
        return "This BMaGlass API key doesn't have permission for that action. Create a key with the needed scopes in BMaGlass Pay and try again.";
      case "unsupported_currency":
        return this.message;
      default:
        return this.message || `BMaGlass Pay couldn't complete that request (HTTP ${this.status}). Please try again.`;
    }
  }
}

export interface Wallet { id: string; currency: string; balance: number; status: string; created_at: string; updated_at: string }
export interface Transaction { uuid_id: string; amount: number; currency: string; direction: string; status: string; description: string | null; recipient_name: string | null; fee_amount: number | null; created_at: string }
export interface PaymentLink { id: string; title: string; description: string | null; amount: number | null; currency: string; link_code: string; status: string; payment_count: number; total_collected: number; expires_at: string | null; created_at: string }
export interface WebhookEndpoint { id: string; url: string; events: string[]; is_active: boolean; created_at: string; secret?: string }
export interface WebhookDelivery { id: string; webhook_id: string; event_id: string; event_type: string; webhook_url: string; status: string; attempts: number; response_status: number | null; error_message: string | null; created_at: string }

export function paymentLinkUrl(linkCode: string): string {
  return `${SITE_BASE}/pay/${encodeURIComponent(linkCode)}`;
}

export function assertSupportedCurrency(currency: string): string {
  const c = String(currency || "").toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(c)) {
    throw new BMaGlassError(0, "unsupported_currency",
      `BMaGlass Pay wallets are ZMW and USD. This is ${c || "?"}, which has no BMaGlass wallet — no exchange rate has been applied. Use ZMW or USD with BMaGlass Pay.`);
  }
  return c;
}

export interface BMaGlassOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class BMaGlass {
  readonly mode: "test" | "live";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BMaGlassOptions) {
    if (!options.apiKey?.startsWith("bmp_")) {
      throw new BMaGlassError(0, "invalid_api_key", "apiKey must be a BMaGlass Pay API key (bmp_live_... or bmp_test_...).");
    }
    this.apiKey = options.apiKey;
    this.mode = options.apiKey.startsWith("bmp_live_") ? "live" : "test";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const f = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!f) throw new BMaGlassError(0, "network_error", "No fetch implementation available; pass fetchImpl.");
    this.fetchImpl = f;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method,
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (!res.ok) {
      throw new BMaGlassError(res.status, parsed?.error ?? "request_failed", parsed?.message ?? `Request failed with HTTP ${res.status}`);
    }
    return (parsed?.data ?? parsed) as T;
  }

  wallets = {
    list: () => this.request<Wallet[]>("GET", "wallets"),
  };
  transactions = {
    list: (limit = 25) => this.request<Transaction[]>("GET", `transactions?limit=${Math.max(1, Math.min(100, limit))}`),
  };
  transfers = {
    /** Live keys only. Test keys receive a 403 test_mode_read_only BMaGlassError. */
    create: (input: { to_user_id: string; amount: number; currency?: string; description?: string; recipient_name?: string }, idempotencyKey?: string) =>
      this.request<{ transaction_id: string; new_sender_balance: number }>("POST", "transfers",
        { ...input, currency: assertSupportedCurrency(input.currency ?? "ZMW") },
        idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
  paymentLinks = {
    list: () => this.request<PaymentLink[]>("GET", "payment-links"),
    /** Live keys only. */
    create: (input: { title: string; description?: string; amount?: number; currency?: string; expires_at?: string }) =>
      this.request<PaymentLink>("POST", "payment-links",
        { ...input, currency: assertSupportedCurrency(input.currency ?? "ZMW") }),
  };
  bitcoin = {
    balance: () => this.request<Array<{ asset: string; balance_sats: number; available_sats: number; updated_at: string }>>("GET", "bitcoin/balance"),
    depositAddress: () => this.request<{ address: string; derivation_path: string; is_active: boolean; created_at: string }>("GET", "bitcoin/deposit-address"),
    /** Quote only — execution happens in the app. Works with test keys. */
    quote: (input: { side: "buy" | "sell"; amount_zmw?: number; amount_sats?: number }) =>
      this.request<unknown>("POST", "bitcoin/quote", input),
  };
  webhooks = {
    list: () => this.request<WebhookEndpoint[]>("GET", "webhooks"),
    /** The returned secret is shown once — store it immediately. */
    create: (input: { url: string; events?: string[] }) => this.request<WebhookEndpoint>("POST", "webhooks", input),
    remove: (id: string) => this.request<{ id: string; is_active: boolean }>("DELETE", `webhooks/${id}`),
    test: (id: string) => this.request<unknown>("POST", `webhooks/${id}/test`),
    deliveries: () => this.request<WebhookDelivery[]>("GET", "webhook-deliveries"),
  };
}

/**
 * Verify a webhook delivery. `rawBody` must be the exact request body
 * string; `signatureHeader` is the X-BMaGlass-Signature header value
 * ("sha256=<hex>"). Uses the bundled HMAC-SHA256 — no WebCrypto needed.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) return false;
  const expected = "sha256=" + toHex(hmacSha256(utf8(secret), utf8(rawBody)));
  return timingSafeEqual(expected, signatureHeader);
}

export function parseWebhookEvent<T = unknown>(rawBody: string, signatureHeader: string, secret: string): { id: string; type: string; created: string; data: T } | null {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
