// moonpay-webhook: MoonPay's buy-transaction callbacks
// (verify_jwt OFF — MoonPay is not a Supabase user; the
// Moonpay-Signature-V2 HMAC is the authentication).
//
// TRACKING ONLY: this function records MoonPay's view of a purchase
// on moonpay_transactions. It NEVER credits a wallet, touches a
// balance, or writes any money table — MoonPay delivers the BTC to
// the user's own deposit address and the existing deposit-detection
// pipeline does the crediting when the deposit lands.
//
// Security shape, mirroring the payoneer-webhook discipline:
//   - If the webhook key is not configured the endpoint answers
//     503 not_configured rather than processing anything — fail
//     closed, always.
//   - The RAW request body is verified FIRST against
//     Moonpay-Signature-V2 (t=<unix>,s=<hex HMAC-SHA256 of
//     "<t>.<rawBody>" keyed with MOONPAY_WEBHOOK_KEY). Any mismatch
//     → 401, ZERO state change.
//   - Delivery is at-least-once and unordered: status application
//     goes through canApplyMoonpayStatus, so a late event can never
//     regress a terminal (completed / failed) row.
//   - Buy events for a reference we never issued are recorded
//     defensively (user_id NULL, source 'webhook_unmatched') so
//     reconciliation can see them; non-buy events are ignored.
//   - After a successful verify + record the answer is always
//     200 { received: true } so MoonPay stops retrying.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  canApplyMoonpayStatus,
  isMoonpayBuyEvent,
  moonpayConfig,
  parseMoonpayWebhookEvent,
  verifyMoonpayWebhookSignature,
} from "../_shared/moonpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[MOONPAY-WEBHOOK] ${step}${detailsStr}`);
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
    // ── Configuration gate (fail closed) ──
    const config = moonpayConfig({
      publishableKey: Deno.env.get("MOONPAY_PUBLISHABLE_KEY") ?? null,
      secretKey: Deno.env.get("MOONPAY_SECRET_KEY") ?? null,
      webhookKey: Deno.env.get("MOONPAY_WEBHOOK_KEY") ?? null,
    });
    if (!config.hasWebhookKey) {
      logStep("Webhook not configured — refusing event");
      return json({ success: false, status: "not_configured", error: "Webhook is not configured." }, 503);
    }

    // ── Verify FIRST, on the raw body ──
    const rawBody = await req.text();
    const verified = await verifyMoonpayWebhookSignature(
      rawBody,
      req.headers.get("moonpay-signature-v2"),
      config.webhookKey,
    );
    if (!verified) {
      logStep("Invalid MoonPay signature");
      return json({ success: false, status: "invalid_signature", error: "Invalid signature" }, 401);
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ success: false, status: "invalid", error: "Invalid payload" }, 400);
    }

    const parsed = parseMoonpayWebhookEvent(event);
    if (!isMoonpayBuyEvent(parsed.type)) {
      return json({ received: true, ignored: true });
    }

    const supabase = getServiceRoleClient();
    const now = new Date().toISOString();

    // ── Known purchase: apply the status (terminal-sticky) ──
    if (parsed.externalReference) {
      const { data: row, error: lookupError } = await supabase
        .from("moonpay_transactions")
        .select("id, status")
        .eq("external_reference", parsed.externalReference)
        .maybeSingle();
      if (lookupError) throw new Error(`MoonPay transaction lookup failed: ${lookupError.message}`);

      if (row) {
        // deno-lint-ignore no-explicit-any
        const update: Record<string, any> = {
          raw_status: parsed.rawStatus,
          last_webhook_event: parsed.type,
          last_webhook_payload: event,
          updated_at: now,
        };
        if (parsed.status && canApplyMoonpayStatus(row.status, parsed.status)) {
          update.status = parsed.status;
        }
        if (parsed.moonpayTransactionId) update.moonpay_transaction_id = parsed.moonpayTransactionId;
        if (parsed.fiatAmount !== null) update.fiat_amount = parsed.fiatAmount;
        if (parsed.fiatCurrency) update.fiat_currency = parsed.fiatCurrency;
        if (parsed.cryptoAmount !== null) update.crypto_amount = parsed.cryptoAmount;
        if (parsed.feeAmount !== null) update.fee_amount = parsed.feeAmount;
        if (parsed.cryptoTransactionId) update.crypto_transaction_id = parsed.cryptoTransactionId;
        if (parsed.failureReason) update.failure_reason = parsed.failureReason;
        const { error: updateError } = await supabase
          .from("moonpay_transactions")
          .update(update)
          .eq("id", row.id);
        if (updateError) throw new Error(`MoonPay transaction update failed: ${updateError.message}`);
        logStep("Tracked purchase updated", {
          externalReference: parsed.externalReference,
          status: update.status ?? row.status,
        });
        return json({ received: true });
      }
    }

    // ── Unknown reference: record defensively, owned by nobody ──
    const fallbackReference = parsed.externalReference ?? parsed.moonpayTransactionId;
    if (!fallbackReference) {
      // Nothing we can reconcile against — acknowledge and move on.
      logStep("Buy event carried no reference — ignored");
      return json({ received: true, ignored: true });
    }
    const { error: insertError } = await supabase
      .from("moonpay_transactions")
      .insert({
        user_id: null,
        external_reference: fallbackReference,
        moonpay_transaction_id: parsed.moonpayTransactionId,
        deposit_address: parsed.walletAddress ?? "",
        fiat_currency: parsed.fiatCurrency ?? "USD",
        fiat_amount: parsed.fiatAmount,
        crypto_currency: "BTC",
        crypto_amount: parsed.cryptoAmount,
        fee_amount: parsed.feeAmount,
        crypto_transaction_id: parsed.cryptoTransactionId,
        status: parsed.status ?? "initiated",
        raw_status: parsed.rawStatus,
        failure_reason: parsed.failureReason,
        environment: config.environment,
        source: "webhook_unmatched",
        last_webhook_event: parsed.type,
        last_webhook_payload: event,
      });
    if (insertError) throw new Error(`MoonPay defensive record failed: ${insertError.message}`);
    logStep("Unmatched buy event recorded defensively", { externalReference: fallbackReference });
    return json({ received: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in moonpay-webhook", { message: errorMessage });
    return json({ success: false, status: "error", error: "Webhook processing failed — retry." }, 500);
  }
});
