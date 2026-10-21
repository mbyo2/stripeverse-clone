// savings-transfer: server-side movement between a user's wallet and
// one of their savings goals (deposit: wallet -> goal; withdraw:
// goal -> wallet).
//
// Why an edge function: savings deposits used to be written from the
// browser as `balance = balance + amount` on savings_accounts — money
// from nothing, no wallet debit. The real movement runs through the
// execute_savings_transfer RPC (SECURITY DEFINER, service_role-only),
// invoked here with a service-role client that forwards no caller
// token — the same proven path as internal-transfer, required because
// protect_wallet_balance() silently neutralizes wallet balance UPDATEs
// made while a user JWT is present.
//
// Input:
//   {
//     savings_account_id, wallet_id,
//     amount, direction ('deposit' | 'withdraw'),
//     idempotency_key, description (optional)
//   }
//
// Auth: user JWT required. The RPC re-checks that the wallet and the
// savings account both belong to the resolved user.
//
// Returns: { success, transaction_id, new_wallet_balance, new_savings_balance }

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
    // ── Resolve the caller from their JWT ──
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
      savings_account_id, wallet_id, amount, direction,
      idempotency_key, description,
    } = body;

    // ── Validation ──
    if (!savings_account_id) throw new Error("savings_account_id required");
    if (!wallet_id) throw new Error("wallet_id required");
    if (direction !== "deposit" && direction !== "withdraw") {
      throw new Error("direction must be 'deposit' or 'withdraw'");
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error("Amount must be greater than zero");
    if (typeof idempotency_key !== "string" || idempotency_key.length < 8) {
      throw new Error("idempotency_key must be a string of at least 8 characters");
    }

    // ── Execute via Postgres function with a service-role client ──
    // Deliberately NOT the request-scoped client above: that one forwards
    // the caller's Authorization header, which would put auth.uid() back
    // in scope for the RPC and trip the balance-protection trigger.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await admin.rpc("execute_savings_transfer", {
      p_user_id: user.id,
      p_savings_account_id: savings_account_id,
      p_wallet_id: wallet_id,
      p_amount: amt,
      p_direction: direction,
      p_idempotency_key: idempotency_key,
      p_description: description ?? null,
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return new Response(JSON.stringify({
      success: true,
      transaction_id: row.transaction_id,
      new_wallet_balance: Number(row.new_wallet_balance),
      new_savings_balance: Number(row.new_savings_balance),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Savings transfer failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
