// escrow-settle: server-side escrow release and refund settlement.
//
// Flow:
//   1. Buyer creates escrow → atomic-transfer debits buyer (to_user_id=null,
//      reference_type='escrow_hold'). Funds leave buyer's wallet; the escrow
//      row tracks the obligation.
//   2. Buyer releases → this function credits the SELLER's wallet.
//   3. Buyer cancels → this function credits the BUYER's wallet (refund).
//
// Why a separate function: atomic-transfer requires from_user_id to match the
// authenticated user (JWT check). The settlement leg moves platform-held funds
// to the seller/buyer, so it runs with the service role after verifying the
// caller is the escrow buyer.
//
// Input: { escrow_id: string, action: 'release' | 'refund' }
// Returns: { success, transaction_id, recipient_id }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    const { escrow_id, action } = await req.json();
    if (!escrow_id) throw new Error("escrow_id required");
    if (!["release", "refund"].includes(action)) throw new Error("action must be 'release' or 'refund'");

    // ── Load and validate escrow ──
    const { data: escrow, error: escrowErr } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrow_id)
      .single();
    if (escrowErr || !escrow) throw new Error("Escrow not found");

    // Only the buyer can release or refund
    if (escrow.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: "Only the buyer can settle this escrow" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (escrow.status !== "funded") {
      throw new Error(`Escrow must be funded to settle (current: ${escrow.status})`);
    }

    const recipientId = action === "release" ? escrow.seller_id : escrow.buyer_id;
    const amount = Number(escrow.amount);
    const currency = escrow.currency || "ZMW";
    const idempotencyKey = `escrow-${action}-${escrow_id}`;

    // ── Idempotency: don't settle twice ──
    const { data: existing } = await supabase
      .from("transactions")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (existing) {
      throw new Error(`Escrow already settled (${action})`);
    }

    // ── Credit recipient wallet ──
    // increment_wallet_balance(p_user_id, p_amount) handles wallet creation
    // and atomic increment server-side.
    const { error: creditErr } = await supabase.rpc("increment_wallet_balance", {
      p_user_id: recipientId,
      p_amount: amount,
    });
    if (creditErr) throw new Error("Failed to credit recipient: " + creditErr.message);

    // Resolve wallet id for the transaction record
    const { data: walletRow } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", recipientId)
      .eq("currency", currency)
      .single();
    const walletId = walletRow?.id;
    if (!walletId) throw new Error("Could not resolve recipient wallet");

    // ── Record the settlement transaction ──
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: recipientId,
        wallet_id: walletId,
        amount,
        currency,
        direction: "incoming",
        payment_method: "wallet",
        status: "completed",
        description: action === "release"
          ? `Escrow released: ${escrow.description || escrow_id}`
          : `Escrow refunded: ${escrow.description || escrow_id}`,
        reference: escrow_id,
        category: action === "release" ? "escrow_release" : "escrow_refund",
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    if (txErr) throw new Error("Failed to record settlement: " + txErr.message);

    // ── Update escrow status ──
    const statusUpdate = action === "release"
      ? { status: "released", released_at: new Date().toISOString(), settlement_transaction_id: tx.id }
      : { status: "cancelled", cancelled_at: new Date().toISOString(), settlement_transaction_id: tx.id };

    const { error: updateErr } = await supabase
      .from("escrow_transactions")
      .update(statusUpdate)
      .eq("id", escrow_id);
    if (updateErr) throw new Error("Failed to update escrow: " + updateErr.message);

    return new Response(JSON.stringify({
      success: true,
      transaction_id: tx.id,
      recipient_id: recipientId,
      action,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Settlement failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
