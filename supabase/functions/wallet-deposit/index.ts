
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[WALLET-DEPOSIT] ${step}${detailsStr}`);
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
    if (!user?.id || !user?.email) throw new Error("User not authenticated");

    const { amount, paymentMethod } = await req.json();
    logStep("Deposit request", { amount, paymentMethod, userId: user.id });

    // Validate amount
    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    if (amount > 50000) {
      throw new Error("Maximum deposit amount is 50,000 ZMW");
    }

    // For MVP beta, simulate successful deposit for all methods
    const reference = `DEP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Ensure wallet exists first
    const { data: wallet } = await supabaseClient
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    let walletId = wallet?.id;

    if (!walletId) {
      const { data: newWallet, error: walletCreateError } = await supabaseClient
        .from('wallets')
        .insert({ user_id: user.id, balance: 0, currency: 'ZMW', status: 'active' })
        .select('id')
        .single();

      if (walletCreateError) throw new Error(`Failed to create wallet: ${walletCreateError.message}`);
      walletId = newWallet.id;
    }

    // Record transaction
    const { data: transaction, error: transactionError } = await supabaseClient
      .from('transactions')
      .insert({
        user_id: user.id,
        wallet_id: walletId,
        amount: amount,
        currency: 'ZMW',
        direction: 'incoming',
        status: 'completed',
        payment_method: paymentMethod || 'mobile_money',
        reference: reference,
        description: `Wallet deposit via ${paymentMethod || 'mobile money'}`,
        category: 'deposit',
      })
      .select()
      .single();

    if (transactionError) {
      logStep("Transaction insert error", transactionError);
      throw new Error(`Failed to record transaction: ${transactionError.message}`);
    }

    // Update wallet balance
    const { error: walletError } = await supabaseClient
      .rpc('increment_wallet_balance', {
        p_user_id: user.id,
        p_amount: amount
      });

    if (walletError) {
      logStep("Failed to update wallet balance", walletError);
      // Revert transaction status
      await supabaseClient
        .from('transactions')
        .update({ status: 'failed' })
        .eq('uuid_id', transaction.uuid_id);
      throw new Error("Failed to update wallet balance");
    }

    logStep("Deposit processed", { transactionId: transaction.uuid_id, amount, reference });

    return new Response(JSON.stringify({
      success: true,
      transaction: {
        id: transaction.uuid_id,
        amount: transaction.amount,
        status: transaction.status,
        reference: transaction.reference
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in wallet-deposit", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
