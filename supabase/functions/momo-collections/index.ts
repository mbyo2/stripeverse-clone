// momo-collections: a merchant starts and tracks mobile-money
// collections against their OWN connected gateway account.
//
// Actions (merchant JWT):
//   { action: "create", amount, phone, operator?, environment?, idempotency_key? }
//       → ledger-first start (begin RPC → gateway call on the
//         merchant's account). Gates re-checked server-side on every
//         call: business record, Zambia, toggle on, account not
//         frozen, connection present for the environment.
//   { action: "status", reference }
//       → re-queries the gateway and applies the result through the
//         exactly-once settle RPC. Repeats are no-ops.
//
// Settlement credits the merchant's custodial ZMW wallet IN FULL;
// the platform's 1% lives in momo_platform_charges, recorded by the
// settle RPC — it is never deducted here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { countryToIso } from "../_shared/connector-config.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import {
  MOMO_NOT_CONFIGURED_MESSAGE,
  MOMO_NOT_ENABLED_MESSAGE,
  detectOperator,
  generateCollectionReference,
  isValidZmPhone,
  type MomoEnvironment,
  type MomoOperator,
} from "../_shared/momo-rail.ts";
import {
  loadConnection,
  refreshCollectionFromRail,
  startCollection,
} from "../_shared/momo-rail-server.ts";
import { isAccountFrozen, ACCOUNT_FROZEN_MESSAGE } from "../_shared/account-freeze.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) {
      return json({ success: false, error: "Sign in to take mobile money payments." }, 401);
    }
    const userId = user.id;
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "status") {
      const reference = typeof body.reference === "string" ? body.reference : "";
      if (!reference) return json({ success: false, error: "reference is required." }, 400);
      const { data: row } = await db
        .from("momo_collections")
        .select("id, user_id, failure_reason")
        .eq("reference", reference)
        .maybeSingle();
      if (!row || row.user_id !== userId) {
        return json({ success: false, error: "That payment wasn't found." }, 404);
      }
      const outcome = await refreshCollectionFromRail(db, reference);
      const { data: fresh } = await db
        .from("momo_collections")
        .select("failure_reason")
        .eq("reference", reference)
        .maybeSingle();
      return json({
        success: true,
        reference,
        status: outcome.collection_status,
        wallet_balance: outcome.wallet_balance,
        failure_reason: outcome.collection_status === "failed" ? (fresh?.failure_reason ?? null) : null,
      });
    }

    if (action === "create") {
      if (await isAccountFrozen(db, userId)) {
        return json({ success: false, error: ACCOUNT_FROZEN_MESSAGE }, 403);
      }
      const { data: merchant } = await db
        .from("merchant_accounts")
        .select("address, mobile_money_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      if (!merchant) {
        return json({ success: false, status: "not_configured", error: "Set up your business profile first — mobile money connects to your business." }, 400);
      }
      // deno-lint-ignore no-explicit-any
      if (countryToIso((merchant.address as any)?.country) !== "ZM") {
        return json({ success: false, status: "not_entitled", error: "Mobile money is available to businesses registered in Zambia." }, 403);
      }
      if (!merchant.mobile_money_enabled) {
        return json({ success: false, status: "not_configured", error: MOMO_NOT_ENABLED_MESSAGE }, 400);
      }
      const amtCheck = validateFiatAmount(body.amount);
      if (!amtCheck.ok) return json({ success: false, error: amtCheck.error }, 400);
      const phone = typeof body.phone === "string" ? body.phone : "";
      if (!isValidZmPhone(phone)) {
        return json({ success: false, error: "Enter a valid Zambian mobile money number, like 0977123456." }, 400);
      }
      const detected = detectOperator(phone);
      const operator: MomoOperator | null =
        body.operator === "mtn" || body.operator === "airtel" || body.operator === "zamtel"
          ? body.operator
          : detected;
      if (!operator) {
        return json({ success: false, error: "That phone number doesn't look like an MTN, Airtel or Zamtel number." }, 400);
      }
      const environment: MomoEnvironment = body.environment === "sandbox" ? "sandbox" : "production";
      const conn = await loadConnection(db, userId, environment);
      if (!conn) {
        return json({ success: false, status: "not_configured", error: MOMO_NOT_CONFIGURED_MESSAGE }, 400);
      }
      const reference = generateCollectionReference();
      const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.length >= 8
        ? body.idempotency_key
        : `direct:${reference}`;
      const result = await startCollection(db, conn, {
        merchantUserId: userId,
        accountId: null,
        amount: amtCheck.amount,
        phone,
        operator,
        environment,
        source: "direct",
        paymentLinkId: null,
        idempotencyKey,
        reference,
      });
      if (result.kind === "conflict") {
        return json({ success: false, status: "conflict", error: result.message }, 409);
      }
      if (result.kind === "start_failed") {
        return json({ success: false, status: "failed", reference: result.reference, error: result.message }, 400);
      }
      return json({
        success: true,
        reference: result.reference,
        collection_id: result.collectionId,
        transaction_id: result.transactionId,
        status: result.status,
        environment,
        message: result.message,
      });
    }

    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.error("momo-collections failed:", e instanceof Error ? e.message : e);
    return json({ success: false, error: "Something went wrong taking that payment. Please try again." }, 500);
  }
});
