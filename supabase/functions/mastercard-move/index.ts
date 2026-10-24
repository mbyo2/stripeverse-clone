// Mastercard Move — cross-border payouts (sandbox-first).
//
// Admin / super_admin ONLY. This is the edge layer for Mastercard
// Send + Mastercard Cross-Border Services (the Move portfolio —
// gateway brief §1.2 / §1.2A). While the features are "Coming soon"
// publicly, this function refuses everyone else with a crafted
// plain-language message; there is no public path into it.
//
// Invariants copied from the proven PayPal rail:
//   * Server-side validation of every amount / currency / corridor
//     field — nothing is trusted from the browser beyond the form.
//   * The payment row (with its unique transaction_reference) is
//     persisted BEFORE the provider call. That reference is the
//     idempotency anchor: a retry reuses the same reference and a
//     payment is never submitted twice under two references.
//   * Provider errors surface as crafted plain language; raw
//     provider bodies go to the row's status_history for admin
//     reconciliation, never to the response.
//   * Sandbox responses are labelled: every row carries env, and
//     every response carries `sandbox: true` while MASTERCARD_ENV
//     is sandbox. Sandbox stubs simulate — nothing here moves real
//     money until the production key swap + partner onboarding.
//
// Secrets (Supabase function secrets, never hardcoded):
//   MASTERCARD_ENV, MASTERCARD_CONSUMER_KEY, MASTERCARD_KEY_ALIAS,
//   MASTERCARD_KEYSTORE_PASSWORD, MASTERCARD_SIGNING_KEY_PEM,
//   MASTERCARD_XBS_ENCRYPTION_KEY_PEM, and optionally
//   MASTERCARD_SEND_PARTNER_ID / MASTERCARD_XBS_PARTNER_ID (issued
//   at onboarding; the sandbox stubs answer with a placeholder).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  getServiceRoleClient,
  getSupabaseClient,
} from "../_shared/supabase-client.ts";
import {
  currentTimestamp,
  generateNonce,
  signMastercardRequest,
} from "../_shared/mastercard-oauth.ts";
import { encryptXbsPayload } from "../_shared/mastercard-encryption.ts";
import { parseFiatAmount } from "../_shared/fiat-amount.ts";
import {
  ADMIN_REFUSAL_MESSAGE,
  NOT_CONFIGURED_MESSAGE,
  appendStatusHistory,
  buildSendDisbursementBody,
  buildXbsPaymentBody,
  buildXbsQuoteBody,
  craftedProviderError,
  hasMastercardAdmin,
  isConfigured,
  isValidTransactionReference,
  normaliseProviderStatus,
  redactRecipientAccount,
  resolvePartnerId,
  resolveTransactionReference,
  sendDisbursementUrl,
  sendStatusUrl,
  xbsAccountsUrl,
  xbsPaymentStatusUrl,
  xbsPaymentUrl,
  xbsQuotesUrl,
  type DestinationType,
  type MastercardMoveConfig,
  type PaymentInput,
  type QuoteInput,
} from "../_shared/mastercard-move.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[MASTERCARD-MOVE] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getConfig(): MastercardMoveConfig {
  const env = Deno.env.get("MASTERCARD_ENV") === "production" ? "production" : "sandbox";
  return {
    env,
    consumerKey: Deno.env.get("MASTERCARD_CONSUMER_KEY") ?? null,
    signingKeyPem: Deno.env.get("MASTERCARD_SIGNING_KEY_PEM") ?? null,
    sendPartnerId: Deno.env.get("MASTERCARD_SEND_PARTNER_ID") ?? null,
    xbsPartnerId: Deno.env.get("MASTERCARD_XBS_PARTNER_ID") ?? null,
  };
}

interface ProviderResult {
  httpStatus: number;
  payload: Record<string, unknown> | null;
}

/** One signed provider call. Body objects are JSON-serialised once,
 *  and that exact string is what gets hashed, signed and sent. */
