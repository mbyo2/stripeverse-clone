// payment-link-checkout: settlement entry point for public payment
// links (the /pay/:code page). Phase 1.5 — see
// migrations/20261021_checkout_settlement_phase1_5.sql.
//
// Before this function existed, PublicCheckout invoked the mock
// `process-payment`, which required the *payer* to be signed in and
// settled against the *caller's* wallet via .single() — so link income
// never reached the link owner, and multi-wallet users hard-failed.
//
// What happens now:
//   - The link names a settlement account (payment_links.account_id,
//     NULL = Main). On a successful payment the OWNER's wallet for that
//     account and the link currency is credited — by
//     execute_payment_link_settlement, executed here with a dedicated
//     service-role client. The caller's JWT is never forwarded into the
//     money path: the protect_wallet_balance trigger silently
//     neutralizes balance UPDATEs made under a user session.
//   - Paying from a BMaGlass wallet balance requires the payer to be
//     signed in; the RPC debits their Main wallet and credits the owner
//     atomically, with ledger rows on both sides and idempotency.
//   - Card / mobile money / bank for links have no live gateway behind
//     them today, so they return a truthful 'not_configured' state
//     (see _shared/payment-providers.ts). A guest does NOT need a
//     BMaGlass account for those methods in principle — the day a real
//     gateway is connected, its completion path credits the owner via
//     the same RPC with p_payer_user_id NULL (credit-only leg).
//
// Actions:
//   { action: "describe", link_code }
//       → { success, settlement_account_name, link } — lets the public
//         page render the link (title/amount/currency) AND show where
//         the money settles. The page loads the link from HERE, not
//         from a direct payment_links select: table RLS gives anon a
//         public read but authenticated non-owners no read, so any
//         signed-in third party — exactly who wallet payment is for —
//         got "link not found" from the table while guests saw it
//         fine. Accounts are owner-only under RLS, so the settlement
//         name is also served from here, service-role side.
//       → link carries only what the checkout page displays:
//         { id, title, description, amount, currency, status,
//           user_id, account_id }. user_id lets the page keep its
//         client-side "you cannot pay your own link" pre-check; the
//         pay action re-checks it server-side regardless.
//   { link_code, payment_method, amount?, idempotency_key, email? }
//       → wallet settlement or a truthful not_configured refusal.
//         A successful settlement also dispatches the developer
//         webhook event payment_link.paid (exactly once per
//         settlement, via _shared/developer-webhooks.ts).
//
// Fee-bearer (2026-10-26): a link's stored fee_payer ('seller' |
// 'buyer') decides who funds the platform fee. It was resolved when
// the link was created (per-link choice > merchant account default >
// 'seller') and is enforced by the settlement RPC — this function
// never lets a caller change it at pay time. describe returns the
// resolved choice plus the computed amounts (via the shared
// _shared/fee-math.ts, the same rule the RPC charges) so the pay
// page can show a buyer the full breakdown BEFORE they pay:
// price + fee = total when the buyer bears the fee.
//   { action: "btc_create_attempt", link_code, amount? }
//       → "Pay with Bitcoin" for guests: creates a payment attempt
//         with a locked quote, a fresh per-attempt on-chain address
//         and (when the Lightning provider is configured) a Lightning
//         invoice for the required sats. No account needed — the
//         payer pays from whatever Bitcoin wallet they already use.
//         The attempt snapshots the link's stored fee_payer; the
//         sat-level fee math lives in _shared/link-btc.ts.
//   { action: "btc_status", link_code, attempt_id }
//       → the payer-facing attempt state; polling it drives the lazy
//         transitions (Lightning receipt check, settlement at full
//         coverage + payment_link.paid dispatch, expiry close-out).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyLinkMethod } from "../_shared/payment-providers.ts";
import { dispatchPaymentLinkPaid } from "../_shared/developer-webhooks.ts";
import { linkFeeRateForMethod, paymentLinkAmounts, type FeePayer } from "../_shared/fee-math.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import {
  LINK_BTC_ATTEMPT_WINDOW_MINUTES,
  btcLinkBelowMinimum,
  classifyLightningReceipt,
  linkBtcDisplayState,
  quoteLinkBtc,
  type LinkBtcDisplayState,
} from "../_shared/link-btc.ts";
import {
  fetchBtcUsdPrices,
  fetchSnapshotQuoteRates,
  fetchUsdZmwFallback,
  PRICE_DIVERGENCE_LIMIT,
  type QuoteRates,
} from "../_shared/price-index.ts";
import {
  decodeBolt11Msat,
  deriveAddress,
  receiveStatus,
} from "../_shared/btc-core.ts";
import {
  lightningProviderConfigured,
  providerCreateInvoice,
  providerGetInvoice,
} from "../_shared/lightning-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Dedicated service-role client — deliberately NOT the shared
    // request-scoped one: that forwards the caller's Authorization
    // header, which would put auth.uid() back in scope for the RPC and
    // trip the balance-protection trigger (internal-transfer's lesson).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json();
    const linkCode = typeof body.link_code === "string" ? body.link_code.trim() : "";
    if (!linkCode) {
      return json({ success: false, status: "invalid", error: "link_code is required" }, 400);
    }

    const { data: link, error: linkError } = await admin
      .from("payment_links")
      .select("id, user_id, title, description, amount, currency, status, account_id, fee_payer, expires_at, max_payments, payment_count, redirect_url")
      .eq("link_code", linkCode)
      .maybeSingle();

    if (linkError) throw new Error(linkError.message);
    if (!link || link.status !== "active") {
      return json({ success: false, status: "not_found", error: "Payment link not found or no longer active" }, 404);
    }

    const feePayer: FeePayer = link.fee_payer === "buyer" ? "buyer" : "seller";

    // ── describe: the public link payload + where its money settles ──
    if (body.action === "describe") {
      // Link-state honesty: an expired or payment-limit-reached link
      // is NOT payable, and the guest page must learn that HERE —
      // before it renders the pay form — not after entering an
      // amount and attempting payment. (The settlement RPC and the
      // BTC attempt path already refuse both states server-side;
      // this surfaces the same truth at describe time, in the same
      // words, so the page renders its "not payable" state.)
      if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
        return json(
          { success: false, status: "expired", error: "This payment link has expired." },
          410,
        );
      }
      if (
        link.max_payments != null &&
        Number(link.payment_count ?? 0) >= Number(link.max_payments)
      ) {
        return json(
          {
            success: false,
            status: "limit_reached",
            error: "This payment link has reached its payment limit.",
          },
          410,
        );
      }
      let settlementAccountName = "Main account";
      if (link.account_id) {
        const { data: account } = await admin
          .from("accounts")
          .select("name")
          .eq("id", link.account_id)
          .maybeSingle();
        if (account?.name) settlementAccountName = account.name;
      }
      // The fee picture for the link's fixed price, computed with
      // the same rule the settlement charges (shared fee-math). The
      // computed amounts are null on any-amount links (no fixed
      // price yet): the pay page then computes the breakdown live
      // from fee_payer + fee_rate_percent.
      const { data: settingsRow } = await admin
        .from("platform_settings")
        .select("split_platform_fee_percent, paypal_platform_fee_percent")
        .eq("id", true)
        .maybeSingle();
      const feeRate = settingsRow?.split_platform_fee_percent ?? null;
      // The PayPal rail rate (1% — CEO decision 2026-10-28),
      // resolved with the same per-rail rule the settlement RPC
      // charges, so a PayPal fee picture never quotes the
      // wallet/Bitcoin link rate.
      const paypalFeeRate = linkFeeRateForMethod("paypal", settingsRow);
      const fixed = link.amount == null || feeRate === null
        ? null
        : paymentLinkAmounts(Number(link.amount), String(feeRate), feePayer);
      return json({
        success: true,
        settlement_account_name: settlementAccountName,
        // "Pay with Bitcoin" availability, so the page can offer the
        // method honestly: on-chain needs only the account zpub
        // (watch-only); Lightning additionally needs its provider.
        bitcoin_available: receiveStatus(Deno.env.get("BTC_XPUB")).configured,
        lightning_available: lightningProviderConfigured(),
        link: {
          id: link.id,
          title: link.title,
          description: link.description ?? null,
          amount: link.amount != null ? Number(link.amount) : null,
          currency: link.currency,
          status: link.status,
          user_id: link.user_id,
          account_id: link.account_id,
          fee_payer: feePayer,
          fee_rate_percent: feeRate === null ? null : Number(feeRate),
          paypal_fee_rate_percent: paypalFeeRate,
          fee_amount: fixed?.fee_amount ?? null,
          buyer_total: fixed?.buyer_total ?? null,
          seller_receives: fixed?.seller_receives ?? null,
          // Return context for shop checkouts: when the link carries
          // a return URL, the page offers "Return to store" after a
          // completed payment (wallet and Bitcoin alike).
          redirect_url: link.redirect_url ?? null,
        },
      });
    }

    // ── Pay with Bitcoin (guest, any external wallet) ──
    if (body.action === "btc_create_attempt") {
      return await btcCreateAttempt(admin, link, body);
    }
    if (body.action === "btc_status") {
      return await btcStatus(admin, link, body);
    }

    // ── pay ──
    const route = classifyLinkMethod(String(body.payment_method || ""));
    if (route.kind === "not_configured") {
      // Truthful refusal: nothing is charged and nothing settles.
      return json({ success: false, status: "not_configured", error: route.error });
    }

    // Wallet payment: the payer must be signed in. The Authorization
    // header carries the anon key for guests — getUser rejects it.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return json({
        success: false,
        status: "unauthorized",
        error: "Sign in with your BMaGlass account to pay from your wallet balance.",
      }, 401);
    }
    if (user.id === link.user_id) {
      return json({
        success: false,
        status: "invalid",
        error: "You cannot pay your own payment link.",
      }, 400);
    }

    // ── Freeze guard: a frozen account cannot pay from its wallet ──
    if (await isAccountFrozen(admin, user.id)) {
      return json({
        success: false,
        status: "account_frozen",
        error: ACCOUNT_FROZEN_MESSAGE,
      }, 403);
    }

    // FIX-1: whole-ngwee only — a custom 10.001 is refused, never rounded.
    const amtCheck = validateFiatAmount(
      link.amount != null ? link.amount : body.amount,
    );
    if (!amtCheck.ok) {
      return json({ success: false, status: "invalid", error: amtCheck.error }, 400);
    }
    const amount = amtCheck.amount;
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    if (idempotencyKey.length < 8) {
      return json({ success: false, status: "invalid", error: "A valid idempotency_key is required" }, 400);
    }

    const { data, error } = await admin.rpc("execute_payment_link_settlement", {
      p_link_id: link.id,
      p_payer_user_id: user.id,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
      p_payment_method: "wallet",
      p_description: `Payment link: ${link.title}`,
    });
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;

    // ── Developer webhook: payment_link.paid ──────────────────────
    // The settlement above is the ONLY path that marks a payment link
    // paid today (every other link method answers not_configured; the
    // gateway credit-leg, when one is connected, must dispatch through
    // this same helper). Dispatch is exactly-once per settlement —
    // anchored to the owner-side transaction id, which an idempotent
    // replay of this payment returns unchanged — and best-effort: the
    // money has already moved, so a webhook failure must never fail
    // the payer's response. The claim + dispatch live in
    // _shared/developer-webhooks.ts, the same machinery (subscriptions,
    // HMAC-SHA256 signing, delivery log) the developer API uses.
    try {
      const { data: settledLink } = await admin
        .from("payment_links")
        .select("id, link_code, title, user_id, payment_count, total_collected, metadata")
        .eq("id", link.id)
        .maybeSingle();
      if (settledLink && row.owner_transaction_id) {
        await dispatchPaymentLinkPaid(admin, settledLink, {
          ownerTransactionId: row.owner_transaction_id,
          payerTransactionId: row.transaction_id ?? null,
          amount,
          currency: link.currency,
          paymentMethod: "wallet",
          // The settlement's own fee truth (the RPC reports what it
          // did, including on an idempotent replay) — never a guess
          // at this layer.
          feePayer: row.fee_payer ?? feePayer,
          feeAmount: row.fee_amount != null ? Number(row.fee_amount) : 0,
          totalCharged: row.total_charged != null ? Number(row.total_charged) : amount,
          settledAt: new Date().toISOString(),
        });
      }
    } catch (whErr) {
      console.error("payment_link.paid dispatch failed (settlement unaffected):", whErr);
    }

    return json({
      success: true,
      status: "completed",
      transaction_id: row.transaction_id,
      owner_transaction_id: row.owner_transaction_id,
      payer_new_balance: row.payer_new_balance != null ? Number(row.payer_new_balance) : null,
      fee_payer: row.fee_payer ?? feePayer,
      fee_amount: row.fee_amount != null ? Number(row.fee_amount) : null,
      total_charged: row.total_charged != null ? Number(row.total_charged) : amount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Payment could not be processed";
    return json({ success: false, status: "error", error: message }, 400);
  }
});

