// lightning-provider: the custodial Lightning provider leg behind the
// lightning-service edge function (Coinos, https://coinos.io).
//
// The ledger side of lightning-service (lightning_payments rows, the
// btc_* RPCs, exactly-once settlement) is provider-agnostic and lives
// in the function itself; everything provider-specific — base URL,
// auth header, request/response shapes — lives here so swapping or
// adding a provider never touches money code again.
//
// Configuration gate: LIGHTNING_PROVIDER=coinos AND COINOS_API_TOKEN
// present. Anything else is "not configured" and the function answers
// with its designed 503 refusals. COINOS_API_BASE overrides the base
// URL (defaults to https://coinos.io/api).
//
// Error hygiene: upstream failures (network, non-2xx, malformed
// payloads) throw LightningUpstreamError with server-side detail only;
// the function maps it to the plain-language 503 copy and NEVER leaks
// raw provider text to the caller. A missing configuration throws
// LightningNotConfiguredError.
//
// Coinos API contract (live-verified 2026-10-24 against a real
// account; see the gateway-secrets contract notes for the full record):
//   POST /invoice  {"invoice":{"amount":<sats>,"currency":"SAT","memo":<text>}}
//     → invoice object. bolt11 in `text`; the payment hash in
//       `paymentHash` (64-hex) — WARNING: the `hash` field is a
//       duplicate of the bolt11 string, NOT the payment hash. The
//       status-lookup key is the invoice `id` (UUID). `created` is
//       epoch MILLISECONDS, `expiry` is seconds (2592000 = 30 days),
//       `received` is sats received so far (paid ⇔ received ≥ amount).
//   GET  /invoice/<id> → the same invoice object (also resolves by
//       bolt11 text; does NOT resolve by paymentHash).
//   GET  /me → account object with top-level numeric `balance` (sats).
//   GET  /payments → { payments: [...], count, incoming, outgoing }.
//   POST /payments → 200 with an EMPTY body for every probed shape,
//       with no observable effect at zero balance: the pay contract
//       could NOT be confirmed, so PROVIDER_PAY_CONFIRMED stays false
//       and pay_invoice answers the designed 503 until a funded drill
//       confirms the real shape.
//   Auth: Authorization: Bearer <token> (register/login-issued JWT).
//
// This module is dependency-free (no imports) so the vitest suite can
// load it directly: tests/bitcoin/lightning-provider.test.ts.

/**
 * Thrown when the Lightning provider is not configured on this
 * deployment. Mapped by the caller to a designed 503 refusal —
 * Lightning being unconfigured is a deployment state the user should
 * be told about truthfully, not a bare 500 leaking the secret's name.
 */
export class LightningNotConfiguredError extends Error {}

/**
 * Thrown when the Lightning provider cannot be reached or answers
 * with an error. Mapped by the caller to a plain-language 503
 * refusal — the raw provider/network text must never reach the user.
 */
export class LightningUpstreamError extends Error {}

export interface LightningProviderConfig {
  provider: string | null;
  token: string | null;
  base: string;
}

export const DEFAULT_COINOS_API_BASE = "https://coinos.io/api";

type EnvMap = Record<string, string | undefined>;

