// stripe-gateway-admin: admin operations for the Stripe gateway
// wallet top-up rail (JWT on — see supabase/config.toml).
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Role: admin / super_admin only (canUseStripeGateway, via
//      user_roles) — the same gate as stripe-gateway-checkout.
//
// Actions:
//   - { action: "status" } — truthful configuration state: whether a
//     usable gateway secret exists (and its test/live mode), the
//     kill-switch setting, whether the webhook secret is present,
//     and the webhook URL to register in Stripe. Secret VALUES never
//     leave this function.
//   - { action: "refund", transaction_id } — create a full Stripe
//     refund for one settled gateway deposit and record it on the
//     row's metadata. Eligibility is decided by the pure
//     decideStripeRefundEligibility: unknown / non-Stripe rows,
//     unsettled rows and rows with no recorded Stripe payment
//     reference are refused plainly with NOTHING changed. While
//     STRIPE_GATEWAY_SECRET_KEY is unconfigured the action answers
//     `not_configured` with NO state change — the expected live
//     behaviour until the CEO adds the keys. Wallet balances are
//     never debited here: as with charge.refunded flagging, what
//     happens to already-spent credited money is an ops decision.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  buildStripeRefundParams,
  canUseStripeGateway,
  decideStripeRefundEligibility,
  mapStripeRefundStatus,
  plainStripeRefundError,
  stripeGatewayConfig,
  stripeGatewayStatus,
  stripeRefundIdempotencyKey,
} from "../_shared/stripe-gateway.ts";
import { createStripeRefund } from "../_shared/stripe-gateway-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WEBHOOK_URL =
  "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/stripe-gateway-webhook";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-GATEWAY-ADMIN] ${step}${detailsStr}`);
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

  // Dedicated service-role client (no caller JWT forwarded) — the
  // money-path rule from _shared/supabase-client.ts.
  const supabase = getServiceRoleClient();

  try {
    logStep("Function started");

    // ── 1. Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ success: false, status: "unauthorized", error: "Please sign in to continue." }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.id) {
      return json({ success: false, status: "unauthorized", error: "Please sign in to continue." }, 401);
    }

    // ── 2. Role gate ──
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) throw new Error(`Role lookup failed: ${roleError.message}`);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!canUseStripeGateway(roles)) {
      return json({
        success: false,
        status: "forbidden",
        error: "The Stripe gateway console is available to administrators only.",
      }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    // ── Status ──
    if (action === "status") {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("stripe_gateway_enabled")
        .eq("id", true)
        .maybeSingle();
      const status = stripeGatewayStatus({
        secretKey: Deno.env.get("STRIPE_GATEWAY_SECRET_KEY") ?? null,
        webhookSecret: Deno.env.get("STRIPE_GATEWAY_WEBHOOK_SECRET") ?? null,
        gatewayEnabled: settings?.stripe_gateway_enabled ?? null,
      });
      return json({
        success: true,
        ...status,
        webhook_url: WEBHOOK_URL,
      });
    }

    // ── Refund ──
    if (action === "refund") {
      const transactionId =
        typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
      if (!transactionId) {
        return json({
          success: false,
          status: "invalid",
          error: "Choose a deposit to refund, then try again.",
        }, 400);
      }

      const { data: row, error: lookupError } = await supabase
        .from("transactions")
        .select(
          "uuid_id, user_id, wallet_id, amount, currency, status, reference, external_reference, metadata, payment_method",
        )
        .eq("uuid_id", transactionId)
        .maybeSingle();
      if (lookupError) throw new Error(`Transaction lookup failed: ${lookupError.message}`);
      if (!row || row.payment_method !== "stripe") {
        return json({
          success: false,
          status: "not_found",
          error: "That transaction could not be found.",
        }, 404);
      }

      // Eligibility first — a refusal here changes nothing.
      const eligibility = decideStripeRefundEligibility(row);
      if (!eligibility.ok) {
        return json(
          { success: false, status: eligibility.reason, error: eligibility.message },
          eligibility.httpStatus,
        );
      }

      // Configuration — truthful not_configured, still no state change.
      const secretKey = Deno.env.get("STRIPE_GATEWAY_SECRET_KEY") ?? null;
      if (!stripeGatewayConfig(secretKey).configured || !secretKey) {
        logStep("Refund requested while gateway not configured", { transactionId });
        return json({
          success: false,
          status: "not_configured",
          error:
            "Stripe is not connected yet, so this refund cannot be created. No money has moved.",
        });
      }

      const result = await createStripeRefund(
        secretKey,
        buildStripeRefundParams({
          paymentIntentId: eligibility.paymentIntentId,
          ledgerId: row.uuid_id,
        }),
        stripeRefundIdempotencyKey(row.uuid_id),
      );

      if (!result.ok || !result.data?.id) {
        logStep("Refund creation failed", {
          transactionId,
          status: result.status,
          type: result.error?.type ?? null,
          code: result.error?.code ?? null,
        });
        // Audit note only (trace fields — never Stripe's raw
        // message); a failure to write it must not mask the 502.
        try {
          await supabase
            .from("transactions")
            .update({
              metadata: {
                ...((row.metadata as Record<string, unknown> | null) ?? {}),
                refund_attempt_failed_at: new Date().toISOString(),
                refund_error_type: result.error?.type ?? null,
                refund_error_code: result.error?.code ?? null,
              },
            })
            .eq("uuid_id", row.uuid_id);
        } catch {
          // best-effort audit note
        }
        return json({
          success: false,
          status: "failed",
          error: plainStripeRefundError(result.error),
        }, 502);
      }

      const refund = result.data;
      const refundStatus = mapStripeRefundStatus(refund.status);
      const requestedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("transactions")
        .update({
          metadata: {
            ...((row.metadata as Record<string, unknown> | null) ?? {}),
            refund_id: refund.id,
            refund_status: refundStatus,
            refund_requested_at: requestedAt,
            refund_payment_intent_id: eligibility.paymentIntentId,
          },
        })
        .eq("uuid_id", row.uuid_id);
      if (updateError) throw new Error(`Refund record failed: ${updateError.message}`);

      logStep("Refund created", { transactionId, refundId: refund.id, refundStatus });
      return json({
        success: true,
        status: "refund_created",
        transaction_id: row.uuid_id,
        refund_id: refund.id,
        refund_status: refundStatus,
        refund_requested_at: requestedAt,
        message:
          "Refund created in Stripe. The cardholder's bank settles it on Stripe's timeline; the wallet balance is unchanged — reconciling it is an ops decision.",
      });
    }

    return json({
      success: false,
      status: "invalid",
      error: "That action is not supported. Please try again.",
    }, 400);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in stripe-gateway-admin", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong with that request. No money has moved — please try again.",
    }, 500);
  }
});
