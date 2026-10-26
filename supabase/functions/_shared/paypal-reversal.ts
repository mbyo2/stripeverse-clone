// Pure decision logic for PayPal CAPTURE REVERSALS (audit D2,
// 2026-10-26) — refunds, reversals and denials of captures that
// already credited a wallet on this platform.
//
// Deliberately pure — no imports, no Deno APIs, no fetch — so the
// vitest suite exercises the exact code the webhook runs (the same
// pattern as _shared/deposit-capture.ts and _shared/paypal-payout.ts).
// The server side (paypal-webhook) uses these helpers like this:
//
//   1. The webhook payload is only ever a TRIGGER (the platform
//      invariant): ids are extracted from the event, then the
//      capture / refund / order are RE-QUERIED from PayPal's API.
//   2. planCaptureReversal decides, from that authoritative state,
//      whether a local credit must be reversed and to what
//      CUMULATIVE total (refunds can be partial and multiple).
//   3. The money move itself happens inside the
//      reverse_paypal_credit RPC (migration 20261226), which is
//      keyed per reversal event and clamps at the credited amount —
//      so replays, races and out-of-order events can never reverse
//      twice or reverse more than was credited. An event for a
//      capture that never credited anything is a no-op there.
//
// Reversal keys: a refund reverses under its own refund id (each
// partial refund is its own exactly-once unit); a capture reversal
// (chargeback / bank reversal) reverses under
// "capture-reversal:<capture id>".

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function moneyOf(value: unknown): { amount: number; currency: string } | null {
  const m = asRecord(value);
  if (!m) return null;
  const raw = typeof m.value === "string" ? m.value : typeof m.total === "string" ? m.total : null;
  const currency = stringOrNull(m.currency_code) ?? stringOrNull(m.currency);
  if (raw === null || !currency) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? { amount, currency: currency.toUpperCase() } : null;
}

