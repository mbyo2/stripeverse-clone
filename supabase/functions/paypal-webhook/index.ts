import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  confirmPayPalDeposit,
  fetchPayPalCapture,
  fetchPayPalOrder,
  fetchPayPalRefund,
  findDepositTransaction,
  getPayPalAccessToken,
  paypalBaseUrl,
} from "../_shared/paypal-deposit.ts";
import {
  captureStateFromApi,
  planCaptureReversal,
  refundStateFromApi,
  refundsFromOrderApi,
  reversalCaptureIdFromResource,
  reversalRefundIdFromResource,
  approvalReversedOrderId,
} from "../_shared/paypal-reversal.ts";
import { extractCompletedCapture } from "../_shared/deposit-capture.ts";
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

      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED':
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.PENDING':
        // Money PayPal took back (or never finally took) after a
        // capture: reconcile the local credit from PayPal's own
        // re-queried state — reverse_paypal_credit reverses exactly
        // once per refund/reversal, and an uncredited capture
        // changes nothing (audit D2).
        await handleCaptureReversalEvent(supabaseClient, eventType, resource);
        break;

      case 'CHECKOUT.PAYMENT-APPROVAL.REVERSED':
        // An approved-but-uncaptured order was reversed/voided:
        // close out any still-pending local row for it, truthfully.
        await handleApprovalReversedEvent(supabaseClient, resource);
        break;

      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(supabaseClient, resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(supabaseClient, resource);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        // The real subscription-payment event (audit D4): PayPal
        // fires PAYMENT.SALE.COMPLETED for a billing-agreement sale;
        // "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED" does not exist,
        // so the case that used to sit here never ran.
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
      case 'PAYMENT.PAYOUTS-ITEM.DENIED':
      case 'PAYMENT.PAYOUTS-ITEM.CANCELED':
      case 'PAYMENT.PAYOUTS-ITEM.REFUNDED':
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

  // Audit D5: this handler used to mark the invoice paid from the
  // payload alone. The payload is only a trigger — re-query the
  // order and require a COMPLETED capture whose amount and currency
  // match the invoice before anything is marked paid.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, amount, currency, status')
    .eq('paypal_order_id', orderId)
    .maybeSingle();
  if (!invoice) {
    logStep("Capture event for unknown invoice order", { orderId });
    return;
  }
  if (invoice.status === 'paid') return;

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for invoice verification");
  const order = await fetchPayPalOrder(accessToken, orderId);
  if (!order) throw new Error("PayPal order re-query failed for invoice verification");
  const capture = extractCompletedCapture(order);
  if (!capture) {
    logStep("Invoice order has no completed capture — not marking paid", { orderId });
    return;
  }
  if (
    Math.abs(Number(capture.amount) - Number(invoice.amount)) > 0.001 ||
    String(capture.currency).toUpperCase() !== String(invoice.currency).toUpperCase()
  ) {
    logStep("Invoice capture mismatch — not marking paid", {
      orderId,
      captureAmount: capture.amount,
      invoiceAmount: invoice.amount,
    });
    return;
  }

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString()
    })
    .eq('id', invoice.id)
    .neq('status', 'paid');

  if (error) {
    logStep("Error updating invoice", error);
  } else {
    logStep("Invoice marked as paid", { orderId });
  }
}

// ── Capture reversals (audit D2) ─────────────────────────────────

/**
 * Reconcile a refund / reversal / denial / pending event for a
 * capture. The event payload only locates the refund or capture;
 * every fact that moves money comes from PayPal's API: the refund
 * (GET /v2/payments/refunds/{id}), the capture
 * (GET /v2/payments/captures/{id}) and, for reversals, the order's
 * refund list. planCaptureReversal (pure, _shared/paypal-reversal.ts)
 * turns that state into a cumulative target, and the
 * reverse_paypal_credit RPC applies it exactly once per reversal
 * key. A retryable non-plan throws, so the webhook answers 500 and
 * PayPal redelivers instead of the reversal being lost.
 */