// ── Pay with Bitcoin ──────────────────────────────────────────────────
//
// An attempt is created per payer visit: a locked quote (rate from the
// platform price index — snapshot first, live cross-check fallback),
// a FRESH on-chain address derived for this attempt alone, and a
// Lightning invoice when the provider is configured. Incoming sats
// are matched by the deposit-detection cron (on-chain, via
// btc_record_link_attempt_deposit) and by status polls (Lightning,
// via providerGetInvoice); settlement runs through
// execute_payment_link_btc_settlement and dispatches
// payment_link.paid through the same claim machinery as wallet
// settlements.

// deno-lint-ignore no-explicit-any
type Admin = any;

const BTC_NOT_CONFIGURED =
  "Bitcoin payment is not available for this link right now. Please choose another payment method.";
const BTC_PRICE_UNAVAILABLE =
  "Bitcoin pricing is unavailable right now. Please try again in a few minutes.";
const BTC_LINK_CURRENCY_UNSUPPORTED =
  "Bitcoin payment is available for links priced in ZMW or USD.";

/** The link's fee bearer, snapshotted onto the attempt at creation.
 *  payment_links.fee_payer is the RESOLVED choice (per-link >
 *  merchant account default in bmaglasspay.online > platform
 *  'seller', resolved when the link was created by the fee-bearer
 *  feature) — the attempt honours it exactly: buyer → the quote
 *  carries the fee on top; seller → the fee leaves the proceeds. */

