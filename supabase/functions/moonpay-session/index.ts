// moonpay-session: start a MoonPay card purchase of Bitcoin.
//
// The customer pays by card inside MoonPay's hosted widget and
// MoonPay sends the BTC to the user's OWN platform deposit address
// (the btc_address_assignments address btc-onchain issues). The
// existing deposit-detection pipeline credits the wallet when the
// deposit lands — nothing is credited here, and webhooks never
// credit either; moonpay_transactions is the tracking layer.
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Freeze guard (assertAccountNotFrozen — the shared money
//      choke-point, exactly as the other money functions use it):
//      a frozen account gets the crafted 403, an unverifiable
//      status the crafted 503, before anything is written.
//   3. Configuration: MOONPAY_PUBLISHABLE_KEY + MOONPAY_SECRET_KEY
//      must exist → truthful `not_configured`, NO row written.
//   3b. Key-environment match (audit M-4): a publishable/secret
//      pair whose prefixes declare different environments
//      (pk_live_ with sk_test_) can never work — refused as
//      `misconfigured`, NO row written, and reported by
//      moonpay-admin so the bad pair is fixed in Supabase, not
//      discovered from MoonPay-side failures.
//   4. Kill switch: platform_settings.moonpay_enabled = false (the
//      DEFAULT) → crafted "coming soon", NO row written.
//
// Then: the fiat is validated server-side (default USD; ZMW refused
// plainly — MoonPay has no kwacha; USD / EUR / GBP only; a positive
// WHOLE amount when given — MoonPay's baseCurrencyAmount is a
// positive integer per its current docs, gap closure 2026-10-27),
// the caller's IP is bound into the signed URL as allowedIpAddress
// (MoonPay IP matching, mandatory for going live — the IP is
// derived server-side from the request headers and canonicalised
// per MoonPay's rules; in production a session whose IP cannot be
// derived refuses rather than minting an unbound live URL), the
// caller's BTC deposit address is got-or-assigned via the EXISTING
// btc-onchain mechanism
// (btc_address_assignments + btc_next_derivation_index +
// deriveAddress from the account zpub — no second derivation), one
// 'initiated' tracking row is written with a fresh
// external_reference, and the signed widget URL is returned.
//
// Output: { success, url, external_reference, deposit_address,
//           environment } on success; crafted { success: false,
//           status, error } refusals otherwise.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  ACCOUNT_STATUS_UNVERIFIED_MESSAGE,
  assertAccountNotFrozen,
} from "../_shared/account-freeze.ts";
import { deriveAddress, receiveStatus } from "../_shared/btc-core.ts";
import {
  buildSignedMoonpayBuyUrl,
  computeMoonpayAllowedIpAddress,
  extractMoonpayClientIp,
  moonpayAmountRejection,
  moonpayConfig,
  MOONPAY_COMING_SOON_MESSAGE,
  MOONPAY_INVALID_AMOUNT_MESSAGE,
  MOONPAY_IP_UNVERIFIED_MESSAGE,
  MOONPAY_MISCONFIGURED_MESSAGE,
  MOONPAY_NOT_CONFIGURED_MESSAGE,
  MOONPAY_UNSUPPORTED_CURRENCY_MESSAGE,
  MOONPAY_WHOLE_AMOUNT_MESSAGE,
  MOONPAY_ZMW_MESSAGE,
} from "../_shared/moonpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[MOONPAY-SESSION] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPPORTED_FIAT = ["USD", "EUR", "GBP"] as const;

/**
 * Get-or-assign the caller's BTC deposit address — the EXACT
 * btc-onchain `receive` mechanism: the existing
 * btc_address_assignments row when one exists, otherwise allocate
 * (index, address) from the btc_next_derivation_index sequence and
 * deriveAddress(account, 0, index), retrying on unique collisions.
 * Returns null when receiving is not configured (no parseable zpub).
 */
