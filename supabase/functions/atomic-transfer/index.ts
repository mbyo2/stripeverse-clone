// atomic-transfer: server-side atomic money movement.
//
// Every money flow (transfers, bill payments, escrow, bulk payments, refunds)
// routes through here so balances move atomically with idempotency guards.
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
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error("Amount must be greater than zero");
    if (amt > 1_000_000) throw new Error("Amount exceeds per-transfer limit");
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
