// bank-payout: withdraw money from a ZMW wallet to a ZAMBIAN BANK
// ACCOUNT — the Payoneer-gap programme's bank cash-out leg (CEO
// order 2026-10-28), modelled on paypal-payout end to end.
//
// The channel is OPERATOR-PAID at launch — there is no bank API
// moving this money. The lifecycle (migration 20261245):
//   create          → reserve_bank_withdrawal debits + holds the
//                     balance and opens the row as pending_review.
//   admin approve   → the operator pays it from the platform's
//                     bank account.
//   admin mark_paid → with the bank's own reference; terminal.
//   admin reject / fail → the transition RPC refunds the full
//                     reservation (amount + fee) exactly once.
// No step ever answers success early, and a refund is never a
// guess: the transition RPC owns every state change under the
// withdrawal row's lock, so replays are no-ops.
//
// THE RAIL GATE (migration 20261245, the 20261242 pattern): while
// platform_settings.bank_payouts_enabled is off, create answers
// 503 not_configured with crafted copy BEFORE the freeze guard and
// BEFORE any reservation — nothing is reserved, nothing is sent,
// no row is written. settings / methods / list keep working so
// saved accounts and history stay visible while the rail is off.
//
// Money movement runs through a dedicated service-role client that
// does NOT forward the caller's JWT (getServiceRoleClient): the
// RPCs are EXECUTE-granted to service_role only. The request-scoped
// client is used ONLY to resolve the caller from their JWT. Admin
// actions re-check the caller's role here AND inside the
// transition RPC, and every successful transition writes an
// audit_logs row (the paypal-admin pattern: the audit is required,
// and its failure is surfaced, never hidden).
//
// Actions (POST JSON { action, ... }):
//   settings        {} — rail state for the form (enabled / fee % /
//                        minimum), readable while the rail is off.
//   methods_list    {} — the caller's saved bank accounts (masked).
//   methods_add     { bank_code, account_name, account_number }
//   methods_remove  { bank_account_id }
//   create          { amount, bank_account_id, wallet_id?,
//                     idempotency_key }
//   list            {} — the caller's bank withdrawals, newest first.
//   admin_list      {} — admin: the queue (all users) + totals.
//   admin_transition { withdrawal_id, transition: approve |
//                      reject | mark_paid | fail, reason?,
//                      external_reference? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import {
  BANK_ADMIN_REFUSAL_MESSAGE,
  BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE,
  bankPayoutFeePercent,
  bankPayoutMinZmw,
  bankPayoutsEnabled,
  canUseBankAdminFor,
  isBankAdminAction,
  isKnownZambianBankCode,
  isPlausibleAccountNumber,
  maskAccountNumber,
  zambianBankName,
} from "../_shared/bank-payout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[BANK-PAYOUT] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** The user's own view of a withdrawal: destination masked. */
function withdrawalView(row: Row) {
  return {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    fee_amount: Number(row.fee_amount),
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number_masked: maskAccountNumber(row.account_number),
    status: row.status,
    failure_reason: row.failure_reason,
    external_reference: row.external_reference,
    created_at: row.created_at,
    updated_at: row.updated_at,
    paid_at: row.paid_at,
  };
}

/** The admin queue's view: the operator needs the full account
 *  number to pay, plus who asked and when. */
function adminWithdrawalView(row: Row, ownerEmail: string | null) {
  return {
    ...withdrawalView(row),
    user_id: row.user_id,
    owner_email: ownerEmail,
    account_number: row.account_number,
    bank_code: row.bank_code,
    admin_note: row.admin_note,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
  };
}

