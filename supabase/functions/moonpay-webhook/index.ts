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
// Security shape, mirroring the platform's webhook discipline:
//   - If the webhook key is not configured the endpoint answers
//     503 not_configured rather than processing anything — fail
//     closed, always.
//   - The RAW request body is verified FIRST against
//     Moonpay-Signature-V2 (t=<unix>,s=<hex HMAC-SHA256 of
//     "<t>.<rawBody>" keyed with MOONPAY_WEBHOOK_KEY). Any mismatch
//     → 401, ZERO state change.
//   - Delivery is at-least-once and unordered: status application
//     goes through planMoonpayEventApplication (the shared plan in
//     _shared/moonpay.ts, also used by the moonpay-reconcile
//     poller), so a late event can never regress a terminal
//     (completed / failed) row.
//   - Dedupe / order guard (audit M-1): events are ordered by the
//     transaction's own data.updatedAt. A row records the newest
//     stamp it has applied (last_event_updated_at); an event
//     stamped at or before it is acknowledged but NOT applied, so
//     a stale redelivery can never overwrite tracking fields —
//     least of all on terminal rows. (No signature-timestamp
//     freshness window: MoonPay prescribes none, and its retries
//     re-send the original signed request — see _shared/moonpay.ts,
//     audit M-3.)
//   - Buy events for a reference we never issued are recorded
//     defensively (source 'webhook_unmatched') so reconciliation
//     can see them; when the payload's top-level externalCustomerId
//     names one of our users (audit M-2 — moonpay-session sets it
//     to the caller's user id) the row is linked to that user,
//     otherwise user_id stays NULL. Non-buy events are ignored.
//   - After a successful verify + record the answer is always
//     200 { received: true } so MoonPay stops retrying.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  isMoonpayBuyEvent,
  moonpayConfig,
  parseMoonpayWebhookEvent,
  planMoonpayEventApplication,
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

    // ── Known purchase: apply the event (ordered, terminal-sticky) ──
    // The row is found by our external reference first, then by
    // MoonPay's transaction id (the dedupe key's id leg — audit
    // M-1) so a redelivery that reaches us without the reference
    // still lands on the same row instead of inserting a twin.
    // deno-lint-ignore no-explicit-any
    let row: any = null;
    if (parsed.externalReference) {
      const { data, error: lookupError } = await supabase
        .from("moonpay_transactions")
        .select("id, status, last_event_updated_at")
        .eq("external_reference", parsed.externalReference)
        .maybeSingle();
      if (lookupError) throw new Error(`MoonPay transaction lookup failed: ${lookupError.message}`);
      row = data;
    }
    if (!row && parsed.moonpayTransactionId) {
      const { data, error: idLookupError } = await supabase
        .from("moonpay_transactions")
        .select("id, status, last_event_updated_at")
        .eq("moonpay_transaction_id", parsed.moonpayTransactionId)
        .maybeSingle();
      if (idLookupError) throw new Error(`MoonPay transaction lookup failed: ${idLookupError.message}`);
      row = data;
    }

    if (row) {
      // ── Order guard + application plan: the decision (may this
      // event write, and exactly what) is planMoonpayEventApplication
      // in _shared/moonpay.ts, shared verbatim with the
      // moonpay-reconcile poller so a state learned by polling is
      // applied exactly as if its webhook had arrived. A duplicate
      // (same stamp) or stale (older stamp) event is acknowledged
      // but changes nothing.
      const storedMs = row.last_event_updated_at
        ? Date.parse(row.last_event_updated_at as string)
        : null;
      const plan = planMoonpayEventApplication(
        { status: row.status as string | null, lastEventUpdatedAtMs: storedMs },
        parsed,
        event,
        now,
      );
      if (!plan.apply || !plan.update) {
        logStep("Duplicate or stale event — acknowledged, not applied", {
          externalReference: parsed.externalReference,
          type: parsed.type,
          updatedAt: parsed.updatedAt,
        });
        return json({ received: true, duplicate: true });
      }
      const { error: updateError } = await supabase
        .from("moonpay_transactions")
        .update(plan.update)
        .eq("id", row.id);
      if (updateError) throw new Error(`MoonPay transaction update failed: ${updateError.message}`);
      logStep("Tracked purchase updated", {
        externalReference: parsed.externalReference,
        status: plan.update.status ?? row.status,
      });
      return json({ received: true });
    }

    // ── Unknown reference: record defensively ──
    // Owned by the payload's externalCustomerId when it names one
    // of our users (audit M-2); by nobody otherwise.
    const fallbackReference = parsed.externalReference ?? parsed.moonpayTransactionId;
    if (!fallbackReference) {
      // Nothing we can reconcile against — acknowledge and move on.
      logStep("Buy event carried no reference — ignored");
      return json({ received: true, ignored: true });
    }
    let ownerId: string | null = null;
    if (
      parsed.externalCustomerId &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        .test(parsed.externalCustomerId)
    ) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", parsed.externalCustomerId)
        .maybeSingle();
      if (profile) ownerId = parsed.externalCustomerId;
    }
    const { error: insertError } = await supabase
      .from("moonpay_transactions")
      .insert({
        user_id: ownerId,
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
        last_event_updated_at: parsed.updatedAt,
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