function denoEnv(name: string): string | undefined {
  // Deno.env in the edge runtime; undefined under Node/vitest.
  const d = (globalThis as { Deno?: { env?: { get?: (n: string) => string | undefined } } }).Deno;
  try {
    return d?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

/** Read the provider configuration from an env map (defaults to Deno.env). */
export function readLightningProviderConfig(env?: EnvMap): LightningProviderConfig {
  const get = (name: string): string | undefined =>
    env ? env[name] : denoEnv(name);
  const provider = (get("LIGHTNING_PROVIDER") ?? "").trim().toLowerCase() || null;
  const token = (get("COINOS_API_TOKEN") ?? "").trim() || null;
  const base = (get("COINOS_API_BASE") ?? "").trim() || DEFAULT_COINOS_API_BASE;
  return { provider, token, base: base.replace(/\/+$/, "") };
}

/** Configured only when the Coinos provider is selected AND its token is present. */
export function lightningProviderConfigured(config?: LightningProviderConfig): boolean {
  const cfg = config ?? readLightningProviderConfig();
  return cfg.provider === "coinos" && Boolean(cfg.token && cfg.token.trim());
}

// ── Pure response mapping (unit-tested) ────────────────────────────────────

export interface ProviderInvoice {
  bolt11: string;
  /** Provider-side status-lookup key (the Coinos invoice id). */
  providerId: string;
  paymentHash: string | null;
}

/**
 * Whether the provider's pay (outbound) contract has been confirmed
 * live. The Coinos pay route could not be confirmed from a
 * zero-balance account (200/empty, no observable effect for every
 * probed shape), so this stays false — pay_invoice answers the
 * designed 503 — until a funded drill confirms the real shape, at
 * which point flipping this one flag wires providerPayInvoice in.
 */
export const PROVIDER_PAY_CONFIRMED = false;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function firstString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Map a Coinos invoice response to the internal shape. Coinos returns
 * the invoice object directly (sometimes nested under `invoice`); the
 * bolt11 lives in `text`, the payment hash in `paymentHash` (the
 * `hash` field is a duplicate of the bolt11 string — it is only
 * treated as a payment hash when it actually is 64-hex), and the
 * status-lookup key is the invoice `id`. Returns null when the
 * payload carries no bolt11 or no lookup key — an incomplete invoice
 * is an upstream failure, never a half-created deposit.
 */
export function parseCoinosInvoice(payload: unknown): ProviderInvoice | null {
  const outer = asRecord(payload);
  if (!outer) return null;
  const rec = asRecord(outer.invoice) ?? outer;
  const bolt11 = firstString(rec, ["text", "bolt11", "payment_request", "invoice"]);
  const hashField = firstString(rec, ["hash", "payment_hash"]);
  const paymentHash = firstString(rec, ["paymentHash", "payment_hash"]) ??
    (hashField && HEX64.test(hashField) ? hashField : null);
  const id = firstString(rec, ["id"]);
  const providerId = id ?? paymentHash;
  if (!bolt11 || !providerId) return null;
  return { bolt11, providerId, paymentHash };
}

export type ProviderInvoiceState = "paid" | "pending" | "expired";

/**
 * Map a Coinos invoice object to paid / pending / expired.
 * Paid (live-verified shape): `received` (sats) ≥ `amount` (> 0).
 * Also paid: `settled === true`, an explicit paid status, or a
 * preimage (other Coinos surfaces/versions). Expired: an explicit
 * expired status, or the invoice's expiry (created + expiry seconds,
 * or an expires_at timestamp) has passed while still unpaid.
 * Anything else is pending.
 */
export function parseCoinosInvoiceState(
  payload: unknown,
  nowMs: number = Date.now(),
): ProviderInvoiceState {
  const outer = asRecord(payload);
  if (!outer) return "pending";
  const rec = asRecord(outer.invoice) ?? outer;

  const amount = typeof rec.amount === "number" ? rec.amount : null;
  const received = typeof rec.received === "number" ? rec.received : null;
  if (amount !== null && amount > 0 && received !== null && received >= amount) {
    return "paid";
  }

  const status = typeof rec.status === "string" ? rec.status.toLowerCase() : "";
  if (
    rec.settled === true ||
    status === "paid" ||
    status === "settled" ||
    status === "complete" ||
    status === "completed" ||
    firstString(rec, ["preimage", "payment_preimage"])
  ) {
    return "paid";
  }
  if (status === "expired" || rec.expired === true) return "expired";

  // Expiry arithmetic: Coinos invoices carry `created` (epoch ms or s)
  // plus `expiry` (seconds), or an absolute `expiry`/`expires_at`.
  const expiryRaw = rec.expiry ?? rec.expires_at ?? rec.expire_at;
  if (typeof expiryRaw === "number" && Number.isFinite(expiryRaw)) {
    const createdRaw = rec.created ?? rec.created_at;
    const createdMs = typeof createdRaw === "number"
      ? (createdRaw > 1e12 ? createdRaw : createdRaw * 1000)
      : null;
    if (createdMs !== null) {
      if (nowMs > createdMs + expiryRaw * 1000) return "expired";
    } else if (expiryRaw > 1e12) {
      if (nowMs > expiryRaw) return "expired";
    } else if (expiryRaw > 1e9) {
      if (nowMs > expiryRaw * 1000) return "expired";
    }
  } else if (typeof expiryRaw === "string") {
    const t = Date.parse(expiryRaw);
    if (Number.isFinite(t) && nowMs > t) return "expired";
  }
  return "pending";
}

/** Map a Coinos payment (pay) response to its payment hash, when present. */
export function parseCoinosPaymentHash(payload: unknown): string | null {
  const outer = asRecord(payload);
  if (!outer) return null;
  const rec = asRecord(outer.payment) ?? outer;
  const direct = firstString(rec, ["paymentHash", "payment_hash"]);
  if (direct) return direct;
  const hashField = firstString(rec, ["hash"]);
  return hashField && HEX64.test(hashField) ? hashField : null;
}

// ── Provider calls ─────────────────────────────────────────────────────────

async function coinosFetch(
  cfg: LightningProviderConfig,
  path: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  if (!lightningProviderConfigured(cfg)) {
    throw new LightningNotConfiguredError("Lightning provider not configured");
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // Network/DNS/timeout: the provider could not be reached at all.
    // Tag it so the caller answers in plain language; the raw message
    // stays server-side in the logs.
    throw new LightningUpstreamError(
      `Coinos upstream unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LightningUpstreamError(`Coinos API ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new LightningUpstreamError("Coinos returned a non-JSON response");
  }
}

/** Create an inbound Lightning invoice for `sats` on the platform account. */
export async function providerCreateInvoice(
  sats: number,
  description: string,
  config?: LightningProviderConfig,
): Promise<ProviderInvoice> {
  const cfg = config ?? readLightningProviderConfig();
  const payload = await coinosFetch(cfg, "/invoice", "POST", {
    invoice: { amount: sats, currency: "SAT", memo: description },
  });
  const invoice = parseCoinosInvoice(payload);
  if (!invoice) {
    throw new LightningUpstreamError("Coinos returned an incomplete invoice");
  }
  return invoice;
}

/** Fetch an invoice's state by its provider id (the Coinos payment hash). */
export async function providerGetInvoice(
  providerId: string,
  config?: LightningProviderConfig,
): Promise<{ state: ProviderInvoiceState; paymentHash?: string }> {
  const cfg = config ?? readLightningProviderConfig();
  const payload = await coinosFetch(
    cfg,
    `/invoice/${encodeURIComponent(providerId)}`,
    "GET",
  );
  const state = parseCoinosInvoiceState(payload);
  const parsed = parseCoinosInvoice(payload);
  return { state, paymentHash: parsed?.paymentHash ?? providerId };
}

/** Pay an outbound bolt11 invoice from the platform Coinos account. */
export async function providerPayInvoice(
  bolt11: string,
  config?: LightningProviderConfig,
): Promise<{ paymentHash?: string }> {
  const cfg = config ?? readLightningProviderConfig();
  const payload = await coinosFetch(cfg, "/payments", "POST", {
    payment: { text: bolt11 },
  });
  return { paymentHash: parseCoinosPaymentHash(payload) ?? undefined };
}