/** Locked rates for a quote: the fresh on-platform snapshot first
 *  (the same source the rest of the platform prices from), else a
 *  live Coinbase/Kraken cross-check that refuses on divergence —
 *  a rate is never invented. */
async function resolveRates(admin: Admin): Promise<QuoteRates> {
  const snapshot = await fetchSnapshotQuoteRates(admin);
  if (snapshot) return snapshot;
  const { coinbaseUsd, krakenUsd } = await fetchBtcUsdPrices();
  if (Math.abs(coinbaseUsd - krakenUsd) / coinbaseUsd > PRICE_DIVERGENCE_LIMIT) {
    throw new Error("Bitcoin price sources diverge — refusing to quote");
  }
  let usdZmw: number | null = null;
  try {
    const { data: rateRow } = await admin.from("exchange_rates").select("rate")
      .eq("from_currency", "USD").eq("to_currency", "ZMW")
      .gt("valid_until", new Date().toISOString())
      .order("valid_from", { ascending: false }).limit(1).maybeSingle();
    usdZmw = Number(rateRow?.rate) || null;
  } catch { /* fall through to the public fallback */ }
  if (!usdZmw) usdZmw = await fetchUsdZmwFallback();
  return { btcUsd: coinbaseUsd, usdZmw };
}

async function btcCreateAttempt(admin: Admin, link: Admin, body: Admin) {
  const receive = receiveStatus(Deno.env.get("BTC_XPUB"));
  if (!receive.configured) {
    return json({ success: false, status: "not_configured", error: BTC_NOT_CONFIGURED }, 503);
  }
  const currency = String(link.currency || "").toUpperCase();
  if (currency !== "ZMW" && currency !== "USD") {
    return json({ success: false, status: "invalid", error: BTC_LINK_CURRENCY_UNSUPPORTED }, 400);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return json({ success: false, status: "invalid", error: "This payment link has expired." }, 400);
  }
  if (link.max_payments != null && Number(link.payment_count ?? 0) >= Number(link.max_payments)) {
    return json({ success: false, status: "invalid", error: "This payment link has already been paid." }, 400);
  }

  const amtCheck = validateFiatAmount(link.amount != null ? link.amount : body.amount);
  if (!amtCheck.ok) {
    return json({ success: false, status: "invalid", error: amtCheck.error }, 400);
  }
  const fiatAmount = amtCheck.amount;

  // Platform fee percent (same setting the fiat settlement reads),
  // plus the minimum Bitcoin link amount (protection P2a): below it a
  // Bitcoin attempt leaves a pooled UTXO worth less than its future
  // spend cost, so attempts are refused server-side here — the
  // wallet payment for small links is untouched.
  let feePercent = 2.5;
  let btcMinAmount = 5;
  try {
    const { data: settings } = await admin
      .from("platform_settings").select("split_platform_fee_percent, btc_link_min_amount").limit(1).maybeSingle();
    const configured = Number(settings?.split_platform_fee_percent);
    if (Number.isFinite(configured) && configured >= 0) feePercent = configured;
    const configuredMin = Number(settings?.btc_link_min_amount);
    if (Number.isFinite(configuredMin) && configuredMin >= 0) btcMinAmount = configuredMin;
  } catch { /* defaults stand */ }

  if (btcLinkBelowMinimum(fiatAmount, btcMinAmount)) {
    return json({
      success: false,
      status: "below_minimum",
      error: `Bitcoin payments start at ${currency} ${btcMinAmount.toFixed(2)} — for smaller amounts, pay with the BMaGlass wallet instead.`,
    }, 400);
  }

  let rates: QuoteRates;
  try {
    rates = await resolveRates(admin);
  } catch (e) {
    console.error("btc_create_attempt: pricing unavailable:", e);
    return json({ success: false, status: "unavailable", error: BTC_PRICE_UNAVAILABLE }, 503);
  }
  const rateFiatPerBtc = currency === "ZMW"
    ? Math.round(rates.btcUsd * rates.usdZmw * 100) / 100
    : Math.round(rates.btcUsd * 100) / 100;

  const feePayer: "seller" | "buyer" = link.fee_payer === "buyer" ? "buyer" : "seller";
  const quote = quoteLinkBtc({ fiatAmount, rateFiatPerBtc, feePercent, feePayer });
  const expiresAt = new Date(Date.now() + LINK_BTC_ATTEMPT_WINDOW_MINUTES * 60_000);

  const { data: attempt, error: insErr } = await admin
    .from("payment_link_btc_attempts")
    .insert({
      link_id: link.id,
      merchant_user_id: link.user_id,
      fiat_amount: fiatAmount,
      fiat_currency: currency,
      fee_payer: feePayer,
      fee_percent: feePercent,
      fee_fiat: quote.feeFiat,
      rate_fiat_per_btc: rateFiatPerBtc,
      amount_sats: quote.amountSats,
      fee_sats: quote.feeSats,
      required_sats: quote.requiredSats,
      expires_at: expiresAt.toISOString(),
    })
    .select("*")
    .single();
  if (insErr) throw insErr;

  // Fresh on-chain address for THIS attempt (same sequence as user
  // deposit addresses — indices can never collide across the two).
  let address: string | null = null;
  for (let i = 0; i < 8 && !address; i++) {
    const { data: idx, error: seqErr } = await admin.rpc("btc_next_derivation_index");
    if (seqErr) throw seqErr;
    const index = Number(idx);
    const derived = deriveAddress(receive.accountPub, 0, index);
    const { error: addrErr } = await admin
      .from("btc_link_attempt_addresses")
      .insert({ attempt_id: attempt.id, derivation_index: index, address: derived });
    if (!addrErr) {
      address = derived;
      await admin.from("payment_link_btc_attempts")
        .update({ onchain_address: derived, derivation_index: index })
        .eq("id", attempt.id);
    } else if (addrErr.code !== "23505") {
      throw addrErr;
    }
  }
  if (!address) throw new Error("Could not allocate a Bitcoin address for this payment");

  // Lightning leg: best-effort. An unconfigured or unreachable
  // provider never blocks the on-chain leg — the page shows the
  // honest unavailable note for Lightning instead.
  let bolt11: string | null = null;
  if (lightningProviderConfigured()) {
    try {
      const invoice = await providerCreateInvoice(
        quote.requiredSats,
        `Payment link: ${link.title}`,
      );
      const msat = decodeBolt11Msat(invoice.bolt11);
      if (msat !== null && msat === BigInt(quote.requiredSats) * 1000n) {
        bolt11 = invoice.bolt11;
        await admin.from("payment_link_btc_attempts")
          .update({
            lightning_invoice: invoice.bolt11,
            lightning_provider_id: invoice.providerId,
            lightning_payment_hash: invoice.paymentHash,
          })
          .eq("id", attempt.id);
      } else {
        console.error("btc_create_attempt: provider invoice amount mismatch — Lightning leg skipped");
      }
    } catch (e) {
      console.error("btc_create_attempt: Lightning invoice failed — on-chain only:", e);
    }
  }

  return json({
    success: true,
    attempt: attemptView({ ...attempt, onchain_address: address, lightning_invoice: bolt11 }),
  });
}

