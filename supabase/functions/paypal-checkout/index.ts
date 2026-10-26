// paypal-checkout: REMOVED — refuses every request (subscriptions
// removed entirely, CEO decision 2026-10-26 18:31).
//
// History: this function was the PayPal SUBSCRIPTION checkout — the
// last billing rail after the Stripe → PayPal subscription migration
// earlier the same day. The CEO then removed subscriptions from
// BMaGlass Pay altogether: "just leave the percentage payments we
// had so as everything is not done in a subscription". The platform's
// percentage transaction fees (send 2.5%, transfer 1.5%, P2P 0.5%,
// instant buy/sell 1.5%, payment-link settlement 2.5%, virtual-card
// funding 1% min K2) are now the ONLY charges, and there is nothing
// left for this endpoint to sell.
//
// Before subscriptions, this function also created one-time payment
// ORDERS that could never settle (audit D1): their return/cancel
// URLs pointed at the webhook endpoint and no code path ever
// captured them. One-time PayPal payments live in the flows that do
// settle — wallet deposits (wallet-deposit + paypal-deposit-capture)
// and checkout payments (process-payment + paypal-checkout-capture).
// Wallet deposits are untouched by this removal and keep working.
//
// Nothing is deleted: the billing-plan catalogue rows and
// the PayPal-side product/plans stay as historical records, the
// subscriptions table keeps its (empty) shape, and paypal-webhook's
// subscription event handling remains inert. A stale client calling
// this endpoint gets the truth, in plain language, before anything
// touches PayPal or the database.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const ONE_TIME_DEPRECATED_MESSAGE =
  "One-time PayPal payments no longer run through this checkout — they complete through wallet deposits and payment links, which settle only after PayPal confirms the capture. Nothing was charged.";

export const SUBSCRIPTIONS_REMOVED_MESSAGE =
  "BMaGlass Pay no longer offers subscription plans — there is nothing to subscribe to. You only pay a percentage fee when you send, transfer, trade or get paid; see Pricing for the current fees. Nothing was charged.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Best-effort body read so the refusal can name the right door the
  // caller knocked on: one-time requests keep their D1 refusal;
  // subscription requests (the historical default) get the removal
  // notice. An unreadable body is treated as the historical default.
  let type = "subscription";
  try {
    const body = await req.json();
    if (typeof body?.type === "string") type = body.type;
  } catch {
    // No body / not JSON — fall through with the default refusal.
  }

  if (type !== "subscription") {
    console.log("[PAYPAL-CHECKOUT] One-time payment refused (deprecated path)");
    return json({ success: false, status: "deprecated", error: ONE_TIME_DEPRECATED_MESSAGE }, 400);
  }

  console.log("[PAYPAL-CHECKOUT] Subscription checkout refused — subscriptions removed (CEO decision 2026-10-26)");
  return json({ success: false, status: "deprecated", error: SUBSCRIPTIONS_REMOVED_MESSAGE }, 410);
});
