// manage-subscription: REMOVED — refuses every request
// (subscriptions removed entirely, CEO decision 2026-10-26 18:31).
//
// History: this function changed a user's plan — upgrade, downgrade,
// change_tier, cancel, reactivate — against the subscribers table,
// driven by the Billing page's SubscriptionManager through the
// useNativeBilling hook. The CEO removed subscriptions from
// BMaGlass Pay altogether ("just leave the percentage payments we
// had"), the Billing page and its hooks are gone, and there is no
// plan left to change, cancel or reactivate: every account is the
// same account, charged only the percentage fee on each transaction.
//
// The subscribers table keeps its rows (the kept accounts' free-tier
// rows) and its shape; nothing is deleted. A stale client calling
// this endpoint gets the truth, in plain language, and nothing is
// mutated.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const SUBSCRIPTION_MANAGEMENT_REMOVED_MESSAGE =
  "Subscription management is closed — BMaGlass Pay no longer offers subscription plans, so there is no plan to change, cancel or reactivate. You only pay a percentage fee when you transact. Nothing was changed.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("[MANAGE-SUBSCRIPTION] Removed endpoint called — refusing", {
    method: req.method,
  });

  return new Response(JSON.stringify({
    success: false,
    status: "deprecated",
    error: SUBSCRIPTION_MANAGEMENT_REMOVED_MESSAGE,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 410,
  });
});
