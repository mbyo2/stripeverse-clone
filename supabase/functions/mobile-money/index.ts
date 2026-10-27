// mobile-money: KYC actions + (refused) external provider actions.
//
// History: this function "processed" MTN / Airtel / Zamtel payments,
// bank transfers, USSD and card payments with setTimeout delays and
// Math.random() success rolls (90% / 85%), inventing provider
// references and writing those fictions into the transactions table.
// None of it ever touched a real gateway.
//
// Now the two concerns are separated cleanly:
//   * KYC actions ('kyc-verification', 'check-kyc') are REAL database
//     work against kyc_verifications and are unchanged in behaviour
//     (they now receive the Supabase client explicitly — they used to
//     reference an undefined module-global `supabase`, so the repo
//     version could not have run them at all).
//   * Provider actions: bank / USSD / card / Zamtel still answer
//     truthfully with status 'not_configured' (see
//     _shared/payment-providers.ts) — no gateway is connected for
//     them, nothing is written and no reference is invented.
//   * MTN MoMo and Airtel Money are WIRED (2026-10-27): real
//     provider clients (_shared/mtn-momo-server.ts,
//     _shared/airtel-money-server.ts) behind their
//     platform_settings kill switches (mtn_momo_enabled /
//     airtel_money_enabled, both default OFF) and the shared telco
//     ledger (migration 20261237: ledger-first rows, exactly-once
//     settlement from re-queried provider status, callbacks as
//     hints only). With no telco secrets the answers are the same
//     'not_configured' as before; Airtel additionally refuses until
//     its Zambia wire shapes are confirmed from Airtel's gated
//     documentation (adapter rule in _shared/airtel-money.ts).
//     Wallet-to-wallet transfers never belonged here — they run
//     through atomic-transfer.
//
// Callers today: KycVerification.tsx and Compliance.tsx (KYC actions
// only). No frontend calls the provider actions yet.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { classifyProvider } from "../_shared/payment-providers.ts";
import {
  buildMtnMomoRequestToPayBody,
  buildMtnMomoTransferBody,
  mtnMomoCallbackHint,
  mtnMomoConfig,
  mtnMomoRailEnabled,
  mtnMomoRailGate,
  mtnMomoSettlementCurrency,
  normaliseMsisdn,
  MTN_MOMO_DISABLED_MESSAGE,
  MTN_MOMO_INVALID_PHONE_MESSAGE,
} from "../_shared/mtn-momo.ts";
import {
  createMtnMomoClient,
  MtnMomoApiError,
  MtnMomoDisabledError,
  MtnMomoNotConfiguredError,
  type MtnMomoClient,
} from "../_shared/mtn-momo-server.ts";
import {
  airtelMoneyCallbackHint,
  airtelMoneyConfig,
  airtelMoneyRailEnabled,
  airtelMoneyRailGate,
  buildAirtelMoneyCollectionBody,
  normaliseAirtelMsisdn,
  AIRTEL_MONEY_DISABLED_MESSAGE,
  AIRTEL_MONEY_INVALID_PHONE_MESSAGE,
  AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
} from "../_shared/airtel-money.ts";
import {
  createAirtelMoneyClient,
  AirtelMoneyAdapterUnconfirmedError,
  AirtelMoneyApiError,
  AirtelMoneyDisabledError,
  AirtelMoneyNotConfiguredError,
  type AirtelMoneyClient,
} from "../_shared/airtel-money-server.ts";
import {
  normalizeTelcoAction,
  normalizeTelcoProvider,
  telcoBeginOutcomeMessage,
  telcoPaymentResponse,
  telcoProviderFailureMessage,
  validateTelcoIdempotencyKey,
  TELCO_IDEMPOTENCY_REQUIRED_MESSAGE,
  TELCO_REFERENCE_REQUIRED_MESSAGE,
  type TelcoProduct,
  type TelcoProvider,
} from "../_shared/telco-payments.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import {
  buildKycDocumentInsertFields,
  buildKycDocumentUpdateFields,
} from "../_shared/kyc-submission.ts";
import {
  KYC_WRITE_LOST_MESSAGE,
  assertKycWriteLanded,
  isKycWriteLostError,
} from "../_shared/kyc-write.ts";
import {
  PHONE_STAMP_AUDIT_FAILED_MESSAGE,
  PHONE_STAMP_FAILED_MESSAGE,
  PHONE_STAMP_FORBIDDEN_MESSAGE,
  PHONE_STAMP_SUCCESS_MESSAGE,
  hasPhoneStampAdmin,
  validatePhoneForStamp,
  validatePhoneStampTarget,
} from "../_shared/phone-stamp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Authenticated client (service role key + the caller's Authorization
// header, as this function has always run). Used ONLY for the KYC
// database actions below.
const getSupabaseClient = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader || "" } },
    },
  );
};

// Service-role client WITHOUT forwarding the caller's Authorization
// header. Required for the admin phone-stamp action: the role check,
// the GoTrue admin stamp and the audit insert must run as
// service_role, not in the caller's `authenticated` PostgREST role
// (same reasoning as _shared/supabase-client.ts getServiceRoleClient).
const getServiceRoleClient = () => {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
};

// ── KYC (real) ───────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof getSupabaseClient>;

enum KycVerificationLevel {
  NONE = "none",
  BASIC = "basic",
  FULL = "full",
}

