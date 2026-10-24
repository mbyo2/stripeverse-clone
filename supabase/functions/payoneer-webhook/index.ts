// payoneer-webhook: Payoneer's status callback for payouts
// (verify_jwt OFF — Payoneer is not a Supabase user; the shared-
// secret HMAC is the authentication).
//
// Security shape, mirroring the stripe-gateway-webhook /
// paypal-webhook discipline:
//   - If the rail is not configured (PAYONEER_CLIENT_ID /
//     PAYONEER_CLIENT_SECRET / PAYONEER_WEBHOOK_SECRET missing)
//     the endpoint answers 503 rather than processing anything —
//     fail closed, always.
//   - The RAW request body is verified FIRST against
//     PAYONEER_WEBHOOK_SECRET. CONFIRM-AT-ONBOARDING: Payoneer's
//     exact signing scheme is issued in the partner portal at
//     onboarding (brief §2.1 — webhook existence is official, the
//     scheme is portal docs); the documented assumption here is
//     header `x-payoneer-signature` = timing-safe HMAC-SHA256 hex
//     of the raw body with the shared secret (see the assumption
//     list in _shared/payoneer.ts). Any mismatch → 400, nothing
//     processed.
//   - The payload is only ever a HINT: it contributes candidate
//     identifiers (provider payout id / client_reference_id), the
//     payment is then RE-QUERIED from Payoneer's API, and the row
//     is settled from that answer via applyProviderStatus. State
//     NEVER changes from payload fields directly, so a forged or
//     replayed event can at most trigger a truthful re-read — and
//     the exactly-once reversal guard makes replays harmless.
//   - Unknown payouts answer 200 (ignored) so Payoneer stops
//     retrying events that can never settle here; a failed
//     re-query answers 500 so Payoneer retries later.
//   - Logs carry trace identifiers only — never payload bodies,
//     which can hold payee details.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  extractProviderStatus,
  extractWebhookIdentifiers,
  verifyPayoneerWebhookSignature,
  type PayoneerEnvValues,
} from "../_shared/payoneer.ts";
import {
  applyProviderStatus,
  findPayoutByClientReference,
  findPayoutByProviderId,
  getPayoneerPayment,
  type FetchLike,
} from "../_shared/payoneer-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYONEER-WEBHOOK] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fetchImpl: FetchLike = (url, init) => fetch(url, init);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Configuration gate (fail closed) ──
    const values: PayoneerEnvValues = {
      clientId: Deno.env.get("PAYONEER_CLIENT_ID") ?? null,
      clientSecret: Deno.env.get("PAYONEER_CLIENT_SECRET") ?? null,
      programId: Deno.env.get("PAYONEER_PROGRAM_ID") ?? null,
      env: Deno.env.get("PAYONEER_ENV") ?? null,
    };
    const webhookSecret = Deno.env.get("PAYONEER_WEBHOOK_SECRET") ?? null;
    if (!values.clientId || !values.clientSecret || !webhookSecret) {
      logStep("Webhook not configured — refusing event");
      return json({ error: "Webhook is not configured." }, 503);
    }

    // ── Verify FIRST, on the raw body ──
    const rawBody = await req.text();
    const verified = await verifyPayoneerWebhookSignature(
      rawBody,
      req.headers.get("x-payoneer-signature"),
      webhookSecret,
    );
    if (!verified) {
      logStep("Invalid Payoneer signature");
      return json({ error: "Invalid signature" }, 400);
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid payload" }, 400);
    }

    // ── Hint extraction (identifiers only — never state) ──
    const { providerPayoutId, clientReferenceId } = extractWebhookIdentifiers(event);
    logStep("Webhook event", { providerPayoutId, clientReferenceId });
    if (!providerPayoutId && !clientReferenceId) {
      return json({ received: true, ignored: true });
    }

    const supabase = getServiceRoleClient();
    let row = providerPayoutId
      ? await findPayoutByProviderId(supabase, providerPayoutId)
      : null;
    if (!row && clientReferenceId) {
      row = await findPayoutByClientReference(supabase, clientReferenceId);
    }
    if (!row) {
      // A payment this rail never recorded — nothing to settle.
      logStep("Unknown payout — ignored", { providerPayoutId, clientReferenceId });
      return json({ received: true, ignored: true });
    }

    const paymentIdToQuery = row.provider_payout_id ?? providerPayoutId;
    if (!paymentIdToQuery) {
      // No provider id anywhere: there is nothing to re-query, so
      // there is nothing truthful to apply.
      logStep("Payout has no provider id to re-query", { payoutId: row.id });
      return json({ received: true, ignored: true });
    }

    // ── Re-query, then settle from Payoneer's answer ──
    let payload: Record<string, unknown>;
    try {
      payload = await getPayoneerPayment(fetchImpl, values, paymentIdToQuery);
    } catch (e) {
      // Cannot re-query: 500 so Payoneer retries after recovery,
      // rather than the status change being lost.
      logStep("Re-query failed — asking Payoneer to retry", {
        payoutId: row.id,
        message: e instanceof Error ? e.message : String(e),
      });
      return json({ error: "Webhook processing failed — retry." }, 500);
    }

    const outcome = await applyProviderStatus(
      supabase,
      row,
      extractProviderStatus(payload),
    );
    logStep("Payout settled from re-query", {
      payoutId: row.id,
      status: outcome.row.status,
      reversedDebit: outcome.reversedDebit,
    });
    return json({ received: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in payoneer-webhook", { message: errorMessage });
    return json({ error: "Webhook processing failed — retry." }, 500);
  }
});
