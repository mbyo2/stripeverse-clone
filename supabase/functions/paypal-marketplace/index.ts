// paypal-marketplace: DEPRECATED — refuses every request (audit D1,
// 2026-10-26).
//
// History: this function created PayPal "marketplace" orders whose
// return_url AND cancel_url pointed at the webhook endpoint, which
// no capture path ever settled (the webhook ignores
// marketplace_transactions rows, and nothing captured these orders),
// so a payer could approve in good faith and the receiver would
// never be paid. Its amount "split" was also fictional: the platform
// fee was smuggled in as a handling line in the amount breakdown —
// no payee / platform_fees were ever sent, so PayPal would have paid
// the whole amount to one account regardless — under a placeholder
// brand name that was never the platform's.
//
// Marketplace payments on BMaGlass Pay settle through the seller's
// own rails instead: payment links and wallet transfers, which are
// capture-verified / atomic and exactly-once. A genuine PayPal
// marketplace split (payee + platform_fees on the order) is a
// separate build, deliberately NOT improvised here; until it exists
// this endpoint tells the truth. No tables or history are deleted:
// marketplace_transactions keeps its rows, and the client hook keeps
// read access to them.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const MARKETPLACE_DEPRECATED_MESSAGE =
  "PayPal marketplace payments are not available on BMaGlass Pay — marketplace sales settle through the seller's payment link or wallet instead, where payment is verified before anything is credited. Nothing was charged.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("[PAYPAL-MARKETPLACE] Deprecated endpoint called — refusing", {
    method: req.method,
  });

  return new Response(JSON.stringify({
    success: false,
    status: "deprecated",
    error: MARKETPLACE_DEPRECATED_MESSAGE,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 410,
  });
});