/** The payer-facing attempt payload (status endpoint + creation). */
function attemptView(attempt: Admin) {
  const expiresAt = attempt.expires_at as string;
  const state: LinkBtcDisplayState = linkBtcDisplayState({
    status: attempt.status,
    seenSats: Number(attempt.seen_sats ?? 0),
    receivedSats: Number(attempt.received_sats ?? 0),
    requiredSats: Number(attempt.required_sats ?? 0),
    expiresAt,
  });
  return {
    id: attempt.id,
    state,
    status: attempt.status,
    fiat_amount: Number(attempt.fiat_amount),
    fiat_currency: attempt.fiat_currency,
    fee_payer: attempt.fee_payer,
    amount_sats: Number(attempt.amount_sats),
    fee_sats: Number(attempt.fee_sats),
    required_sats: Number(attempt.required_sats),
    seen_sats: Number(attempt.seen_sats ?? 0),
    received_sats: Number(attempt.received_sats ?? 0),
    provider_deduction_sats: Number(attempt.provider_deduction_sats ?? 0),
    remaining_sats: Math.max(0, Number(attempt.required_sats) - Number(attempt.received_sats ?? 0)),
    rate_fiat_per_btc: Number(attempt.rate_fiat_per_btc),
    onchain_address: attempt.onchain_address ?? null,
    lightning_invoice: attempt.lightning_invoice ?? null,
    expires_at: expiresAt,
    settled_at: attempt.settled_at ?? null,
    failure_reason: attempt.failure_reason ?? null,
  };
}