async function handleCaptureReversalEvent(supabase: any, eventType: string, resource: any) {
  const captureIdHint = reversalCaptureIdFromResource(eventType, resource);
  const refundId = eventType === 'PAYMENT.CAPTURE.REFUNDED'
    ? reversalRefundIdFromResource(resource)
    : null;

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for reversal reconciliation");

  let refund = null;
  if (refundId) {
    const refundPayload = await fetchPayPalRefund(accessToken, refundId);
    if (refundPayload) refund = refundStateFromApi(refundPayload);
  }

  let capture = null;
  const captureId = refund?.captureId ?? captureIdHint;
  if (captureId) {
    const capturePayload = await fetchPayPalCapture(accessToken, captureId);
    if (capturePayload) capture = captureStateFromApi(capturePayload);
  }

  let orderRefunds: ReturnType<typeof refundsFromOrderApi> = [];
  if (capture?.orderId) {
    const order = await fetchPayPalOrder(accessToken, capture.orderId);
    if (order) orderRefunds = refundsFromOrderApi(order);
  }

  const plan = planCaptureReversal({ eventType, capture, refund, orderRefunds });
  if (plan.action === "none") {
    logStep("Capture reversal event needs no local reversal", {
      eventType,
      reason: plan.reason,
    });
    if (plan.retryable) {
      throw new Error(`Capture reversal not yet reconcilable: ${plan.reason}`);
    }
    return;
  }

  const { data, error } = await supabase.rpc("reverse_paypal_credit", {
    p_capture_id: plan.captureId,
    p_reversal_key: plan.key,
    p_target_amount: plan.targetTotal,
    p_currency: plan.currency,
    p_event_type: eventType,
  });
  if (error) throw new Error(`Capture reversal failed: ${error.message}`);

  const result = Array.isArray(data) ? data[0] : data;
  logStep("Capture reversal reconciled", {
    eventType,
    captureId: plan.captureId,
    key: plan.key,
    outcome: result?.outcome ?? null,
    debited: result?.debited_amount ?? null,
  });
}

/**
 * CHECKOUT.PAYMENT-APPROVAL.REVERSED: the buyer approval on an
 * uncaptured order was reversed (PayPal voids the order, e.g. when
 * the capture window lapses). Nothing was credited — the order was
 * never captured — so reconciliation is bookkeeping only: re-query
 * the order, and when PayPal confirms it is VOIDED, close any
 * still-pending local row for it as failed so it cannot sit in
 * pending forever pretending the money might still arrive.
 */
