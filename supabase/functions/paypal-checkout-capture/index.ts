// paypal-checkout-capture: completes a PayPal CHECKOUT payment (a
// `process-payment` order) after the buyer returns from PayPal
// approval.
//
// process-payment creates a real PayPal order and records a PENDING
// checkout row (metadata.kind = 'checkout_payment', reference = order
// id, the row's user/wallet = the MERCHANT named at order creation),
// but settles nothing — correctly, because an approved order is not
// yet captured money. Until now nothing ever captured those orders,
// so an approved checkout could never pay its merchant.
//
// This function is the missing capture path for the return flow: the
// app sends the buyer back to /checkout?paypal_return=checkout&token=…
// and the page invokes this function with the order id. It delegates
// to confirmPayPalCheckoutPayment (_shared/paypal-checkout.ts), which
// reads PayPal's authoritative order state, captures the order if it
// is APPROVED, verifies the capture's amount + currency against the
// pending row, and credits the merchant's settlement wallet exactly
// once inside the complete_checkout_payment RPC. The paypal-webhook
// runs the same confirmation as a backstop for buyers who never
// return.
//
// Auth: user JWT required, and the caller must be the payment's
// recorded PAYER (metadata.payer_user_id) — the buyer confirming
// their own payment. The merchant's balance is never disclosed to the
// payer; the response reports the settled amount and currency only.
//
// Input:  { order_id }
// Response shape mirrors paypal-deposit-capture:
//   { success, status, transaction_id?, capture_id?, amount?,
//     currency?, already_completed?, message?, error? }
// `success` is true only when the payment is in its completed state —
// settled by this call, or verifiably settled already.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { confirmPayPalCheckoutPayment } from "../_shared/paypal-checkout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYPAL-CHECKOUT-CAPTURE] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Dedicated service-role client: forwards NO caller Authorization
    // header (money moves through the RPC under service_role — the
    // protect_wallet_balance lesson). The caller is resolved explicitly
    // from the bearer token below.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user?.id) throw new Error("User not authenticated");

    const body = await req.json();
    const orderId = String(body.order_id ?? body.token ?? "").trim();
    if (!orderId || orderId.length < 6) throw new Error("A PayPal order_id is required");
    logStep("Capture requested", { orderId, userId: user.id });

    const result = await confirmPayPalCheckoutPayment(supabase, orderId, {
      expectPayerUserId: user.id,
    });
    logStep("Confirmation result", { kind: result.kind, orderId });

    switch (result.kind) {
      case "completed":
        return json({
          success: true,
          status: "completed",
          already_completed: result.alreadyCredited,
          transaction_id: result.transactionId,
          capture_id: result.captureId,
          amount: result.amount,
          currency: result.currency,
          message: result.alreadyCredited
            ? "This payment was already confirmed — the merchant has been paid."
            : "Payment confirmed. The merchant has been paid.",
        });
      case "pending":
        return json({
          success: false,
          status: "pending",
          transaction_id: result.transactionId,
          paypal_status: result.paypalStatus,
          message:
            "PayPal has not completed this payment yet, so the merchant has not been paid. If you approved the payment, give it a moment and check again.",
        });
      case "not_configured":
        return json({
          success: false,
          status: "not_configured",
          error: "PayPal is not configured on this platform yet.",
        });
      case "mismatch":
        return json({
          success: false,
          status: "mismatch",
          transaction_id: result.transactionId,
          error:
            "The confirmed PayPal payment does not match the recorded checkout, so the merchant was not paid. Support can reconcile this payment from its order reference.",
        });
      case "not_pending":
        return json({
          success: false,
          status: "failed",
          transaction_id: result.transactionId,
          error: `This payment is ${result.status} and can no longer be completed.`,
        });
      case "failed":
        return json({
          success: false,
          status: "failed",
          transaction_id: result.transactionId,
          error: result.error,
        });
      case "forbidden":
        return json(
          { success: false, status: "forbidden", error: "This payment does not belong to you." },
          403,
        );
      case "not_found":
        return json(
          {
            success: false,
            status: "not_found",
            error: "No PayPal checkout payment matches this order reference.",
          },
          404,
        );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-checkout-capture", { message: errorMessage });
    return json({ success: false, status: "error", error: errorMessage }, 500);
  }
});
