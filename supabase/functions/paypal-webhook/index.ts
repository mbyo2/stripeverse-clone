import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  confirmPayPalDeposit,
  findDepositTransaction,
  getPayPalAccessToken,
  paypalBaseUrl,
} from "../_shared/paypal-deposit.ts";
import {
  confirmPayPalCheckoutPayment,
  findCheckoutPaymentTransaction,
} from "../_shared/paypal-checkout.ts";
import {
  extractPayPalWebhookSignatureHeaders,
  verifyPayPalWebhookSignature,
} from "../_shared/paypal-webhook-verify.ts";
import { orderIdFromWebhookEvent } from "../_shared/deposit-capture.ts";
import {
  payoutBatchIdFromWebhookResource,
  payoutItemIdFromWebhookResource,
  payoutSenderItemIdFromWebhookResource,
} from "../_shared/paypal-payout.ts";
import {
  attachProviderIds,
  findWithdrawalByBatchId,
  findWithdrawalById,
  findWithdrawalByItemId,
  refreshWithdrawalFromPayPal,
} from "../_shared/paypal-payout-server.ts";

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

    // Log ONLY the trace identifiers (audit L1): the full payload
    // carries payer PII (emails, names, addresses) and must never
    // reach the function logs. Event type + event id + resource id
    // are enough to trace an event end to end.
    logStep("Webhook event", {
      eventType: webhookData.event_type ?? null,
      eventId: webhookData.id ?? null,
      resourceId: webhookData.resource?.id ?? null,
    });

    // Verify webhook signature for security
    const isValid = await verifyWebhookSignature(req, webhookData);
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
      case 'PAYMENT.CAPTURE.COMPLETED': {
        // A capture belonging to a wallet-deposit order settles that
        // deposit (exactly once, via complete_wallet_deposit); a
        // capture belonging to a checkout order settles that payment
        // to its merchant (exactly once, via
        // complete_checkout_payment). Any other capture keeps the
        // invoice behaviour below.
        const depositHandled = await handleWalletDepositEvent(supabaseClient, eventType, resource);
        if (!depositHandled) {
          const checkoutHandled = await handleCheckoutPaymentEvent(supabaseClient, eventType, resource);
          if (!checkoutHandled) {
            await handlePaymentCompleted(supabaseClient, resource);
          }
        }
        break;
      }

      case 'CHECKOUT.ORDER.APPROVED':
        // Wallet-deposit and checkout orders get captured + settled
        // here as a backstop for buyers who never return to the app.
        // Orders of neither kind have nothing to do in this event.
        await handleWalletDepositEvent(supabaseClient, eventType, resource)
          || await handleCheckoutPaymentEvent(supabaseClient, eventType, resource);
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

      case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
      case 'PAYMENT.PAYOUTS-ITEM.FAILED':
      case 'PAYMENT.PAYOUTS-ITEM.RETURNED':
      case 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED':
      case 'PAYMENT.PAYOUTS-ITEM.BLOCKED':
      case 'PAYMENT.PAYOUTSBATCH.DENIED':
      case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
        // Withdrawal (payout) finalization backstop — the twin of
        // the deposit backstop below. NOTE: these event types must
        // also be subscribed on the PayPal webhook itself
        // (account-side) before PayPal will send them; the
        // paypal-payout status action polls the same finalization
        // path, so an unsubscribed event delays nothing forever.
        await handlePayoutEvent(supabaseClient, eventType, resource);
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
    
    // Generic error response - don't leak implementation details
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Webhook processing failed" 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

/**
 * Prove the event really came from PayPal, using PayPal's own
 * verification API — POST /v1/notifications/verify-webhook-signature
 * (see _shared/paypal-webhook-verify.ts). The previous implementation
 * HMAC-verified against a PAYPAL_WEBHOOK_SECRET: PayPal has no such
 * secret (its webhook signatures are RSA against a hosted cert), and
 * it called crypto.createHash, which does not exist on Deno's Web
 * Crypto — so it threw on every event and every genuine webhook was
 * rejected. Fails closed: missing headers, no PAYPAL_WEBHOOK_ID, no
 * access token, or any answer other than verification_status
 * "SUCCESS" returns false, the caller responds 401, and no state
 * changes.
 */
