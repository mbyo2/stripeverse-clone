// atomic-transfer: server-side atomic money movement.
//
// Every money flow (transfers, bill payments, escrow, bulk payments, refunds)
// routes through here so balances move atomically with idempotency guards.
//
// Send Money is one exception to the generic path: requests with
// reference_type "send_money" are routed to the dedicated
// execute_send_money_transfer RPC, which computes the 2.5% send fee
// (platform_settings.send_money_fee_percent) and credits it to the
// platform wallet atomically with the send — the client never names
// the fee amount or the fee's destination.
//
// The user-to-user Transfer flow is the second exception (CEO
// decision, 2026-10-23 — supersedes the 2026-10-22 "Transfer stays
// free" call): requests with reference_type "transfer" AND
// "qr_payment" are routed to execute_transfer_with_fee, the
// transfer-fee twin of the send RPC, which charges 1.5%
// (platform_settings.transfer_fee_percent) on top and credits it to
// the platform the same way. QR pay carries its own marker but is a
// user-to-user wallet transfer, so it pays the transfer fee too.
// Every other reference_type (bill_payment, bnpl_installment,
// bulk_payment, escrow_hold, refund) keeps the generic
// execute_atomic_transfer path below, untouched.
//
// Input:
//   {
//     from_user_id, to_user_id (nullable — null = external/biller payment),
//     amount, currency (default 'ZMW'),
//     reference_type, reference_id, idempotency_key,
//     description, recipient_name, payment_method
//   }
//
// Auth: user JWT required. A user may only send from their OWN wallet.
// (Internal service-role callers bypass this by design — the RPC runs
// with the service role key, but the from_user_id check below still applies
// to JWT-authenticated callers.)
//
// ⚠️ The RPC MUST be executed with a dedicated service-role client that
// does NOT forward the caller's JWT (same pattern as internal-transfer):
// execute_atomic_transfer is EXECUTE-granted to service_role only, and
// PostgREST runs a request carrying a user JWT in the `authenticated`
// role — so the shared getSupabaseClient(req), which forwards the
// caller's Authorization header, gets "permission denied for function
// execute_atomic_transfer" on every call. The forwarded JWT would also
// put auth.uid() in scope for the RPC, tripping the
// protect_wallet_balance trigger that neutralizes balance UPDATEs made
// under a user session. That combination is why user-to-user sends
// failed server-side while the UI could only show a generic error
// (found in Money QA Round 2, 2026-10-22). The request-scoped client
// below is used ONLY to resolve the caller from their JWT.
//
// Returns: { success, transaction_id, new_sender_balance }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { assertAccountNotFrozen } from "../_shared/account-freeze.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      from_user_id, to_user_id, amount, currency,
      reference_type, reference_id, idempotency_key,
      description, recipient_name, payment_method,
    } = body;

    // ── Validation ──
    // FIX-1: fiat amounts are whole-ngwee only. 10.001 is REFUSED here
    // (never rounded): a 3dp debit against a 2dp credit destroyed
    // value and corrupted balances. Shared validator, every entry point.
    const amtCheck = validateFiatAmount(amount);
    if (!amtCheck.ok) throw new Error(amtCheck.error);
    const amt = amtCheck.amount;
    if (!from_user_id) throw new Error("from_user_id required");
    if (!reference_type) throw new Error("reference_type required");
    if (!idempotency_key) throw new Error("idempotency_key required");

    // Users may only move money out of their OWN wallet.
    if (from_user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden: cannot send from another user's wallet" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No self-transfers
    if (to_user_id && to_user_id === from_user_id) {
      throw new Error("Cannot transfer to yourself");
    }

    // ── Execute atomically via Postgres function (row locking inside) ──
    // Dedicated service-role client — deliberately NOT the request-scoped
    // one above: that one forwards the caller's Authorization header,
    // which demotes this call to the `authenticated` role (the RPC is
    // service_role-only → permission denied) and would put auth.uid()
    // back in scope for the balance-protection trigger.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ── Freeze guard: a frozen account cannot move money out ──
    // (from_user_id was verified === user.id above.)
    await assertAccountNotFrozen(admin, user.id);

    // ── Send Money: dedicated RPC that charges the send fee ──────────
    // The fee (2.5% at launch) is computed inside
    // execute_send_money_transfer from platform_settings and credited
    // to the platform operator's Main wallet in the same transaction
    // as the send. Nothing about the fee is taken from the request.
    if (reference_type === "send_money") {
      if (!to_user_id) throw new Error("to_user_id required");

      const { data, error } = await admin.rpc("execute_send_money_transfer", {
        p_from_user_id: from_user_id,
        p_to_user_id: to_user_id,
        p_amount: amt,
        p_currency: currency || "ZMW",
        p_reference_id: reference_id || null,
        p_idempotency_key: idempotency_key,
        p_description: description || null,
        p_recipient_name: recipient_name || null,
        p_payment_method: payment_method || "wallet",
      });

      if (error) throw new Error(error.message);

      const row = Array.isArray(data) ? data[0] : data;
      return new Response(JSON.stringify({
        success: true,
        transaction_id: row.transaction_id,
        new_sender_balance: Number(row.new_sender_balance),
        fee_amount: Number(row.fee_amount ?? 0),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Transfer + QR pay: dedicated RPC that charges the transfer fee ──
    // The fee (1.5% at launch, CEO decision 2026-10-23) is computed
    // inside execute_transfer_with_fee from platform_settings and
    // credited to the platform operator's Main wallet in the same
    // transaction as the transfer. Nothing about the fee is taken
    // from the request. "qr_payment" is routed here as well: QR pay
    // has its own marker, but it IS a user-to-user wallet transfer,
    // so it carries the transfer fee exactly like "transfer" does.
    if (reference_type === "transfer" || reference_type === "qr_payment") {
      if (!to_user_id) throw new Error("to_user_id required");

      const { data, error } = await admin.rpc("execute_transfer_with_fee", {
        p_from_user_id: from_user_id,
        p_to_user_id: to_user_id,
        p_amount: amt,
        p_currency: currency || "ZMW",
        p_reference_id: reference_id || null,
        p_idempotency_key: idempotency_key,
        p_description: description || null,
        p_recipient_name: recipient_name || null,
        p_payment_method: payment_method || "wallet",
      });

      if (error) throw new Error(error.message);

      const row = Array.isArray(data) ? data[0] : data;
      return new Response(JSON.stringify({
        success: true,
        transaction_id: row.transaction_id,
        new_sender_balance: Number(row.new_sender_balance),
        fee_amount: Number(row.fee_amount ?? 0),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await admin.rpc("execute_atomic_transfer", {
      p_from_user_id: from_user_id,
      p_to_user_id: to_user_id || null,
      p_amount: amt,
      p_currency: currency || "ZMW",
      p_reference_type: reference_type,
      p_reference_id: reference_id || null,
      p_idempotency_key: idempotency_key,
      p_description: description || null,
      p_recipient_name: recipient_name || null,
      p_payment_method: payment_method || "wallet",
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return new Response(JSON.stringify({
      success: true,
      transaction_id: row.transaction_id,
      new_sender_balance: Number(row.new_sender_balance),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transfer failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