// deno-lint-ignore no-explicit-any
async function getOrAssignDepositAddress(admin: any, userId: string): Promise<string | null> {
  const r = receiveStatus(Deno.env.get("BTC_XPUB"));
  if (!r.configured) {
    console.error("moonpay-session: receiving not configured (" + r.reason + ")");
    return null;
  }
  const account = r.accountPub;

  const { data: existing } = await admin
    .from("btc_address_assignments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing.address as string;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: idx, error: seqErr } = await admin.rpc("btc_next_derivation_index");
    if (seqErr) throw seqErr;
    const index = Number(idx);
    const address = deriveAddress(account, 0, index);

    const { data: row, error: insErr } = await admin
      .from("btc_address_assignments")
      .insert({ user_id: userId, derivation_index: index, address })
      .select()
      .single();

    if (!insErr && row) return row.address as string;
    if (insErr?.code === "23505") {
      const { data: mine } = await admin
        .from("btc_address_assignments")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (mine) return mine.address as string;
      continue;
    }
    throw insErr;
  }
  throw new Error("Could not allocate a deposit address");
}

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

    // ── 2. Freeze guard ──
    try {
      await assertAccountNotFrozen(supabase, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === ACCOUNT_FROZEN_MESSAGE) {
        return json({ success: false, status: "frozen", error: msg }, 403);
      }
      return json({ success: false, status: "unverified", error: ACCOUNT_STATUS_UNVERIFIED_MESSAGE }, 503);
    }

    // ── 3. Configuration (before any row is written) ──
    const config = moonpayConfig({
      publishableKey: Deno.env.get("MOONPAY_PUBLISHABLE_KEY") ?? null,
      secretKey: Deno.env.get("MOONPAY_SECRET_KEY") ?? null,
      webhookKey: Deno.env.get("MOONPAY_WEBHOOK_KEY") ?? null,
    });
    if (!config.configured) {
      logStep("MoonPay not configured");
      return json({ success: false, status: "not_configured", error: MOONPAY_NOT_CONFIGURED_MESSAGE });
    }

    // ── 3b. Key-environment mismatch (audit M-4) ──
    if (config.keyEnvironmentMismatch) {
      console.error(
        "moonpay-session: publishable/secret key environment mismatch — refusing session",
      );
      return json({ success: false, status: "misconfigured", error: MOONPAY_MISCONFIGURED_MESSAGE }, 503);
    }

    // ── 4. Kill switch ──
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("moonpay_enabled")
      .eq("id", true)
      .maybeSingle();
    if (!settings || settings.moonpay_enabled !== true) {
      return json({ success: false, status: "coming_soon", error: MOONPAY_COMING_SOON_MESSAGE });
    }

    const body = await req.json().catch(() => ({}));

    // ── Fiat validation (server-side; the browser's values are a
    // request, never an instruction) ──
    const fiatCurrencyRaw = typeof body.fiatCurrency === "string"
      ? body.fiatCurrency.trim().toUpperCase()
      : typeof body.fiat_currency === "string"
        ? body.fiat_currency.trim().toUpperCase()
        : "USD";
    if (!/^[A-Z]{3}$/.test(fiatCurrencyRaw)) {
      return json({ success: false, status: "invalid", error: MOONPAY_UNSUPPORTED_CURRENCY_MESSAGE }, 400);
    }
    if (fiatCurrencyRaw === "ZMW") {
      return json({ success: false, status: "invalid", error: MOONPAY_ZMW_MESSAGE }, 400);
    }
    if (!(SUPPORTED_FIAT as readonly string[]).includes(fiatCurrencyRaw)) {
      return json({ success: false, status: "invalid", error: MOONPAY_UNSUPPORTED_CURRENCY_MESSAGE }, 400);
    }
    const fiatCurrency = fiatCurrencyRaw;

    let fiatAmount: number | null = null;
    const rawAmount = body.fiatAmount ?? body.fiat_amount;
    if (rawAmount !== undefined && rawAmount !== null) {
      const n = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
      const rejection = moonpayAmountRejection(n);
      if (rejection === "invalid") {
        return json({ success: false, status: "invalid", error: MOONPAY_INVALID_AMOUNT_MESSAGE }, 400);
      }
      if (rejection === "fractional") {
        // Never silently rounded: the customer pays the amount they
        // entered, or a whole amount they choose — not our rounding.
        return json({ success: false, status: "invalid", error: MOONPAY_WHOLE_AMOUNT_MESSAGE }, 400);
      }
      fiatAmount = n;
    }

    // ── IP matching (gap closure 2026-10-27, P0): bind the signed
    // URL to this caller's IP. Derived HERE, from the very request
    // that mints the URL (MoonPay: a stale capture is a mismatch
    // cause), canonicalised per MoonPay's rules. Sandbox URLs carry
    // it too — sandbox enforces IP matching by default, so this is
    // exercised end to end before production. In PRODUCTION an
    // underivable IP refuses the session (no row is written): a
    // live URL without the binding would be blocked by MoonPay the
    // moment it enforces, and minting it anyway would quietly drop
    // the protection the parameter exists for.
    const clientIp = extractMoonpayClientIp(req.headers);
    let allowedIpAddress: string | null = null;
    if (clientIp && config.secretKey) {
      allowedIpAddress = await computeMoonpayAllowedIpAddress(clientIp, config.secretKey);
    } else if (config.environment === "production") {
      logStep("Client IP could not be derived — refusing production session");
      return json({ success: false, status: "ip_unverified", error: MOONPAY_IP_UNVERIFIED_MESSAGE }, 503);
    } else {
      logStep("Client IP could not be derived — sandbox session minted without IP binding");
    }

    // ── The caller's own BTC deposit address (existing mechanism) ──
    const depositAddress = await getOrAssignDepositAddress(supabase, user.id);
    if (!depositAddress) {
      return json({
        success: false,
        status: "not_configured",
        error: "Bitcoin deposits are not available yet — Bitcoin custody is not configured on this deployment. No money has moved.",
      }, 503);
    }

    // ── Record the tracking row FIRST (the reference leads) ──
    const externalReference = crypto.randomUUID();
    const { error: insertError } = await supabase
      .from("moonpay_transactions")
      .insert({
        user_id: user.id,
        external_reference: externalReference,
        deposit_address: depositAddress,
        fiat_currency: fiatCurrency,
        fiat_amount: fiatAmount,
        crypto_currency: "BTC",
        status: "initiated",
        environment: config.environment,
        source: "session",
      });
    if (insertError) throw new Error(`Failed to record MoonPay purchase: ${insertError.message}`);

    // ── Build the signed widget URL ──
    const origin = req.headers.get("origin") ?? "https://bmaglasspay.online";
    const url = await buildSignedMoonpayBuyUrl(config, {
      walletAddress: depositAddress,
      email: user.email ?? null,
      externalTransactionId: externalReference,
      externalCustomerId: user.id,
      baseCurrencyCode: fiatCurrency,
      baseCurrencyAmount: fiatAmount,
      redirectUrl: `${origin}/bitcoin`,
      allowedIpAddress,
    });

    logStep("MoonPay session created", {
      externalReference,
      environment: config.environment,
      fiatCurrency,
    });

    return json({
      success: true,
      status: "initiated",
      url,
      external_reference: externalReference,
      deposit_address: depositAddress,
      environment: config.environment,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in moonpay-session", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong starting this purchase. No money has moved — please try again.",
    }, 500);
  }
});
