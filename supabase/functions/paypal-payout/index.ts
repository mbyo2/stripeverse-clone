// paypal-payout: withdraw money from a wallet back to PayPal —
// the platform's first live fiat exit.
//
// Until now PayPal money only flowed IN (wallet-deposit /
// process-payment). This function is the way out, and it follows
// the platform's honesty rules end to end:
//   - RESERVE FIRST: the balance is debited inside
//     reserve_paypal_withdrawal (service_role, row-locked,
//     idempotent) BEFORE anything is sent to PayPal. The same RPC
//     enforces the provenance rule (a user may withdraw to PayPal
//     at most the PayPal-sourced portion of their balance — the
//     mark follows the money between users; see the 20261028
//     migration), the min/daily limits, and the fee.
//   - PENDING MEANS PENDING: an accepted payout is 'processing'
//     until PayPal reports the item SUCCEEDED. Nothing here ever
//     answers success early.
//   - FAILURE MEANS REFUND, EXACTLY ONCE: a synchronous refusal
//     (including the payouts-not-enabled 403) refunds in the same
//     request; later failures refund through the status action or
//     the webhook backstop. The refund RPC owns the transition, so
//     races and replays cannot refund twice.
//   - NOT CONFIGURED MEANS NOT CONFIGURED: if the platform PayPal
//     account cannot send payouts, the user hears "PayPal
//     withdrawals are not available yet" — with their money already
//     back in the wallet — never a raw provider error.
//
// Actions (POST JSON { action, ... }):
//   create { amount, currency, recipient_email, wallet_id?,
//            idempotency_key }
//   status { withdrawal_id }  — refresh one withdrawal from PayPal
//   list   {}                 — the caller's withdrawals, newest first
//   float  {}                 — the platform float's public state
//                               (allowance / used / remaining, USD)
//                               so the withdraw form can preview the
//                               combined available figure. The
//                               reserve RPC re-derives everything
//                               under lock; this is a preview only.
//
// Money movement runs through a dedicated service-role client that
// does NOT forward the caller's JWT (getServiceRoleClient): the
// RPCs are EXECUTE-granted to service_role only, and a forwarded
// JWT would both demote the call and trip the balance-protection
// trigger. The request-scoped client is used ONLY to resolve the
// caller from their JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import {
  floatAvailable,
  isPayPalPayoutCurrency,
  isPlausibleEmail,
  normalizeCurrency,
  PAYOUT_DAILY_LIMIT,
  PAYOUT_MIN_AMOUNT,
  PAYOUTS_NOT_AVAILABLE_MESSAGE,
  payoutsEnabled,
  provenanceAvailable,
  provenanceRefusalMessage,
  withdrawalRefusalMessage,
} from "../_shared/paypal-payout.ts";
import {
  createPayPalPayout,
  finalizeAcceptedWithdrawal,
  findWithdrawalById,
  refreshWithdrawalFromPayPal,
  refundUnsentWithdrawal,
  type PayPalWithdrawalRow,
} from "../_shared/paypal-payout-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYPAL-PAYOUT] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const NOT_AVAILABLE_MESSAGE =
  "PayPal withdrawals are not available yet. Your money has been returned to your wallet — nothing was sent.";

function withdrawalView(row: PayPalWithdrawalRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    fee_amount: Number(row.fee_amount),
    recipient_email: row.recipient_email,
    status: row.status,
    provider_status: row.provider_status,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Resolve the caller from their JWT (request-scoped client).
    const supabase = getSupabaseClient(req);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const admin = getServiceRoleClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "create") {
      return await handleCreate(admin, user.id, body);
    }
    if (action === "status") {
      return await handleStatus(admin, user.id, body);
    }
    if (action === "list") {
      return await handleList(admin, user.id);
    }
    if (action === "float") {
      return await handleFloat(admin);
    }
    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json(
      { success: false, error: "This withdrawal could not be processed. If any money was reserved, it is returned automatically — check your withdrawal history." },
      500,
    );
  }
});

