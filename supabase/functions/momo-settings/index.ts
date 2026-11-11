// momo-settings: a merchant manages their own mobile-money gateway
// connection. The merchant pastes THEIR OWN gateway API keys; the
// platform encrypts them at rest (AES-256-GCM envelope, key in an
// edge-function secret — _shared/secret-vault.ts), uses them only to
// run that merchant's collections, and NEVER returns a saved key:
// the UI is write-only and shows a last-4 hint.
//
// Actions (merchant JWT):
//   { action: "status" }
//       → business gate facts, per-environment connection summaries,
//         recent collections, the separate 1% platform charges, and
//         the indicative USD/ZMW display rate (display only).
//   { action: "connect", environment, secret_key, public_key?, account_id? }
//       → Zambia-gated server-side (the same merchant_accounts source
//         of truth as the connector config), the credential is
//         validated against the gateway before it is stored.
//   { action: "disconnect", environment }
//       → wipes the stored credential and marks the row disconnected.
//
// WHITE-LABEL: no user-facing string here names the underlying rail.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { countryToIso } from "../_shared/connector-config.ts";
import { encryptSecret, secretHint, secretVaultKeyFromEnv } from "../_shared/secret-vault.ts";
import {
  connectionSummary,
  loadConnectionSummary,
  validateRailCredential,
} from "../_shared/momo-rail-server.ts";
import type { MomoEnvironment } from "../_shared/momo-rail.ts";

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
      return json({ success: false, error: "Sign in to manage your mobile money connection." }, 401);
    }
    const userId = user.id;
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "status";

    const { data: merchant } = await db
      .from("merchant_accounts")
      .select("business_name, address, status, mobile_money_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: profile } = await db
      .from("profiles")
      .select("is_frozen")
      .eq("id", userId)
      .maybeSingle();
    // deno-lint-ignore no-explicit-any
    const countryIso = countryToIso((merchant?.address as any)?.country);
    const facts = {
      has_business: !!merchant,
      country: countryIso,
      zambia: countryIso === "ZM",
      toggle_on: !!merchant?.mobile_money_enabled,
      frozen: !!profile?.is_frozen,
    };

    if (action === "status") {
      const [sandboxConn, productionConn] = await Promise.all([
        loadConnectionSummary(db, userId, "sandbox").catch(() => null),
        loadConnectionSummary(db, userId, "production").catch(() => null),
      ]);
      const { data: collections } = await db
        .from("momo_collections")
        .select("id, reference, amount, currency, operator, phone, status, source, environment, failure_reason, created_at, settled_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      const { data: charges } = await db
        .from("momo_platform_charges")
        .select("id, collection_id, amount, currency, percent, description, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      const { data: chargesTotal } = await db
        .from("momo_platform_charges")
        .select("amount")
        .eq("user_id", userId);
      // Indicative FX for display only — never used in settlement
      // math (collections are ZMW-native end to end).
      const { data: rateRow } = await db
        .from("exchange_rates")
        .select("rate, valid_until")
        .eq("from_currency", "USD")
        .eq("to_currency", "ZMW")
        .gt("valid_until", new Date().toISOString())
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({
        success: true,
        facts,
        connections: {
          sandbox: connectionSummary(sandboxConn),
          production: connectionSummary(productionConn),
        },
        collections: collections ?? [],
        charges: charges ?? [],
        charges_total_zmw: (chargesTotal ?? []).reduce((s, r) => s + Number(r.amount || 0), 0),
        fx_display: rateRow ? { pair: "USD/ZMW", rate: Number(rateRow.rate), valid_until: rateRow.valid_until } : null,
      });
    }

    if (action === "connect") {
      if (facts.frozen) {
        return json({ success: false, error: "This account is frozen, so it can't connect payment methods right now. Please contact support." }, 403);
      }
      if (!facts.has_business) {
        return json({ success: false, error: "Set up your business profile first — mobile money connects to your business." }, 400);
      }
      if (!facts.zambia) {
        return json({ success: false, error: "Mobile money is available to businesses registered in Zambia. Your business country isn't Zambia, so it can't be connected." }, 403);
      }
      const environment: MomoEnvironment = body.environment === "sandbox" ? "sandbox" : "production";
      const secretKey = typeof body.secret_key === "string" ? body.secret_key.trim() : "";
      if (secretKey.length < 16) {
        return json({ success: false, error: "Paste your mobile money API secret key — it looks too short to be a real key." }, 400);
      }
      const vaultKey = secretVaultKeyFromEnv();
      if (!vaultKey) {
        return json({ success: false, error: "Mobile money connections are temporarily unavailable. Please try again later." }, 503);
      }
      // Validate against the gateway BEFORE storing: a key that the
      // gateway itself refuses is never saved.
      let probe: { ok: boolean; accountId: string | null };
      try {
        probe = await validateRailCredential(secretKey, environment);
      } catch {
        return json({ success: false, error: "We couldn't reach the mobile money gateway to check that key. Please try again in a moment." }, 502);
      }
      if (!probe.ok) {
        return json({ success: false, error: "That API key wasn't accepted by the mobile money gateway. Check you pasted the full secret key for the right environment (sandbox keys only work in the sandbox)." }, 400);
      }
      const envelope = await encryptSecret(secretKey, vaultKey);
      const accountId = typeof body.account_id === "string" && body.account_id.trim()
        ? body.account_id.trim()
        : probe.accountId;
      const { error: upsertError } = await db
        .from("merchant_momo_connections")
        .upsert({
          user_id: userId,
          environment,
          secret_key_ciphertext: envelope.ciphertext,
          secret_key_iv: envelope.iv,
          vault_key_version: envelope.keyVersion,
          public_key: typeof body.public_key === "string" && body.public_key.trim() ? body.public_key.trim() : null,
          account_id: accountId,
          key_hint: secretHint(secretKey),
          status: "connected",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,environment" });
      if (upsertError) throw new Error(upsertError.message);
      const saved = await loadConnectionSummary(db, userId, environment);
      return json({ success: true, connection: connectionSummary(saved), environment });
    }

    if (action === "disconnect") {
      const environment: MomoEnvironment = body.environment === "sandbox" ? "sandbox" : "production";
      const { error } = await db
        .from("merchant_momo_connections")
        .update({
          status: "disconnected",
          secret_key_ciphertext: "",
          secret_key_iv: "",
          public_key: null,
          account_id: null,
          key_hint: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("environment", environment);
      if (error) throw new Error(error.message);
      return json({ success: true, environment });
    }

    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.error("momo-settings failed:", e instanceof Error ? e.message : e);
    return json({ success: false, error: "Something went wrong managing your mobile money connection. Please try again." }, 500);
  }
});
