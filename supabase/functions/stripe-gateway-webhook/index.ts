// stripe-gateway-webhook: Stripe's settlement callback for wallet
// top-ups (verify_jwt OFF — Stripe is not a Supabase user; the
// Stripe-Signature header is the authentication).
//
// Security shape, mirroring the paypal-webhook's discipline:
//   - The RAW request body is read first and verified against
//     STRIPE_GATEWAY_WEBHOOK_SECRET (HMAC-SHA256, timestamp
//     tolerance). Any failure → 400, nothing processed. If the
//     secret is not configured the endpoint answers 503 rather than
//     processing unverified events — fail closed, always.
//   - The payload is only ever a HINT: settlement re-queries the
//     Checkout Session from Stripe and credits only a verified
//     'paid' session whose amount and currency match the ledger row,
//     inside complete_stripe_wallet_deposit (exactly-once under the
//     row lock). Replays, duplicates and out-of-order events are
//     therefore harmless by construction.
//   - Events are not ordered: a late 'expired' can never rewrite a
//     completed row (closeStripeDeposit only moves 'pending' rows).
//   - Logs carry trace identifiers only (event id/type, session id)
//     — never payload bodies, which can hold payer details.
//
// Responses: 200 for every verified event (including ignored types
// and unknown sessions, so Stripe stops retrying events that can
// never settle here); 500 only for transient failures Stripe should
// retry (e.g. the settlement RPC errored); 400 for bad signatures.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  paymentIntentIdFromChargeEvent,
  sessionIdFromEvent,
  stripeEventAction,
  stripeGatewayConfig,
  verifyStripeSignature,
} from "../_shared/stripe-gateway.ts";
import {
  closeStripeDeposit,
  flagStripeRefund,
  settleStripeDeposit,
} from "../_shared/stripe-gateway-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-GATEWAY-WEBHOOK] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Verify FIRST, on the raw body ──
    const rawBody = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_GATEWAY_WEBHOOK_SECRET") ?? null;
    if (!webhookSecret) {
      logStep("Webhook secret not configured — refusing event");
      return json({ error: "Webhook is not configured." }, 503);
    }
    const verified = await verifyStripeSignature(
      rawBody,
      req.headers.get("stripe-signature"),
      webhookSecret,
    );
    if (!verified) {
      logStep("Invalid Stripe signature");
      return json({ error: "Invalid signature" }, 400);
    }

    let event: { id?: string; type?: string; data?: { object?: { id?: string } } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid payload" }, 400);
    }

    const eventType = event.type ?? null;
    logStep("Webhook event", {
      eventType,
      eventId: event.id ?? null,
      resourceId: event.data?.object?.id ?? null,
    });

    const action = stripeEventAction(eventType);
    if (action === "ignore") {
      return json({ received: true, ignored: true });
    }

    const supabase = getServiceRoleClient();

    if (action === "refund") {
      const paymentIntentId = paymentIntentIdFromChargeEvent(event);
      const chargeId = event.data?.object?.id ?? null;
      if (paymentIntentId) {
        const flagged = await flagStripeRefund(supabase, paymentIntentId, chargeId);
        logStep("Refund reconciliation flag", { paymentIntentId, flagged });
      }
      return json({ received: true });
    }

    const sessionId = sessionIdFromEvent(event);
    if (!sessionId) {
      logStep("Event carried no usable session id", { eventType });
      return json({ received: true, ignored: true });
    }

    if (action === "close_unsettled") {
      const outcome = await closeStripeDeposit(
        supabase,
        sessionId,
        eventType === "checkout.session.expired" ? "session_expired" : "async_payment_failed",
      );
      logStep("Deposit closed unsettled", { sessionId, outcome });
      return json({ received: true });
    }

    // action === "settle"
    const secretKey = Deno.env.get("STRIPE_GATEWAY_SECRET_KEY") ?? null;
    if (!stripeGatewayConfig(secretKey).configured) {
      // Cannot re-query without the API key: 500 so Stripe retries
      // after the key is set, rather than the deposit being lost.
      logStep("Gateway secret missing — asking Stripe to retry later");
      return json({ error: "Gateway is not configured." }, 500);
    }

    const result = await settleStripeDeposit(supabase, secretKey, sessionId);
    logStep("Settlement result", { sessionId, kind: result.kind });

    switch (result.kind) {
      case "completed":
      case "not_found": // a session this rail never recorded — nothing to settle
      case "not_pending": // already closed; a later 'paid' cannot resurrect it silently
      case "pending": // async payment still clearing; async_payment_succeeded will re-drive
        return json({ received: true });
      case "mismatch":
        // Verified money that does not match the ledger row: never
        // credited. 200 so Stripe stops retrying; the row stays
        // pending and visible for admin reconciliation.
        logStep("Settlement mismatch — NOT credited", { sessionId, reason: result.reason });
        return json({ received: true, settled: false });
      default:
        return json({ error: "Settlement failed — retry." }, 500);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in stripe-gateway-webhook", { message: errorMessage });
    return json({ error: "Webhook processing failed — retry." }, 500);
  }
});