async function verifyKyc(
  supabase: SupabaseClient,
  userId: string,
  data: Record<string, unknown>,
): Promise<{ level: KycVerificationLevel; message: string }> {
  // Check if the user already has KYC verification
  const { data: existingKyc, error: kycError } = await supabase
    .from("kyc_verifications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (kycError) throw kycError;

  // If user already has full verification, return that
  if (existingKyc && existingKyc.level === KycVerificationLevel.FULL && existingKyc.verified_at) {
    return { level: KycVerificationLevel.FULL, message: "Your account is already fully verified." };
  }

  const { firstName, lastName, idType, idNumber, dateOfBirth, address, selfieImage } = data as {
    firstName?: string; lastName?: string; idType?: string; idNumber?: string;
    dateOfBirth?: string; address?: string; selfieImage?: string;
  };

  if (!firstName || !lastName || !idType || !idNumber || !dateOfBirth) {
    return { level: KycVerificationLevel.NONE, message: "Missing required verification information." };
  }

  // Full when the advanced evidence is supplied, basic otherwise.
  // Submission is for review: verified_at is set by an admin, never here.
  const verificationLevel = address && selfieImage
    ? KycVerificationLevel.FULL
    : KycVerificationLevel.BASIC;

  if (existingKyc) {
    // .select("id") requests the written row back: a 0-row update
    // returns no PostgREST error, so without it a blocked write used
    // to pass as success while nothing was saved (the re-submission
    // bug). assertKycWriteLanded turns that into a hard failure.
    const { data: updatedRows, error: updateError } = await supabase
      .from("kyc_verifications")
      .update({
        level: verificationLevel,
        first_name: firstName,
        last_name: lastName,
        id_type: idType,
        id_number: idNumber,
        date_of_birth: dateOfBirth,
        address: address || existingKyc.address,
        selfie_url: selfieImage || existingKyc.selfie_url,
        // Document URLs (idFrontUrl/idBackUrl/addressDocUrl or their
        // snake_case aliases) — fall back to the stored values when
        // the new submission omits them, like address/selfie above.
        ...buildKycDocumentUpdateFields(data, existingKyc),
        updated_at: new Date().toISOString(),
        metadata: {},
      })
      .eq("user_id", userId)
      .select("id");
    if (updateError) throw updateError;
    assertKycWriteLanded(updatedRows);
  } else {
    const { data: insertedRows, error: insertError } = await supabase
      .from("kyc_verifications")
      .insert({
        user_id: userId,
        level: verificationLevel,
        first_name: firstName,
        last_name: lastName,
        id_type: idType,
        id_number: idNumber,
        date_of_birth: dateOfBirth,
        address: address || null,
        selfie_url: selfieImage || null,
        // Document URLs — null when the submission did not provide them.
        ...buildKycDocumentInsertFields(data),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      })
      .select("id");
    if (insertError) throw insertError;
    assertKycWriteLanded(insertedRows);
  }

  return {
    level: verificationLevel,
    message: verificationLevel === KycVerificationLevel.FULL
      ? "Your full verification has been submitted for review."
      : "Basic verification completed. Full verification is pending review.",
  };
}

async function checkKycLevel(
  supabase: SupabaseClient,
  userId: string,
): Promise<KycVerificationLevel> {
  try {
    if (!userId) return KycVerificationLevel.NONE;

    const { data, error } = await supabase
      .from("kyc_verifications")
      .select("level, verified_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return KycVerificationLevel.NONE;

    // Until an admin approves (verified_at set), a FULL submission
    // counts as BASIC.
    if (!data.verified_at && data.level === KycVerificationLevel.FULL) {
      return KycVerificationLevel.BASIC;
    }

    return (data.level as KycVerificationLevel) || KycVerificationLevel.NONE;
  } catch (error) {
    console.error("Error checking KYC level:", error);
    return KycVerificationLevel.NONE;
  }
}

// ── Provider actions (truthful refusal) ─────────────────────────────

// ── Direct telco rails (MTN MoMo + Airtel Money) ────────────────────
//
// Both rails run the same shape: gate (secrets → kill switch →
// adapter confirmation) → ledger-first begin RPC → provider call →
// settlement ONLY from a re-queried provider status via the settle
// RPC. All ledger work goes through the service-role client that
// does not forward the caller's JWT (the RPCs are service_role only
// and protect_wallet_balance must not neutralise their updates).

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

interface TelcoPaymentRow {
  id: string;
  transaction_id: string;
  user_id: string;
  wallet_id: string;
  provider: TelcoProvider;
  product: TelcoProduct;
  provider_reference: string;
  phone_msisdn: string;
  amount: number;
  currency: string;
  status: "pending" | "successful" | "failed";
  submission_state: string;
  provider_transaction_id: string | null;
}

async function loadMtnClient(service: ServiceClient) {
  const { data: settings } = await service
    .from("platform_settings")
    .select("mtn_momo_enabled")
    .eq("id", true)
    .maybeSingle();
  const values = {
    env: Deno.env.get("MTN_MOMO_ENV"),
    collectionSubscriptionKey: Deno.env.get("MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY"),
    disbursementSubscriptionKey: Deno.env.get("MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY"),
    apiUserId: Deno.env.get("MTN_MOMO_API_USER_ID"),
    apiKey: Deno.env.get("MTN_MOMO_API_KEY"),
    targetEnvironment: Deno.env.get("MTN_MOMO_TARGET_ENVIRONMENT"),
    callbackUrl: Deno.env.get("MTN_MOMO_CALLBACK_URL"),
    productionBaseUrl: Deno.env.get("MTN_MOMO_PRODUCTION_BASE_URL"),
    railEnabled: mtnMomoRailEnabled(settings),
  };
  return { config: mtnMomoConfig(values), client: createMtnMomoClient(values) };
}

async function loadAirtelClient(service: ServiceClient) {
  const { data: settings } = await service
    .from("platform_settings")
    .select("airtel_money_enabled")
    .eq("id", true)
    .maybeSingle();
  const values = {
    env: Deno.env.get("AIRTEL_ENV"),
    clientId: Deno.env.get("AIRTEL_CLIENT_ID"),
    clientSecret: Deno.env.get("AIRTEL_CLIENT_SECRET"),
    publicKeyPem: Deno.env.get("AIRTEL_PUBLIC_KEY_PEM"),
    callbackUrl: Deno.env.get("AIRTEL_CALLBACK_URL"),
    baseUrl: Deno.env.get("AIRTEL_BASE_URL"),
    shapesConfirmed: Deno.env.get("AIRTEL_API_SHAPES_CONFIRMED"),
    railEnabled: airtelMoneyRailEnabled(settings),
  };
  return { config: airtelMoneyConfig(values), client: createAirtelMoneyClient(values) };
}

/**
 * The gate refusal for a rail, or null when the rail may run.
 * `not_configured` deliberately routes through the legacy classifier
 * so the no-secrets answer is byte-identical to before this wiring.
 */
async function telcoGateRefusal(
  service: ServiceClient,
  provider: TelcoProvider,
): Promise<{ refusal: Response | null; mtn?: Awaited<ReturnType<typeof loadMtnClient>>; airtel?: Awaited<ReturnType<typeof loadAirtelClient>> }> {
  if (provider === "mtn") {
    const mtn = await loadMtnClient(service);
    if (!mtn.config.configured) return { refusal: notConfigured("mtn"), mtn };
    const { data: settings } = await service
      .from("platform_settings")
      .select("mtn_momo_enabled")
      .eq("id", true)
      .maybeSingle();
    if (!mtnMomoRailEnabled(settings)) {
      return {
        refusal: json({ success: false, status: "disabled", error: MTN_MOMO_DISABLED_MESSAGE }),
        mtn,
      };
    }
    return { refusal: null, mtn };
  }
  const airtel = await loadAirtelClient(service);
  if (!airtel.config.configured) return { refusal: notConfigured("airtel"), airtel };
  const { data: settings } = await service
    .from("platform_settings")
    .select("airtel_money_enabled")
    .eq("id", true)
    .maybeSingle();
  if (!airtelMoneyRailEnabled(settings)) {
    return {
      refusal: json({ success: false, status: "disabled", error: AIRTEL_MONEY_DISABLED_MESSAGE }),
      airtel,
    };
  }
  if (!airtel.config.shapesConfirmed) {
    return {
      refusal: json({
        success: false,
        status: "adapter_unconfirmed",
        error: AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
      }),
      airtel,
    };
  }
  return { refusal: null, airtel };
}

function telcoErrorResponse(provider: TelcoProvider, error: unknown): Response | null {
  if (error instanceof MtnMomoNotConfiguredError || error instanceof AirtelMoneyNotConfiguredError) {
    return notConfigured(provider);
  }
  if (error instanceof MtnMomoDisabledError || error instanceof AirtelMoneyDisabledError) {
    return json({
      success: false,
      status: "disabled",
      error: provider === "mtn" ? MTN_MOMO_DISABLED_MESSAGE : AIRTEL_MONEY_DISABLED_MESSAGE,
    });
  }
  if (error instanceof AirtelMoneyAdapterUnconfirmedError) {
    return json({
      success: false,
      status: "adapter_unconfirmed",
      error: AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
    });
  }
  return null;
}

async function loadTelcoPayment(
  service: ServiceClient,
  provider: TelcoProvider,
  reference: string,
): Promise<TelcoPaymentRow | null> {
  const { data } = await service
    .from("mobile_money_payments")
    .select(
      "id, transaction_id, user_id, wallet_id, provider, product, provider_reference, phone_msisdn, amount, currency, status, submission_state, provider_transaction_id",
    )
    .eq("provider", provider)
    .eq("provider_reference", reference)
    .maybeSingle();
  return (data as TelcoPaymentRow | null) ?? null;
}

function telcoRowResponse(row: TelcoPaymentRow) {
  return json(
    telcoPaymentResponse({
      provider: row.provider,
      product: row.product,
      status: row.status,
      transactionId: row.transaction_id,
      reference: row.provider_reference,
    }),
  );
}

/**
 * Re-query the provider for this payment's status and settle the
 * ledger from THAT answer (never from a callback body, never from
 * the initiation response). Returns the freshest payment view; a
 * provider 404 (not yet visible) or unmapped status leaves the row
 * pending and returns it unchanged.
 */
async function refreshTelcoPayment(
  service: ServiceClient,
  row: TelcoPaymentRow,
  clients: { mtn?: MtnMomoClient; airtel?: AirtelMoneyClient },
): Promise<TelcoPaymentRow> {
  let parsed: {
    status: "pending" | "successful" | "failed" | null;
    rawStatus: string | null;
    providerTransactionId: string | null;
    amount: number | null;
    currency: string | null;
    reasonCode: string | null;
    reasonMessage: string | null;
  };
  try {
    if (row.provider === "mtn") {
      if (!clients.mtn) return row;
      const s = await clients.mtn.getStatus(row.product, row.provider_reference);
      parsed = {
        status: s.status,
        rawStatus: s.rawStatus,
        providerTransactionId: s.financialTransactionId,
        amount: s.amount !== null ? Number(s.amount) : null,
        currency: s.currency,
        reasonCode: s.reasonCode,
        reasonMessage: s.reasonMessage,
      };
    } else {
      if (!clients.airtel) return row;
      const idOrRef = row.provider_transaction_id ?? row.provider_reference;
      const s = row.product === "collection"
        ? await clients.airtel.getTransactionStatus(idOrRef)
        : await clients.airtel.getDisbursementStatus(idOrRef);
      parsed = {
        status: s.status,
        rawStatus: s.rawStatus,
        providerTransactionId: s.providerTransactionId,
        amount: s.amount,
        currency: s.currency,
        reasonCode: s.responseCode,
        reasonMessage: null,
      };
    }
  } catch (error) {
    if (
      (error instanceof MtnMomoApiError || error instanceof AirtelMoneyApiError) &&
      error.kind === "not_found"
    ) {
      return row;
    }
    throw error;
  }

  if (parsed.status === null) return row;

  const { error: settleError } = await service.rpc("settle_mobile_money_payment", {
    p_provider: row.provider,
    p_provider_reference: row.provider_reference,
    p_provider_status: parsed.status,
    p_provider_transaction_id: parsed.providerTransactionId,
    p_provider_amount: parsed.amount !== null && Number.isFinite(parsed.amount) ? parsed.amount : null,
    p_provider_currency: parsed.currency,
    p_provider_status_raw: parsed.rawStatus,
    p_reason_code: parsed.reasonCode,
    p_reason_message: parsed.reasonMessage,
  });
  if (settleError) {
    console.error("settle_mobile_money_payment failed:", settleError);
    return row;
  }
  return (await loadTelcoPayment(service, row.provider, row.provider_reference)) ?? row;
}

async function resolveTelcoWallet(
  service: ServiceClient,
  userId: string,
  currency: string,
  walletIdRaw: unknown,
  createIfMissing: boolean,
): Promise<{ wallet: { id: string; currency: string; status: string } } | { refusal: Response }> {
  if (typeof walletIdRaw === "string" && walletIdRaw.length > 0) {
    const { data } = await service
      .from("wallets")
      .select("id, currency, status, user_id")
      .eq("id", walletIdRaw)
      .maybeSingle();
    if (!data) {
      return { refusal: json({ success: false, status: "not_found", error: "That wallet could not be found. No money has moved." }, 400) };
    }
    if (data.user_id !== userId) {
      return { refusal: json({ success: false, status: "forbidden", error: "That wallet does not belong to you. No money has moved." }, 403) };
    }
    if (String(data.currency).toUpperCase() !== currency) {
      return { refusal: json({ success: false, status: "currency_mismatch", error: "That wallet is in a different currency from this payment. No money has moved." }, 400) };
    }
    return { wallet: data };
  }
  const { data } = await service
    .from("wallets")
    .select("id, currency, status")
    .eq("user_id", userId)
    .eq("currency", currency)
    .is("account_id", null)
    .maybeSingle();
  if (data) return { wallet: data };
  if (!createIfMissing) {
    return { refusal: json({ success: false, status: "not_found", error: "No wallet in that currency was found. No money has moved." }, 400) };
  }
  const { data: created, error } = await service
    .from("wallets")
    .insert({ user_id: userId, balance: 0, currency, status: "active" })
    .select("id, currency, status")
    .single();
  if (error || !created) {
    return { refusal: json({ success: false, status: "error", error: "Your wallet couldn't be prepared for this payment. No money has moved." }, 500) };
  }
  return { wallet: created };
}

async function initiateTelcoPayment(
  service: ServiceClient,
  userId: string,
  provider: TelcoProvider,
  product: TelcoProduct,
  requestData: Record<string, unknown>,
): Promise<Response> {
  const gate = await telcoGateRefusal(service, provider);
  if (gate.refusal) return gate.refusal;

  // Airtel disbursement additionally needs the confirmed RSA PIN
  // encryption helper (adapter point): until it exists, payouts
  // refuse BEFORE any ledger row is written.
  if (provider === "airtel" && product === "disbursement") {
    return json({
      success: false,
      status: "adapter_unconfirmed",
      error: AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
    });
  }

  const amtCheck = validateFiatAmount(requestData.amount, 50000);
  if (!amtCheck.ok) {
    return json({ success: false, status: "validation_error", error: amtCheck.error }, 400);
  }
  const amount = Number(requestData.amount);

  const phoneRaw = requestData.phoneNumber ?? requestData.phone ?? requestData.msisdn;
  const msisdn = provider === "mtn"
    ? normaliseMsisdn(typeof phoneRaw === "string" ? phoneRaw : null)
    : normaliseAirtelMsisdn(typeof phoneRaw === "string" ? phoneRaw : null);
  if (!msisdn) {
    return json({
      success: false,
      status: "validation_error",
      error: provider === "mtn" ? MTN_MOMO_INVALID_PHONE_MESSAGE : AIRTEL_MONEY_INVALID_PHONE_MESSAGE,
    }, 400);
  }

  const idempotencyKey = validateTelcoIdempotencyKey(
    requestData.idempotencyKey ?? requestData.idempotency_key,
  );
  if (!idempotencyKey) {
    return json({ success: false, status: "validation_error", error: TELCO_IDEMPOTENCY_REQUIRED_MESSAGE }, 400);
  }

  const currency = provider === "mtn"
    ? mtnMomoSettlementCurrency(gate.mtn!.config)
    : "ZMW";

  const resolved = await resolveTelcoWallet(
    service, userId, currency, requestData.wallet_id, product === "collection",
  );
  if ("refusal" in resolved) return resolved.refusal;

  const providerReference = crypto.randomUUID();
  const { data: beginRows, error: beginError } = await service.rpc("begin_mobile_money_payment", {
    p_user_id: userId,
    p_wallet_id: resolved.wallet.id,
    p_provider: provider,
    p_product: product,
    p_phone_msisdn: msisdn,
    p_amount: amount,
    p_currency: currency,
    p_idempotency_key: idempotencyKey,
    p_provider_reference: providerReference,
  });
  if (beginError) {
    console.error("begin_mobile_money_payment failed:", beginError);
    return json({ success: false, status: "error", error: "This payment couldn't be started. No money has moved." }, 500);
  }
  const begin = Array.isArray(beginRows) ? beginRows[0] : null;
  if (!begin) {
    return json({ success: false, status: "error", error: "This payment couldn't be started. No money has moved." }, 500);
  }
  if (begin.outcome !== "created" && begin.outcome !== "existing") {
    return json(
      { success: false, status: begin.outcome, error: telcoBeginOutcomeMessage(begin.outcome) },
      begin.outcome === "idempotency_conflict" ? 409 : 400,
    );
  }

  let row = await loadTelcoPayment(service, provider, begin.provider_reference);
  if (!row) {
    return json({ success: false, status: "error", error: "This payment couldn't be started. No money has moved." }, 500);
  }
  if (row.status !== "pending") return telcoRowResponse(row);

  const clients = { mtn: gate.mtn?.client, airtel: gate.airtel?.client };

  // A resumed begin (idempotent replay) whose submission already
  // reached the provider: never submit twice — re-query instead.
  if (row.submission_state === "accepted" || row.submission_state === "unknown") {
    try {
      row = await refreshTelcoPayment(service, row, clients);
    } catch (error) {
      const mapped = telcoErrorResponse(provider, error);
      if (mapped) return mapped;
      // Provider unreachable: the payment stays pending, truthfully.
    }
    return telcoRowResponse(row);
  }

  // ── Submit to the provider (ledger row already exists) ──
  try {
    if (provider === "mtn") {
      const client = gate.mtn!.client;
      if (product === "collection") {
        const built = buildMtnMomoRequestToPayBody({
          amount, currency, externalId: row.transaction_id, payerMsisdn: msisdn,
        });
        if (!built.ok) {
          await service.rpc("update_mobile_money_submission", {
            p_provider_reference: row.provider_reference, p_state: "rejected", p_error_kind: "validation",
          });
          row = (await loadTelcoPayment(service, provider, row.provider_reference)) ?? row;
          return telcoRowResponse(row);
        }
        await client.requestToPay(row.provider_reference, built.body);
      } else {
        const built = buildMtnMomoTransferBody({
          amount, currency, externalId: row.transaction_id, payeeMsisdn: msisdn,
        });
        if (!built.ok) {
          await service.rpc("update_mobile_money_submission", {
            p_provider_reference: row.provider_reference, p_state: "rejected", p_error_kind: "validation",
          });
          row = (await loadTelcoPayment(service, provider, row.provider_reference)) ?? row;
          return telcoRowResponse(row);
        }
        await client.transfer(row.provider_reference, built.body);
      }
    } else {
      const client = gate.airtel!.client;
      const built = buildAirtelMoneyCollectionBody({
        amount,
        reference: row.provider_reference,
        transactionId: row.transaction_id,
        payerMsisdn: msisdn,
      });
      if (!built.ok) {
        await service.rpc("update_mobile_money_submission", {
          p_provider_reference: row.provider_reference, p_state: "rejected", p_error_kind: "validation",
        });
        row = (await loadTelcoPayment(service, provider, row.provider_reference)) ?? row;
        return telcoRowResponse(row);
      }
      await client.requestPayment(built.body);
    }
  } catch (error) {
    const mapped = telcoErrorResponse(provider, error);
    if (mapped) return mapped;
    if (error instanceof MtnMomoApiError || error instanceof AirtelMoneyApiError) {
      if (error.kind === "duplicate_reference") {
        // The original submission exists provider-side: mark the
        // outcome unknown and resolve it by re-query, never by
        // minting a second reference.
        await service.rpc("update_mobile_money_submission", {
          p_provider_reference: row.provider_reference, p_state: "unknown", p_error_kind: error.kind,
        });
        try {
          row = await refreshTelcoPayment(service, row, clients);
        } catch { /* stays pending; status action can retry */ }
        return telcoRowResponse(row);
      }
      // A definitive provider refusal before acceptance: fail the
      // row (the RPC refunds a disbursement debit exactly once).
      await service.rpc("update_mobile_money_submission", {
        p_provider_reference: row.provider_reference, p_state: "rejected", p_error_kind: error.kind,
      });
      row = (await loadTelcoPayment(service, provider, row.provider_reference)) ?? row;
      const body = telcoPaymentResponse({
        provider: row.provider, product: row.product, status: row.status,
        transactionId: row.transaction_id, reference: row.provider_reference,
      });
      return json({ ...body, error: telcoProviderFailureMessage(provider, error.kind) });
    }
    // Network-level failure: the provider may or may not hold the
    // request. Mark unknown; the status action resolves by re-query.
    await service.rpc("update_mobile_money_submission", {
      p_provider_reference: row.provider_reference, p_state: "unknown", p_error_kind: "network",
    });
    return telcoRowResponse(row);
  }

  await service.rpc("update_mobile_money_submission", {
    p_provider_reference: row.provider_reference, p_state: "accepted", p_error_kind: null,
  });
  try {
    row = await refreshTelcoPayment(service, row, clients);
  } catch { /* accepted but not yet visible — stays pending */ }
  return telcoRowResponse(row);
}

async function telcoStatusAction(
  service: ServiceClient,
  userId: string,
  provider: TelcoProvider,
  product: TelcoProduct,
  requestData: Record<string, unknown>,
): Promise<Response> {
  const reference = typeof requestData.reference === "string" ? requestData.reference : "";
  if (!reference) {
    return json({ success: false, status: "validation_error", error: TELCO_REFERENCE_REQUIRED_MESSAGE }, 400);
  }
  const gate = await telcoGateRefusal(service, provider);
  if (gate.refusal) return gate.refusal;
  let row = await loadTelcoPayment(service, provider, reference);
  if (!row || row.user_id !== userId || row.product !== product) {
    return json({ success: false, status: "not_found", error: "We couldn't find that payment." }, 404);
  }
  if (row.status === "pending") {
    try {
      row = await refreshTelcoPayment(service, row, {
        mtn: gate.mtn?.client, airtel: gate.airtel?.client,
      });
    } catch (error) {
      const mapped = telcoErrorResponse(provider, error);
      if (mapped) return mapped;
      // Still pending is the truthful answer.
    }
  }
  return telcoRowResponse(row);
}

async function telcoBalanceAction(
  service: ServiceClient,
  userId: string,
  provider: TelcoProvider,
  requestData: Record<string, unknown>,
): Promise<Response> {
  const { data: roleRows } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("admin") && !roles.includes("super_admin")) {
    return json({ success: false, status: "forbidden", error: "Only a platform admin can see the provider account balance." }, 403);
  }
  const gate = await telcoGateRefusal(service, provider);
  if (gate.refusal) return gate.refusal;
  const product: TelcoProduct = requestData.product === "disbursement" ? "disbursement" : "collection";
  try {
    if (provider === "mtn") {
      const balance = await gate.mtn!.client.getBalance(product);
      return json({ success: true, status: "ok", provider, product, balance });
    }
    const balance = await gate.airtel!.client.getBalance();
    return json({ success: true, status: "ok", provider, product, balance });
  } catch (error) {
    const mapped = telcoErrorResponse(provider, error);
    if (mapped) return mapped;
    return json({ success: false, status: "error", error: telcoProviderFailureMessage(provider, "provider") }, 502);
  }
}

async function telcoAccountHolderAction(
  service: ServiceClient,
  provider: TelcoProvider,
  requestData: Record<string, unknown>,
): Promise<Response> {
  const gate = await telcoGateRefusal(service, provider);
  if (gate.refusal) return gate.refusal;
  if (provider === "airtel") {
    // No publicly documented Airtel account-holder check exists;
    // refuse rather than invent one.
    return json({ success: false, status: "adapter_unconfirmed", error: AIRTEL_MONEY_UNCONFIRMED_MESSAGE });
  }
  const phoneRaw = requestData.phoneNumber ?? requestData.phone ?? requestData.msisdn;
  const msisdn = normaliseMsisdn(typeof phoneRaw === "string" ? phoneRaw : null);
  if (!msisdn) {
    return json({ success: false, status: "validation_error", error: MTN_MOMO_INVALID_PHONE_MESSAGE }, 400);
  }
  try {
    const active = await gate.mtn!.client.isAccountHolderActive(msisdn);
    return json({ success: true, status: "ok", provider, active });
  } catch (error) {
    const mapped = telcoErrorResponse(provider, error);
    if (mapped) return mapped;
    if (error instanceof MtnMomoApiError && error.kind === "not_found") {
      return json({ success: true, status: "ok", provider, active: false });
    }
    return json({ success: false, status: "error", error: telcoProviderFailureMessage(provider, "provider") }, 502);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Provider callback receiver. Callbacks are UNAUTHENTICATED hints
 * (MTN documents no signature scheme; Airtel's Zambia rule is not
 * publicly verifiable): the handler identifies the ledger row,
 * records the hint, then settles ONLY from a re-queried provider
 * status. It always answers 200 so providers do not block or storm
 * the endpoint over an unknown reference.
 */
async function handleTelcoCallback(
  requestData: Record<string, unknown>,
  url: URL,
): Promise<Response> {
  const service = getServiceRoleClient();
  const providerRaw = url.searchParams.get("provider") ?? requestData.provider;
  let provider = normalizeTelcoProvider(providerRaw);
  if (!provider || provider === "zamtel") {
    // Infer from the hint shape when the callback URL carried no
    // provider marker: MTN echoes our transaction id as externalId;
    // Airtel's example payload carries transaction_reference.
    const tx = requestData.transaction as Record<string, unknown> | undefined;
    if (typeof requestData.externalId === "string") provider = "mtn";
    else if (tx && typeof tx.transaction_reference === "string") provider = "airtel";
  }
  if (!provider || provider === "zamtel") return json({ received: true, identified: false });

  let hintArgs: Record<string, unknown>;
  if (provider === "mtn") {
    const hint = mtnMomoCallbackHint(requestData);
    hintArgs = {
      p_provider: "mtn",
      p_transaction_id: hint.externalId && UUID_RE.test(hint.externalId) ? hint.externalId : null,
      p_provider_reference: null,
      p_provider_transaction_id: hint.financialTransactionId,
    };
  } else {
    const hint = airtelMoneyCallbackHint(requestData);
    hintArgs = {
      p_provider: "airtel",
      p_transaction_id: null,
      p_provider_reference: hint.providerReference,
      p_provider_transaction_id: hint.providerTransactionId,
    };
  }

  const { data: hintRows } = await service.rpc("record_mobile_money_callback_hint", hintArgs);
  const hintRow = Array.isArray(hintRows) ? hintRows[0] : null;
  if (!hintRow?.payment_id) return json({ received: true, identified: false });
  if (hintRow.payment_status !== "pending") return json({ received: true, identified: true });

  // Re-query + settle when the rail is live; otherwise the hint is
  // recorded and settlement waits for the rail (or a status poll).
  const gate = await telcoGateRefusal(service, provider);
  if (!gate.refusal) {
    const row = await loadTelcoPayment(service, provider, hintRow.provider_reference);
    if (row && row.status === "pending") {
      try {
        await refreshTelcoPayment(service, row, {
          mtn: gate.mtn?.client, airtel: gate.airtel?.client,
        });
      } catch { /* hint recorded; a later poll settles */ }
    }
  }
  return json({ received: true, identified: true });
}

function notConfigured(providerKey: string) {
  const route = classifyProvider(providerKey, {
    paypalConfigured: Boolean(
      Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_CLIENT_SECRET"),
    ),
  });
  // classifyProvider only returns 'paypal' for providerKey 'paypal',
  // which is never routed to this endpoint.
  const message = route.kind === "not_configured"
    ? route.error
    : "This payment method is not handled by this endpoint.";
  return json({ success: false, status: "not_configured", error: message });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST" && req.method !== "PUT") {
      return json({ error: "Method not allowed" }, 405);
    }

    const url = new URL(req.url);
    let requestData: Record<string, unknown> = {};
    try {
      requestData = (await req.json()) as Record<string, unknown>;
    } catch {
      requestData = {};
    }

    // ── Provider callbacks (unauthenticated hints) ──
    // Dispatched BEFORE user auth: MTN documents no callback
    // signature, and Airtel's Zambia rule is unverifiable, so a
    // callback can only identify a payment and trigger a re-query
    // (see handleTelcoCallback). Reachable via ?provider=…&
    // action=callback on the callback URL, an explicit body action,
    // or the unauthenticated provider hint shapes themselves.
    const queryAction = normalizeTelcoAction(url.searchParams.get("action"));
    const bodyAction = normalizeTelcoAction(requestData.action);
    const bodyTx = requestData.transaction as Record<string, unknown> | undefined;
    const looksLikeProviderHint =
      !req.headers.get("Authorization") &&
      (typeof requestData.externalId === "string" ||
        (bodyTx !== undefined && typeof bodyTx.transaction_reference === "string"));
    if (
      req.method === "PUT" ||
      queryAction === "callback" ||
      (bodyAction === "callback" && requestData.paymentMethod === "mobile-money") ||
      looksLikeProviderHint
    ) {
      if (queryAction === "callback" || bodyAction === "callback" || looksLikeProviderHint) {
        return await handleTelcoCallback(requestData, url);
      }
      return json({ error: "Method not allowed" }, 405);
    }

    const supabase = getSupabaseClient(req);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return json({ error: "Unauthorized - Authentication required" }, 401);
    }

    const { paymentMethod } = requestData;

    // ── Admin action: stamp a phone number as confirmed ──
    // Dispatched BEFORE the KYC own-record guard below: by design it
    // acts on ANOTHER user. It is still after authentication, and it
    // additionally requires an admin / super_admin role (checked via
    // a service-role client that does not forward the caller header).
    // Interim mechanism for vetted early users: P2P tier T1 requires
    // auth.users.phone_confirmed_at, which no user flow can write —
    // only the GoTrue admin API stamps it.
    if (paymentMethod === "admin-stamp-phone") {
      const service = getServiceRoleClient();

      const { data: roleRows, error: roleError } = await service
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (roleError) {
        console.error("admin-stamp-phone: role lookup failed:", roleError);
      }
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      if (!hasPhoneStampAdmin(roles)) {
        return json(
          { success: false, error: PHONE_STAMP_FORBIDDEN_MESSAGE, message: PHONE_STAMP_FORBIDDEN_MESSAGE },
          403,
        );
      }

      const target = validatePhoneStampTarget(requestData.userId);
      if (!target.ok) {
        return json({ success: false, error: target.error, message: target.error }, 400);
      }
      const phoneCheck = validatePhoneForStamp(requestData.phone);
      if (!phoneCheck.ok) {
        return json({ success: false, error: phoneCheck.error, message: phoneCheck.error }, 400);
      }

      const { error: stampError } = await service.auth.admin.updateUserById(
        target.userId,
        { phone: phoneCheck.phone, phone_confirm: true },
      );
      if (stampError) {
        console.error("admin-stamp-phone: GoTrue stamp failed:", stampError);
        return json(
          { success: false, error: PHONE_STAMP_FAILED_MESSAGE, message: PHONE_STAMP_FAILED_MESSAGE },
          500,
        );
      }

      // Audit is REQUIRED, not best-effort. Choice (documented per
      // spec): if the audit insert fails we return 500 even though
      // the GoTrue stamp has already happened and cannot be rolled
      // back — the phone IS confirmed at that point, but returning
      // success would silently lose the audit trail for a privileged
      // action. The error tells the admin the audit failed so it can
      // be surfaced / reconciled instead of hidden.
      const { error: auditError } = await service
        .from("audit_logs")
        .insert({
          user_id: user.id,
          action: "admin_phone_stamp",
          table_name: "auth.users",
          record_id: target.userId,
          new_values: { phone: phoneCheck.phone },
        });
      if (auditError) {
        console.error(
          "admin-stamp-phone: AUDIT INSERT FAILED after successful stamp — " +
            "phone was confirmed for target but no audit row was written:",
          auditError,
        );
        return json(
          { success: false, error: PHONE_STAMP_AUDIT_FAILED_MESSAGE, message: PHONE_STAMP_AUDIT_FAILED_MESSAGE },
          500,
        );
      }

      return json({ success: true, message: PHONE_STAMP_SUCCESS_MESSAGE });
    }

    // ── KYC actions (real DB work) ──
    if (paymentMethod === "kyc-verification" || paymentMethod === "check-kyc") {
      const { userId, data } = requestData;
      if (!userId) {
        return json({ error: "User ID is required for KYC actions" }, 400);
      }
      // A caller may only act on their own KYC record.
      if (userId !== user.id) {
        return json({ error: "Forbidden: cannot act on another user's KYC record" }, 403);
      }

      if (paymentMethod === "kyc-verification") {
        try {
          const result = await verifyKyc(supabase, userId, data || {});
          return json(result);
        } catch (error) {
          console.error("KYC verification error:", error);
          // A write that landed on 0 rows is NOT a generic failure:
          // answer with the crafted plain-language message so the
          // user learns nothing was saved (never a silent success).
          if (isKycWriteLostError(error)) {
            return json(
              { success: false, error: KYC_WRITE_LOST_MESSAGE, message: KYC_WRITE_LOST_MESSAGE },
              500,
            );
          }
          return json({ error: "Failed to process KYC verification" }, 500);
        }
      }

      const level = await checkKycLevel(supabase, userId);
      return json({ level });
    }

    // ── Provider actions ──
    if (paymentMethod === "mobile-money") {
      const provider = normalizeTelcoProvider(requestData.provider ?? "mobile_money");
      if (provider === "zamtel") return notConfigured("zamtel");
      if (provider === "mtn" || provider === "airtel") {
        const service = getServiceRoleClient();
        const action = normalizeTelcoAction(requestData.action);
        // Legacy probe (no action): answer with the rail's gate
        // state only — the same truthful answers as before wiring.
        if (!action) {
          const gate = await telcoGateRefusal(service, provider);
          if (gate.refusal) return gate.refusal;
          return json({
            success: false,
            status: "validation_error",
            error: "Choose what you want to do — start a payment, or check a payment's status.",
          }, 400);
        }
        switch (action) {
          case "collection":
            return await initiateTelcoPayment(service, user.id, provider, "collection", requestData);
          case "disbursement":
            return await initiateTelcoPayment(service, user.id, provider, "disbursement", requestData);
          case "collection-status":
            return await telcoStatusAction(service, user.id, provider, "collection", requestData);
          case "disbursement-status":
            return await telcoStatusAction(service, user.id, provider, "disbursement", requestData);
          case "balance":
            return await telcoBalanceAction(service, user.id, provider, requestData);
          case "account-holder":
            return await telcoAccountHolderAction(service, provider, requestData);
          default:
            return json({ success: false, status: "validation_error", error: "That mobile money action isn't supported." }, 400);
        }
      }
      return notConfigured(String(requestData.provider || "mobile_money").toLowerCase());
    }
    if (paymentMethod === "bank-transfer") return notConfigured("bank_transfer");
    if (paymentMethod === "ussd") return notConfigured("ussd");
    if (paymentMethod === "card") return notConfigured("card");
    if (paymentMethod === "wallet-transfer") return notConfigured("wallet");

    return json({ error: "Unsupported payment method" }, 400);
  } catch (error) {
    console.error("Error processing request:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
