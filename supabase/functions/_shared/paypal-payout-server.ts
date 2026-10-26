// Server-side orchestration for PayPal withdrawals (Deno).
//
// Used by:
//   - `paypal-payout` — the user-facing actions (create / status /
//     list). Create reserves first, then sends; status refreshes a
//     withdrawal from PayPal's own state and finalizes it.
//   - `paypal-webhook` — the backstop: PAYMENT.PAYOUTS-ITEM.* and
//     PAYMENT.PAYOUTSBATCH.* events finalize the same way.
//
// The webhook payload is only ever a TRIGGER here (the deposit
// pattern): finalization re-reads the payout batch from PayPal's API
// with our credentials and decides from THAT — never from the
// payload's claimed status. Money transitions themselves live in
// the reserve / refund / complete RPCs (SECURITY DEFINER,
// service_role only), so the status action and the webhook can race
// and replay freely: completion and refund are each exactly-once.
//
// The admin client passed in MUST be a dedicated service-role client
// that does not forward any caller Authorization header (the
// protect_wallet_balance lesson — see _shared/supabase-client.ts).
// Pure decision logic lives in ./paypal-payout.ts.

import { getPayPalAccessToken, paypalBaseUrl } from "./paypal-deposit.ts";
import {
  buildPayoutRequest,
  classifyPayoutPostFailure,
  extractBatchStatus,
  extractPayoutItem,
  payoutFailureReason,
  planPayoutFinalization,
  type PayoutFinalization,
  type PayoutItemState,
} from "./paypal-payout.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface PayPalWithdrawalRow {
  id: string;
  user_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  fee_amount: number;
  recipient_email: string;
  payout_batch_id: string | null;
  payout_item_id: string | null;
  status: string;
  provider_status: string | null;
  failure_reason: string | null;
  idempotency_key: string;
  refunded_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const WITHDRAWAL_COLUMNS =
  "id, user_id, wallet_id, amount, currency, fee_amount, recipient_email, " +
  "payout_batch_id, payout_item_id, status, provider_status, failure_reason, " +
  "idempotency_key, refunded_at, completed_at, created_at, updated_at";

export async function findWithdrawalById(
  admin: AdminClient,
  withdrawalId: string,
): Promise<PayPalWithdrawalRow | null> {
  const { data, error } = await admin
    .from("paypal_withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("id", withdrawalId)
    .maybeSingle();
  if (error) throw new Error(`Withdrawal lookup failed: ${error.message}`);
  return (data as PayPalWithdrawalRow | null) ?? null;
}

export async function findWithdrawalByBatchId(
  admin: AdminClient,
  batchId: string,
): Promise<PayPalWithdrawalRow | null> {
  const { data, error } = await admin
    .from("paypal_withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("payout_batch_id", batchId)
    .maybeSingle();
  if (error) throw new Error(`Withdrawal lookup failed: ${error.message}`);
  return (data as PayPalWithdrawalRow | null) ?? null;
}

export async function findWithdrawalByItemId(
  admin: AdminClient,
  itemId: string,
): Promise<PayPalWithdrawalRow | null> {
  const { data, error } = await admin
    .from("paypal_withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("payout_item_id", itemId)
    .maybeSingle();
  if (error) throw new Error(`Withdrawal lookup failed: ${error.message}`);
  return (data as PayPalWithdrawalRow | null) ?? null;
}

// ── PayPal Payouts REST ──────────────────────────────────────────────

export type CreatePayoutResult =
  | {
      kind: "accepted";
      batchId: string | null;
      item: PayoutItemState | null;
      batchStatus: string | null;
    }
  | { kind: "not_configured" }
  | { kind: "not_enabled" }
  | { kind: "insufficient_funds" }
  | { kind: "already_submitted" }
  | { kind: "rejected"; message: string }
  | { kind: "unreachable" };

/**
 * POST /v1/payments/payouts for one reserved withdrawal. The batch
 * id and item id are the withdrawal's own id, so the payout is
 * traceable to its row. Two distinct idempotency mechanisms ride on
 * the request, and they behave differently (audit D9):
 *   - the PayPal-Request-Id header (the withdrawal id): PayPal's
 *     documented Payouts idempotency — a retry with the same key
 *     returns the payout's current state instead of creating a
 *     second payout;
 *   - sender_batch_id (also the withdrawal id): NOT a dedupe key —
 *     PayPal rejects its reuse within 30 days, with a link to the
 *     original batch. That rejection is classified
 *     "already_submitted" below and resolved against the original
 *     batch — never refunded, because the original may still pay.
 */
export async function createPayPalPayout(
  row: PayPalWithdrawalRow,
): Promise<CreatePayoutResult> {
  const accessToken = await getPayPalAccessToken();
  if (!accessToken) return { kind: "not_configured" };
  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": row.id,
      },
      body: JSON.stringify(
        buildPayoutRequest({
          withdrawalId: row.id,
          recipientEmail: row.recipient_email,
          amount: Number(row.amount),
          currency: row.currency,
        }),
      ),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      // Log only the trace fields (audit L1): the raw error body can
      // echo request field values (including the receiver email) and
      // must not reach the logs. Status + PayPal's error name +
      // debug_id trace the failure with PayPal support.
      const errBody = body as Record<string, unknown> | null;
      console.error("PayPal payout create failed:", response.status, {
        name: typeof errBody?.name === "string" ? errBody.name : null,
        debugId: typeof errBody?.debug_id === "string" ? errBody.debug_id : null,
      });
      const failure = classifyPayoutPostFailure(response.status, body);
      if (failure.kind === "not_enabled") return { kind: "not_enabled" };
      if (failure.kind === "insufficient_funds") return { kind: "insufficient_funds" };
      if (failure.kind === "already_submitted") {
        // The original batch exists. With its id recovered from the
        // error's HATEOAS link, hand it to the finalizer exactly
        // like a fresh acceptance with unknown item state — it
        // re-reads the batch and settles from PayPal's truth.
        if (failure.batchId) {
          return {
            kind: "accepted",
            batchId: failure.batchId,
            item: null,
            batchStatus: null,
          };
        }
        return { kind: "already_submitted" };
      }
      return { kind: "rejected", message: failure.message };
    }
    const header = (body as Record<string, unknown> | null)?.batch_header as
      | Record<string, unknown>
      | undefined;
    return {
      kind: "accepted",
      batchId:
        typeof header?.payout_batch_id === "string" ? header.payout_batch_id : null,
      item: extractPayoutItem(body, row.id),
      batchStatus: extractBatchStatus(body),
    };
  } catch (e) {
    console.error("PayPal payout create error:", e);
    return { kind: "unreachable" };
  }
}

