// Pure UI logic for the P2P marketplace (Phase 1c) — status mapping,
// countdowns, form validation and price maths. No imports from the
// app, so the whole module is unit-testable in isolation
// (tests/p2p/p2pUi.test.ts).
//
// The maths here MIRRORS the Phase 1a RPCs (never replaces them):
// order amounts are computed exactly as p2p_create_order computes
// them so the user sees the numbers the server will settle on, and
// the release/mark-paid validation mirrors §3.5 so a form cannot be
// submitted in a state the RPC would refuse — the RPC stays the
// authority and its crafted refusals still surface verbatim.

export type P2pOrderStatus =
  | "escrow_locked"
  | "paid_marked"
  | "disputed"
  | "completed"
  | "refunded"
  | "cancelled_unpaid"
  | "expired_unpaid";

/** Order statuses the trade can never leave — the escrow is settled
 *  or was never funded, so polling surfaces may stop (scalability
 *  fix #5: a settled trade generates no standing load). */
export const TERMINAL_P2P_ORDER_STATUSES: readonly P2pOrderStatus[] = [
  "completed",
  "refunded",
  "cancelled_unpaid",
  "expired_unpaid",
];

export function isTerminalP2pOrderStatus(
  status: string | null | undefined,
): boolean {
  return (
    status != null &&
    (TERMINAL_P2P_ORDER_STATUSES as readonly string[]).includes(status)
  );
}

/** A dispute is live only while "open"; every ruled/negotiated
 *  outcome is final (see DISPUTE_STATUS_LABELS). */
export function isTerminalP2pDisputeStatus(
  status: string | null | undefined,
): boolean {
  return status != null && status !== "open";
}

export type P2pAdSide = "sell_crypto" | "buy_crypto";

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

/** Satoshis → BTC string with the full 8 decimals the escrow system
 *  messages use (e.g. 1000 → "0.00001000"). */
export function formatBtcFromSats(sats: number | null | undefined): string {
  if (sats === null || sats === undefined || !Number.isFinite(sats)) return "0.00000000";
  return (sats / 100_000_000).toFixed(8);
}

export function formatSats(sats: number | null | undefined): string {
  if (sats === null || sats === undefined || !Number.isFinite(sats)) return "0 sats";
  return `${Math.trunc(sats).toLocaleString("en-US")} sats`;
}