async function verifyWebhookSignature(req: Request, webhookEvent: unknown): Promise<boolean> {
  try {
    const headers = extractPayPalWebhookSignatureHeaders((name) => req.headers.get(name));
    if (!headers) {
      logStep("Missing required PayPal webhook headers");
      return false;
    }

    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
    if (!webhookId) {
      logStep("No webhook ID configured");
      return false;
    }

    const accessToken = await getPayPalAccessToken();
    if (!accessToken) {
      logStep("Could not obtain a PayPal access token for verification");
      return false;
    }

    const isValid = await verifyPayPalWebhookSignature(
      {
        headers,
        webhookId,
        webhookEvent,
        accessToken,
        baseUrl: paypalBaseUrl(),
      },
      (url, init) => fetch(url, init),
    );

    logStep("Webhook signature verification", { isValid });
    return isValid;
  } catch (error) {
    logStep("Error verifying webhook signature", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Backstop settlement for PayPal wallet deposits.
 *
 * Returns true when the event's order is a recorded wallet deposit
 * (handled here), false when it is not (caller falls back to the
 * pre-existing handlers). The webhook payload is only a trigger:
 * confirmPayPalDeposit re-reads PayPal's authoritative order state,
 * captures the order if it is still only APPROVED, verifies amount +
 * currency against the pending row, and credits the wallet through
 * the complete_wallet_deposit RPC — idempotently, so this backstop
 * and the buyer's return flow can race and replay safely.
 */
async function handleWalletDepositEvent(supabase: any, eventType: string, resource: any): Promise<boolean> {
  const orderId = orderIdFromWebhookEvent(eventType, resource);
  if (!orderId) return false;

  const deposit = await findDepositTransaction(supabase, orderId);
  if (!deposit) return false;

  const result = await confirmPayPalDeposit(supabase, orderId);
  logStep("Wallet deposit webhook confirmation", { orderId, kind: result.kind });
  return true;
}

/**
 * Backstop settlement for PayPal CHECKOUT payments — the twin of
 * handleWalletDepositEvent above, for the orders `process-payment`
 * creates. Returns true when the event's order is a recorded checkout
 * payment (handled here), false when it is not (caller falls back to
 * the pre-existing handlers). The webhook payload is only a trigger:
 * confirmPayPalCheckoutPayment re-reads PayPal's authoritative order
 * state, captures the order if it is still only APPROVED, verifies
 * amount + currency against the pending row, and settles the merchant
 * through the complete_checkout_payment RPC — idempotently, so this
 * backstop and the buyer's return flow can race and replay safely.
 */
async function handleCheckoutPaymentEvent(supabase: any, eventType: string, resource: any): Promise<boolean> {
  const orderId = orderIdFromWebhookEvent(eventType, resource);
  if (!orderId) return false;

  const payment = await findCheckoutPaymentTransaction(supabase, orderId);
  if (!payment) return false;

  const result = await confirmPayPalCheckoutPayment(supabase, orderId);
  logStep("Checkout payment webhook confirmation", { orderId, kind: result.kind });
  return true;
}

/**
 * Backstop finalization for PayPal WITHDRAWALS (payouts).
 *
 * The payload is only a trigger, exactly as with deposits: the
 * withdrawal row is found by PayPal's batch id, item id, or — for
 * item events, whose payout_item.sender_item_id is OUR withdrawal
 * id — by the sender item id (which also reattaches a withdrawal
 * whose creation response was lost). Finalization then re-reads
 * the batch from PayPal's API and completes or refunds from that
 * authoritative state, through the same RPCs the status action
 * uses — so webhook replays and webhook/poll races are no-ops and
 * a refund can only ever happen once.
 */
async function handlePayoutEvent(supabase: any, eventType: string, resource: any): Promise<void> {
  const batchId = payoutBatchIdFromWebhookResource(resource);
  const itemId = payoutItemIdFromWebhookResource(resource);
  const senderItemId = payoutSenderItemIdFromWebhookResource(resource);

  let row = batchId ? await findWithdrawalByBatchId(supabase, batchId) : null;
  if (!row && itemId) row = await findWithdrawalByItemId(supabase, itemId);
  if (!row && senderItemId) row = await findWithdrawalById(supabase, senderItemId);
  if (!row) {
    logStep("Payout event for unknown withdrawal", { eventType, batchId, itemId });
    return;
  }

  row = await attachProviderIds(supabase, row, batchId, itemId);
  const outcome = await refreshWithdrawalFromPayPal(supabase, row);
  logStep("Payout webhook finalization", {
    eventType,
    withdrawalId: row.id,
    kind: outcome.kind,
    status: outcome.row.status,
  });
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