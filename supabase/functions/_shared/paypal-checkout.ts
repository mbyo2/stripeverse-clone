// Server-side confirmation of PayPal CHECKOUT payments (Deno) — the
// orders `process-payment` creates for provider 'paypal'.
//
// Used by:
//   - `paypal-checkout-capture` — the buyer return flow: the app
//     sends the buyer back to /checkout?paypal_return=checkout with
//     the order id, the page invokes the function, and this module
//     settles the payment to its merchant.
//   - `paypal-webhook` — the backstop: CHECKOUT.ORDER.APPROVED /
//     PAYMENT.CAPTURE.COMPLETED events for a checkout order run the
//     same confirmation, so a buyer who never returns to the app
//     still settles the merchant.
//
// This is a deliberate mirror of _shared/paypal-deposit.ts (the
// wallet-deposit confirmation): the webhook payload is only ever a
// TRIGGER, the settlement decision is made from PayPal's own API
// state verified against the pending row, and the credit happens
// inside the complete_checkout_payment RPC (SECURITY DEFINER,
// service_role only) — row-locked and idempotent, so the return flow
// and the webhook can race and replay freely and the merchant is
// credited exactly once.
//
// Differences from the deposit twin, all deliberate:
//   - Rows are keyed metadata.kind = 'checkout_payment'; the row's
//     user_id / wallet_id are the MERCHANT's (the credit leg), and
//     the payer is recorded in metadata.payer_user_id — the return
//     flow pins callers against THAT, not against the row owner.
//   - The PayPal capture call uses its own PayPal-Request-Id
//     namespace (checkout-payment-capture-<order id>) so a checkout
//     capture never replays as a deposit capture or vice versa.
//
// The client passed in MUST be a dedicated service-role client that
// does not forward any caller Authorization header: the
// protect_wallet_balance trigger silently neutralizes wallet balance
// UPDATEs made while a user JWT is in scope (the internal-transfer
// lesson). Pure decision logic lives in ./deposit-capture.ts (shared
// with deposits — the money rule is identical) and
// ./checkout-capture.ts.

import {
  extractCompletedCapture,
  paypalErrorTrace,
  paypalOrderStatus,
  planCompletion,
  verifyCapture,
  type CapturedPayment,
  type PendingDeposit,
} from "./deposit-capture.ts";
import {
  fetchPayPalOrder,
  getPayPalAccessToken,
  paypalBaseUrl,
} from "./paypal-deposit.ts";

export interface CheckoutPaymentRow {
  uuid_id: string;
  /** The MERCHANT (credit-leg owner), not the payer. */
  user_id: string | null;
  wallet_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
}

export type ConfirmCheckoutResult =
  | { kind: "not_found" }
  | { kind: "forbidden"; transactionId: string }
  | { kind: "not_configured" }
  | { kind: "not_pending"; transactionId: string; status: string }
  | { kind: "pending"; transactionId: string; paypalStatus: string }
  | { kind: "failed"; transactionId: string; paypalStatus: string; error: string }
  | { kind: "mismatch"; transactionId: string; reason: string }
  | {
      kind: "completed";
      transactionId: string;
      captureId: string;
      amount: number;
      currency: string;
      merchantUserId: string | null;
      /** The merchant's settlement-wallet balance after credit. Server-side
       *  only: the payer-facing function must not disclose it. */
      merchantNewBalance: number | null;
      alreadyCredited: boolean;
    };

// deno-lint-ignore no-explicit-any
type AdminClient = any;

function checkoutRowToPending(row: CheckoutPaymentRow): PendingDeposit {
  const captureId =
    (typeof row.metadata?.capture_id === "string" ? row.metadata.capture_id : null) ??
    row.external_reference;
  return { amount: Number(row.amount), currency: row.currency, status: row.status, captureId };
}

/** The payer recorded on a checkout row at order creation, if any. */
export function payerUserIdOf(row: CheckoutPaymentRow): string | null {
  const payer = row.metadata?.payer_user_id;
  return typeof payer === "string" ? payer : null;
}

