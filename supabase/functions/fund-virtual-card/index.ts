
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertAccountNotFrozen } from "../_shared/account-freeze.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[FUND-VIRTUAL-CARD] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.id) throw new Error("User not authenticated");

    // ── Freeze guard: a frozen account cannot fund a card ──
    await assertAccountNotFrozen(supabaseClient, user.id);

    // Virtual cards are "Coming soon" for the public (CEO decision,
    // 2026-10-22): funding a card is a card action, so it stays
    // admin-only until the Mastercard developer-platform integration
    // is built and tested — the same rule create-virtual-card and the
    // card pages enforce.
    const { data: adminRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "super_admin"])
      .maybeSingle();
    if (!adminRole) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Virtual cards are coming soon — they're not available yet.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { cardId, amount } = await req.json();
    logStep("Fund request", { cardId, amount, userId: user.id });

    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    // Calculate fee (1% minimum K2)
    const feeAmount = Math.max(amount * 0.01, 2);
    const totalDebit = amount + feeAmount;

    // Get virtual card first — the card row carries wallet_id, the
    // wallet this card is bound to (set by create-virtual-card), and
    // funding must debit THAT wallet, not an arbitrary one.
    const { data: card, error: cardError } = await supabaseClient
      .from('virtual_cards')
      .select('*')
      .eq('id', cardId)
      .eq('user_id', user.id)
      .single();

    if (cardError || !card) {
      throw new Error("Virtual card not found");
    }

    // Resolve the funding wallet: the card's own bound wallet.
    // The old code selected by user_id with .single(), which throws
    // for anyone holding more than one wallet (the normal case:
    // ZMW + USD mains, sub-accounts) — funding could never work.
    // Legacy cards whose wallet_id is NULL fall back to the caller's
    // Main ZMW wallet (user_id + currency 'ZMW' + account_id IS
    // NULL), the same deterministic resolution create-virtual-card
    // uses — never .single() on user_id alone.
    let wallet: any = null;
    if (card.wallet_id) {
      const { data: boundWallet } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('id', card.wallet_id)
        .maybeSingle();
      // The bound wallet must belong to the caller; anything else is
      // treated as not found rather than leaking another user's row.
      if (boundWallet && boundWallet.user_id === user.id) {
        wallet = boundWallet;
      }
    } else {
      const { data: mainWallet } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('currency', 'ZMW')
        .is('account_id', null)
        .maybeSingle();
      wallet = mainWallet ?? null;
    }

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    if (wallet.status !== "active") {
      throw new Error("Wallet is not active");
    }

    // Check sufficient balance
    if (wallet.balance < totalDebit) {
      throw new Error("Insufficient wallet balance");
    }

    // Start transaction
    const { error: debitWalletError } = await supabaseClient
      .from('wallets')
      .update({
        balance: wallet.balance - totalDebit,
        updated_at: new Date().toISOString()
      })
      .eq('id', wallet.id);

    if (debitWalletError) {
      throw new Error("Failed to debit wallet");
    }

    // Credit virtual card
    const { error: creditCardError } = await supabaseClient
      .from('virtual_cards')
      .update({ 
        balance: card.balance + amount,
        updated_at: new Date().toISOString()
      })
      .eq('id', cardId);

    if (creditCardError) {
      // Rollback wallet debit — the same bound wallet that was debited
      await supabaseClient
        .from('wallets')
        .update({ balance: wallet.balance })
        .eq('id', wallet.id);
      throw new Error("Failed to credit virtual card");
    }

    // Record transaction — LIVE columns only (verified against
    // information_schema 2026-10-26): public.transactions has NO
    // transaction_type and NO processed_at column; the funding
    // kind is carried by `category`. The previous insert named
    // both phantom columns, PostgREST rejected it, and the failure
    // was swallowed by the warning below — no funding row was ever
    // recorded (live count of transactions with a virtual_card_id
    // was 0). created_at defaults to now() and serves as the
    // processed time.
    const { error: transactionError } = await supabaseClient
      .from('transactions')
      .insert({
        user_id: user.id,
        virtual_card_id: cardId,
        amount: amount,
        fee_amount: feeAmount,
        currency: 'ZMW',
        category: 'card_funding',
        direction: 'outgoing',
        status: 'completed',
        payment_method: 'wallet',
        reference: `FUND-${cardId}-${Date.now()}`
      });

    if (transactionError) {
      logStep("Warning: Failed to record transaction", transactionError);
    }

    logStep("Card funded successfully", { cardId, amount, feeAmount });

    return new Response(JSON.stringify({
      success: true,
      message: "Virtual card funded successfully",
      newCardBalance: card.balance + amount,
      newWalletBalance: wallet.balance - totalDebit,
      feeAmount: feeAmount
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in fund-virtual-card", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
