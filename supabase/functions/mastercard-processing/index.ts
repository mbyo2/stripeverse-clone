// Mastercard Processing Core — the virtual-card issuing provider
// layer (sandbox-first).
//
// Admin / super_admin ONLY, behind the same gate as the rest of the
// Mastercard surface. This function is the provider behind the
// admin virtual-card flow (gateway brief §1.1): it speaks the
// Processing Core resource model — POST /clients → POST /accounts →
// POST /cards — signed with the portal project's OAuth 1.0a key via
// _shared/mastercard-oauth.ts, exactly like the Move rail.
//
// Honesty rules (brief §1.1 + CEO rules):
//   * Processing sandbox access is provisioned by Mastercard
//     through an implementation project. If the sandbox answers
//     with a provisioning / access refusal, this function surfaces
//     it truthfully — crafted message + refusal class + the
//     provider's ReasonCode — and NEVER simulates a success.
//   * Provider prose is never shown; provider payloads are logged
//     and returned only through the redaction helpers (a card
//     contract payload can carry the full PAN).
//   * The full PAN, when the CMS returns one, is revealed at most
//     once (in the issue_card response, to the authenticated
//     admin) and is never stored or logged — only the masked form
//     and the provider contract ids are persisted, onto the
//     virtual_cards row (migration 20261107).
//
// Secrets (Supabase function secrets, never hardcoded):
//   MASTERCARD_ENV, MASTERCARD_CONSUMER_KEY, MASTERCARD_SIGNING_KEY_PEM
//   (shared with the Move rail), plus the Processing onboarding
//   values MC_PROCESSING_CLIENT_TYPE / MC_PROCESSING_ACCOUNT_PRODUCT_CODE
//   / MC_PROCESSING_CARD_PRODUCT_CODE — in sandbox these fall back to
//   the documented sandbox test values (brief §1.1); in production
//   there are no defaults and the layer reports not configured until
//   onboarding supplies them.

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
import {
  PROCESSING_ADMIN_REFUSAL_MESSAGE,
  PROCESSING_NOT_CONFIGURED_MESSAGE,
  accountsUrl,
  buildCreateAccountBody,
  buildCreateCardBody,
  buildCreateClientBody,
  cardContractIdFrom,
  cardContractUrl,
  cardExpiryFrom,
  cardNumberFrom,
  cardsUrl,
  classifyProviderRefusal,
  clientIdFrom,
  clientsUrl,
  contractTransactionsUrl,
  craftedProcessingError,
  deriveAccountContractNumber,
  deriveClientNumber,
  expiryDateFromYymm,
  expiryDisplayFromYymm,
  hasProcessingAdmin,
  idFromLocationHeader,
  isProcessingConfigured,
  maskPan,
  normaliseCardStatus,
  normaliseTransactions,
  providerReasonCode,
  redactSensitive,
  resolveAccountProductCode,
  resolveCardProductCode,
  resolveClientType,
  accountContractIdFrom,
  type MastercardProcessingConfig,
} from "../_shared/mastercard-processing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  // Details pass through the redactor unconditionally: a provider
  // payload in a log line must never carry a PAN or a CVV.
  const safe = details ? (redactSensitive(details) as Record<string, unknown>) : undefined;
  console.log(`[MASTERCARD-PROCESSING] ${step}${safe ? ` - ${JSON.stringify(safe)}` : ""}`);
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getConfig(): MastercardProcessingConfig {
  return {
    env: Deno.env.get("MASTERCARD_ENV") === "production" ? "production" : "sandbox",
    consumerKey: Deno.env.get("MASTERCARD_CONSUMER_KEY") ?? null,
    signingKeyPem: Deno.env.get("MASTERCARD_SIGNING_KEY_PEM") ?? null,
    clientType: Deno.env.get("MC_PROCESSING_CLIENT_TYPE") ?? null,
    accountProductCode: Deno.env.get("MC_PROCESSING_ACCOUNT_PRODUCT_CODE") ?? null,
    cardProductCode: Deno.env.get("MC_PROCESSING_CARD_PRODUCT_CODE") ?? null,
  };
}

interface ProviderResult {
  httpStatus: number;
  payload: Record<string, unknown> | null;
  location: string | null;
}

/** One signed provider call. The body string that is hashed and
 *  signed is the exact string that is sent. */