/** Find the checkout-payment row recorded for a PayPal order id, if any. */
export async function findCheckoutPaymentTransaction(
  admin: AdminClient,
  orderId: string,
): Promise<CheckoutPaymentRow | null> {
  const { data, error } = await admin
    .from("transactions")
    .select(
      "uuid_id, user_id, wallet_id, amount, currency, status, reference, external_reference, metadata",
    )
    .eq("reference", orderId)
    .eq("payment_method", "paypal")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Checkout payment lookup failed: ${error.message}`);
  const rows = (data ?? []) as CheckoutPaymentRow[];
  return rows.find((r) => r.metadata?.kind === "checkout_payment") ?? null;
}

/**
 * Confirm (and, when PayPal reports the order APPROVED, capture) the
 * checkout payment behind a PayPal order id, settling its merchant
 * exactly once. `expectPayerUserId` pins the payment to its buyer
 * (return flow); the webhook omits it.
 */
export async function confirmPayPalCheckoutPayment(
  admin: AdminClient,
  orderId: string,
  opts?: { expectPayerUserId?: string },
): Promise<ConfirmCheckoutResult> {
  const row = await findCheckoutPaymentTransaction(admin, orderId);
  if (!row) return { kind: "not_found" };
  if (opts?.expectPayerUserId && payerUserIdOf(row) !== opts.expectPayerUserId) {
    return { kind: "forbidden", transactionId: row.uuid_id };
  }

  const pending = checkoutRowToPending(row);

  // Already settled: report the truth without touching PayPal or money.
  if (row.status === "completed") {
    return {
      kind: "completed",
      transactionId: row.uuid_id,
      captureId: pending.captureId ?? "",
      amount: Number(row.amount),
      currency: row.currency,
      merchantUserId: row.user_id,
      merchantNewBalance: null,
      alreadyCredited: true,
    };
  }
  if (row.status !== "pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) return { kind: "not_configured" };

  let order = await fetchPayPalOrder(accessToken, orderId);
  if (!order) {
    return {
      kind: "failed",
      transactionId: row.uuid_id,
      paypalStatus: "unknown",
      error: "PayPal could not be reached to confirm this payment. The merchant has not been paid.",
    };
  }

  let capture: CapturedPayment | null = extractCompletedCapture(order);
  let status = paypalOrderStatus(order) ?? "unknown";

  // Approved but not yet captured: capture it now — the step that was
  // missing for checkout orders (they were created, approved, and
  // then simply never captured, so no merchant could ever be paid).
  if (!capture && status === "APPROVED") {
    const captured = await capturePayPalCheckoutOrder(accessToken, orderId);
    if (captured) {
      order = captured;
      capture = extractCompletedCapture(order);
      status = paypalOrderStatus(order) ?? status;
    } else {
      // Capture failed (or lost a race with the webhook): re-read the
      // order once — if it now shows a completed capture we can still
      // settle from PayPal's authoritative state.
      const reread = await fetchPayPalOrder(accessToken, orderId);
      if (reread) {
        order = reread;
        capture = extractCompletedCapture(order);
        status = paypalOrderStatus(order) ?? status;
      }
    }
  }

  if (!capture) {
    if (status === "VOIDED") {
      return {
        kind: "failed",
        transactionId: row.uuid_id,
        paypalStatus: status,
        error: "This PayPal order was voided before completion. No money was charged.",
      };
    }
    // CREATED / PAYER_ACTION_REQUIRED / APPROVED-without-capture /
    // COMPLETED-with-a-still-pending-capture: nothing settleable yet.
    return { kind: "pending", transactionId: row.uuid_id, paypalStatus: status };
  }

  const verification = verifyCapture(capture, pending);
  if (!verification.ok) {
    return { kind: "mismatch", transactionId: row.uuid_id, reason: verification.reason };
  }
  const plan = planCompletion(pending, capture.id);
  if (plan === "not_pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }
  if (plan === "conflict") {
    return { kind: "mismatch", transactionId: row.uuid_id, reason: "capture_conflict" };
  }

  // The RPC re-verifies amount + currency and performs the credit
  // atomically under the row lock — replay-safe by construction.
  const { data, error } = await admin.rpc("complete_checkout_payment", {
    p_order_id: orderId,
    p_capture_id: capture.id,
    p_captured_amount: capture.amount,
    p_captured_currency: capture.currency,
  });
  if (error) throw new Error(`Checkout payment completion failed: ${error.message}`);

  const result = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; new_balance: number | null }
    | undefined;
  if (!result) throw new Error("Checkout payment completion returned no result");

  switch (result.outcome) {
    case "credited":
    case "already_completed":
      return {
        kind: "completed",
        transactionId: row.uuid_id,
        captureId: capture.id,
        amount: Number(row.amount),
        currency: row.currency,
        merchantUserId: row.user_id,
        merchantNewBalance: result.new_balance !== null ? Number(result.new_balance) : null,
        alreadyCredited: result.outcome === "already_completed",
      };
    case "amount_mismatch":
    case "currency_mismatch":
    case "conflict":
      return { kind: "mismatch", transactionId: row.uuid_id, reason: result.outcome };
    case "not_pending":
      return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
    case "not_found":
      return { kind: "not_found" };
    default:
      return {
        kind: "failed",
        transactionId: row.uuid_id,
        paypalStatus: status,
        error: `Payment could not be settled (${result.outcome}). The merchant has not been paid.`,
      };
  }
}

// ── PayPal REST ──────────────────────────────────────────────────────

/**
 * Capture an approved checkout order. The PayPal-Request-Id makes the
 * capture itself idempotent at PayPal: a retried capture for the same
 * order replays instead of double-charging. The id namespace is
 * distinct from wallet deposits' on purpose.
 */
export async function capturePayPalCheckoutOrder(
  accessToken: string,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": `checkout-payment-capture-${orderId}`,
      },
    });
    if (!response.ok) {
      // Trace fields only (audit L1) — never the raw error body.
      console.error("PayPal checkout capture failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error("PayPal checkout capture error:", e);
    return null;
  }
}