// deno-lint-ignore no-explicit-any
async function handleCreate(admin: any, userId: string, body: any) {
  // ── Rail gate FIRST (migration 20261242): PayPal Payouts needs a
  // separate account-level PayPal permission and settles from the
  // platform's own PayPal balance. Until both are in place no
  // withdrawal can settle, so while the flag is off the refusal
  // happens HERE — before the freeze guard, before any validation
  // that implies the form was viable, and above all before the
  // reserve RPC: nothing is reserved, nothing is sent, no row is
  // written. The gate fails closed: an unreadable settings row
  // counts as off.
  const { data: gateSettings } = await admin
    .from("platform_settings")
    .select("paypal_payouts_enabled")
    .eq("id", true)
    .maybeSingle();
  if (!payoutsEnabled(gateSettings)) {
    return json(
      { success: false, status: "not_configured", error: PAYOUTS_NOT_AVAILABLE_MESSAGE },
      503,
    );
  }

  // ── Freeze guard: a frozen account cannot withdraw ──
  // (status/list stay available to a frozen user; only new money-out
  // is refused.)
  if (await isAccountFrozen(admin, userId)) {
    return json({ success: false, status: "account_frozen", error: ACCOUNT_FROZEN_MESSAGE }, 403);
  }

  const amount = Number(body.amount);
  const currency = normalizeCurrency(body.currency);
  const recipientEmail = typeof body.recipient_email === "string" ? body.recipient_email.trim() : "";
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  const walletId = typeof body.wallet_id === "string" && body.wallet_id ? body.wallet_id : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ success: false, status: "failed", error: "Enter an amount greater than zero." }, 400);
  }
  // FIX-1: fiat amounts are whole cents/ngwee only — refused, never rounded.
  const amtCheck = validateFiatAmount(body.amount);
  if (!amtCheck.ok) {
    return json({ success: false, status: "failed", error: amtCheck.error }, 400);
  }
  if (!isPayPalPayoutCurrency(currency)) {
    return json({
      success: false,
      status: "failed",
      error: currency === "ZMW"
        ? "PayPal can't pay out in Zambian kwacha (ZMW). Withdraw from a USD wallet instead — you can convert your balance in the app first."
        : `PayPal withdrawals aren't supported in ${currency || "that currency"}.`,
    }, 400);
  }
  if (!isPlausibleEmail(recipientEmail)) {
    return json({ success: false, status: "failed", error: "Enter a valid PayPal email address." }, 400);
  }
  if (amount < PAYOUT_MIN_AMOUNT) {
    return json({
      success: false,
      status: "failed",
      error: `The minimum PayPal withdrawal is ${PAYOUT_MIN_AMOUNT.toFixed(2)} ${currency}.`,
    }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return json({ success: false, status: "failed", error: "A valid idempotency key is required." }, 400);
  }

  // ── Reserve first (the RPC also enforces provenance + limits) ──
  const { data, error } = await admin.rpc("reserve_paypal_withdrawal", {
    p_user_id: userId,
    p_wallet_id: walletId,
    p_amount: amount,
    p_currency: currency,
    p_recipient_email: recipientEmail,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Withdrawal reservation failed: ${error.message}`);
  const reserve = (Array.isArray(data) ? data[0] : data) as
    | {
        outcome: string;
        withdrawal_id: string | null;
        fee_amount: number | null;
        new_balance: number | null;
        provenance_available: number | null;
        daily_remaining: number | null;
        float_available: number | null;
      }
    | undefined;
  if (!reserve) throw new Error("Withdrawal reservation returned no result");

  switch (reserve.outcome) {
    case "wallet_not_found":
      return json({ success: false, status: "failed", error: `You don't have a ${currency} wallet to withdraw from.` }, 400);
    case "currency_mismatch":
      return json({ success: false, status: "failed", error: "That wallet holds a different currency." }, 400);
    case "wallet_not_active":
      return json({ success: false, status: "failed", error: "That wallet can't send money right now." }, 400);
    case "below_minimum":
      return json({ success: false, status: "failed", error: `The minimum PayPal withdrawal is ${PAYOUT_MIN_AMOUNT.toFixed(2)} ${currency}.` }, 400);
    case "limit_exceeded":
      return json({
        success: false,
        status: "failed",
        error: `That would pass today's PayPal withdrawal limit of ${PAYOUT_DAILY_LIMIT.toFixed(2)} ${currency} — you have ${Number(reserve.daily_remaining ?? 0).toFixed(2)} ${currency} of it left today.`,
      }, 400);
    case "over_provenance_cap": {
      // The cap is now provenance + platform float (20261213). The
      // user hears ONE true figure: when float room is part of it,
      // the combined copy explains both sources; with no float in
      // play the original provenance copy is the exact truth.
      const provenance = provenanceAvailable(Number(reserve.provenance_available ?? 0));
      const float = Number(reserve.float_available ?? 0);
      return json({
        success: false,
        status: "failed",
        error: float > 0
          ? withdrawalRefusalMessage(provenance + float, currency)
          : provenanceRefusalMessage(provenance, currency),
      }, 400);
    }
    case "insufficient_balance":
      return json({
        success: false,
        status: "failed",
        error: `Insufficient balance: you have ${Number(reserve.new_balance ?? 0).toFixed(2)} ${currency} and this withdrawal needs the amount plus any fee.`,
      }, 400);
    case "reserved":
    case "already_reserved":
      break;
    default:
      throw new Error(`Unexpected reservation outcome: ${reserve.outcome}`);
  }

  const row = await findWithdrawalById(admin, reserve.withdrawal_id as string);
  if (!row) throw new Error("Reserved withdrawal could not be re-read");

  // A replayed create for an already-sent withdrawal just reports
  // its current state — never sends twice. (Our reserve RPC's
  // idempotency is what guarantees this; a re-POST would in any case
  // be rejected by PayPal as a duplicate sender_batch_id, which the
  // send path classifies as already-submitted, not as a refusal.)
  if (reserve.outcome === "already_reserved" && row.status !== "pending") {
    return json({
      success: true,
      status: row.status,
      withdrawal: withdrawalView(row),
      new_balance: reserve.new_balance !== null ? Number(reserve.new_balance) : null,
    });
  }

  // ── Send to PayPal ──
  const sent = await createPayPalPayout(row);
  switch (sent.kind) {
    case "not_configured":
    case "not_enabled": {
      await refundUnsentWithdrawal(admin, row, NOT_AVAILABLE_MESSAGE);
      return json({ success: false, status: "failed", error: NOT_AVAILABLE_MESSAGE }, 503);
    }
    case "insufficient_funds": {
      const message =
        "PayPal withdrawals are temporarily unavailable. Your money has been returned to your wallet — nothing was sent.";
      await refundUnsentWithdrawal(admin, row, message);
      return json({ success: false, status: "failed", error: message }, 503);
    }
    case "rejected": {
      const message = `PayPal refused this withdrawal: ${sent.message} Your money has been returned to your wallet.`;
      await refundUnsentWithdrawal(admin, row, message);
      return json({ success: false, status: "failed", error: message }, 400);
    }
    case "already_submitted":
    case "unreachable": {
      // The batch may already exist at PayPal: either the send's
      // outcome was lost (unreachable) or PayPal told us this
      // withdrawal's sender_batch_id was already used
      // (already_submitted — the original batch, which may still pay
      // out). Either way the reservation stands and NOTHING is
      // refunded on a guess; the status action and the webhook
      // backstop settle the row from PayPal's own state.
      const { error: updateError } = await admin
        .from("paypal_withdrawals")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending");
      if (updateError) throw new Error(`Withdrawal update failed: ${updateError.message}`);
      const fresh = (await findWithdrawalById(admin, row.id)) ?? row;
      return json({
        success: true,
        status: "processing",
        withdrawal: withdrawalView(fresh),
        message: "Your withdrawal is being sent. Its status will update here as PayPal confirms it.",
      }, 202);
    }
    case "accepted": {
      const outcome = await finalizeAcceptedWithdrawal(admin, row, sent);
      const fresh = outcome.row;
      if (outcome.kind === "refunded") {
        return json({
          success: false,
          status: "failed",
          withdrawal: withdrawalView(fresh),
          error: `PayPal could not complete this withdrawal: ${outcome.reason} Your money has been returned to your wallet.`,
        }, 400);
      }
      return json({
        success: true,
        status: fresh.status,
        withdrawal: withdrawalView(fresh),
        new_balance: reserve.new_balance !== null ? Number(reserve.new_balance) : null,
        message: fresh.status === "completed"
          ? "PayPal has completed this withdrawal."
          : "Your withdrawal has been sent to PayPal and is processing. It completes when PayPal confirms it — track it in your withdrawal history.",
      });
    }
  }
}

// deno-lint-ignore no-explicit-any
async function handleStatus(admin: any, userId: string, body: any) {
  const withdrawalId = typeof body.withdrawal_id === "string" ? body.withdrawal_id : "";
  if (!withdrawalId) {
    return json({ success: false, error: "withdrawal_id is required" }, 400);
  }
  const row = await findWithdrawalById(admin, withdrawalId);
  if (!row || row.user_id !== userId) {
    return json({ success: false, error: "Withdrawal not found" }, 404);
  }
  const outcome = await refreshWithdrawalFromPayPal(admin, row);
  return json({
    success: true,
    status: outcome.row.status,
    withdrawal: withdrawalView(outcome.row),
    reachable: outcome.kind !== "unreachable",
  });
}

// deno-lint-ignore no-explicit-any
async function handleFloat(admin: any) {
  const { data: settings, error: settingsError } = await admin
    .from("platform_settings")
    .select("paypal_float_allowance_usd, paypal_payouts_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) throw new Error(`Float settings read failed: ${settingsError.message}`);
  const { data: used, error: usedError } = await admin.rpc("paypal_float_used_usd");
  if (usedError) throw new Error(`Float usage read failed: ${usedError.message}`);
  const allowance = Number(settings?.paypal_float_allowance_usd ?? 0);
  const usedUsd = Number(used ?? 0);
  return json({
    success: true,
    currency: "USD",
    allowance_usd: allowance,
    used_usd: usedUsd,
    remaining_usd: floatAvailable(allowance, usedUsd),
    // The rail gate rides along so the withdraw form's preview and
    // the create refusal can never disagree about whether the rail
    // is on (migration 20261242).
    payouts_enabled: payoutsEnabled(settings),
  });
}

// deno-lint-ignore no-explicit-any
async function handleList(admin: any, userId: string) {
  const { data, error } = await admin
    .from("paypal_withdrawals")
    .select(
      "id, user_id, wallet_id, amount, currency, fee_amount, recipient_email, " +
      "payout_batch_id, payout_item_id, status, provider_status, failure_reason, " +
      "idempotency_key, refunded_at, completed_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Withdrawal list failed: ${error.message}`);
  const rows = (data ?? []) as PayPalWithdrawalRow[];
  return json({ success: true, withdrawals: rows.map(withdrawalView) });
}
