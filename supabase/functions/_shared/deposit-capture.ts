// Pure decision logic for completing PayPal wallet deposits.
//
// Shared by the `paypal-deposit-capture` edge function (user return
// flow) and the `paypal-webhook` deposit backstop. Deliberately pure —
// no imports, no Deno APIs, no fetch — so the vitest suite exercises the
// exact code the edge functions run (same pattern as
// _shared/payment-providers.ts).
//
// The money rule this module encodes: a wallet may be credited ONLY
// from a PayPal capture whose status is COMPLETED and whose amount and
// currency exactly match the pending deposit row that wallet-deposit
// recorded at order creation (metadata.kind = 'wallet_deposit',
// reference = PayPal order id). Everything else is a truthful
// non-completion — never a partial credit, never a rounded "close
// enough".

/** A capture as PayPal reports it (from an order payload or a webhook). */
export interface CapturedPayment {
  id: string;
  status: string;
  /** Numeric amount, major units (e.g. 40.00). */
  amount: number;
  /** ISO currency code, upper case (e.g. "USD"). */
  currency: string;
}

/** The pending deposit row wallet-deposit recorded at order creation. */
export interface PendingDeposit {
  amount: number;
  currency: string;
  status: string;
  /** Capture id recorded when the deposit completed, if it has. */
  captureId: string | null;
}

/** Parse a PayPal money value ("40.00", 40, "40.5") to a number. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Money equality in integer minor units — no float drift. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function captureFromRecord(record: Record<string, unknown>): CapturedPayment | null {
  const id = record.id;
  const status = record.status;
  const amount = asRecord(record.amount);
  if (typeof id !== "string" || typeof status !== "string" || !amount) return null;
  const value = parseMoney(amount.value);
  const currency = amount.currency_code;
  if (value === null || typeof currency !== "string") return null;
  return { id, status, amount: value, currency: currency.toUpperCase() };
}

/**
 * Pull the completed capture out of a PayPal order payload
 * (GET /v2/checkout/orders/:id or the capture call's response).
 * Returns null when no capture on the order is COMPLETED — an APPROVED
 * order, or one whose capture is still PENDING at PayPal, has nothing
 * creditable yet.
 */
export function extractCompletedCapture(order: unknown): CapturedPayment | null {
  const o = asRecord(order);
  if (!o) return null;
  const units = o.purchase_units;
  if (!Array.isArray(units)) return null;
  for (const unit of units) {
    const payments = asRecord(asRecord(unit)?.payments);
    const captures = payments?.captures;
    if (!Array.isArray(captures)) continue;
    for (const raw of captures) {
      const rec = asRecord(raw);
      if (!rec) continue;
      const capture = captureFromRecord(rec);
      if (capture && capture.status === "COMPLETED") return capture;
    }
  }
  return null;
}

/** The order-level status string ("CREATED" | "APPROVED" | "COMPLETED" | …). */
export function paypalOrderStatus(order: unknown): string | null {
  const o = asRecord(order);
  return typeof o?.status === "string" ? o.status : null;
}

/**
 * The PayPal order id a webhook event refers to, for the two events
 * that can complete a deposit. Any other event type returns null.
 *   - CHECKOUT.ORDER.APPROVED: the resource IS the order.
 *   - PAYMENT.CAPTURE.COMPLETED: the resource is the capture; the order
 *     id rides in supplementary_data.related_ids.order_id.
 */
export function orderIdFromWebhookEvent(eventType: string, resource: unknown): string | null {
  const r = asRecord(resource);
  if (!r) return null;
  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    return typeof r.id === "string" ? r.id : null;
  }
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const related = asRecord(asRecord(r.supplementary_data)?.related_ids);
    const orderId = related?.order_id;
    return typeof orderId === "string" ? orderId : null;
  }
  return null;
}

export type CaptureVerification =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_capture" | "capture_not_completed" | "amount_mismatch" | "currency_mismatch";
    };

/**
 * Verify a PayPal capture against the recorded pending deposit.
 * This is the gate the credit decision must pass — in the edge layer
 * AND again inside the complete_wallet_deposit RPC.
 */
