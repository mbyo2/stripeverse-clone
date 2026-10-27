// mobile-money-callback: the PUBLIC provider callback receiver for
// the direct telco rails (MTN MoMo + Airtel Money).
//
// Why a separate function: `mobile-money` keeps verify_jwt = true
// (it serves authenticated KYC / admin actions), and the Supabase
// gateway rejects unauthenticated requests before they reach it —
// but real provider callbacks arrive with NO Authorization header
// (MTN documents no callback signature scheme at all; Airtel's
// Zambia rule is not publicly verifiable). So this function is
// verify_jwt = false (config.toml), like paypal-webhook.
//
// Security posture: because callbacks are unauthenticated hints,
// this handler can NEVER settle from the callback body. It only:
//   1. identifies the ledger row (record_mobile_money_callback_hint
//      — increments the hint counter, changes no status, moves no
//      money), then
//   2. when the rail is live, re-queries the provider's status API
//      and settles through settle_mobile_money_payment with THAT
//      answer.
// A forged callback can therefore trigger, at most, a status
// re-query of a payment the platform already knows about. It
// always answers 200 so providers neither block the endpoint nor
// storm it over an unknown reference.
//
// Callback URLs to register with the providers (secrets
// MTN_MOMO_CALLBACK_URL / AIRTEL_CALLBACK_URL):
//   https://<project>.supabase.co/functions/v1/mobile-money-callback?provider=mtn
//   https://<project>.supabase.co/functions/v1/mobile-money-callback?provider=airtel

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  mtnMomoCallbackHint,
  mtnMomoConfig,
  mtnMomoRailEnabled,
} from "../_shared/mtn-momo.ts";
import { createMtnMomoClient } from "../_shared/mtn-momo-server.ts";
import {
  airtelMoneyCallbackHint,
  airtelMoneyConfig,
  airtelMoneyRailEnabled,
} from "../_shared/airtel-money.ts";
import { createAirtelMoneyClient } from "../_shared/airtel-money-server.ts";
import { normalizeTelcoProvider } from "../_shared/telco-payments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  let provider = normalizeTelcoProvider(url.searchParams.get("provider") ?? body.provider);
  if (!provider || provider === "zamtel") {
    const tx = body.transaction as Record<string, unknown> | undefined;
    if (typeof body.externalId === "string") provider = "mtn";
    else if (tx && typeof tx.transaction_reference === "string") provider = "airtel";
  }
  if (!provider || provider === "zamtel") return json({ received: true, identified: false });

  let hintArgs: Record<string, unknown>;
  if (provider === "mtn") {
    const hint = mtnMomoCallbackHint(body);
    hintArgs = {
      p_provider: "mtn",
      p_transaction_id: hint.externalId && UUID_RE.test(hint.externalId) ? hint.externalId : null,
      p_provider_reference: null,
      p_provider_transaction_id: hint.financialTransactionId,
    };
  } else {
    const hint = airtelMoneyCallbackHint(body);
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

  // Re-query + settle — only when the rail is fully live (secrets
  // present AND kill switch ON AND, for Airtel, adapter confirmed).
  try {
    const { data: row } = await service
      .from("mobile_money_payments")
      .select("provider, product, provider_reference, provider_transaction_id, status")
      .eq("id", hintRow.payment_id)
      .maybeSingle();
    if (!row || row.status !== "pending") return json({ received: true, identified: true });

    let parsed: {
      status: "pending" | "successful" | "failed" | null;
      rawStatus: string | null;
      providerTransactionId: string | null;
      amount: number | null;
      currency: string | null;
      reasonCode: string | null;
      reasonMessage: string | null;
    } | null = null;

    if (provider === "mtn") {
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
      if (!mtnMomoConfig(values).configured || !values.railEnabled) {
        return json({ received: true, identified: true });
      }
      const client = createMtnMomoClient(values);
      const s = await client.getStatus(row.product, row.provider_reference);
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
      const config = airtelMoneyConfig(values);
      if (!config.ready || !values.railEnabled) {
        return json({ received: true, identified: true });
      }
      const client = createAirtelMoneyClient(values);
      const idOrRef = row.provider_transaction_id ?? row.provider_reference;
      const s = row.product === "collection"
        ? await client.getTransactionStatus(idOrRef)
        : await client.getDisbursementStatus(idOrRef);
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

    if (parsed && parsed.status !== null) {
      await service.rpc("settle_mobile_money_payment", {
        p_provider: provider,
        p_provider_reference: row.provider_reference,
        p_provider_status: parsed.status,
        p_provider_transaction_id: parsed.providerTransactionId,
        p_provider_amount: parsed.amount !== null && Number.isFinite(parsed.amount) ? parsed.amount : null,
        p_provider_currency: parsed.currency,
        p_provider_status_raw: parsed.rawStatus,
        p_reason_code: parsed.reasonCode,
        p_reason_message: parsed.reasonMessage,
      });
    }
  } catch (error) {
    // A failed re-query never fails the callback: the hint is
    // recorded and a later status poll settles the payment.
    console.error("mobile-money-callback re-query failed:", error);
  }

  return json({ received: true, identified: true });
});
