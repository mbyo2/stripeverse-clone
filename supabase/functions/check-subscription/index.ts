
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.id || !user?.email) throw new Error("User not authenticated");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2023-10-16",
    });

    // Get or create customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      logStep("No customer found, creating free subscription");
      await supabaseClient.from("subscribers").upsert({
        user_id: user.id,
        email: user.email,
        stripe_customer_id: null,
        subscription_tier: 'free',
        subscription_status: 'active',
        subscription_start: new Date().toISOString(),
        auto_renewal: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });

      return new Response(JSON.stringify({ 
        subscription_tier: 'free',
        subscription_status: 'active',
        subscription_end: null
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    let subscriptionTier = 'free';
    let subscriptionStatus = 'active';
    let subscriptionEnd = null;
    let stripeSubscriptionId = null;

    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      stripeSubscriptionId = subscription.id;
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      
      // Determine tier from price
      const priceId = subscription.items.data[0].price.id;
      const price = await stripe.prices.retrieve(priceId);
      const amount = price.unit_amount || 0;
      
      if (amount <= 999) {
        subscriptionTier = "basic";
      } else if (amount <= 1999) {
        subscriptionTier = "premium";
      } else {
        subscriptionTier = "enterprise";
      }
      
      subscriptionStatus = subscription.status === 'active' ? 'active' : 'inactive';
      logStep("Active subscription found", { subscriptionId: subscription.id, tier: subscriptionTier });
    }

    // Update subscribers table
    await supabaseClient.from("subscribers").upsert({
      user_id: user.id,
      email: user.email,
      stripe_customer_id: customerId,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_tier: subscriptionTier,
      subscription_status: subscriptionStatus,
      subscription_start: subscriptionTier !== 'free' ? new Date().toISOString() : null,
      subscription_end: subscriptionEnd,
      auto_renewal: subscriptionTier !== 'free',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    logStep("Updated subscription info", { tier: subscriptionTier, status: subscriptionStatus });

    return new Response(JSON.stringify({
      subscription_tier: subscriptionTier,
      subscription_status: subscriptionStatus,
      subscription_end: subscriptionEnd
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      subscription_tier: 'free',
      subscription_status: 'active',
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
