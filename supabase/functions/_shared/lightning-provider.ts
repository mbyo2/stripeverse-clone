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
//   POST /payments → pay an outbound invoice,
//       {"payment":{"text": <bolt11>}} — the live-probed shape
//       (2026-10-24: 200 with an EMPTY body and no observable effect
//       at zero balance for every probed shape; POST /pay → 404,
//       POST /send → a different route family). Because the POST
//       response alone proves nothing, a send is settled only on an
//       independent GET /payments read-back — see
//       PROVIDER_PAY_CONFIRMED and providerPayInvoice below.
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
 * Whether the provider's pay (outbound) leg is wired.
 *
 * History: the Coinos pay route could not be confirmed from a
 * zero-balance account (POST /payments answered 200/empty with no
 * observable effect for every probed shape), so this stayed false —
 * pay_invoice answered the designed 503 — through 2026-10-24.
 *
 * Wired 2026-10-26 (custodial Lightning send mission) on this
 * doctrine, which is what makes wiring it safe BEFORE a funded
 * drill exists:
 *   - The pay REQUEST uses the live-probed shape
 *     (POST /payments {"payment":{"text": bolt11}} — the shape the
 *     2026-10-24 probes found accepted with 200, never a hard 4xx).
 *   - The POST response is NEVER trusted as settlement. A send
 *     settles only on an INDEPENDENT read-back (GET /payments via
 *     providerGetOutgoingPayment) showing the payment completed.
 *   - A 2xx POST with no confirmed read-back leaves the send in
 *     its reserved "processing" state — held, visible, and
 *     reconcilable by ops — never auto-refunded and never
 *     double-payable (the invoice's payment hash is the identity).
 *   - A definitive provider rejection (a structured 400/422
 *     provider error — see providerPayInvoice) releases the
 *     reservation in full; every ambiguous answer — network,
 *     timeout, 5xx, rate limit, proxy page — is "unknown" and also
 *     holds (mirror of the on-chain broadcast doctrine in
 *     _shared/btc-core.ts).
 * The remaining proof is the funded drill: the first real custodial
 * Lightning send settles a real invoice end to end. Until then,
 * every code path around the pay call is unit-proven and the
 * live-probed refusals hold.
 */
export const PROVIDER_PAY_CONFIRMED = true;

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
 * status-lookup key is the invoice `id`. The payment hash is an
 * IDENTITY for matching payments, never a lookup key: the contract
 * proves GET /invoice/<paymentHash> returns 500, so a payload with
 * no `id` is incomplete. Returns null when the payload carries no
 * bolt11 or no invoice id — an incomplete invoice is an upstream
 * failure, never a half-created deposit.
 */
export function parseCoinosInvoice(payload: unknown): ProviderInvoice | null {
  const outer = asRecord(payload);
  if (!outer) return null;
  const rec = asRecord(outer.invoice) ?? outer;
  const bolt11 = firstString(rec, ["text", "bolt11", "payment_request", "invoice"]);
  const hashField = firstString(rec, ["hash", "payment_hash"]);
  const paymentHashField = firstString(rec, ["paymentHash", "payment_hash"]);
  // A payment hash is 64-hex or it is not a payment hash — the guard
  // applies to the `paymentHash` field exactly as to `hash`.
  const paymentHash =
    (paymentHashField && HEX64.test(paymentHashField) ? paymentHashField : null) ??
    (hashField && HEX64.test(hashField) ? hashField : null);
  const providerId = firstString(rec, ["id"]);
  if (!bolt11 || !providerId) return null;
  return { bolt11, providerId, paymentHash };
}

export type ProviderInvoiceState = "paid" | "pending" | "expired";

export interface CoinosInvoiceAmounts {
  /** The invoice's fixed amount in sats, when the payload carries it. */
  amountSats: number | null;
  /** Sats the provider reports as actually received so far. This is
   *  the figure the link-attempt Lightning tolerance (protection P1)
   *  settles on: a provider that deducts on receives reports LESS
   *  than the invoice amount here. */
  receivedSats: number | null;
}

/** Extract the amount / actually-received sats from a Coinos invoice
 *  payload (same nesting rules as parseCoinosInvoiceState: the
 *  invoice object directly, or nested under `invoice`). */
export function parseCoinosInvoiceAmounts(payload: unknown): CoinosInvoiceAmounts {
  const outer = asRecord(payload);
  if (!outer) return { amountSats: null, receivedSats: null };
  const rec = asRecord(outer.invoice) ?? outer;
  const amount = typeof rec.amount === "number" && Number.isFinite(rec.amount)
    ? rec.amount
    : null;
  const received = typeof rec.received === "number" && Number.isFinite(rec.received)
    ? rec.received
    : null;
  return { amountSats: amount, receivedSats: received };
}

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

  // Expiry arithmetic (contract): `created` is epoch MILLISECONDS
  // (epoch seconds tolerated) and `expiry` is a DURATION in seconds
  // counted from `created` — never an absolute timestamp, so an
  // `expiry` with no `created` says nothing about expiry.
  const createdRaw = rec.created ?? rec.created_at;
  const createdMs = typeof createdRaw === "number" && Number.isFinite(createdRaw)
    ? (createdRaw > 1e12 ? createdRaw : createdRaw * 1000)
    : null;
  const expirySecs = rec.expiry;
  if (
    typeof expirySecs === "number" && Number.isFinite(expirySecs) &&
    createdMs !== null && nowMs > createdMs + expirySecs * 1000
  ) {
    return "expired";
  }
  // Absolute expiry timestamps carried by other surfaces/versions
  // live under their own field names.
  const expiresAt = rec.expires_at ?? rec.expire_at;
  if (typeof expiresAt === "string") {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t) && nowMs > t) return "expired";
  } else if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    const expiresMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
    if (nowMs > expiresMs) return "expired";
  }
  return "pending";
}

