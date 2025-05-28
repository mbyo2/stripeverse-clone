
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    const { cardId, amount } = await req.json();
    logStep("Fund request", { cardId, amount, userId: user.id });

    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    // Calculate fee (1% minimum K2)
    const feeAmount = Math.max(amount * 0.01, 2);
    const totalDebit = amount + feeAmount;

    // Get user wallet
    const { data: wallet, error: walletError } = await supabaseClient
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (walletError || !wallet) {
      throw new Error("Wallet not found");
    }

    // Check sufficient balance
    if (wallet.balance < totalDebit) {
      throw new Error("Insufficient wallet balance");
    }

    // Get virtual card
    const { data: card, error: cardError } = await supabaseClient
      .from('virtual_cards')
      .select('*')
      .eq('id', cardId)
      .eq('user_id', user.id)
      .single();

    if (cardError || !card) {
      throw new Error("Virtual card not found");
    }

    // Start transaction
    const { error: debitWalletError } = await supabaseClient
      .from('wallets')
      .update({ 
        balance: wallet.balance - totalDebit,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

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
      // Rollback wallet debit
      await supabaseClient
        .from('wallets')
        .update({ balance: wallet.balance })
        .eq('user_id', user.id);
      throw new Error("Failed to credit virtual card");
    }

    // Record transaction
    const { error: transactionError } = await supabaseClient
      .from('transactions')
      .insert({
        user_id: user.id,
        virtual_card_id: cardId,
        amount: amount,
        fee_amount: feeAmount,
        currency: 'ZMW',
        transaction_type: 'card_funding',
        direction: 'outgoing',
        status: 'completed',
        payment_method: 'wallet',
        reference: `FUND-${cardId}-${Date.now()}`,
        processed_at: new Date().toISOString()
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