async function loadAttempt(admin: Admin, attemptId: string) {
  const { data } = await admin
    .from("payment_link_btc_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  return data;
}

/** Settle a fully-covered attempt + dispatch payment_link.paid.
 *  Shared by the status endpoint and returns the fresh attempt row.
 *  The settlement RPC and the dispatch claim are both idempotent —
 *  racing callers (page poll vs detection cron) cannot double-pay
 *  or double-dispatch. */
async function settleAttemptIfCovered(admin: Admin, attempt: Admin) {
  if (attempt.status === "settled" || attempt.status === "partial_credited" || attempt.status === "failed") {
    return attempt;
  }
  // Coverage: the full required sats, or the required sats minus a
  // provider deduction the record RPC already validated against the
  // band (protection P1) — the settlement RPC enforces the same rule.
  const coverageFloor = Number(attempt.required_sats) - Number(attempt.provider_deduction_sats ?? 0);
  if (Number(attempt.received_sats) < coverageFloor) return attempt;

  const chainCredited = Number(attempt.received_sats) - Number(attempt.lightning_received_sats ?? 0);
  const method = Number(attempt.lightning_received_sats ?? 0) > 0 && chainCredited < Number(attempt.required_sats)
    ? "bitcoin_lightning"
    : "bitcoin_onchain";

  const { data, error } = await admin.rpc("execute_payment_link_btc_settlement", {
    p_attempt_id: attempt.id,
    p_payment_method: method,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;

  if (row?.owner_transaction_id) {
    try {
      const { data: settledLink } = await admin
        .from("payment_links")
        .select("id, link_code, title, user_id, payment_count, total_collected, metadata")
        .eq("id", attempt.link_id)
        .maybeSingle();
      if (settledLink) {
        await dispatchPaymentLinkPaid(admin, settledLink, {
          ownerTransactionId: row.owner_transaction_id,
          payerTransactionId: null,
          amount: Number(attempt.fiat_amount),
          currency: attempt.fiat_currency,
          paymentMethod: method,
          // The attempt's locked fee truth (snapshotted at creation
          // from the link's stored fee_payer): the fiat fee, and what
          // the buyer actually paid in fiat terms at the locked
          // quote — price alone (seller bore the fee) or price + fee
          // (buyer bore it, in sats).
          feePayer: attempt.fee_payer,
          feeAmount: Number(attempt.fee_fiat),
          totalCharged: attempt.fee_payer === "buyer"
            ? Number(attempt.fiat_amount) + Number(attempt.fee_fiat)
            : Number(attempt.fiat_amount),
          settledAt: new Date().toISOString(),
        });
      }
    } catch (whErr) {
      console.error("payment_link.paid dispatch failed (BTC settlement unaffected):", whErr);
    }
  }
  return (await loadAttempt(admin, attempt.id)) ?? attempt;
}

async function btcStatus(admin: Admin, link: Admin, body: Admin) {
  const attemptId = typeof body.attempt_id === "string" ? body.attempt_id : "";
  if (!attemptId) {
    return json({ success: false, status: "invalid", error: "attempt_id is required" }, 400);
  }
  let attempt = await loadAttempt(admin, attemptId);
  if (!attempt || attempt.link_id !== link.id) {
    return json({ success: false, status: "not_found", error: "Payment attempt not found" }, 404);
  }

  const open = attempt.status !== "settled" && attempt.status !== "partial_credited" && attempt.status !== "failed";

  // Lightning receipt check (only while the leg is unpaid). The
  // provider reports what ACTUALLY arrived for the fixed-amount
  // invoice; protection P1 classifies it: full or within the
  // provider-deduction band → record the actual amount and settle on
  // it; below the band → a genuine underpayment, NOT recorded (the
  // attempt keeps its top-up behaviour, exactly as before).
  if (open && attempt.lightning_provider_id && Number(attempt.lightning_received_sats ?? 0) === 0) {
    try {
      const { state, receivedSats } = await providerGetInvoice(attempt.lightning_provider_id);
      const requiredSats = Number(attempt.required_sats);
      let recordSats: number | null = null;
      if (receivedSats !== null && Number.isInteger(receivedSats)) {
        const cls = classifyLightningReceipt(requiredSats, receivedSats);
        if (cls === "full" || cls === "absorbed") recordSats = receivedSats;
      } else if (state === "paid") {
        // Payload carried no received figure: fall back to the
        // pre-P1 full-paid signal and record the invoice amount.
        recordSats = requiredSats;
      }
      if (recordSats !== null) {
        const { error: recErr } = await admin.rpc("btc_record_link_attempt_lightning", {
          p_attempt_id: attempt.id,
          p_received_sats: recordSats,
        });
        if (recErr) throw recErr;
        attempt = (await loadAttempt(admin, attempt.id)) ?? attempt;
      }
    } catch (e) {
      console.error("btc_status: Lightning status check failed:", e);
    }
  }

  // Settlement at full coverage (either leg).
  attempt = await settleAttemptIfCovered(admin, attempt);

  // Expiry close-out (plain expiry / partial credit) once the
  // window has closed and settlement did not apply.
  if (
    attempt.status !== "settled" && attempt.status !== "partial_credited" && attempt.status !== "failed" &&
    new Date(attempt.expires_at).getTime() <= Date.now()
  ) {
    try {
      await admin.rpc("finalize_payment_link_btc_partial", { p_attempt_id: attempt.id });
      attempt = (await loadAttempt(admin, attempt.id)) ?? attempt;
    } catch (e) {
      console.error("btc_status: close-out failed:", e);
    }
  }

  return json({ success: true, attempt: attemptView(attempt) });
}