/** Map a Coinos payment (pay) response to its payment hash, when present. */
export function parseCoinosPaymentHash(payload: unknown): string | null {
  const outer = asRecord(payload);
  if (!outer) return null;
  const rec = asRecord(outer.payment) ?? outer;
  const direct = firstString(rec, ["paymentHash", "payment_hash"]);
  if (direct && HEX64.test(direct)) return direct;
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

/**
 * Fetch an invoice's state by its provider id (the Coinos invoice
 * `id`, a UUID — never the payment hash: the contract proves lookup
 * by paymentHash returns 500). The returned paymentHash comes only
 * from the payload itself; it is never fabricated from the lookup
 * key (a UUID is not a payment hash).
 */
export async function providerGetInvoice(
  providerId: string,
  config?: LightningProviderConfig,
): Promise<{
  state: ProviderInvoiceState;
  paymentHash?: string;
  amountSats: number | null;
  receivedSats: number | null;
}> {
  const cfg = config ?? readLightningProviderConfig();
  const payload = await coinosFetch(
    cfg,
    `/invoice/${encodeURIComponent(providerId)}`,
    "GET",
  );
  const state = parseCoinosInvoiceState(payload);
  const parsed = parseCoinosInvoice(payload);
  const amounts = parseCoinosInvoiceAmounts(payload);
  return {
    state,
    paymentHash: parsed?.paymentHash ?? undefined,
    amountSats: amounts.amountSats,
    receivedSats: amounts.receivedSats,
  };
}

/** The classified outcome of one outbound pay attempt. */
export type ProviderPayOutcome =
  | { kind: "accepted"; paymentHash: string | null }
  | { kind: "rejected"; detail: string }
  | { kind: "unknown"; detail: string };

/**
 * Extract a structured provider error message from a response body,
 * when the body is a JSON object carrying one. HTML pages, plain
 * text, non-object JSON and JSON without an error field all return
 * null — those are the answers a proxy, a Cloudflare challenge or a
 * rate limiter gives, NOT provider verdicts, and they must never be
 * read as one.
 */
function providerErrorMessage(text: string): string | null {
  if (!text) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return null;
  }
  const rec = asRecord(parsedJson);
  if (!rec) return null;
  return firstString(rec, ["message", "error", "error_message", "detail"]);
}

/**
 * Pay an outbound bolt11 invoice from the platform Coinos account.
 *
 * NEVER throws for a provider-side outcome (only for a missing
 * configuration): the caller must be able to distinguish a
 * DEFINITIVE rejection — the payment provably was not made, so the
 * reservation may be released — from an UNKNOWN outcome, where the
 * payment may in fact have been made and the reservation must HOLD
 * for reconciliation. This is the Lightning mirror of
 * classifyBroadcastOutcome in btc-core.ts:
 *
 *   - 2xx        → "accepted". NOT settled — the caller confirms
 *                  via providerGetOutgoingPayment before settling;
 *                  the 2026-10-24 probes showed a 2xx can carry an
 *                  empty body and proves nothing on its own.
 *   - 400 / 422 WITH a structured provider JSON error body →
 *                  "rejected" (Coinos itself refused the payment:
 *                  malformed, unpayable, insufficient provider
 *                  balance). Definitive.
 *   - EVERYTHING else non-2xx → "unknown": 408/429 (timeout / rate
 *                  limit — the payment may well have been taken),
 *                  any other 4xx, and any 4xx whose body is HTML or
 *                  non-JSON (a Cloudflare/proxy answer, not a
 *                  provider verdict), 5xx, network, timeout.
 *                  Reading an ambiguous 4xx as "rejected" would
 *                  release the reservation for a payment that may
 *                  have been made — the double-pay exposure this
 *                  split exists to prevent.
 */
