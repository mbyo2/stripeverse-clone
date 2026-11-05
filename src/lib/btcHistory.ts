// Shared resolution + formatting for BTC transaction-history rows.
//
// public.transactions.amount is numeric(12,2) denominated in BTC, so
// every movement under 0.005 BTC is stored as 0.00 — the column alone
// CANNOT say how much Bitcoin a row moved. Writers therefore record
// the true amount in metadata.sats (integer satoshis); renderers must
// resolve the amount from there first and only fall back to the
// (rounded) column for rows written before that convention existed.
// Pre-launch sweep 2026-11-05: history surfaces rendered "+0 sats" /
// "$0.00" for real deposits and sells because they read only `amount`.

export interface BtcHistoryRowLike {
  amount?: number | string | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** True satoshis moved by a BTC history row, or null when unknowable. */
export function btcRowSats(row: BtcHistoryRowLike): number | null {
  if ((row.currency ?? "").toUpperCase() !== "BTC") return null;
  const meta = row.metadata;
  if (meta && typeof meta === "object") {
    const raw = (meta as Record<string, unknown>).sats;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.round(n);
  }
  const amount = Number(row.amount ?? NaN);
  if (Number.isFinite(amount)) return Math.round(amount * 100_000_000);
  return null;
}

/** "100,000 sats" — the unit every money flow in the app speaks. */
export function formatSatsAmount(sats: number): string {
  return `${Math.round(sats).toLocaleString("en-US")} sats`;
}

/** Display string for a BTC row's amount (no sign — callers add it). */
export function formatBtcRowAmount(row: BtcHistoryRowLike): string {
  const sats = btcRowSats(row);
  if (sats === null) return "0 sats";
  return formatSatsAmount(Math.abs(sats));
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  complete: "Completed",
  pending: "Pending",
  processing: "Processing",
  awaiting_rebalance: "Being prepared",
  reserved: "Reserved",
  queued: "Queued",
  broadcast: "Sent",
  verifying: "Being verified",
  detected: "Confirming",
  failed: "Failed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
};

/** Human label for a transaction status — never raw snake_case. */
export function friendlyTxStatus(status?: string | null): string {
  if (!status) return "";
  const key = status.toLowerCase();
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
