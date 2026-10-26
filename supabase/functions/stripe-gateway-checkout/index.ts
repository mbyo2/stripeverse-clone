// stripe-gateway-checkout: start a Stripe Checkout wallet top-up.
//
// The gateway-expansion rail (brief §3): a customer pays IN by card
// through Stripe-hosted Checkout to top up their BMaGlass wallet. It
// mirrors the proven PayPal deposit initiation in `wallet-deposit`:
//
//   - The caller names the target (a wallet, or a currency within an
//     account scope); the wallet must belong to the caller and be
//     active; only that wallet can ever be credited.
//   - A PENDING ledger row is recorded FIRST (transactions,
//     payment_method 'stripe', metadata.kind 'wallet_deposit'). Its
//     uuid_id is the ledger id: it becomes the Checkout Session's
//     client_reference_id and the create call's Idempotency-Key, so
//     a retried create returns the same session.
//   - The amount is validated SERVER-SIDE against the rail's
//     per-currency guard (validateStripeTopUp) — the browser's
//     number is a request, never an instruction.
//   - Nothing is credited here: the wallet is credited only when the
//     stripe-gateway-webhook settles a verified 'paid' session via
//     complete_stripe_wallet_deposit.
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Role: admin / super_admin only (canUseStripeGateway). The rail
//      is 'Coming soon' publicly — everyone else gets a plain
//      refusal here and never sees the option in the app either.
//   3. Kill switch: platform_settings.stripe_gateway_enabled must
//      read exactly true (stripeGatewayKillSwitchEnabled — the same
//      decision the admin status reports, so a missing settings row
//      reads as disabled in both places; audit fix D6). The column
//      defaults to true, but the rail is dark until the secret below
//      exists, and role-gated besides.
//   4. Configuration: STRIPE_GATEWAY_SECRET_KEY must hold a Stripe
//      secret/restricted key (sk_/rk_, test or live). Absent or
//      malformed → truthful `not_configured`, no rows written. The
//      subscription feature's STRIPE_SECRET_KEY is NEVER read here.
//
// Currency: the wallet's own currency is attempted (ZMW included —
// see the evidence note in _shared/stripe-gateway.ts). If Stripe
// rejects the currency, the top-up is REFUSED honestly and the
// ledger row is closed as failed: the user may start a USD top-up
// and type a dollar amount themselves, but an amount is only ever
// charged in the currency and value the user entered. There is NO
// automatic fallback charge in another currency — the previous
// same-amount USD fallback was removed by audit fix D1 (2026-10-26):
// it re-ran checkout with the UNCHANGED numeric amount against the
// USD wallet, so a K10,000 ZMW top-up would have become a $10,000
// USD charge.
//
// Input:  { amount, currency?, wallet_id?, account_id? }
// Output: { success, status, transaction_id?, session_id?, url?,
//           charge_currency?, target_currency?, mode?, message?,
//           error? }
// `success: true` means only "a Checkout Session exists" — the
// deposit itself completes in the webhook, never here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  buildCheckoutSessionParams,
  canUseStripeGateway,
  isStripeCurrencyRejection,
  resolveStripeReturnOrigin,
  stripeGatewayConfig,
  stripeGatewayKillSwitchEnabled,
  validateStripeTopUp,
} from "../_shared/stripe-gateway.ts";
import { createStripeCheckoutSession } from "../_shared/stripe-gateway-server.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-GATEWAY-CHECKOUT] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface WalletRow {
  id: string;
  currency: string;
  status: string;
  user_id: string;
  account_id: string | null;
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

    // ── 2. Role gate (superadmin-only rail) ──
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) throw new Error(`Role lookup failed: ${roleError.message}`);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    if (!canUseStripeGateway(roles)) {
      return json({
        success: false,
        status: "forbidden",
        error: "Card top-ups by Stripe are not available on your account yet.",
      }, 403);
    }

    // ── 3. Kill switch (explicit-true semantics, audit fix D6) ──
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("stripe_gateway_enabled")
      .eq("id", true)
      .maybeSingle();
    if (!stripeGatewayKillSwitchEnabled(settings?.stripe_gateway_enabled)) {
      return json({
        success: false,
        status: "not_configured",
        error: "Card top-ups are switched off right now. No money has moved.",
      }, 503);
    }

    // ── 4. Configuration ──
    const secretKey = Deno.env.get("STRIPE_GATEWAY_SECRET_KEY") ?? null;
    const config = stripeGatewayConfig(secretKey);
    if (!config.configured || !secretKey) {
      logStep("Stripe gateway not configured");
      return json({
        success: false,
        status: "not_configured",
        error: "Card payments aren't switched on yet — Stripe is still being connected. No money has moved.",
      });
    }

    const body = await req.json().catch(() => ({}));
    // FIX-1: whole minor units only — a 3dp amount would charge a
    // different value in cents than the wallet is credited.
    const amtCheck = validateFiatAmount(body.amount);
    if (!amtCheck.ok) {
      return json({ success: false, status: "invalid", error: amtCheck.error }, 400);
    }
    const amount = amtCheck.amount;
    const requestedCurrency = body.currency ? String(body.currency).toUpperCase() : null;

    // ── Resolve the ONE target wallet ──
    let wallet: WalletRow | null = null;

    if (body.wallet_id) {
      const { data, error } = await supabase
        .from("wallets")
        .select("id, currency, status, user_id, account_id")
        .eq("id", String(body.wallet_id))
        .maybeSingle();
      if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
      if (!data) {
        return json({ success: false, status: "not_found", error: "Target wallet not found." }, 404);
      }
      if (data.user_id !== user.id) {
        return json({ success: false, status: "forbidden", error: "Target wallet does not belong to you." }, 403);
      }
      wallet = data as WalletRow;
      if (requestedCurrency && requestedCurrency !== wallet.currency) {
        return json({
          success: false,
          status: "invalid",
          error: `Currency ${requestedCurrency} does not match the target wallet's currency ${wallet.currency}.`,
        }, 400);
      }
    } else {
      // Deterministic scope: the named account (must be the caller's
      // own, not closed) or Main (account_id IS NULL).
      let accountId: string | null = null;
      if (body.account_id) {
        const { data: account, error: accountError } = await supabase
          .from("accounts")
          .select("id, user_id, status")
          .eq("id", String(body.account_id))
          .maybeSingle();
        if (accountError) throw new Error(`Account lookup failed: ${accountError.message}`);
        if (!account || account.user_id !== user.id) {
          return json({ success: false, status: "forbidden", error: "Target account does not belong to you." }, 403);
        }
        if (account.status === "closed") {
          return json({ success: false, status: "invalid", error: "Target account is closed." }, 400);
        }
        accountId = account.id;
      }
      const currency = requestedCurrency || "ZMW";
      wallet = await getOrCreateWallet(supabase, user.id, currency, accountId);
    }

    if (!wallet) {
      return json({ success: false, status: "failed", error: "Target wallet could not be resolved." }, 500);
    }
    if (wallet.status !== "active") {
      return json({ success: false, status: "invalid", error: "Target wallet is not active." }, 400);
    }

    // ── Server-side price guard ──
    const validation = validateStripeTopUp(amount, wallet.currency);
    if (!validation.ok) {
      const messages: Record<string, string> = {
        unsupported_currency: `Card top-ups are not available for ${wallet.currency} wallets yet.`,
        invalid_amount: "Enter an amount greater than zero.",
        below_minimum: "That amount is below the minimum for a card top-up in this currency.",
        above_maximum: "That amount is above the maximum for a single card top-up. Try a smaller amount.",
      };
      return json({
        success: false,
        status: "invalid",
        error: messages[validation.reason] ?? "That top-up can't be started.",
      }, 400);
    }

    // ── Record the PENDING ledger row (the ledger id leads) ──
    const requestedLedgerId = crypto.randomUUID();
    const { data: inserted, error: insertError } = await supabase
      .from("transactions")
      .insert({
        uuid_id: requestedLedgerId,
        user_id: user.id,
        wallet_id: wallet.id,
        amount,
        currency: wallet.currency,
        direction: "incoming",
        status: "pending",
        payment_method: "stripe",
        provider: "stripe",
        description: "Wallet deposit via Stripe (awaiting confirmation)",
        category: "deposit",
        metadata: {
          kind: "wallet_deposit",
          wallet_id: wallet.id,
          gateway: "stripe",
          requested_currency: requestedCurrency ?? wallet.currency,
          charge_currency: wallet.currency,
          stripe_mode: config.mode,
          account_id: wallet.account_id,
        },
      })
      .select("uuid_id")
      .single();
    if (insertError) throw new Error(`Failed to record deposit: ${insertError.message}`);
    // The row's uuid_id is the ledger id Stripe will carry. We asked
    // for requestedLedgerId; if the database generated its own, the
    // returned value is the truth and leads from here.
    const ledgerId = (inserted?.uuid_id as string | undefined) ?? requestedLedgerId;

    // Return URLs are built ONLY from an allowlisted origin (audit
    // fixes D9/D10): the raw Origin header is attacker-influenceable
    // and must never decide where Stripe sends a payer after payment.
    const origin = resolveStripeReturnOrigin(req.headers.get("origin"), config.mode);
    const successUrl = `${origin}/wallet?stripe_return=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/wallet?stripe_return=cancelled`;

    // ── Create the session — ONE attempt, in the wallet's own
    // currency, for the amount the user typed. No second attempt in
    // another currency ever follows (audit fix D1). ──
    const form = buildCheckoutSessionParams({
      ledgerId,
      userId: user.id,
      amount,
      currency: wallet.currency,
      successUrl,
      cancelUrl,
      customerEmail: user.email ?? null,
    });
    const result = await createStripeCheckoutSession(secretKey, form, ledgerId);

    if (!result.ok || !result.data?.id || !result.data.url) {
      // No session: close the ledger row as failed so it never sits
      // pending pretending money might arrive, and answer plainly.
      // A currency rejection gets the truthful, actionable refusal;
      // detection uses documented error fields only and drives no
      // money decision (audit fixes D1 + D4).
      const currencyRejected = isStripeCurrencyRejection(result.error);
      await supabase
        .from("transactions")
        .update({
          status: "failed",
          metadata: {
            kind: "wallet_deposit",
            wallet_id: wallet.id,
            gateway: "stripe",
            requested_currency: requestedCurrency ?? wallet.currency,
            charge_currency: wallet.currency,
            stripe_mode: config.mode,
            account_id: wallet.account_id,
            failure: currencyRejected ? "currency_rejected" : "session_create_failed",
            stripe_error_type: result.error?.type ?? null,
            stripe_error_code: result.error?.code ?? null,
          },
        })
        .eq("uuid_id", ledgerId);
      logStep("Session creation failed", {
        ledgerId,
        status: result.status,
        currencyRejected,
      });
      if (currencyRejected) {
        return json({
          success: false,
          status: "unsupported_currency",
          error:
            `Stripe doesn't accept ${wallet.currency} charges on this account yet, so this top-up can't start. No money was charged. ` +
            "To top up in US dollars instead, start a new top-up, choose your USD wallet and enter the dollar amount yourself — an amount is never converted or charged in another currency automatically.",
        }, 400);
      }
      return json({
        success: false,
        status: "failed",
        error: "Stripe could not start this top-up. No money was charged — please try again.",
      }, 502);
    }

    const session = result.data;
    const { error: refError } = await supabase
      .from("transactions")
      .update({
        reference: session.id,
        external_reference: session.id,
        metadata: {
          kind: "wallet_deposit",
          wallet_id: wallet.id,
          gateway: "stripe",
          requested_currency: requestedCurrency ?? wallet.currency,
          charge_currency: wallet.currency,
          stripe_mode: config.mode,
          account_id: wallet.account_id,
          stripe_session_id: session.id,
        },
      })
      .eq("uuid_id", ledgerId);
    if (refError) {
      // Not fatal: the webhook settles by client_reference_id and
      // back-fills the reference (see findStripeDepositTransaction).
      logStep("Reference write-back failed (webhook will back-fill)", { ledgerId });
    }

    logStep("Checkout session created", {
      ledgerId,
      sessionId: session.id,
      chargeCurrency: wallet.currency,
      mode: config.mode,
    });

    return json({
      success: true,
      status: "pending",
      transaction_id: ledgerId,
      session_id: session.id,
      url: session.url,
      charge_currency: wallet.currency,
      target_currency: wallet.currency,
      mode: config.mode,
      message:
        "Top-up started with Stripe. Your wallet is credited only after Stripe confirms the payment — no money has moved yet.",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in stripe-gateway-checkout", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong starting this top-up. No money has moved — please try again.",
    }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** The caller's wallet for (currency, account scope), created if missing. */
async function getOrCreateWallet(
  supabase: AdminClient,
  userId: string,
  currency: string,
  accountId: string | null,
): Promise<WalletRow | null> {
  let query = supabase
    .from("wallets")
    .select("id, currency, status, user_id, account_id")
    .eq("user_id", userId)
    .eq("currency", currency);
  query = accountId === null ? query.is("account_id", null) : query.eq("account_id", accountId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
  if (data) return data as WalletRow;
  const { data: created, error: createError } = await supabase
    .from("wallets")
    .insert({ user_id: userId, account_id: accountId, balance: 0, currency, status: "active" })
    .select("id, currency, status, user_id, account_id")
    .single();
  if (createError) throw new Error(`Failed to create wallet: ${createError.message}`);
  return created as WalletRow;
}