export function formatZmw(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "K0.00";
  return `K${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------
// Order status → stepper + headline (§4.4 trade room)
// ---------------------------------------------------------------------

export interface OrderStep {
  key: "locked" | "pay" | "confirm" | "done";
  label: string;
  state: "done" | "current" | "upcoming" | "blocked";
}

export interface OrderStatusMeta {
  headline: string;
  description: string;
  /** Tailwind tone key used for badges. */
  tone: "waiting" | "active" | "danger" | "success" | "neutral";
  terminal: boolean;
}

const STEP_LABELS: Array<{ key: OrderStep["key"]; label: string }> = [
  { key: "locked", label: "Escrow locked" },
  { key: "pay", label: "Payment sent" },
  { key: "confirm", label: "Seller confirms" },
  { key: "done", label: "Completed" },
];

function steps(currentIdx: number, blockedIdx: number | null): OrderStep[] {
  return STEP_LABELS.map((s, i) => ({
    ...s,
    state:
      blockedIdx === i
        ? "blocked"
        : i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "upcoming",
  }));
}

/**
 * The four-step trade stepper. A dispute freezes the stepper at the
 * step the trade had reached (paid-marked disputes block "confirm",
 * pre-payment disputes block "pay"); terminal failures collapse to
 * the final step blocked.
 */
export function orderSteps(
  status: P2pOrderStatus,
  opts: { paidMarkedAt?: string | null } = {},
): OrderStep[] {
  switch (status) {
    case "escrow_locked":
      return steps(1, null);
    case "paid_marked":
      return steps(2, null);
    case "disputed":
      return steps(opts.paidMarkedAt ? 2 : 1, opts.paidMarkedAt ? 2 : 1);
    case "completed":
      return STEP_LABELS.map((s) => ({ ...s, state: "done" as const }));
    case "refunded":
      return steps(3, 3);
    case "cancelled_unpaid":
    case "expired_unpaid":
      return steps(1, 1);
    default:
      return steps(0, null);
  }
}

export const ORDER_STATUS_META: Record<P2pOrderStatus, OrderStatusMeta> = {
  escrow_locked: {
    headline: "Waiting for payment",
    description:
      "The Bitcoin is locked in escrow. The buyer must pay the account shown on this order before the timer runs out.",
    tone: "waiting",
    terminal: false,
  },
  paid_marked: {
    headline: "Payment marked as sent",
    description:
      "The buyer says the money is on its way. The seller must check inside their own account before releasing — a screenshot is never proof.",
    tone: "active",
    terminal: false,
  },
  disputed: {
    headline: "Dispute open — escrow frozen",
    description:
      "The Bitcoin stays frozen in escrow while this is resolved. Neither side can move it. Add your evidence and wait for a ruling.",
    tone: "danger",
    terminal: false,
  },
  completed: {
    headline: "Trade completed",
    description: "The Bitcoin was released to the buyer and this trade is finished.",
    tone: "success",
    terminal: true,
  },
  refunded: {
    headline: "Refunded to the seller",
    description: "The escrowed Bitcoin was returned to the seller and this trade is closed.",
    tone: "neutral",
    terminal: true,
  },
  cancelled_unpaid: {
    headline: "Cancelled before payment",
    description: "This order was cancelled before any payment was made. The escrowed Bitcoin went back to the seller.",
    tone: "neutral",
    terminal: true,
  },
  expired_unpaid: {
    headline: "Expired — payment window closed",
    description: "The payment window ran out before payment was marked. The escrowed Bitcoin went back to the seller.",
    tone: "neutral",
    terminal: true,
  },
};

/**
 * Neutral fallback for a status the client map doesn't know yet
 * (schema evolution can add an order status server-side before the
 * client ships). Rendering must never deref an empty lookup.
 */
export const ORDER_STATUS_FALLBACK: OrderStatusMeta = {
  headline: "Unknown status",
  description: "",
  tone: "neutral",
  terminal: false,
};

export function orderStatusMeta(status: string): OrderStatusMeta {
  return (
    ORDER_STATUS_META[status as P2pOrderStatus] ?? {
      ...ORDER_STATUS_FALLBACK,
      headline: status.replace(/_/g, " "),
    }
  );
}

// ---------------------------------------------------------------------
// Countdowns
// ---------------------------------------------------------------------

export interface Countdown {
  totalMs: number;
  expired: boolean;
  label: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Human countdown label: "2d 4h" / "1h 05m" / "14:32" / "Expired". */
export function formatCountdownLabel(totalMs: number): string {
  if (totalMs <= 0) return "Expired";
  const totalSec = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

export function countdownTo(
  targetIso: string | null | undefined,
  nowMs: number,
): Countdown | null {
  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  if (!Number.isFinite(target)) return null;
  const totalMs = target - nowMs;
  return { totalMs, expired: totalMs <= 0, label: formatCountdownLabel(totalMs) };
}

// ---------------------------------------------------------------------
// Price maths (mirrors p2p_create_order §2.2/§2.3)
// ---------------------------------------------------------------------

export interface AdPriceShape {
  price_type: "fixed" | "margin";
  fixed_price_zmw: number | null;
  margin_percent: number | null;
}

/** The price an order on this ad settles at right now. */
export function adEffectivePriceZmw(
  ad: AdPriceShape,
  indexZmw: number | null | undefined,
): number | null {
  if (ad.price_type === "fixed") {
    return ad.fixed_price_zmw !== null && ad.fixed_price_zmw > 0
      ? Number(ad.fixed_price_zmw)
      : null;
  }
  if (!indexZmw || indexZmw <= 0 || ad.margin_percent === null) return null;
  return Math.round(indexZmw * (1 + ad.margin_percent / 100) * 100) / 100;
}

/** Signed % distance from the index (e.g. +2.5 means 2.5% above). */
export function percentVsIndex(
  priceZmw: number | null | undefined,
  indexZmw: number | null | undefined,
): number | null {
  if (!priceZmw || !indexZmw || indexZmw <= 0) return null;
  return ((priceZmw - indexZmw) / indexZmw) * 100;
}

/** §3.8 bait threshold: more than 10% away from the index. */
export function isOffMarket(
  priceZmw: number | null | undefined,
  indexZmw: number | null | undefined,
): boolean {
  const pct = percentVsIndex(priceZmw, indexZmw);
  return pct !== null && Math.abs(pct) > 10;
}

/** fiat → sats, exactly as the RPC: floor(fiat / price × 1e8). */
export function cryptoFromFiat(fiatZmw: number, priceZmw: number): number {
  if (!(fiatZmw > 0) || !(priceZmw > 0)) return 0;
  return Math.floor((fiatZmw / priceZmw) * 100_000_000);
}

/** sats → fiat, exactly as the RPC: round(sats / 1e8 × price, 2). */
export function fiatFromCrypto(sats: number, priceZmw: number): number {
  if (!(sats > 0) || !(priceZmw > 0)) return 0;
  return Math.round(((sats / 100_000_000) * priceZmw + Number.EPSILON) * 100) / 100;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------
// Separate P2P account — transfer maths
// ---------------------------------------------------------------------

/**
 * Sats in the P2P account that can move back to the main wallet
 * right now: what is available minus what the T+1 (24-hour) safety
 * hold still covers. Held sats stay in the P2P account until the
 * hold matures, so they never count as transferable.
 */
export function maxTransferableToMainSats(
  p2pAvailableSats: number,
  unmaturedHoldsSats: number,
): number {
  return Math.max(0, p2pAvailableSats - unmaturedHoldsSats);
}

/**
 * Sats still missing from the P2P account to cover `neededSats`
 * (a sell ad's total, an order's lock) — zero when already covered.
 */
export function p2pShortfallSats(
  neededSats: number,
  p2pAvailableSats: number,
): number {
  return Math.max(0, neededSats - p2pAvailableSats);
}

// ---------------------------------------------------------------------
// §3.5 form validation
// ---------------------------------------------------------------------

export interface MarkPaidInput {
  paymentMethodId: string;
  railReference: string;
  amountSentZmw: string;
}

export function validateMarkPaidForm(
  input: MarkPaidInput,
  orderFiatZmw: number,
): string | null {
  if (!input.paymentMethodId) {
    return "Choose the account you paid from. It must be one of your registered payment methods — paying from someone else's account freezes this trade.";
  }
  const reference = input.railReference.trim();
  if (reference.length < 4) {
    return "Enter the payment reference from your mobile-money or bank transaction (the transaction ID), exactly as it appears.";
  }
  const amount = Number(input.amountSentZmw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter the amount you sent.";
  }
  if (round2(amount) !== round2(orderFiatZmw)) {
    return `The amount sent must equal the order amount exactly (${formatZmw(orderFiatZmw)}). Partial payments cannot release a trade — if you sent a different amount, contact the seller in chat before marking paid.`;
  }
  return null;
}

export interface ReleaseFormInput {
  receivedAmountZmw: string;
  receivedReference: string;
  checkedOwnAccount: boolean;
  checkedFullAmount: boolean;
  checkedSenderName: boolean;
}

export function validateReleaseForm(
  input: ReleaseFormInput,
  orderFiatZmw: number,
): string | null {
  if (!input.checkedOwnAccount || !input.checkedFullAmount || !input.checkedSenderName) {
    return "Confirm all three checks first: you checked inside your own account, the full amount is there, and the sender name matches this order.";
  }
  const reference = input.receivedReference.trim();
  if (reference.length < 4) {
    return "Type the payment reference exactly as it appears inside your own account — not from a screenshot or the chat.";
  }
  const amount = Number(input.receivedAmountZmw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter the amount you received, as shown in your account.";
  }
  if (round2(amount) !== round2(orderFiatZmw)) {
    return `The amount you received must match the order amount exactly (${formatZmw(orderFiatZmw)}). If it does not, do not release — open a dispute instead.`;
  }
  return null;
}

// ---------------------------------------------------------------------
// Limits reasons → plain language (get_limits `reasons` codes)
// ---------------------------------------------------------------------

export function limitsReasonText(code: string): string {
  const sanction = /^sanctioned_rung_(\d)$/.exec(code);
  if (sanction) {
    return `A sanction (level ${sanction[1]}) is limiting your P2P trading right now. You can see it under Sanctions on your P2P profile.`;
  }
  switch (code) {
    case "kyc_required":
      return "Verify your identity to start P2P trading — complete both steps: your KYC documents and face verification.";
    case "marketplace_paused":
      return "P2P trading is paused right now.";
    case "account_too_new":
      return "Your account is too new for P2P trading. This short safety wait protects other traders from throwaway scam accounts.";
    case "new_trader_limits":
      return "New-trader safety limits apply while you build a trading history.";
    case "daily_order_cap_reached":
      return "You have reached today's P2P order limit. It resets tomorrow.";
    case "identity_review_hold":
      return "Your account is under an identity review, so P2P trading is on hold until the review finishes.";
    case "trade_hold":
      return "P2P trading is on hold on your account. Contact support if you believe this is a mistake.";
    default:
      return code.replace(/_/g, " ");
  }
}

// ---------------------------------------------------------------------
// Disputes (§3.6) — reasons, filtered by role + order status
// ---------------------------------------------------------------------

export const DISPUTE_REASON_LABELS: Record<string, string> = {
  paid_not_received: "I paid but the seller says it never arrived / I never received the payment",
  amount_mismatch: "The amount paid does not match the order amount",
  third_party_payment: "The payment came from a different person's account",
  seller_unresponsive: "The seller is not responding",
  seller_unresponsive_pre_payment: "The seller is not responding (before payment)",
  buyer_unresponsive_after_paid: "The buyer is not responding after paying",
  payment_reversed: "The payment was reversed by the provider after release",
  other: "Something else",
};

export type DisputeRole = "buyer" | "seller";

/**
 * The reasons a party may open a dispute with, per §3.6: from
 * escrow_locked only the buyer's pre-payment non-response (which
 * auto-cancels); from paid_marked the full set for each side; on a
 * completed trade the seller's reversed-payment track.
 */
export function disputeReasonsFor(
  role: DisputeRole,
  status: P2pOrderStatus,
): string[] {
  if (status === "escrow_locked") {
    return role === "buyer" ? ["seller_unresponsive_pre_payment"] : [];
  }
  if (status === "paid_marked") {
    return role === "seller"
      ? ["paid_not_received", "amount_mismatch", "third_party_payment", "buyer_unresponsive_after_paid", "other"]
      : ["seller_unresponsive", "amount_mismatch", "other"];
  }
  if (status === "completed") {
    return role === "seller" ? ["payment_reversed", "other"] : ["other"];
  }
  return [];
}

export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  ruled_release: "Ruled — released to buyer",
  ruled_refund: "Ruled — refunded to seller",
  negotiated_release: "Settled — released to buyer",
  negotiated_refund: "Settled — refunded to seller",
};

export const REPORT_CATEGORY_LABELS: Record<string, string> = {
  scam_attempt: "Scam attempt",
  off_platform_solicitation: "Asked to move off-platform (WhatsApp etc.)",
  fake_proof: "Fake payment proof",
  abusive_behaviour: "Abusive behaviour",
  other: "Other",
};

export const PAYMENT_METHOD_TYPE_LABELS: Record<string, string> = {
  mobile_money: "Mobile Money",
  bank: "Bank Transfer",
};

export function paymentMethodTypeLabel(type: string): string {
  return PAYMENT_METHOD_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

// ---------------------------------------------------------------------
// Sanctions (§3.9 ladder)
// ---------------------------------------------------------------------

export const SANCTION_LEVEL_LABELS: Record<number, string> = {
  0: "Warning",
  1: "Restriction — 7-day P2P pause",
  2: "Trade ban — 90 days",
  3: "Freeze — P2P and withdrawals held for investigation",
  4: "Permanent ban",
};

/** Default duration string the edge accepts for auto-expiring rungs. */
export function sanctionDefaultDuration(level: number): string | null {
  if (level === 1) return "7 days";
  if (level === 2) return "90 days";
  return null;
}

// ---------------------------------------------------------------------
// SLA clock (admin console §4.3)
// ---------------------------------------------------------------------

export interface SlaInfo {
  breached: boolean;
  label: string;
}

export function slaInfo(
  slaDueAt: string | null | undefined,
  nowMs: number,
): SlaInfo | null {
  if (!slaDueAt) return null;
  const due = new Date(slaDueAt).getTime();
  if (!Number.isFinite(due)) return null;
  const diff = due - nowMs;
  if (diff <= 0) {
    return { breached: true, label: `SLA breached by ${formatCountdownLabel(-diff)}` };
  }
  return { breached: false, label: `SLA: ${formatCountdownLabel(diff)} left` };
}

// ---------------------------------------------------------------------
// Trader display helpers
// ---------------------------------------------------------------------

export function traderDisplayName(
  nickname: string | null | undefined,
  userId: string,
): string {
  if (nickname && nickname.trim()) return nickname.trim();
  return `Trader ${userId.slice(0, 6)}`;
}

/** Completion-style summary from the public counters. */
export function completionSummary(profile: {
  trades_completed: number;
  orders_cancelled_unpaid: number;
  orders_expired_unpaid: number;
}): string {
  const finished = profile.trades_completed;
  const dropped = profile.orders_cancelled_unpaid + profile.orders_expired_unpaid;
  const total = finished + dropped;
  if (total === 0) return "No trades yet";
  const pct = Math.round((finished / total) * 100);
  return `${pct}% completion · ${finished} trades`;
}

// ---------------------------------------------------------------------
// Dispute receipt PDF (§4.3 research amendment) — print-window HTML
// following the TransactionReceipt pattern. All user-controlled
// strings are escaped: names, notes and references are data, never
// markup.
// ---------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface P2pReceiptData {
  orderId: string;
  statusLabel: string;
  asset: string;
  cryptoAmountBtc: string;
  fiatAmountZmw: number;
  priceZmw: number;
  feeSats: number;
  buyerName: string;
  sellerName: string;
  paymentMethodLine: string | null;
  railReference: string | null;
  createdAt: string;
  paidMarkedAt: string | null;
  completedAt: string | null;
  dispute: {
    reasonLabel: string;
    statusLabel: string;
    rulingNotes: string | null;
    ruledAt: string | null;
  } | null;
  generatedAt: string;
}

function receiptRow(label: string, value: string): string {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}

export function buildP2pReceiptHtml(data: P2pReceiptData): string {
  const fmtDate = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toUTCString() : iso;
  };
  const rows: string[] = [
    receiptRow("Order ID", data.orderId),
    receiptRow("Status", data.statusLabel),
    receiptRow("Amount", `${data.cryptoAmountBtc} ${data.asset}`),
    receiptRow("Fiat value", formatZmw(data.fiatAmountZmw)),
    receiptRow("Price", `${formatZmw(data.priceZmw)} per BTC`),
    receiptRow("Platform fee", formatSats(data.feeSats)),
    receiptRow("Buyer", data.buyerName),
    receiptRow("Seller", data.sellerName),
  ];
  if (data.paymentMethodLine) {
    rows.push(receiptRow("Paid to (seller's registered account)", data.paymentMethodLine));
  }
  if (data.railReference) {
    rows.push(receiptRow("Payment reference", data.railReference));
  }
  const created = fmtDate(data.createdAt);
  if (created) rows.push(receiptRow("Order created", created));
  const paid = fmtDate(data.paidMarkedAt);
  if (paid) rows.push(receiptRow("Payment marked", paid));
  const completed = fmtDate(data.completedAt);
  if (completed) rows.push(receiptRow("Completed", completed));
  if (data.dispute) {
    rows.push(receiptRow("Dispute reason", data.dispute.reasonLabel));
    rows.push(receiptRow("Dispute outcome", data.dispute.statusLabel));
    if (data.dispute.rulingNotes) {
      rows.push(receiptRow("Ruling notes", data.dispute.rulingNotes));
    }
    const ruled = fmtDate(data.dispute.ruledAt);
    if (ruled) rows.push(receiptRow("Ruled at", ruled));
  }

  return `<!doctype html>
<html><head><title>P2P Trade Receipt — ${escapeHtml(data.orderId)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 640px; margin: 40px auto; padding: 24px; color: #111; }
  .header { text-align: center; margin-bottom: 8px; }
  .logo { font-size: 22px; font-weight: 700; color: #0070ba; }
  .accent { height: 3px; background: #f7931a; border-radius: 2px; margin: 12px 0 20px; }
  .subtitle { text-align: center; color: #555; font-size: 14px; margin: 0 0 16px; }
  .row { display: flex; justify-content: space-between; gap: 24px; padding: 8px 0; border-bottom: 1px solid #eee; }
  .label { color: #666; font-size: 13px; }
  .value { font-weight: 500; font-size: 13px; text-align: right; word-break: break-word; }
  .footer { text-align: center; color: #888; font-size: 12px; margin-top: 32px; line-height: 1.5; }
  @media print { body { margin: 0; } }
</style></head><body>
  <div class="header"><div class="logo">BMaGlass Pay</div></div>
  <div class="accent"></div>
  <p class="subtitle">P2P Trade Receipt</p>
  ${rows.join("\n  ")}
  <div class="footer">
    <p>Generated ${escapeHtml(fmtDate(data.generatedAt) ?? data.generatedAt)} from the BMaGlass Pay trade record.<br/>
    This receipt is issued for use with banks and law enforcement. Escrow movements on BMaGlass Pay are final as recorded above.</p>
  </div>
</body></html>`;
}
