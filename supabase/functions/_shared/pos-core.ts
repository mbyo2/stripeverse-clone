// pos-core: pure logic for the Bitcoin POS data bridge (scope: the
// merchant data layer — payment requests, API keys, CSV export).
//
// This module is deliberately import-free so it can be unit-tested
// byte-identical through the repo's transpile-loader test style, and
// shared by the `pos` edge function (Deno) and the vitest suite
// (Node). WebCrypto (crypto.subtle / getRandomValues) exists in both.
//
// Money rules that live here:
//   - fiat → sats conversion FLOORS, at the raw BTC/ZMW index. No
//     trade spread is applied: a POS request is the merchant's own
//     price converted for payment, not a platform trade. Flooring
//     means the expected sats never exceed the fiat value at the
//     locked rate; a customer paying exactly the quoted sats has
//     settled the full amount by construction.
//   - Payment classification is exact integer comparison:
//     received == expected → paid, < → underpaid, > → overpaid.

export const SATS_PER_BTC = 100_000_000;

export const POS_REQUEST_STATUSES = [
  "awaiting_payment",
  "paid",
  "underpaid",
  "overpaid",
  "expired",
  "cancelled",
] as const;
export type PosRequestStatus = (typeof POS_REQUEST_STATUSES)[number];

export function isPosRequestStatus(v: unknown): v is PosRequestStatus {
  return typeof v === "string" && (POS_REQUEST_STATUSES as readonly string[]).includes(v);
}

/** Convert a ZMW amount to expected sats at a ZMW-per-BTC rate. Floored. */
export function fiatZmwToSats(fiatZmw: number, rateZmwPerBtc: number): number {
  if (!(fiatZmw > 0) || !(rateZmwPerBtc > 0)) {
    throw new Error("Invalid conversion inputs");
  }
  return Math.floor((fiatZmw * SATS_PER_BTC) / rateZmwPerBtc);
}

/** Exact-integer payment classification. */
export function classifyPayment(
  expectedSats: number,
  receivedSats: number,
): "paid" | "underpaid" | "overpaid" {
  if (!Number.isInteger(expectedSats) || expectedSats <= 0) {
    throw new Error("Invalid expected sats");
  }
  if (!Number.isInteger(receivedSats) || receivedSats < 0) {
    throw new Error("Invalid received sats");
  }
  if (receivedSats === expectedSats) return "paid";
  return receivedSats < expectedSats ? "underpaid" : "overpaid";
}

/** Exact decimal BTC string for an integer sats amount (BIP21 amount). */
export function satsToBtcString(sats: number): string {
  if (!Number.isInteger(sats) || sats < 0) throw new Error("Invalid sats");
  const whole = Math.floor(sats / SATS_PER_BTC);
  const frac = sats % SATS_PER_BTC;
  if (frac === 0) return String(whole);
  const fracStr = String(frac).padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * BIP21 URI the customer's wallet scans: address + exact amount +
 * the merchant reference as the label (lands in the customer's own
 * wallet history, which helps both sides reconcile).
 */
export function bip21Uri(address: string, sats: number, label?: string): string {
  const base = `bitcoin:${address}?amount=${satsToBtcString(sats)}`;
  return label ? `${base}&label=${encodeURIComponent(label)}` : base;
}

// ── Merchant references ──────────────────────────────────────────────
// The reference is the merchant's own till/order number and the
// reconciliation key between BMaGlass records and the merchant's
// POS/accounting system. Trimmed, 1–64 chars, printable, no control
// characters. Returns the normalised reference or null.

export function normaliseMerchantReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ref = raw.trim();
  if (ref.length < 1 || ref.length > 64) return null;
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(ref)) return null;
  return ref;
}

/** Validate + normalise a fiat amount: positive, capped, whole ngwee. */
export function normaliseFiatZmw(raw: unknown, maxZmw = 1_000_000): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded <= 0 || rounded > maxZmw) return null;
  return rounded;
}

// ── API keys ─────────────────────────────────────────────────────────
// Plain key: "bmp_pos_" + 64 hex chars (32 random bytes). Only the
// SHA-256 hex of the full plain key is ever stored (pos_api_keys.
// key_hash); the stored display prefix is the first 16 characters —
// enough to identify a key in a list, useless for authentication.

export const POS_KEY_PREFIX = "bmp_pos_";
export const POS_KEY_DISPLAY_PREFIX_LEN = 16;

export function isPosApiKey(token: string): boolean {
  return typeof token === "string" && token.startsWith(POS_KEY_PREFIX);
}

