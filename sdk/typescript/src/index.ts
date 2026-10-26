/**
 * @bmaglass/sdk — typed client for the BMaGlass Pay Developer API.
 *
 * Auth: an API key created in the BMaGlass Pay app (bmp_live_… moves
 * real money; bmp_test_… is read-only — this app has no test-mode
 * ledger, so test keys can never move money).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export class BMaGlassError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BMaGlassError";
  }
}

export interface Wallet { id: string; currency: string; balance: number; status: string; created_at: string; updated_at: string }
export interface Transaction { uuid_id: string; amount: number; currency: string; direction: string; status: string; description: string | null; recipient_name: string | null; fee_amount: number | null; created_at: string }
export interface PaymentLink { id: string; title: string; description: string | null; amount: number | null; currency: string; link_code: string; status: string; payment_count: number; total_collected: number; expires_at: string | null; created_at: string }
export interface WebhookEndpoint { id: string; url: string; events: string[]; is_active: boolean; created_at: string; secret?: string }
export interface WebhookDelivery { id: string; webhook_id: string | null; event_id: string; event_type: string; webhook_url: string; status: string; attempts: number; response_status: number | null; error_message: string | null; created_at: string }
export interface BitcoinQuote { id: string; side: "buy" | "sell"; amount_zmw: number; amount_sats: number; fee_bps: number; fee_zmw: number; mid_rate_zmw: number; expires_at: string; created_at: string }

export interface BMaGlassOptions {
  apiKey: string;
  /** Defaults to the production developer-api function URL. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api";

export class BMaGlass {
  readonly mode: "test" | "live";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BMaGlassOptions) {
    if (!options.apiKey?.startsWith("bmp_")) {
      throw new BMaGlassError(0, "invalid_api_key", "apiKey must be a BMaGlass Pay API key (bmp_live_… or bmp_test_…).");
    }
    this.apiKey = options.apiKey;
    this.mode = options.apiKey.includes("_live_") ? "live" : "test";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    list: (limit = 25) => this.request<Transaction[]>("GET", `transactions?limit=${limit}`),
  };
  transfers = {
    /** Live keys only. Test keys receive a 403 test_mode_read_only BMaGlassError. */
    create: (input: { to_user_id: string; amount: number; currency?: string; description?: string; recipient_name?: string }, idempotencyKey?: string) =>
      this.request<{ transaction_id: string; new_sender_balance: number }>("POST", "transfers", input,
        idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
  paymentLinks = {
    list: () => this.request<PaymentLink[]>("GET", "payment-links"),
    /** Live keys only. */
    create: (input: { title: string; description?: string; amount?: number; currency?: string; expires_at?: string }) =>
      this.request<PaymentLink>("POST", "payment-links", input),
  };
  bitcoin = {
    balance: () => this.request<Array<{ asset: string; balance_sats: number; available_sats: number; updated_at: string }>>("GET", "bitcoin/balance"),
    depositAddress: () => this.request<{ address: string; derivation_path: string; is_active: boolean; created_at: string }>("GET", "bitcoin/deposit-address"),
    /** Quote only — execution happens in the app. Works with test keys. */
    quote: (input: { side: "buy" | "sell"; amount_zmw?: number; amount_sats?: number }) =>
      this.request<BitcoinQuote>("POST", "bitcoin/quote", input),
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
 * ("sha256=<hex>"). Returns the parsed event when valid, else null.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseWebhookEvent<T = unknown>(rawBody: string, signatureHeader: string, secret: string): { id: string; type: string; created: string; data: T } | null {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

export default BMaGlass;