async function providerCall(
  config: MastercardProcessingConfig,
  method: string,
  url: string,
  bodyObject: Record<string, unknown> | null,
): Promise<ProviderResult> {
  const body = bodyObject ? JSON.stringify(bodyObject) : "";
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
      "Content-Type": "application/json",
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
  return { httpStatus: response.status, payload, location: response.headers.get("Location") };
}

function providerFailure(result: ProviderResult): Response {
  return json(502, {
    success: false,
    error: craftedProcessingError(result.httpStatus, result.payload),
    provider_http_status: result.httpStatus,
    refusal_class: classifyProviderRefusal(result.httpStatus, result.payload),
    reason_code: providerReasonCode(result.payload),
  });
}

function isSuccess(result: ProviderResult): boolean {
  return result.httpStatus >= 200 && result.httpStatus < 300;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}

function cleanId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64) {
    return value.trim();
  }
  return null;
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

    // ── Admin gate (admin OR super_admin via user_roles) ─────────
    const { data: roleRows } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!hasProcessingAdmin(roles)) {
      return json(403, { success: false, error: PROCESSING_ADMIN_REFUSAL_MESSAGE });
    }

    const config = getConfig();
    if (!isProcessingConfigured(config)) {
      return json(503, { success: false, error: PROCESSING_NOT_CONFIGURED_MESSAGE });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    logStep("Action", { action, userId: user.id, env: config.env });

    // ── Create CMS client ─────────────────────────────────────────
    if (action === "create_client") {
      const firstName = cleanName(body.first_name);
      const lastName = cleanName(body.last_name);
      if (!firstName || !lastName) {
        return json(400, { success: false, error: "Check the cardholder's first and last name, then try again." });
      }
      const targetUserId = cleanId(body.user_id) ?? user.id;
      const clientNumber = typeof body.client_number === "string" && body.client_number.trim()
        ? body.client_number.trim()
        : deriveClientNumber(targetUserId);
      const result = await providerCall(config, "POST", clientsUrl(config), buildCreateClientBody({
        clientNumber,
        clientType: resolveClientType(config) as string,
        firstName,
        lastName,
        email: typeof body.email === "string" ? body.email : null,
        phoneNumberMobile: typeof body.phone_number_mobile === "string" ? body.phone_number_mobile : null,
      }));
      if (!isSuccess(result)) return providerFailure(result);
      const clientId = clientIdFrom(result.payload) ?? idFromLocationHeader(result.location, "clients");
      if (!clientId) {
        return json(502, { success: false, error: "Mastercard created the client but did not return its reference. Please check with an administrator before trying again." });
      }
      return json(200, { success: true, sandbox: config.env === "sandbox", client_id: clientId, client_number: clientNumber });
    }

    // ── Create CMS account contract ───────────────────────────────
    if (action === "create_account") {
      const clientId = cleanId(body.client_id);
      if (!clientId) {
        return json(400, { success: false, error: "Choose the cardholder first, then try again." });
      }
      const accountContractNumber = typeof body.account_contract_number === "string" && body.account_contract_number.trim()
        ? body.account_contract_number.trim()
        : deriveAccountContractNumber(`${clientId}-${crypto.randomUUID()}`);
      const currency = typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency)
        ? body.currency.toUpperCase()
        : "EUR";
      const result = await providerCall(config, "POST", accountsUrl(config), buildCreateAccountBody({
        accountContractNumber,
        clientId,
        productCode: resolveAccountProductCode(config) as string,
        currency,
      }));
      if (!isSuccess(result)) return providerFailure(result);
      const accountId = accountContractIdFrom(result.payload) ?? idFromLocationHeader(result.location, "accounts");
      if (!accountId) {
        return json(502, { success: false, error: "Mastercard created the account but did not return its reference. Please check with an administrator before trying again." });
      }
      return json(200, { success: true, sandbox: config.env === "sandbox", account_contract_id: accountId, account_contract_number: accountContractNumber });
    }

    // ── Issue card (create card contract) ─────────────────────────
    if (action === "issue_card") {
      const clientId = cleanId(body.client_id);
      const accountId = cleanId(body.account_contract_id ?? body.account_id);
      const firstName = cleanName(body.first_name);
      const lastName = cleanName(body.last_name);
      if (!clientId || !accountId || !firstName || !lastName) {
        return json(400, { success: false, error: "Check the cardholder and account details, then try again." });
      }
      const currency = typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency)
        ? body.currency.toUpperCase()
        : "EUR";
      const result = await providerCall(config, "POST", cardsUrl(config), buildCreateCardBody({
        accountContractId: accountId,
        clientId,
        productCode: resolveCardProductCode(config) as string,
        currency,
        firstName,
        lastName,
      }));
      if (!isSuccess(result)) return providerFailure(result);
      const cardId = cardContractIdFrom(result.payload) ?? idFromLocationHeader(result.location, "cards");
      if (!cardId) {
        return json(502, { success: false, error: "Mastercard created the card but did not return its reference. Please check with an administrator before trying again." });
      }

      // Best-effort details fetch: the card contract carries the
      // CMS-generated number + expiry. A failure here does not
      // un-issue the card — the contract id above is the durable
      // reference, and details can be re-read via card_status.
      let details: ProviderResult | null = null;
      try {
        details = await providerCall(config, "GET", cardContractUrl(config, cardId), null);
        if (!isSuccess(details)) details = null;
      } catch {
        details = null;
      }
      const pan = details ? cardNumberFrom(details.payload) : null;
      const expiryRaw = details ? cardExpiryFrom(details.payload) : null;

      // Persist the provider references onto the platform card row
      // when the caller names one (the admin creation flow does).
      const virtualCardId = cleanId(body.virtual_card_id);
      if (virtualCardId) {
        await service
          .from("virtual_cards")
          .update({
            provider_client_id: clientId,
            provider_account_id: accountId,
            provider_card_id: cardId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", virtualCardId);
      }

      return json(200, {
        success: true,
        sandbox: config.env === "sandbox",
        card_contract_id: cardId,
        card: {
          status: details ? normaliseCardStatus(details.payload) : "unknown",
          masked_number: maskPan(pan),
          expiry_date: expiryDateFromYymm(expiryRaw),
          expiry: expiryDisplayFromYymm(expiryRaw),
          // One-time reveal, same contract as create-virtual-card:
          // the full number appears only in this response, to the
          // authenticated admin, and is never stored or logged.
          // The CMS does not return a CVV at issuance (it is set /
          // verified through the card-verification-code operations),
          // so none is claimed here.
          card_number: pan,
          cvv: null,
        },
      });
    }

    // ── Card status / details ─────────────────────────────────────
    if (action === "card_status") {
      let cardId = cleanId(body.card_contract_id ?? body.provider_card_id);
      const virtualCardId = cleanId(body.virtual_card_id);
      if (!cardId && virtualCardId) {
        const { data: row } = await service
          .from("virtual_cards")
          .select("provider_card_id")
          .eq("id", virtualCardId)
          .maybeSingle();
        cardId = row?.provider_card_id ?? null;
      }
      if (!cardId) {
        return json(400, { success: false, error: "That card has no Mastercard reference yet — it was not issued through Mastercard Processing." });
      }
      const result = await providerCall(config, "GET", cardContractUrl(config, cardId), null);
      if (!isSuccess(result)) return providerFailure(result);
      return json(200, {
        success: true,
        sandbox: config.env === "sandbox",
        card_contract_id: cardId,
        status: normaliseCardStatus(result.payload),
        masked_number: maskPan(cardNumberFrom(result.payload)),
        card: redactSensitive(result.payload),
      });
    }

    // ── Card / account transactions ───────────────────────────────
    if (action === "card_transactions") {
      let contractId = cleanId(body.contract_id ?? body.card_contract_id ?? body.account_contract_id);
      const virtualCardId = cleanId(body.virtual_card_id);
      if (!contractId && virtualCardId) {
        const { data: row } = await service
          .from("virtual_cards")
          .select("provider_card_id, provider_account_id")
          .eq("id", virtualCardId)
          .maybeSingle();
        contractId = row?.provider_card_id ?? row?.provider_account_id ?? null;
      }
      if (!contractId) {
        return json(400, { success: false, error: "That card has no Mastercard reference yet — it was not issued through Mastercard Processing." });
      }
      const result = await providerCall(config, "GET", contractTransactionsUrl(config, contractId), null);
      if (!isSuccess(result)) return providerFailure(result);
      return json(200, {
        success: true,
        sandbox: config.env === "sandbox",
        contract_id: contractId,
        transactions: normaliseTransactions(result.payload),
      });
    }

    return json(400, { success: false, error: "That action is not supported. Please try again." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    const crafted = [
      PROCESSING_ADMIN_REFUSAL_MESSAGE,
      PROCESSING_NOT_CONFIGURED_MESSAGE,
      "Mastercard signing key is not configured.",
    ].includes(message)
      ? message
      : "Something went wrong with that card request. No card was created — please try again.";
    return json(500, { success: false, error: crafted });
  }
});