/** GET /v1/payments/payouts/{batch_id} — PayPal's authoritative state. */
export async function fetchPayPalPayoutBatch(
  batchId: string,
): Promise<Record<string, unknown> | null> {
  const accessToken = await getPayPalAccessToken();
  if (!accessToken) return null;
  try {
    const response = await fetch(
      `${paypalBaseUrl()}/v1/payments/payouts/${batchId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("PayPal payout batch fetch error:", e);
    return null;
  }
}

// ── Finalization ─────────────────────────────────────────────────────

export type FinalizeOutcome =
  | { kind: "completed"; row: PayPalWithdrawalRow }
  | { kind: "refunded"; row: PayPalWithdrawalRow; reason: string }
  | { kind: "unchanged"; row: PayPalWithdrawalRow }
  | { kind: "unreachable"; row: PayPalWithdrawalRow };

async function applyPlan(
  admin: AdminClient,
  row: PayPalWithdrawalRow,
  plan: PayoutFinalization,
  providerStatus: string | null,
  reason: string | null,
): Promise<FinalizeOutcome> {
  if (plan === "complete") {
    const { error } = await admin.rpc("complete_paypal_withdrawal", {
      p_withdrawal_id: row.id,
      p_provider_status: providerStatus,
    });
    if (error) throw new Error(`Withdrawal completion failed: ${error.message}`);
  } else if (plan === "refund") {
    const { error } = await admin.rpc("refund_paypal_withdrawal", {
      p_withdrawal_id: row.id,
      p_failure_reason: reason ?? "PayPal could not complete this payout.",
    });
    if (error) throw new Error(`Withdrawal refund failed: ${error.message}`);
  } else if (providerStatus && providerStatus !== row.provider_status) {
    const { error } = await admin
      .from("paypal_withdrawals")
      .update({ provider_status: providerStatus, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(`Withdrawal status update failed: ${error.message}`);
  }
  const fresh = (await findWithdrawalById(admin, row.id)) ?? row;
  if (plan === "complete") return { kind: "completed", row: fresh };
  if (plan === "refund") {
    return { kind: "refunded", row: fresh, reason: reason ?? "PayPal could not complete this payout." };
  }
  return { kind: "unchanged", row: fresh };
}

/**
 * Finalize a withdrawal from PayPal's CURRENT batch state. Used
 * immediately after creation (catches fast failures like an invalid
 * recipient), by the status action, and by the webhook backstop.
 * Idempotent: terminal rows and no-change plans move nothing.
 */
export async function refreshWithdrawalFromPayPal(
  admin: AdminClient,
  row: PayPalWithdrawalRow,
): Promise<FinalizeOutcome> {
  if (row.status === "completed" || row.status === "failed") {
    return { kind: "unchanged", row };
  }
  if (!row.payout_batch_id) return { kind: "unchanged", row };
  const batch = await fetchPayPalPayoutBatch(row.payout_batch_id);
  if (!batch) return { kind: "unreachable", row };
  const item = extractPayoutItem(batch, row.id);
  const batchStatus = extractBatchStatus(batch);
  const plan = planPayoutFinalization(row.status, item?.transactionStatus ?? null, batchStatus);
  const providerStatus = item?.transactionStatus ?? batchStatus;
  return applyPlan(admin, row, plan, providerStatus, payoutFailureReason(item));
}

/**
 * Finalize straight from a creation response we already hold (no
 * extra GET needed for the common fast outcomes), recording the
 * batch/item ids first. Falls back to a batch re-read when the
 * creation response carries no item state.
 */
export async function finalizeAcceptedWithdrawal(
  admin: AdminClient,
  row: PayPalWithdrawalRow,
  accepted: Extract<CreatePayoutResult, { kind: "accepted" }>,
): Promise<FinalizeOutcome> {
  const { error } = await admin
    .from("paypal_withdrawals")
    .update({
      payout_batch_id: accepted.batchId,
      payout_item_id: accepted.item?.payoutItemId ?? row.payout_item_id,
      status: "processing",
      provider_status: accepted.item?.transactionStatus ?? accepted.batchStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) throw new Error(`Withdrawal update failed: ${error.message}`);

  const fresh = (await findWithdrawalById(admin, row.id)) ?? row;
  if (accepted.item) {
    const plan = planPayoutFinalization(
      fresh.status,
      accepted.item.transactionStatus,
      accepted.batchStatus,
    );
    return applyPlan(
      admin,
      fresh,
      plan,
      accepted.item.transactionStatus ?? accepted.batchStatus,
      payoutFailureReason(accepted.item),
    );
  }
  return refreshWithdrawalFromPayPal(admin, fresh);
}

/**
 * Record PayPal's batch/item ids on a withdrawal that does not have
 * them yet (e.g. reattached from a webhook after a lost creation
 * response). Never overwrites ids already stored.
 */
export async function attachProviderIds(
  admin: AdminClient,
  row: PayPalWithdrawalRow,
  batchId: string | null,
  itemId: string | null,
): Promise<PayPalWithdrawalRow> {
  if ((batchId && !row.payout_batch_id) || (itemId && !row.payout_item_id)) {
    const { error } = await admin
      .from("paypal_withdrawals")
      .update({
        payout_batch_id: row.payout_batch_id ?? batchId,
        payout_item_id: row.payout_item_id ?? itemId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw new Error(`Withdrawal update failed: ${error.message}`);
    return (await findWithdrawalById(admin, row.id)) ?? row;
  }
  return row;
}

/**
 * Refund a withdrawal whose send never reached PayPal (not enabled,
 * platform funds, sync rejection, transport failure) and mark it
 * failed with a plain-language reason. The refund RPC performs the
 * money return exactly once; this wrapper also stamps the reason
 * for failures the RPC accepted before the row had one.
 */
export async function refundUnsentWithdrawal(
  admin: AdminClient,
  row: PayPalWithdrawalRow,
  reason: string,
): Promise<PayPalWithdrawalRow> {
  const { data, error } = await admin.rpc("refund_paypal_withdrawal", {
    p_withdrawal_id: row.id,
    p_failure_reason: reason,
  });
  if (error) throw new Error(`Withdrawal refund failed: ${error.message}`);
  const result = (Array.isArray(data) ? data[0] : data) as { outcome: string } | undefined;
  if (result && result.outcome !== "refunded" && result.outcome !== "already_refunded") {
    console.error("Unexpected refund outcome for unsent withdrawal:", result.outcome, row.id);
  }
  return (await findWithdrawalById(admin, row.id)) ?? row;
}
