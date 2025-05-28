
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0";

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

    let transactionResult;

    if (paymentMethod === 'stripe') {
      // Initialize Stripe (if STRIPE_SECRET_KEY is available)
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        throw new Error("Stripe not configured");
      }

      const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
      
      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd', // or 'zmw' if supported
        metadata: {
          user_id: user.id,
          type: 'wallet_deposit'
        }
      });

      transactionResult = {
        external_reference: paymentIntent.id,
        status: 'pending'
      };
    } else {
      // Mock successful payment for other methods
      transactionResult = {
        external_reference: `MOCK-${Date.now()}`,
        status: 'completed'
      };
    }

    // Record transaction
    const { data: transaction, error: transactionError } = await supabaseClient
      .from('transactions')
      .insert({
        user_id: user.id,
        amount: amount,
        currency: 'ZMW',
        transaction_type: 'deposit',
        direction: 'incoming',
        status: transactionResult.status,
        payment_method: paymentMethod,
        reference: `DEP-${Date.now()}`,
        external_reference: transactionResult.external_reference,
        processed_at: transactionResult.status === 'completed' ? new Date().toISOString() : null
      })
      .select()
      .single();

    if (transactionError) {
      throw new Error(`Failed to record transaction: ${transactionError.message}`);
    }

    // If payment is completed, update wallet balance
    if (transactionResult.status === 'completed') {
      const { error: walletError } = await supabaseClient
        .rpc('increment_wallet_balance', {
          p_user_id: user.id,
          p_amount: amount
        });

      if (walletError) {
        logStep("Failed to update wallet balance", walletError);
        // Update transaction status to failed
        await supabaseClient
          .from('transactions')
          .update({ status: 'failed' })
          .eq('id', transaction.id);
        throw new Error("Failed to update wallet balance");
      }
    }

    logStep("Deposit processed", { transactionId: transaction.id, status: transactionResult.status });

    return new Response(JSON.stringify({
      success: true,
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        status: transaction.status,
        reference: transaction.reference
      },
      paymentIntent: paymentMethod === 'stripe' ? transactionResult.external_reference : null
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
