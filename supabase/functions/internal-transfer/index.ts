// internal-transfer: server-side transfer between a user's OWN wallets
// (e.g. Main account -> one of their sub-accounts, or back).
//
// Why this goes through an edge function instead of a direct RPC call:
// balances are guarded by the protect_wallet_balance trigger, which
// silently neutralizes wallet balance UPDATEs made while a user JWT is
// present (auth.uid() set). A browser-side RPC would write the ledger
// rows but move no money. Routing through here — user resolved from the
// JWT, transfer executed with a service-role client that forwards no
// caller token — is the same proven path as atomic-transfer.
//
// Input:
//   {
//     from_wallet_id, to_wallet_id,
//     amount, idempotency_key, description (optional)
//   }
//
// Auth: user JWT required. The RPC re-checks that both wallets belong to
// the resolved user, so a caller can only move their own money.
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
    const { from_wallet_id, to_wallet_id, amount, idempotency_key, description } = body;

    // ── Validation ──
    if (!from_wallet_id) throw new Error("from_wallet_id required");
    if (!to_wallet_id) throw new Error("to_wallet_id required");
    const amtCheck = validateFiatAmount(amount);
    if (!amtCheck.ok) throw new Error(amtCheck.error);
    const amt = amtCheck.amount;
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

    // ── Freeze guard: a frozen account cannot move money out ──
    await assertAccountNotFrozen(admin, user.id);

    const { data, error } = await admin.rpc("execute_internal_transfer", {
      p_user_id: user.id,
      p_from_wallet_id: from_wallet_id,
      p_to_wallet_id: to_wallet_id,
      p_amount: amt,
      p_idempotency_key: idempotency_key,
      p_description: description ?? null,
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