/** The capture id a refund points at, from its HATEOAS "up" link. */
export function captureIdFromRefundLinks(refund: unknown): string | null {
  const r = asRecord(refund);
  if (!r || !Array.isArray(r.links)) return null;
  for (const raw of r.links) {
    const link = asRecord(raw);
    if (!link || link.rel !== "up") continue;
    const href = stringOrNull(link.href);
    if (!href) continue;
    const match = href.match(/\/v2\/payments\/captures\/([^/?#]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * The capture id a reversal-family event is about. REFUNDED events
 * carry a REFUND resource (its own id is the refund id; the capture
 * is behind the up-link). REVERSED / DENIED / PENDING events carry
 * the CAPTURE resource itself.
 */
export function reversalCaptureIdFromResource(eventType: string, resource: unknown): string | null {
  const r = asRecord(resource);
  if (!r) return null;
  if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    return captureIdFromRefundLinks(r);
  }
  if (
    eventType === "PAYMENT.CAPTURE.REVERSED" ||
    eventType === "PAYMENT.CAPTURE.DENIED" ||
    eventType === "PAYMENT.CAPTURE.PENDING"
  ) {
    return stringOrNull(r.id);
  }
  return null;
}

/** The refund id carried by a PAYMENT.CAPTURE.REFUNDED event. */
export function reversalRefundIdFromResource(resource: unknown): string | null {
  const r = asRecord(resource);
  return r ? stringOrNull(r.id) : null;
}

/** The order id a CHECKOUT.PAYMENT-APPROVAL.REVERSED event is about. */
export function approvalReversedOrderId(resource: unknown): string | null {
  const r = asRecord(resource);
  return r ? stringOrNull(r.id) : null;
}

// ── Authoritative-state shapes (from PayPal re-queries) ──────────

export interface CaptureState {
  id: string;
  /** COMPLETED / DECLINED / PARTIALLY_REFUNDED / PENDING / REFUNDED / FAILED */
  status: string;
  amount: number;
  currency: string;
  orderId: string | null;
}

export interface RefundState {
  id: string;
  /** COMPLETED / CANCELLED / PENDING / FAILED */
  status: string;
  amount: number;
  currency: string;
  /** Cumulative refunded total for the capture, when PayPal reports it. */
  totalRefunded: number | null;
  captureId: string | null;
}

export function captureStateFromApi(payload: unknown): CaptureState | null {
  const c = asRecord(payload);
  if (!c) return null;
  const id = stringOrNull(c.id);
  const status = stringOrNull(c.status)?.toUpperCase() ?? null;
  const money = moneyOf(c.amount);
  if (!id || !status || !money) return null;
  const related = asRecord(asRecord(c.supplementary_data)?.related_ids);
  return {
    id,
    status,
    amount: money.amount,
    currency: money.currency,
    orderId: related ? stringOrNull(related.order_id) : null,
  };
}

export function refundStateFromApi(payload: unknown): RefundState | null {
  const r = asRecord(payload);
  if (!r) return null;
  const id = stringOrNull(r.id);
  const status = stringOrNull(r.status)?.toUpperCase() ?? null;
  const money = moneyOf(r.amount);
  if (!id || !status || !money) return null;
  const breakdown = asRecord(r.seller_payable_breakdown);
  const total = breakdown ? moneyOf(breakdown.total_refunded_amount) : null;
  return {
    id,
    status,
    amount: money.amount,
    currency: money.currency,
    totalRefunded: total ? total.amount : null,
    captureId: captureIdFromRefundLinks(r),
  };
}

/** The refund list embedded in an order's purchase units. */
export function refundsFromOrderApi(payload: unknown): RefundState[] {
  const order = asRecord(payload);
  if (!order || !Array.isArray(order.purchase_units)) return [];
  const out: RefundState[] = [];
  for (const rawUnit of order.purchase_units) {
    const unit = asRecord(rawUnit);
    const payments = unit ? asRecord(unit.payments) : null;
    const refunds = payments && Array.isArray(payments.refunds) ? payments.refunds : [];
    for (const rawRefund of refunds) {
      const state = refundStateFromApi(rawRefund);
      if (state) out.push(state);
    }
  }
  return out;
}

// ── The plan ─────────────────────────────────────────────────────

export type CaptureReversalPlan =
  | {
      action: "reverse";
      captureId: string;
      /** Exactly-once key for this reversal unit (see header). */
      key: string;
      /** Cumulative total that should stand reversed after this event. */
      targetTotal: number;
      currency: string;
    }
  | { action: "none"; reason: string; retryable: boolean };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Decide the local reversal for one reversal-family event, from
 * PayPal's re-queried state only — never from the webhook payload.
 * The RPC remains the final authority (it re-checks the local row,
 * the key set and the credited cap under a row lock); this plan is
 * the honest computation of WHAT to ask it for.
 */
export function planCaptureReversal(input: {
  eventType: string;
  capture: CaptureState | null;
  refund: RefundState | null;
  orderRefunds: RefundState[];
}): CaptureReversalPlan {
  const { eventType, capture, refund, orderRefunds } = input;

  if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    if (!refund) return { action: "none", reason: "refund_state_unavailable", retryable: true };
    if (refund.status === "PENDING") {
      return { action: "none", reason: "refund_pending", retryable: false };
    }
    if (refund.status !== "COMPLETED") {
      return { action: "none", reason: "refund_not_completed", retryable: false };
    }
    const captureId = refund.captureId ?? capture?.id ?? null;
    if (!captureId) return { action: "none", reason: "capture_unidentified", retryable: true };
    const completedSum = round2(
      orderRefunds
        .filter((r) => r.status === "COMPLETED")
        .reduce((sum, r) => sum + r.amount, 0),
    );
    const targetTotal = refund.totalRefunded ?? (completedSum > 0 ? completedSum : refund.amount);
    return {
      action: "reverse",
      captureId,
      key: refund.id,
      targetTotal: round2(targetTotal),
      currency: refund.currency,
    };
  }

  if (eventType === "PAYMENT.CAPTURE.REVERSED") {
    if (!capture) return { action: "none", reason: "capture_state_unavailable", retryable: true };
    const completed = orderRefunds.filter((r) => r.status === "COMPLETED");
    if (completed.length > 0) {
      return {
        action: "reverse",
        captureId: capture.id,
        key: `capture-reversal:${capture.id}`,
        targetTotal: round2(completed.reduce((sum, r) => sum + r.amount, 0)),
        currency: capture.currency,
      };
    }
    if (capture.status === "REFUNDED") {
      // A full reversal with the refund records not visible on the
      // order: the reversal claws back the whole capture.
      return {
        action: "reverse",
        captureId: capture.id,
        key: `capture-reversal:${capture.id}`,
        targetTotal: capture.amount,
        currency: capture.currency,
      };
    }
    // The event arrived before PayPal's state shows the reversal:
    // ask PayPal to deliver it again rather than guessing.
    return { action: "none", reason: "reversal_not_visible_yet", retryable: true };
  }

  if (eventType === "PAYMENT.CAPTURE.DENIED") {
    // A denied capture was never completed, so it can never have
    // been credited here (credits require a COMPLETED capture). The
    // RPC would answer not_credited; nothing to reverse.
    return { action: "none", reason: "capture_declined", retryable: false };
  }

  if (eventType === "PAYMENT.CAPTURE.PENDING") {
    return { action: "none", reason: "capture_pending", retryable: false };
  }

  return { action: "none", reason: "unhandled_event", retryable: false };
}