function methodView(row: Row) {
  return {
    id: row.id,
    bank_name: row.bank_name,
    bank_code: row.bank_code,
    account_name: row.account_name,
    account_number_masked: maskAccountNumber(row.account_number),
    account_number_last4: String(row.account_number ?? "").slice(-4),
    is_primary: row.is_primary === true,
    created_at: row.created_at,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    switch (action) {
      case "settings":
        return await handleSettings(admin);
      case "methods_list":
        return await handleMethodsList(admin, user.id);
      case "methods_add":
        return await handleMethodsAdd(admin, user.id, body);
      case "methods_remove":
        return await handleMethodsRemove(admin, user.id, body);
      case "create":
        return await handleCreate(admin, user.id, body);
      case "list":
        return await handleList(admin, user.id);
      case "admin_list":
        return await handleAdminList(admin, user.id, body);
      case "admin_transition":
        return await handleAdminTransition(admin, user.id, body);
      default:
        return json({ success: false, error: "Unknown action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json(
      { success: false, error: "This withdrawal could not be processed. If any money was reserved, it stays reserved and visible in your withdrawal history — it is never lost." },
      500,
    );
  }
});

// deno-lint-ignore no-explicit-any
async function readSettings(admin: any) {
  const { data } = await admin
    .from("platform_settings")
    .select("bank_payouts_enabled, bank_payout_fee_percent, bank_payout_min_zmw")
    .eq("id", true)
    .maybeSingle();
  return data as Row | null;
}

// deno-lint-ignore no-explicit-any
async function handleSettings(admin: any) {
  const settings = await readSettings(admin);
  return json({
    success: true,
    enabled: bankPayoutsEnabled(settings),
    fee_percent: bankPayoutFeePercent(settings),
    min_zmw: bankPayoutMinZmw(settings),
    currency: "ZMW",
  });
}

// deno-lint-ignore no-explicit-any
async function handleMethodsList(admin: any, userId: string) {
  const { data, error } = await admin
    .from("bank_accounts")
    .select("id, bank_name, bank_code, account_name, account_number, is_primary, created_at")
    .eq("user_id", userId)
    .eq("country", "ZM")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Bank account list failed: ${error.message}`);
  return json({ success: true, methods: (data ?? []).map(methodView) });
}

// deno-lint-ignore no-explicit-any
async function handleMethodsAdd(admin: any, userId: string, body: any) {
  const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim().toUpperCase() : "";
  const accountName = typeof body.account_name === "string" ? body.account_name.trim() : "";
  const accountNumber = typeof body.account_number === "string"
    ? body.account_number.replace(/[\s-]/g, "")
    : "";
  if (!isKnownZambianBankCode(bankCode)) {
    return json({ success: false, status: "failed", error: "Choose your bank from the list." }, 400);
  }
  if (accountName.length < 2 || accountName.length > 120) {
    return json({ success: false, status: "failed", error: "Enter the name on the bank account." }, 400);
  }
  if (!isPlausibleAccountNumber(accountNumber)) {
    return json({ success: false, status: "failed", error: "Enter the bank account number (digits only, 6 to 20 of them)." }, 400);
  }
  const { data: existing } = await admin
    .from("bank_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("account_number", accountNumber)
    .maybeSingle();
  if (existing) {
    return json({ success: false, status: "failed", error: "That bank account is already saved." }, 400);
  }
  const { count } = await admin
    .from("bank_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const { data, error } = await admin
    .from("bank_accounts")
    .insert({
      user_id: userId,
      bank_name: zambianBankName(bankCode),
      bank_code: bankCode,
      account_name: accountName,
      account_number: accountNumber,
      account_type: "savings",
      currency: "ZMW",
      country: "ZM",
      is_primary: (count ?? 0) === 0,
    })
    .select("id, bank_name, bank_code, account_name, account_number, is_primary, created_at")
    .single();
  if (error) throw new Error(`Saving the bank account failed: ${error.message}`);
  return json({ success: true, method: methodView(data) });
}

// deno-lint-ignore no-explicit-any
async function handleMethodsRemove(admin: any, userId: string, body: any) {
  const id = typeof body.bank_account_id === "string" ? body.bank_account_id : "";
  if (!id) {
    return json({ success: false, status: "failed", error: "bank_account_id is required." }, 400);
  }
  const { error } = await admin
    .from("bank_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`Removing the bank account failed: ${error.message}`);
  return json({ success: true });
}

// deno-lint-ignore no-explicit-any
async function handleCreate(admin: any, userId: string, body: any) {
  // ── Rail gate FIRST (migration 20261245): until the operator
  // payout channel and its funding are in place no bank withdrawal
  // can settle, so while the flag is off the refusal happens HERE —
  // before the freeze guard and before the reserve RPC: nothing is
  // reserved, nothing is sent, no row is written. The gate fails
  // closed: an unreadable settings row counts as off.
  const settings = await readSettings(admin);
  if (!bankPayoutsEnabled(settings)) {
    return json(
      { success: false, status: "not_configured", error: BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE },
      503,
    );
  }

  // ── Freeze guard: a frozen account cannot withdraw ──
  if (await isAccountFrozen(admin, userId)) {
    return json({ success: false, status: "account_frozen", error: ACCOUNT_FROZEN_MESSAGE }, 403);
  }

  const amount = Number(body.amount);
  const bankAccountId = typeof body.bank_account_id === "string" ? body.bank_account_id : "";
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  const walletId = typeof body.wallet_id === "string" && body.wallet_id ? body.wallet_id : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ success: false, status: "failed", error: "Enter an amount greater than zero." }, 400);
  }
  const amtCheck = validateFiatAmount(body.amount);
  if (!amtCheck.ok) {
    return json({ success: false, status: "failed", error: amtCheck.error }, 400);
  }
  if (!bankAccountId) {
    return json({ success: false, status: "failed", error: "Choose the bank account to pay to." }, 400);
  }
  const minZmw = bankPayoutMinZmw(settings);
  if (amount < minZmw) {
    return json({
      success: false,
      status: "failed",
      error: `The minimum bank withdrawal is K${minZmw.toFixed(2)}.`,
    }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return json({ success: false, status: "failed", error: "A valid idempotency key is required." }, 400);
  }

  // ── Reserve first (the RPC enforces ownership, limits, fee) ──
  const { data, error } = await admin.rpc("reserve_bank_withdrawal", {
    p_user_id: userId,
    p_wallet_id: walletId,
    p_bank_account_id: bankAccountId,
    p_amount: amount,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Withdrawal reservation failed: ${error.message}`);
  const reserve = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; withdrawal_id: string | null; fee_amount: number | null; new_balance: number | null }
    | undefined;
  if (!reserve) throw new Error("Withdrawal reservation returned no result");

  switch (reserve.outcome) {
    case "bank_account_not_found":
      return json({ success: false, status: "failed", error: "That bank account isn't one of your saved accounts." }, 400);
    case "wallet_not_found":
      return json({ success: false, status: "failed", error: "You don't have a ZMW wallet to withdraw from." }, 400);
    case "currency_mismatch":
      return json({ success: false, status: "failed", error: "Bank withdrawals are made from your ZMW wallet — convert your balance to ZMW first." }, 400);
    case "wallet_not_active":
      return json({ success: false, status: "failed", error: "That wallet can't send money right now." }, 400);
    case "below_minimum":
      return json({ success: false, status: "failed", error: `The minimum bank withdrawal is K${minZmw.toFixed(2)}.` }, 400);
    case "insufficient_balance":
      return json({
        success: false,
        status: "failed",
        error: `Insufficient balance: you have K${Number(reserve.new_balance ?? 0).toFixed(2)} and this withdrawal needs the amount plus any fee.`,
      }, 400);
    case "reserved":
    case "already_reserved":
      break;
    default:
      throw new Error(`Unexpected reservation outcome: ${reserve.outcome}`);
  }

  const { data: row, error: readError } = await admin
    .from("bank_withdrawals")
    .select("*")
    .eq("id", reserve.withdrawal_id)
    .single();
  if (readError || !row) throw new Error("Reserved withdrawal could not be re-read");
  return json({
    success: true,
    status: row.status,
    withdrawal: withdrawalView(row),
    new_balance: reserve.new_balance !== null ? Number(reserve.new_balance) : null,
    message: reserve.outcome === "already_reserved"
      ? "This withdrawal was already requested — it is being reviewed."
      : "Your withdrawal is reserved and waiting for review. We'll pay it to your bank once it's approved.",
  });
}