export async function providerPayInvoice(
  bolt11: string,
  config?: LightningProviderConfig,
): Promise<ProviderPayOutcome> {
  const cfg = config ?? readLightningProviderConfig();
  if (!lightningProviderConfigured(cfg)) {
    throw new LightningNotConfiguredError("Lightning provider not configured");
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ payment: { text: bolt11 } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return {
      kind: "unknown",
      detail: `pay request unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const text = await res.text().catch(() => "");
  if (res.status >= 200 && res.status < 300) {
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { kind: "accepted", paymentHash: parseCoinosPaymentHash(parsed) };
  }
  if (res.status === 400 || res.status === 422) {
    const providerError = providerErrorMessage(text);
    if (providerError !== null) {
      return {
        kind: "rejected",
        detail: `Coinos pay refused ${res.status}: ${providerError.slice(0, 200)}`,
      };
    }
  }
  return { kind: "unknown", detail: `Coinos pay answered ${res.status}: ${text.slice(0, 200)}` };
}

export type ProviderOutgoingState = "paid" | "failed" | "pending" | "not_found";

export interface ProviderOutgoingPayment {
  state: ProviderOutgoingState;
  /** Provider-reported fee in sats, when the payload carries one. */
  feeSats: number | null;
  paymentHash: string | null;
}

const PAID_STATUS_WORDS = new Set([
  "paid", "settled", "complete", "completed", "success", "succeeded",
]);
const FAILED_STATUS_WORDS = new Set([
  "failed", "error", "rejected", "cancelled", "canceled", "expired",
]);

/**
 * Find OUR payment for an invoice in a Coinos GET /payments payload
 * and map it to a settlement state. Pure; the caller fetches.
 *
 * Matching: by payment hash (the invoice's identity) or by the
 * bolt11 text itself. Coinos payment records are invoice-shaped
 * objects in both directions; an entry carrying `received` is read
 * with the invoice-state rules (paid ⇔ received ≥ amount — which is
 * also the correct read-back when the platform pays an invoice it
 * issued itself), otherwise the payment-state words / preimage /
 * settled flags decide. Across multiple matches the most terminal
 * state wins (paid > failed > pending): mirrors can lag, and a
 * payment that completed anywhere is completed.
 */
export function parseCoinosOutgoingPayment(
  payload: unknown,
  match: { paymentHash?: string | null; bolt11?: string | null },
): ProviderOutgoingPayment {
  const outer = asRecord(payload);
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(outer?.payments)
    ? (outer!.payments as unknown[])
    : outer
    ? [outer.payment ?? outer]
    : [];

  const wantHash = (match.paymentHash ?? "").toLowerCase() || null;
  const wantBolt11 = match.bolt11 ?? null;

  let best: ProviderOutgoingPayment = { state: "not_found", feeSats: null, paymentHash: null };
  const rank = (s: ProviderOutgoingState) =>
    s === "paid" ? 3 : s === "failed" ? 2 : s === "pending" ? 1 : 0;

  for (const entry of list) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const entryHash = (() => {
      const ph = firstString(rec, ["paymentHash", "payment_hash"]);
      if (ph && HEX64.test(ph)) return ph;
      const h = firstString(rec, ["hash"]);
      return h && HEX64.test(h) ? h : null;
    })();
    const entryBolt11 = firstString(rec, ["text", "bolt11", "payment_request", "invoice"]);
    const hashMatches = wantHash !== null && entryHash !== null &&
      entryHash.toLowerCase() === wantHash;
    const boltMatches = wantBolt11 !== null && entryBolt11 !== null &&
      entryBolt11 === wantBolt11;
    if (!hashMatches && !boltMatches) continue;

    let state: ProviderOutgoingState = "pending";
    const status = typeof rec.status === "string" ? rec.status.toLowerCase() : "";
    if (typeof rec.received === "number" && typeof rec.amount === "number") {
      const invState = parseCoinosInvoiceState(rec);
      state = invState === "paid" ? "paid" : invState === "expired" ? "failed" : "pending";
    } else if (
      firstString(rec, ["preimage", "payment_preimage"]) ||
      rec.settled === true ||
      PAID_STATUS_WORDS.has(status)
    ) {
      state = "paid";
    } else if (FAILED_STATUS_WORDS.has(status) || rec.failed === true) {
      state = "failed";
    }
    const fee = typeof rec.fee === "number" && Number.isFinite(rec.fee)
      ? Math.abs(Math.trunc(rec.fee))
      : null;
    if (rank(state) > rank(best.state)) {
      best = { state, feeSats: fee, paymentHash: entryHash };
    } else if (best.feeSats === null && fee !== null) {
      best = { ...best, feeSats: fee };
    }
  }
  return best;
}

/**
 * Read back the state of an outbound payment by polling the
 * provider's payments list. This read-back — never the POST
 * response — is the only evidence a send may settle on. A fetch
 * failure throws LightningUpstreamError and the caller keeps the
 * send in its held "processing" state.
 */
export async function providerGetOutgoingPayment(
  match: { paymentHash?: string | null; bolt11?: string | null },
  config?: LightningProviderConfig,
): Promise<ProviderOutgoingPayment> {
  const cfg = config ?? readLightningProviderConfig();
  const payload = await coinosFetch(cfg, "/payments", "GET");
  return parseCoinosOutgoingPayment(payload, match);
}