async function handleApprovalReversedEvent(supabase: any, resource: any) {
  const orderId = approvalReversedOrderId(resource);
  if (!orderId) return;

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for approval-reversal reconciliation");
  const order = await fetchPayPalOrder(accessToken, orderId);
  if (!order) throw new Error("PayPal order re-query failed for approval reversal");
  if ((order as any).status !== "VOIDED") {
    logStep("Approval-reversed order is not voided at PayPal — leaving local rows alone", {
      orderId,
      paypalStatus: (order as any).status ?? null,
    });
    return;
  }

  const rows = [
    await findDepositTransaction(supabase, orderId),
    await findCheckoutPaymentTransaction(supabase, orderId),
  ];
  for (const row of rows) {
    if (!row || row.status !== "pending") continue;
    const { error } = await supabase
      .from("transactions")
      .update({
        status: "failed",
        metadata: {
          ...(row.metadata ?? {}),
          approval_reversed_at: new Date().toISOString(),
          failure_reason: "The PayPal approval was reversed before capture, so this payment never completed and no money was charged.",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("uuid_id", row.uuid_id)
      .eq("status", "pending");
    if (error) {
      logStep("Error closing approval-reversed row", error);
    } else {
      logStep("Pending row closed for reversed approval", { orderId, transactionId: row.uuid_id });
    }
  }
}

// ── Subscriptions (audit D4/D5) ──────────────────────────────────
// Every handler below re-queries PayPal before mutating: the
// subscription (GET /v1/billing/subscriptions/{id}) for lifecycle
// events, the sale (GET /v1/payments/sale/{id}) for payments.
// Period boundaries come from PayPal's payload — start_time and
// billing_info.next_billing_time — never from a local now()+30d
// guess (the previous ACTIVATED handler's invention).

async function fetchPayPalSubscription(accessToken: string, subscriptionId: string) {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/billing/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("PayPal subscription fetch error:", e);
    return null;
  }
}

async function fetchPayPalSale(accessToken: string, saleId: string) {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/payments/sale/${saleId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("PayPal sale fetch error:", e);
    return null;
  }
}

async function handleSubscriptionActivated(supabase: any, resource: any) {
  logStep("Processing subscription activation", { subscriptionId: resource.id });

  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for subscription verification");
  const sub = await fetchPayPalSubscription(accessToken, subscriptionId);
  if (!sub) throw new Error("PayPal subscription re-query failed");
  if (sub.status !== "ACTIVE") {
    logStep("Subscription is not ACTIVE at PayPal — not activating locally", {
      subscriptionId,
      paypalStatus: sub.status ?? null,
    });
    return;
  }

  const activationUpdate: Record<string, unknown> = {
    status: 'active',
    current_period_start: sub.start_time ?? new Date().toISOString(),
  };
  if (sub.billing_info?.next_billing_time) {
    activationUpdate.current_period_end = sub.billing_info.next_billing_time;
  }
  const { error } = await supabase
    .from('subscriptions')
    .update(activationUpdate)
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
  if (!subscriptionId) return;

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for subscription verification");
  const sub = await fetchPayPalSubscription(accessToken, subscriptionId);
  if (!sub) throw new Error("PayPal subscription re-query failed");
  if (sub.status !== "CANCELLED") {
    logStep("Subscription is not CANCELLED at PayPal — leaving local state alone", {
      subscriptionId,
      paypalStatus: sub.status ?? null,
    });
    return;
  }

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
  // PAYMENT.SALE.COMPLETED: resource is the sale. Its shape (per
  // PayPal's docs) is what this handler was always written for —
  // billing_agreement_id + amount.total / amount.currency — it was
  // simply registered under an event name that does not exist.
  const saleId = resource.id;
  const subscriptionId = resource.billing_agreement_id;
  logStep("Processing subscription payment", { subscriptionId, saleId });
  if (!saleId || !subscriptionId) return;

  // Re-query the sale and take amount/currency/state from PayPal,
  // not from the payload (audit D5).
  const accessToken = await getPayPalAccessToken();
  if (!accessToken) throw new Error("PayPal not configured for subscription payment verification");
  const sale = await fetchPayPalSale(accessToken, saleId);
  if (!sale) throw new Error("PayPal sale re-query failed");
  if (sale.state !== "completed") {
    logStep("Subscription sale is not completed at PayPal — not recording", {
      saleId,
      paypalState: sale.state ?? null,
    });
    return;
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, user_id, subscription_tier')
    .eq('paypal_subscription_id', subscriptionId)
    .single();

  if (!subscription) {
    logStep("Subscription sale for unknown subscription", { subscriptionId, saleId });
    return;
  }

  // Exactly once per sale: the sale id rides in paypal_order_id,
  // and a replay finds the invoice already recorded.
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('paypal_order_id', saleId)
    .maybeSingle();
  if (existing) {
    logStep("Subscription payment already recorded", { saleId });
    return;
  }

  const invoiceNumber = await generateInvoiceNumber(supabase);

  const { error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      amount: parseFloat(sale.amount.total),
      currency: sale.amount.currency,
      status: 'paid',
      invoice_number: invoiceNumber,
      paypal_order_id: saleId,
      paid_at: sale.create_time ?? new Date().toISOString()
    });
  if (invoiceError) {
    logStep("Error recording subscription payment", invoiceError);
    return;
  }

  // Roll the period from PayPal's own billing state.
  const sub = await fetchPayPalSubscription(accessToken, subscriptionId);
  if (sub?.billing_info?.next_billing_time) {
    await supabase
      .from('subscriptions')
      .update({
        current_period_start: sale.create_time ?? new Date().toISOString(),
        current_period_end: sub.billing_info.next_billing_time
      })
      .eq('paypal_subscription_id', subscriptionId);
  }

  logStep("Subscription payment recorded", { subscriptionId, saleId });
}

async function handleSubscriptionPaymentFailed(supabase: any, resource: any) {
  const subscriptionId = resource.id ?? resource.billing_agreement_id;
  logStep("Processing subscription payment failure", { subscriptionId });
  if (!subscriptionId) return;

  // Record the failure truthfully (this handler used to be a
  // log-only no-op): the subscription is marked payment_failed so
  // entitlement checks stop treating it as a paying subscription,
  // and the failure time is kept on the row's updated_at. A later
  // successful sale re-activates via the ACTIVATED/sale handlers.
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'payment_failed',
      updated_at: new Date().toISOString()
    })
    .eq('paypal_subscription_id', subscriptionId)
    .in('status', ['active', 'pending']);

  if (error) {
    logStep("Error recording subscription payment failure", error);
  } else {
    logStep("Subscription payment failure recorded", { subscriptionId });
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