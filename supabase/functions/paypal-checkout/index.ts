import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAYPAL-CHECKOUT] ${step}${detailsStr}`);
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

    const { planId, amount, currency = 'USD', type = 'subscription' } = await req.json();
    logStep("Checkout request", { planId, amount, currency, type, userId: user.id });

    // Get PayPal access token
    const paypalAuth = await getPayPalAccessToken();
    if (!paypalAuth) throw new Error("Failed to authenticate with PayPal");

    let orderResponse;
    
    if (type === 'subscription') {
      // Create subscription plan if needed and then subscription
      orderResponse = await createPayPalSubscription(paypalAuth, planId, amount, currency, user.email);
    } else {
      // Create one-time payment order
      orderResponse = await createPayPalOrder(paypalAuth, amount, currency, user.email);
    }

    if (!orderResponse.success) {
      throw new Error(orderResponse.error || 'PayPal order creation failed');
    }

    // Store order/subscription info in database
    if (type === 'subscription') {
      await supabaseClient.from('subscriptions').insert({
        user_id: user.id,
        subscription_tier: planId,
        paypal_subscription_id: orderResponse.subscriptionId,
        paypal_plan_id: planId,
        status: 'pending'
      });
    } else {
      await supabaseClient.from('invoices').insert({
        user_id: user.id,
        paypal_order_id: orderResponse.orderId,
        amount,
        currency,
        status: 'pending',
        invoice_number: await generateInvoiceNumber(supabaseClient)
      });
    }

    logStep("Order/Subscription created", { 
      orderId: orderResponse.orderId, 
      subscriptionId: orderResponse.subscriptionId 
    });

    return new Response(JSON.stringify({ 
      success: true,
      approvalUrl: orderResponse.approvalUrl,
      orderId: orderResponse.orderId,
      subscriptionId: orderResponse.subscriptionId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-checkout", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function getPayPalAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  
  if (!clientId || !clientSecret) {
    console.error("PayPal credentials not found");
    return null;
  }

  const auth = btoa(`${clientId}:${clientSecret}`);
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  try {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("Error getting PayPal access token:", error);
    return null;
  }
}

async function createPayPalOrder(accessToken: string, amount: number, currency: string, email: string) {
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  try {
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: currency,
            value: amount.toFixed(2)
          }
        }],
        payer: {
          email_address: email
        },
        application_context: {
          return_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`,
          cancel_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`
        }
      }),
    });

    const order = await response.json();
    
    if (response.ok) {
      const approvalUrl = order.links?.find((link: any) => link.rel === "approve")?.href;
      return {
        success: true,
        orderId: order.id,
        approvalUrl
      };
    } else {
      return {
        success: false,
        error: order.message || 'Order creation failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function createPayPalSubscription(accessToken: string, planId: string, amount: number, currency: string, email: string) {
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  // First create a billing plan
  const planResponse = await createBillingPlan(accessToken, planId, amount, currency);
  if (!planResponse.success) {
    return planResponse;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        plan_id: planResponse.planId,
        subscriber: {
          email_address: email
        },
        application_context: {
          return_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`,
          cancel_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`
        }
      }),
    });

    const subscription = await response.json();
    
    if (response.ok) {
      const approvalUrl = subscription.links?.find((link: any) => link.rel === "approve")?.href;
      return {
        success: true,
        subscriptionId: subscription.id,
        approvalUrl
      };
    } else {
      return {
        success: false,
        error: subscription.message || 'Subscription creation failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function createBillingPlan(accessToken: string, planId: string, amount: number, currency: string) {
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  const planMap: Record<string, string> = {
    basic: "Basic Plan",
    premium: "Premium Plan", 
    enterprise: "Enterprise Plan"
  };

  try {
    const response = await fetch(`${baseUrl}/v1/billing/plans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        product_id: planId,
        name: planMap[planId] || planId,
        description: `${planMap[planId] || planId} subscription`,
        status: "ACTIVE",
        billing_cycles: [{
          frequency: {
            interval_unit: "MONTH",
            interval_count: 1
          },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: amount.toFixed(2),
              currency_code: currency
            }
          }
        }],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3
        }
      }),
    });

    const plan = await response.json();
    
    if (response.ok) {
      return {
        success: true,
        planId: plan.id
      };
    } else {
      return {
        success: false,
        error: plan.message || 'Plan creation failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function generateInvoiceNumber(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc('generate_invoice_number');
  if (error) {
    console.error('Error generating invoice number:', error);
    return `INV-${Date.now()}`;
  }
  return data;
}