async function providerCall(
  config: MastercardMoveConfig,
  method: string,
  url: string,
  bodyObject: Record<string, unknown> | null,
  opts: { encryptXbs?: boolean } = {},
): Promise<ProviderResult> {
  let body = bodyObject ? JSON.stringify(bodyObject) : "";
  let contentType = "application/json";

  // XBS payload encryption (brief §1.2A): built in
  // _shared/mastercard-encryption.ts and unit-tested. The sandbox
  // stubs answer without it, so it is enabled only when the
  // function environment explicitly opts in (the MTF step).
  if (opts.encryptXbs && Deno.env.get("MASTERCARD_XBS_ENCRYPTION") === "true") {
    const encryptionPem = Deno.env.get("MASTERCARD_XBS_ENCRYPTION_KEY_PEM") ?? "";
    body = await encryptXbsPayload(bodyObject, encryptionPem);
    contentType = "application/jose";
  }

  const authorization = await signMastercardRequest(
    method,
    url,
    {
      consumerKey: config.consumerKey ?? "",
      body,
      nonce: generateNonce(),
      timestamp: currentTimestamp(),
    },
    config.signingKeyPem ?? "",
  );

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": contentType,
      Accept: "application/json",
      Authorization: authorization,
    },
    body: method === "GET" ? undefined : body,
  });
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = null;
  }
  return { httpStatus: response.status, payload };
}

function providerIdFrom(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  for (const key of ["payment_id", "id", "transaction_id", "disbursement_id"]) {
    if (typeof payload[key] === "string") return payload[key] as string;
  }
  const nested = payload.payment_disbursement ?? payload.payment;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const rec = nested as Record<string, unknown>;
    if (typeof rec.id === "string") return rec.id;
  }
  return null;
}

function providerStatusFrom(payload: Record<string, unknown> | null): string {
  if (!payload) return "unknown";
  if (typeof payload.status === "string") return normaliseProviderStatus(payload.status);
  const nested = payload.payment_disbursement ?? payload.payment;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return normaliseProviderStatus((nested as Record<string, unknown>).status);
  }
  return "unknown";
}

function proposalIdFrom(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.proposal_id === "string") return payload.proposal_id;
  const quote = payload.quote;
  if (quote && typeof quote === "object" && !Array.isArray(quote)) {
    const rec = quote as Record<string, unknown>;
    if (typeof rec.proposal_id === "string") return rec.proposal_id;
  }
  return null;
}

const DESTINATION_TYPES: DestinationType[] = ["bank", "mobile_money", "card", "cash_pickup"];

function parseQuoteInput(body: Record<string, unknown>): QuoteInput | null {
  // FIX-1: whole minor units only — parseFiatAmount refuses >2dp.
  const amount = parseFiatAmount(body.amount, 1_000_000);
  if (amount === null) return null;
  const destinationType = body.destination_type as DestinationType;
  if (!DESTINATION_TYPES.includes(destinationType)) return null;
  const sourceCurrency = String(body.source_currency ?? "ZMW").toUpperCase();
  const destinationCurrency = String(body.destination_currency ?? "").toUpperCase();
  const destinationCountry = String(body.destination_country ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(sourceCurrency) || !/^[A-Z]{3}$/.test(destinationCurrency)) return null;
  if (!/^[A-Z]{2}$/.test(destinationCountry)) return null;
  return {
    amount,
    sourceCurrency,
    destinationCurrency,
    destinationCountry,
    destinationType,
    paymentType: typeof body.payment_type === "string" ? body.payment_type : "P2P",
  };
}

