// paypal-deposit-capture: completes a PayPal wallet deposit after the
// buyer returns from PayPal approval.
//
// wallet-deposit creates a real PayPal order and records a PENDING
// deposit row (metadata.kind = 'wallet_deposit', reference = order id),
// but credits nothing — correctly, because an approved order is not
// yet captured money. Until now nothing ever captured those orders, so
// approved deposits sat pending forever and no PayPal deposit could
// ever reach a wallet.
//
// This function is the missing capture path for the return flow: the
// app sends the buyer back to /wallet?paypal_return=deposit&token=…
// and the page invokes this function with the order id. It delegates
// to confirmPayPalDeposit (_shared/paypal-deposit.ts), which reads
// PayPal's authoritative order state, captures the order if it is
// APPROVED, verifies the capture's amount + currency against the
// pending row, and credits the target wallet exactly once inside the
// complete_wallet_deposit RPC. The paypal-webhook runs the same
// confirmation as a backstop for buyers who never return.
//
// Auth: user JWT required, and the deposit must belong to the caller.
//
// Input:  { order_id, action?: "confirm" | "cancel" }
//   - "confirm" (default): the return-from-approval flow above.
//   - "cancel": the payer returned via PayPal's cancel URL. The claim
//     is verified against PayPal's own order state before anything is
//     recorded (see cancelPayPalDeposit): a deposit whose order was
//     never approved flips to 'cancelled' so activity stops showing
//     it as awaiting confirmation; an order that was approved or
//     captured is handed to the confirmation path instead — money
//     the payer approved is never buried as "cancelled".
// Response shape mirrors wallet-deposit:
//   { success, status, transaction_id?, capture_id?, amount?,
//     currency?, new_balance?, already_completed?, message?, error? }
// `success` is true only when the deposit is in its completed state —
// credited by this call, or verifiably credited already — or, for the
// cancel action, verifiably cancelled.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cancelPayPalDeposit,
  confirmPayPalDeposit,
  type ConfirmDepositResult,
} from "../_shared/paypal-deposit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYPAL-DEPOSIT-CAPTURE] ${step}${detailsStr}`);
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
    // Unknown actions fail closed to the confirmation flow — the
    // original, money-deciding behaviour of this function.
    const action = body.action === "cancel" ? "cancel" : "confirm";
    logStep("Capture requested", { orderId, userId: user.id, action });

    if (action === "cancel") {
      const cancelResult = await cancelPayPalDeposit(supabase, orderId, {
        expectUserId: user.id,
      });
      logStep("Cancellation result", { kind: cancelResult.kind, orderId });
      if (cancelResult.kind === "cancelled") {
        return json({
          success: true,
          status: "cancelled",
          already_cancelled: cancelResult.alreadyCancelled,
          transaction_id: cancelResult.transactionId,
          message: cancelResult.alreadyCancelled
            ? "This deposit was already cancelled. Nothing was charged."
            : "Deposit cancelled. Nothing was charged.",
        });
      }
      if (cancelResult.kind === "unverified") {
        return json({
          success: false,
          status: "pending",
          transaction_id: cancelResult.transactionId,
          message:
            "We could not check this deposit with PayPal just now, so it has not been marked cancelled. Nothing has been charged.",
        });
      }
      // Every other cancel outcome IS a confirmation outcome (the
      // order was approved or captured, or the row already settled):
      // answer with the confirmation mapping below.
      return confirmResponse(cancelResult);
    }

    const result = await confirmPayPalDeposit(supabase, orderId, { expectUserId: user.id });
    logStep("Confirmation result", { kind: result.kind, orderId });

    return confirmResponse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-deposit-capture", { message: errorMessage });
    return json({ success: false, status: "error", error: errorMessage }, 500);
  }
});

function confirmResponse(result: ConfirmDepositResult): Response {
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
          new_balance: result.newBalance,
          message: result.alreadyCredited
            ? "This deposit was already confirmed — your wallet balance includes it."
            : "Deposit confirmed. The money is in your wallet.",
        });
      case "pending":
        return json({
          success: false,
          status: "pending",
          transaction_id: result.transactionId,
          paypal_status: result.paypalStatus,
          message:
            "PayPal has not completed this payment yet, so nothing has been credited. If you approved the payment, give it a moment and check again.",
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
            "The confirmed PayPal payment does not match the recorded deposit, so the wallet was not credited. Support can reconcile this deposit from its order reference.",
        });
      case "not_pending":
        return json({
          success: false,
          status: "failed",
          transaction_id: result.transactionId,
          error: `This deposit is ${result.status} and can no longer be completed.`,
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
          { success: false, status: "forbidden", error: "This deposit does not belong to you." },
          403,
        );
      case "not_found":
        return json(
          {
            success: false,
            status: "not_found",
            error: "No PayPal deposit matches this order reference.",
          },
          404,
        );
    }
}
