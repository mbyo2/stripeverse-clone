import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAYPAL-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const body = await req.text();
    const webhookData = JSON.parse(body);
    
    logStep("Webhook data", webhookData);

    // Verify webhook signature for security
    const isValid = await verifyWebhookSignature(req, body);
    if (!isValid) {
      logStep("Invalid webhook signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const eventType = webhookData.event_type;
    const resource = webhookData.resource;

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCompleted(supabaseClient, resource);
        break;
      
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(supabaseClient, resource);
        break;
      
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(supabaseClient, resource);
        break;
      
      case 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED':
        await handleSubscriptionPaymentCompleted(supabaseClient, resource);
        break;
      
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        await handleSubscriptionPaymentFailed(supabaseClient, resource);
        break;
      
      default:
        logStep("Unhandled event type", { eventType });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-webhook", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function verifyWebhookSignature(req: Request, body: string): Promise<boolean> {
  // In production, implement proper PayPal webhook signature verification
  // For now, return true for development
  return true;
}

async function handlePaymentCompleted(supabase: any, resource: any) {
  logStep("Processing payment completion", { orderId: resource.supplementary_data?.related_ids?.order_id });
  
  const orderId = resource.supplementary_data?.related_ids?.order_id;
  if (!orderId) return;

  // Update invoice status
  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString()
    })
    .eq('paypal_order_id', orderId);

  if (error) {
    logStep("Error updating invoice", error);
  } else {
    logStep("Invoice marked as paid", { orderId });
  }
}

async function handleSubscriptionActivated(supabase: any, resource: any) {
  logStep("Processing subscription activation", { subscriptionId: resource.id });
  
  const subscriptionId = resource.id;
  const planId = resource.plan_id;
  
  // Update subscription status
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
    })
    .eq('paypal_subscription_id', subscriptionId);

  if (error) {
    logStep("Error updating subscription", error);
  } else {
    logStep("Subscription activated", { subscriptionId });
  }
}

async function handleSubscriptionCancelled(supabase: any, resource: any) {
  logStep("Processing subscription cancellation", { subscriptionId: resource.id });
  
  const subscriptionId = resource.id;
  
  // Update subscription status
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled'
    })
    .eq('paypal_subscription_id', subscriptionId);

  if (error) {
    logStep("Error updating subscription", error);
  } else {
    logStep("Subscription cancelled", { subscriptionId });
  }
}

async function handleSubscriptionPaymentCompleted(supabase: any, resource: any) {
  logStep("Processing subscription payment", { subscriptionId: resource.billing_agreement_id });
  
  // Create invoice for the payment
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('user_id, subscription_tier')
    .eq('paypal_subscription_id', resource.billing_agreement_id)
    .single();

  if (subscription) {
    const invoiceNumber = await generateInvoiceNumber(supabase);
    
    await supabase
      .from('invoices')
      .insert({
        user_id: subscription.user_id,
        amount: parseFloat(resource.amount.total),
        currency: resource.amount.currency,
        status: 'paid',
        invoice_number: invoiceNumber,
        paid_at: new Date().toISOString()
      });

    logStep("Subscription payment recorded", { subscriptionId: resource.billing_agreement_id });
  }
}

async function handleSubscriptionPaymentFailed(supabase: any, resource: any) {
  logStep("Processing subscription payment failure", { subscriptionId: resource.billing_agreement_id });
  
  // You might want to notify the user or take other actions here
  // For now, just log the failure
}

async function generateInvoiceNumber(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc('generate_invoice_number');
  if (error) {
    console.error('Error generating invoice number:', error);
    return `INV-${Date.now()}`;
  }
  return data;
}