export function verifyCapture(
  capture: CapturedPayment | null,
  pending: PendingDeposit,
): CaptureVerification {
  if (!capture) return { ok: false, reason: "missing_capture" };
  if (capture.status !== "COMPLETED") return { ok: false, reason: "capture_not_completed" };
  if (!moneyEquals(capture.amount, pending.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (capture.currency.toUpperCase() !== pending.currency.toUpperCase()) {
    return { ok: false, reason: "currency_mismatch" };
  }
  return { ok: true };
}

export type CompletionPlan = "credit" | "already_completed" | "conflict" | "not_pending";

/**
 * Decide what a completion attempt may do with the pending row, before
 * any money moves. Mirrors the authority — the complete_wallet_deposit
 * RPC — so callers can answer honestly without a wasted round trip:
 *   - credit:            row is pending; proceed to verify + credit.
 *   - already_completed: this capture already credited this row; a
 *                        replay must report success without re-crediting.
 *   - conflict:          row completed under a DIFFERENT capture id —
 *                        never credit, surface it.
 *   - not_pending:       row is failed/cancelled/etc.; cannot complete.
 */
export function planCompletion(pending: PendingDeposit, captureId: string): CompletionPlan {
  if (pending.status === "completed") {
    return pending.captureId !== null && pending.captureId === captureId
      ? "already_completed"
      : "conflict";
  }
  if (pending.status !== "pending") return "not_pending";
  return "credit";
}

export type CancellationPlan =
  | "mark_cancelled"
  | "confirm_instead"
  | "already_cancelled"
  | "already_completed"
  | "not_pending";

/**
 * Decide what a payer-cancel report (the PayPal cancel-URL return) may
 * do with the deposit row. The cancel return is a CLAIM by the payer,
 * never proof: the flip is allowed only from PayPal's own order state,
 * fetched server-side with our credentials —
 *
 *   - mark_cancelled:  the row is still pending AND PayPal shows the
 *     order was never approved (CREATED / PAYER_ACTION_REQUIRED /
 *     SAVED) or was voided, with NO completed capture. Nothing was
 *     charged, so the row may flip pending → cancelled.
 *   - confirm_instead: PayPal shows a completed capture, or the order
 *     is APPROVED / COMPLETED — money is in flight or has moved. The
 *     cancellation claim must NOT bury it: the ordinary confirmation
 *     path decides (capture + verify + credit exactly once, or a
 *     truthful pending), exactly as if the payer had returned
 *     normally.
 *   - already_cancelled / already_completed / not_pending: replay and
 *     race outcomes — report the row's truth, touch nothing. A
 *     completed row is NEVER modified by a cancel report.
 *
 * An unrecognised PayPal status fails closed to confirm_instead: when
 * in doubt, the confirmation path — which re-reads PayPal itself —
 * governs, and nothing is flipped on a guess.
 *
 * Race note: the flip itself is a guarded UPDATE … WHERE status =
 * 'pending' in the edge layer, and the complete_wallet_deposit RPC
 * locks the row FOR UPDATE and refuses non-pending rows — so a
 * completion racing a cancel resolves exactly once, and a row that
 * flipped to cancelled first can never be credited afterwards (the
 * RPC answers not_pending; support reconciles from the order
 * reference if a payer ever pays through a stale approval link after
 * cancelling).
 */
export function planCancellation(
  rowStatus: string,
  paypal: { orderStatus: string | null; hasCompletedCapture: boolean },
): CancellationPlan {
  if (rowStatus === "completed") return "already_completed";
  if (rowStatus === "cancelled") return "already_cancelled";
  if (rowStatus !== "pending") return "not_pending";
  if (paypal.hasCompletedCapture) return "confirm_instead";
  switch (paypal.orderStatus) {
    case "CREATED":
    case "PAYER_ACTION_REQUIRED":
    case "SAVED":
    case "VOIDED":
      return "mark_cancelled";
    default:
      // APPROVED / COMPLETED / anything unrecognised: money may be
      // in flight — the confirmation path governs.
      return "confirm_instead";
  }
}

/** Trace fields for a failed PayPal API call, safe to write to logs. */
export interface PayPalErrorTrace {
  status: number;
  /** PayPal's error name (e.g. "UNPROCESSABLE_ENTITY_ERROR"), if any. */
  name: string | null;
  /** PayPal's debug_id — the id PayPal support traces by, if any. */
  debugId: string | null;
}

/**
 * Reduce a PayPal error response body to the fields that may be
 * logged (audit L1): the HTTP status, PayPal's error name, and its
 * debug_id. The raw body is NEVER logged — PayPal error `details`
 * can echo request field values (amounts, emails), and webhook /
 * capture payloads carry full payer PII. Status + name + debug_id
 * are enough to trace any failure with PayPal support.
 */
export function paypalErrorTrace(status: number, bodyText: string): PayPalErrorTrace {
  let name: string | null = null;
  let debugId: string | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.name === "string") name = rec.name;
      if (typeof rec.debug_id === "string") debugId = rec.debug_id;
    }
  } catch {
    // Not JSON — the status alone is the trace.
  }
  return { status, name, debugId };
}