// deno-lint-ignore no-explicit-any
async function handleList(admin: any, userId: string) {
  const { data, error } = await admin
    .from("bank_withdrawals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Withdrawal list failed: ${error.message}`);
  return json({ success: true, withdrawals: (data ?? []).map(withdrawalView) });
}

// deno-lint-ignore no-explicit-any
async function handleAdminList(admin: any, userId: string, body: any) {
  if (!(await canUseBankAdminFor(admin, userId))) {
    return json({ success: false, status: "forbidden", error: BANK_ADMIN_REFUSAL_MESSAGE }, 403);
  }
  const status = typeof body.status === "string" ? body.status : "";
  let query = admin
    .from("bank_withdrawals")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Queue read failed: ${error.message}`);
  const rows = (data ?? []) as Row[];

  // Resolve owner emails + profile names for the queue (the
  // name-match check compares the bank account name against the
  // wallet holder's name).
  const emails = new Map<string, string>();
  const names = new Map<string, string>();
  const uniqueUsers = [...new Set(rows.map((r) => r.user_id as string))];
  for (const uid of uniqueUsers) {
    const { data: userData } = await admin.auth.admin.getUserById(uid);
    if (userData?.user?.email) emails.set(uid, userData.user.email);
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", uid)
      .maybeSingle();
    const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
    if (full) names.set(uid, full);
  }

  const totals = {
    pending_review_count: 0,
    pending_review_zmw: 0,
    approved_count: 0,
    approved_zmw: 0,
  };
  for (const r of rows) {
    if (r.status === "pending_review") {
      totals.pending_review_count += 1;
      totals.pending_review_zmw += Number(r.amount) + Number(r.fee_amount);
    }
    if (r.status === "approved") {
      totals.approved_count += 1;
      totals.approved_zmw += Number(r.amount) + Number(r.fee_amount);
    }
  }

  return json({
    success: true,
    withdrawals: rows.map((r) => ({
      ...adminWithdrawalView(r, emails.get(r.user_id) ?? null),
      holder_name: names.get(r.user_id) ?? null,
    })),
    totals,
  });
}

// deno-lint-ignore no-explicit-any
async function handleAdminTransition(admin: any, userId: string, body: any) {
  if (!(await canUseBankAdminFor(admin, userId))) {
    return json({ success: false, status: "forbidden", error: BANK_ADMIN_REFUSAL_MESSAGE }, 403);
  }
  const withdrawalId = typeof body.withdrawal_id === "string" ? body.withdrawal_id : "";
  // The transition verb travels in its OWN field: body.action is
  // the router's field ("admin_transition") and cannot carry both.
  const verb = body.transition;
  if (!withdrawalId || !isBankAdminAction(verb)) {
    return json({ success: false, status: "failed", error: "A withdrawal and a valid action are required." }, 400);
  }
  const reason = typeof body.reason === "string" ? body.reason : null;
  const externalReference = typeof body.external_reference === "string" ? body.external_reference : null;

  const { data: before } = await admin
    .from("bank_withdrawals")
    .select("status, amount, fee_amount")
    .eq("id", withdrawalId)
    .maybeSingle();

  const { data, error } = await admin.rpc("transition_bank_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_admin_id: userId,
    p_action: verb,
    p_reason: reason,
    p_external_reference: externalReference,
  });
  if (error) throw new Error(`Withdrawal transition failed: ${error.message}`);
  const result = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; withdrawal_status: string | null; new_balance: number | null }
    | undefined;
  if (!result) throw new Error("Withdrawal transition returned no result");

  switch (result.outcome) {
    case "forbidden":
      return json({ success: false, status: "forbidden", error: BANK_ADMIN_REFUSAL_MESSAGE }, 403);
    case "not_found":
      return json({ success: false, status: "failed", error: "Withdrawal not found." }, 404);
    case "reason_required":
      return json({ success: false, status: "failed", error: "Give a reason — the user sees it, and a refund follows it." }, 400);
    case "reference_required":
      return json({ success: false, status: "failed", error: "Enter the bank's reference for this payment before marking it paid." }, 400);
    case "invalid_transition":
      return json({
        success: false,
        status: "failed",
        error: `This withdrawal is ${String(result.withdrawal_status ?? "settled")} — that action no longer applies, and nothing was changed.`,
      }, 409);
    case "approved":
    case "rejected":
    case "paid_out":
    case "failed":
      break;
    default:
      throw new Error(`Unexpected transition outcome: ${result.outcome}`);
  }

  // ── Audit (required — the paypal-admin pattern): the transition
  // already committed, so an audit failure is surfaced loudly to
  // the caller rather than hidden; the row itself carries the
  // actor (reviewed_by / paid_by) as a second record.
  const { error: auditError } = await admin
    .from("audit_logs")
    .insert({
      user_id: userId,
      action: `bank_withdrawal_${verb}`,
      table_name: "bank_withdrawals",
      record_id: withdrawalId,
      old_values: before ? { status: before.status } : null,
      new_values: {
        status: result.withdrawal_status,
        amount: before ? Number(before.amount) : null,
        fee_amount: before ? Number(before.fee_amount) : null,
        reason,
        external_reference: externalReference,
      },
    });
  if (auditError) {
    logStep("AUDIT INSERT FAILED after transition", { message: auditError.message });
    return json({
      success: false,
      status: "audit_failed",
      error: "The change was made, but its audit record could not be written. Note the withdrawal ID and tell the platform owner before continuing.",
      withdrawal_id: withdrawalId,
      new_status: result.withdrawal_status,
    }, 500);
  }

  const { data: row } = await admin
    .from("bank_withdrawals")
    .select("*")
    .eq("id", withdrawalId)
    .single();
  return json({
    success: true,
    status: result.withdrawal_status,
    withdrawal: row ? withdrawalView(row) : null,
  });
}