export function generatePosApiKey(): { plain: string; displayPrefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const plain = `${POS_KEY_PREFIX}${hex}`;
  return { plain, displayPrefix: plain.slice(0, POS_KEY_DISPLAY_PREFIX_LEN) };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison for hash strings (same shape as btc-onchain). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── CSV export ───────────────────────────────────────────────────────
// One row per request, columns fixed by the data-bridge contract —
// a merchant's accounting system can map them once and rely on them:
//   date, reference, status, fiat_zmw, sats_expected, sats_received,
//   btc_zmw_rate, txid, confirmations, paid_at

export interface PosRequestCsvRow {
  created_at: string;
  merchant_reference: string;
  status: string;
  fiat_amount_zmw: number | string;
  sats_expected: number | string;
  sats_received: number | string | null;
  btc_zmw_rate: number | string;
  txid: string | null;
  confirmations_at_detection: number | string | null;
  paid_at: string | null;
}

export const POS_CSV_HEADER =
  "date,reference,status,fiat_zmw,sats_expected,sats_received,btc_zmw_rate,txid,confirmations,paid_at";

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function twoDp(v: number | string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

export function requestsToCsv(rows: PosRequestCsvRow[]): string {
  const lines = [POS_CSV_HEADER];
  for (const r of rows) {
    lines.push([
      csvEscape(String(r.created_at ?? "")),
      csvEscape(String(r.merchant_reference ?? "")),
      csvEscape(String(r.status ?? "")),
      twoDp(r.fiat_amount_zmw),
      String(r.sats_expected ?? ""),
      r.sats_received == null ? "" : String(r.sats_received),
      twoDp(r.btc_zmw_rate),
      csvEscape(r.txid ?? ""),
      r.confirmations_at_detection == null ? "" : String(r.confirmations_at_detection),
      csvEscape(r.paid_at ?? ""),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

// ── Statement summary (PDF statement band) ───────────────────────────
// Definitions, chosen to be explainable to an accountant:
//   - settled = paid + underpaid + overpaid (money actually arrived)
//   - totalCollectedZmw = Σ over settled rows of the kwacha value of
//     the BTC that ARRIVED, at that request's locked rate
//     (sats_received × rate_at_payment ?? rate / 1e8), to whole ngwee
//   - totalReceivedSats = Σ sats_received over settled rows
//   - averageRateZmw = totalCollectedZmw / total BTC received — the
//     volume-weighted rate actually achieved (null when nothing was
//     received, rather than a misleading zero)

export interface PosSummaryRow {
  status: string;
  fiat_amount_zmw: number | string;
  sats_expected: number | string;
  sats_received: number | string | null;
  btc_zmw_rate: number | string;
  btc_zmw_rate_at_payment: number | string | null;
}

export interface PosStatementSummary {
  requestCount: number;
  paidCount: number;
  settledCount: number;
  totalCollectedZmw: number;
  totalReceivedSats: number;
  averageRateZmw: number | null;
}

export function summarisePosRequests(rows: PosSummaryRow[]): PosStatementSummary {
  let paidCount = 0;
  let settledCount = 0;
  let collected = 0;
  let receivedSats = 0;
  for (const r of rows) {
    if (r.status === "paid") paidCount += 1;
    const settled = r.status === "paid" || r.status === "underpaid" || r.status === "overpaid";
    const received = r.sats_received == null ? 0 : Number(r.sats_received);
    if (settled && received > 0) {
      settledCount += 1;
      receivedSats += received;
      const rate = Number(r.btc_zmw_rate_at_payment ?? r.btc_zmw_rate);
      if (Number.isFinite(rate) && rate > 0) {
        collected += (received * rate) / SATS_PER_BTC;
      }
    }
  }
  const totalCollectedZmw = Math.round(collected * 100) / 100;
  return {
    requestCount: rows.length,
    paidCount,
    settledCount,
    totalCollectedZmw,
    totalReceivedSats: receivedSats,
    averageRateZmw:
      receivedSats > 0
        ? Math.round((totalCollectedZmw / (receivedSats / SATS_PER_BTC)) * 100) / 100
        : null,
  };
}

/** Shorten a txid for print: first 10 + … + last 8 (full id stays in CSV/API). */
export function shortenTxid(txid: string | null | undefined, head = 10, tail = 8): string {
  if (!txid) return "";
  if (txid.length <= head + tail + 1) return txid;
  return `${txid.slice(0, head)}…${txid.slice(-tail)}`;
}