function parsePaymentInput(
  body: Record<string, unknown>,
  quote: QuoteInput,
  transactionReference: string,
): PaymentInput | null {
  const recipientName = String(body.recipient_name ?? "").trim();
  const recipientAccount = String(body.recipient_account ?? "").trim();
  if (recipientName.length < 2 || recipientName.length > 120) return null;
  if (recipientAccount.length < 4 || recipientAccount.length > 120) return null;
  return {
    ...quote,
    transactionReference,
    proposalId: typeof body.proposal_id === "string" ? body.proposal_id : null,
    recipientName,
    recipientAccount,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const service = getServiceRoleClient();

    // ── Authenticate ──────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { success: false, error: "Please sign in to continue." });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user?.id) {
      return json(401, { success: false, error: "Your session has expired. Please sign in again to continue." });
    }
    const user = userData.user;

    // ── Admin gate (admin OR super_admin, via user_roles — the
    // same in-function check pattern as create-virtual-card, widened
    // to the superadmin tier) ─────────────────────────────────────
    const { data: roleRows } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!hasMastercardAdmin(roles)) {
      return json(403, { success: false, error: ADMIN_REFUSAL_MESSAGE });
    }

    const config = getConfig();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    logStep("Action", { action, userId: user.id, env: config.env });

    // Listing reads our own table only — allowed before the
    // provider-config check so admins can always see saved rows.
    if (action === "list_payments") {
      const { data, error } = await service
        .from("mastercard_move_payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return json(500, { success: false, error: "The payment list could not be loaded. Please try again." });
      return json(200, { success: true, payments: data ?? [], sandbox: config.env === "sandbox" });
    }

    if (!isConfigured(config)) {
      return json(503, { success: false, error: NOT_CONFIGURED_MESSAGE });
    }

    // ── Quotes ────────────────────────────────────────────────────
    if (action === "xbs_quote" || action === "send_quote") {
      const quote = parseQuoteInput(body);
      if (!quote) {
        return json(400, { success: false, error: "Check the amount, currencies, destination country and destination type, then try again." });
      }
      const rail = action === "xbs_quote" ? "xbs" : "send";
      const reference = resolveTransactionReference({
        existingReference: null,
        suppliedReference: typeof body.transaction_reference === "string" ? body.transaction_reference : null,
        idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
        generate: () => `quote-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
      });

      if (rail === "send") {
        // Mastercard Send publishes NO quote endpoint (brief §1.2
        // lists disbursement create/retrieve only) — so a Send
        // "quote" is a local, sandbox-labelled estimate record.
        // The first provider call for Send is the disbursement
        // itself. We say exactly that, and never invent an FX
        // conversion we did not receive.
        const { data: row, error } = await service
          .from("mastercard_move_payments")
          .insert({
            transaction_reference: reference,
            rail,
            kind: "quote",
            amount: quote.amount,
            source_currency: quote.sourceCurrency,
            destination_currency: quote.destinationCurrency,
            destination_country: quote.destinationCountry,
            destination_type: quote.destinationType,
            payment_type: quote.paymentType ?? "P2P",
            status: "quoted",
            env: config.env,
            status_history: [{
              event: "quote_created_locally",
              note: "Mastercard Send has no quote endpoint; this is a sandbox estimate record. Destination amount is confirmed at disbursement.",
              at: new Date().toISOString(),
              env: config.env,
            }],
            created_by: user.id,
          })
          .select("*")
          .single();
        if (error) return json(500, { success: false, error: "The quote could not be saved. Please try again." });
        return json(200, {
          success: true,
          sandbox: config.env === "sandbox",
          sandbox_estimate: true,
          note: "Mastercard Send does not provide a quote step — this estimate is recorded locally and the destination amount is confirmed when the disbursement is created.",
          payment: row,
        });
      }

      const partnerId = resolvePartnerId(config, "xbs");
      if (!partnerId) return json(503, { success: false, error: NOT_CONFIGURED_MESSAGE });
      const result = await providerCall(config, "POST", xbsQuotesUrl(config, partnerId), buildXbsQuoteBody(quote), { encryptXbs: true });
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        return json(502, { success: false, error: craftedProviderError(result.httpStatus), sandbox: config.env === "sandbox" });
      }
      const proposalId = proposalIdFrom(result.payload);
      const { data: row, error } = await service
        .from("mastercard_move_payments")
        .insert({
          transaction_reference: reference,
          rail,
          kind: "quote",
          amount: quote.amount,
          source_currency: quote.sourceCurrency,
          destination_currency: quote.destinationCurrency,
          destination_country: quote.destinationCountry,
          destination_type: quote.destinationType,
          payment_type: quote.paymentType ?? "P2P",
          proposal_id: proposalId,
          status: "quoted",
          env: config.env,
          provider_response: result.payload,
          status_history: [{ event: "quote_created", proposal_id: proposalId, at: new Date().toISOString(), env: config.env }],
          created_by: user.id,
        })
        .select("*")
        .single();
      if (error) return json(500, { success: false, error: "The quote was created but could not be saved. Please try again." });
      return json(200, { success: true, sandbox: config.env === "sandbox", proposal_id: proposalId, payment: row, provider: result.payload });
    }

    // ── Payments (idempotency-critical) ───────────────────────────
    if (action === "xbs_payment" || action === "send_payment") {
      const rail = action === "xbs_payment" ? "xbs" : "send";
      const quote = parseQuoteInput(body);
      if (!quote) {
        return json(400, { success: false, error: "Check the amount, currencies, destination country and destination type, then try again." });
      }

      // 1) Resolve the reference BEFORE anything else. A retry that
      //    carries the same idempotency key (or the reference from
      //    the first attempt) resolves to the SAME reference.
      const suppliedReference = typeof body.transaction_reference === "string" ? body.transaction_reference : null;
      const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
      const candidateReference = resolveTransactionReference({
        existingReference: null,
        suppliedReference,
        idempotencyKey,
        generate: () => `bmg-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      });
      if (!isValidTransactionReference(candidateReference)) {
        return json(400, { success: false, error: "That payment reference is not valid. Start a new payment and try again." });
      }

      // 2) Existing row? Reuse it — never mint, never re-submit a
      //    payment that already reached the provider.
      const { data: existing } = await service
        .from("mastercard_move_payments")
        .select("*")
        .eq("transaction_reference", candidateReference)
        .eq("kind", "payment")
        .maybeSingle();

      const reference = resolveTransactionReference({
        existingReference: existing?.transaction_reference ?? null,
        suppliedReference,
        idempotencyKey,
        generate: () => candidateReference,
      });

      if (existing && ["submitted", "pending", "completed"].includes(existing.status)) {
        return json(200, {
          success: true,
          idempotent_replay: true,
          sandbox: config.env === "sandbox",
          payment: existing,
        });
      }

      const payment = parsePaymentInput(body, quote, reference);
      if (!payment) {
        return json(400, { success: false, error: "Check the recipient name and account details, then try again." });
      }

      // 3) Persist BEFORE the provider call (or note the retry on
      //    the already-persisted row).
      let row = existing;
      if (!row) {
        const { data: inserted, error: insertError } = await service
          .from("mastercard_move_payments")
          .insert({
            transaction_reference: reference,
            rail,
            kind: "payment",
            amount: payment.amount,
            source_currency: payment.sourceCurrency,
            destination_currency: payment.destinationCurrency,
            destination_country: payment.destinationCountry,
            destination_type: payment.destinationType,
            payment_type: payment.paymentType ?? "P2P",
            recipient_name: payment.recipientName,
            recipient_account: redactRecipientAccount(payment.recipientAccount),
            proposal_id: payment.proposalId,
            status: "created_locally",
            env: config.env,
            status_history: [{ event: "created", at: new Date().toISOString(), env: config.env }],
            created_by: user.id,
          })
          .select("*")
          .single();
        if (insertError || !inserted) {
          return json(500, { success: false, error: "The payment could not be saved, so it was not sent. Please try again." });
        }
        row = inserted;
      } else {
        await service
          .from("mastercard_move_payments")
          .update({
            status_history: appendStatusHistory(row.status_history, {
              event: "retry_submission",
              at: new Date().toISOString(),
              env: config.env,
            }),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }

      // 4) The provider call — exactly once per persisted row state.
      const partnerId = resolvePartnerId(config, rail);
      if (!partnerId) return json(503, { success: false, error: NOT_CONFIGURED_MESSAGE });
      const url = rail === "xbs" ? xbsPaymentUrl(config, partnerId) : sendDisbursementUrl(config, partnerId);
      const payload = rail === "xbs" ? buildXbsPaymentBody(payment) : buildSendDisbursementBody(payment);
      const result = await providerCall(config, "POST", url, payload, { encryptXbs: rail === "xbs" });

      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        await service
          .from("mastercard_move_payments")
          .update({
            status: "provider_error",
            provider_response: result.payload,
            status_history: appendStatusHistory(row.status_history, {
              event: "provider_error",
              http_status: result.httpStatus,
              at: new Date().toISOString(),
              env: config.env,
            }),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        return json(502, {
          success: false,
          error: craftedProviderError(result.httpStatus),
          transaction_reference: reference,
          sandbox: config.env === "sandbox",
        });
      }

      const providerId = providerIdFrom(result.payload);
      const status = providerStatusFrom(result.payload);
      const { data: updated } = await service
        .from("mastercard_move_payments")
        .update({
          status: status === "unknown" ? "submitted" : status,
          provider_payment_id: providerId,
          provider_reference: reference,
          provider_response: result.payload,
          status_history: appendStatusHistory(row.status_history, {
            event: "submitted",
            provider_status: status,
            provider_payment_id: providerId,
            at: new Date().toISOString(),
            env: config.env,
          }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("*")
        .single();
      return json(200, { success: true, sandbox: config.env === "sandbox", payment: updated ?? row });
    }

    // ── Status ────────────────────────────────────────────────────
    if (action === "xbs_status" || action === "send_status") {
      const rail = action === "xbs_status" ? "xbs" : "send";
      const reference = typeof body.transaction_reference === "string" ? body.transaction_reference : null;
      const givenId = typeof body.payment_id === "string" ? body.payment_id : null;
      if (!reference && !givenId) {
        return json(400, { success: false, error: "Choose a payment to check, then try again." });
      }
      let query = service.from("mastercard_move_payments").select("*");
      query = reference ? query.eq("transaction_reference", reference) : query.eq("provider_payment_id", givenId as string);
      const { data: row } = await query.maybeSingle();

      const partnerId = resolvePartnerId(config, rail);
      if (!partnerId) return json(503, { success: false, error: NOT_CONFIGURED_MESSAGE });
      const url = rail === "xbs"
        ? xbsPaymentStatusUrl(config, partnerId, row?.provider_payment_id ?? givenId ?? reference as string)
        : sendStatusUrl(config, partnerId, reference ?? row?.transaction_reference ?? "");
      const result = await providerCall(config, "GET", url, null, { encryptXbs: false });
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        return json(502, { success: false, error: craftedProviderError(result.httpStatus), sandbox: config.env === "sandbox" });
      }
      const status = providerStatusFrom(result.payload);
      if (row) {
        await service
          .from("mastercard_move_payments")
          .update({
            status: status === "unknown" ? row.status : status,
            provider_response: result.payload,
            status_history: appendStatusHistory(row.status_history, {
              event: "status_checked",
              provider_status: status,
              at: new Date().toISOString(),
              env: config.env,
            }),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
      return json(200, { success: true, sandbox: config.env === "sandbox", status, provider: result.payload });
    }

    // ── Balances ──────────────────────────────────────────────────
    if (action === "xbs_balances") {
      const partnerId = resolvePartnerId(config, "xbs");
      if (!partnerId) return json(503, { success: false, error: NOT_CONFIGURED_MESSAGE });
      const result = await providerCall(config, "GET", xbsAccountsUrl(config, partnerId), null, { encryptXbs: false });
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        return json(502, { success: false, error: craftedProviderError(result.httpStatus), sandbox: config.env === "sandbox" });
      }
      return json(200, { success: true, sandbox: config.env === "sandbox", accounts: result.payload });
    }

    return json(400, { success: false, error: "That action is not supported. Please try again." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    // Our own crafted messages pass through; anything technical
    // collapses to a crafted generic (CEO error-presentation rule).
    const crafted = [
      ADMIN_REFUSAL_MESSAGE,
      NOT_CONFIGURED_MESSAGE,
      "Mastercard signing key is not configured.",
    ].includes(message)
      ? message
      : "Something went wrong with that payment request. It has not been sent — check the payment list before trying again.";
    return json(500, { success: false, error: crafted });
  }
});
