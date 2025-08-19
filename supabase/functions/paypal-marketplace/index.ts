import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAYPAL-MARKETPLACE] ${step}${detailsStr}`);
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

    const { 
      receiverUserId,
      grossAmount,
      platformFee,
      netAmount,
      currency = 'USD',
      description 
    } = await req.json();

    logStep("Marketplace payment request", { 
      payerUserId: user.id,
      receiverUserId, 
      grossAmount, 
      platformFee, 
      netAmount,
      currency 
    });

    // Validate receiver exists
    const { data: receiverProfile, error: receiverError } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('id', receiverUserId)
      .single();

    if (receiverError || !receiverProfile) {
      throw new Error('Receiver not found');
    }

    // Get PayPal access token
    const paypalAuth = await getPayPalAccessToken();
    if (!paypalAuth) throw new Error("Failed to authenticate with PayPal");

    // Create PayPal order with marketplace configuration
    const orderResponse = await createMarketplaceOrder(
      paypalAuth, 
      grossAmount, 
      platformFee, 
      netAmount, 
      currency, 
      user.email,
      description
    );

    if (!orderResponse.success) {
      throw new Error(orderResponse.error || 'PayPal marketplace order creation failed');
    }

    // Store marketplace transaction in database
    const { data: transaction, error: transactionError } = await supabaseClient
      .from('marketplace_transactions')
      .insert({
        payer_user_id: user.id,
        receiver_user_id: receiverUserId,
        paypal_order_id: orderResponse.orderId,
        gross_amount: grossAmount,
        platform_fee: platformFee,
        net_amount: netAmount,
        currency,
        status: 'pending',
        description
      })
      .select()
      .single();

    if (transactionError) {
      throw new Error(`Failed to store transaction: ${transactionError.message}`);
    }

    logStep("Marketplace order created", { 
      orderId: orderResponse.orderId,
      transactionId: transaction.id 
    });

    return new Response(JSON.stringify({ 
      success: true,
      approvalUrl: orderResponse.approvalUrl,
      orderId: orderResponse.orderId,
      transactionId: transaction.id
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-marketplace", { message: errorMessage });
    
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

async function createMarketplaceOrder(
  accessToken: string, 
  grossAmount: number, 
  platformFee: number, 
  netAmount: number, 
  currency: string, 
  payerEmail: string,
  description: string
) {
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
            value: grossAmount.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: currency,
                value: netAmount.toFixed(2)
              },
              handling: {
                currency_code: currency,
                value: platformFee.toFixed(2)
              }
            }
          },
          description: description,
          items: [{
            name: description,
            unit_amount: {
              currency_code: currency,
              value: netAmount.toFixed(2)
            },
            quantity: "1"
          }]
        }],
        payer: {
          email_address: payerEmail
        },
        application_context: {
          return_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`,
          cancel_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/paypal-webhook`,
          brand_name: "Your Platform",
          landing_page: "BILLING",
          user_action: "PAY_NOW"
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
        error: order.message || 'Marketplace order creation failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}