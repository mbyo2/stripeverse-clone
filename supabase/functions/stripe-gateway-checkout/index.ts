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
//   3. Kill switch: platform_settings.stripe_gateway_enabled = false
//      disables the rail instantly (default true; the rail is dark
//      until the secret below exists, and role-gated besides).
//   4. Configuration: STRIPE_GATEWAY_SECRET_KEY must hold a Stripe
//      secret/restricted key (sk_/rk_, test or live). Absent or
//      malformed → truthful `not_configured`, no rows written. The
//      subscription feature's STRIPE_SECRET_KEY is NEVER read here.
//
// Currency: the wallet's own currency is attempted first (ZMW
// included — see the evidence note in _shared/stripe-gateway.ts). If
// Stripe rejects the currency, the SAME amount is charged in USD to
// the caller's USD wallet in the same account scope (the PayPal
// precedent: PayPal cannot take ZMW, so that rail is USD-only), the
// fallback is recorded on the ledger row, and the response reports
// it. Nothing about the fallback is silent.
//
// Input:  { amount, currency?, wallet_id?, account_id? }
// Output: { success, status, transaction_id?, session_id?, url?,
//           charge_currency?, target_currency?, fallback_applied?,
//           mode?, message?, error? }
// `success: true` means only "a Checkout Session exists" — the
// deposit itself completes in the webhook, never here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  buildCheckoutSessionParams,
  canUseStripeGateway,
  isStripeCurrencyRejection,
  stripeGatewayConfig,
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

    // ── 3. Kill switch ──
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("stripe_gateway_enabled")
      .eq("id", true)
      .maybeSingle();
    if (settings && settings.stripe_gateway_enabled === false) {
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
          fallback_applied: false,
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

    const origin = req.headers.get("origin") ?? "https://bmaglasspay.online";
    const successUrl = `${origin}/wallet?stripe_return=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/wallet?stripe_return=cancelled`;

    const attempt = async (chargeWallet: WalletRow, idempotencyKey: string) => {
      const form = buildCheckoutSessionParams({
        ledgerId,
        userId: user.id,
        amount,
        currency: chargeWallet.currency,
        successUrl,
        cancelUrl,
        customerEmail: user.email ?? null,
      });
      return createStripeCheckoutSession(secretKey, form, idempotencyKey);
    };

    // ── Create the session (attempt 1: the wallet's own currency) ──
    let chargeWallet = wallet;
    let fallbackApplied = false;
    let result = await attempt(chargeWallet, ledgerId);

    // ── USD fallback on a currency rejection (PayPal precedent) ──
    if (!result.ok && isStripeCurrencyRejection(result.error) && chargeWallet.currency !== "USD") {
      const usdValidation = validateStripeTopUp(amount, "USD");
      if (usdValidation.ok) {
        const usdWallet = await getOrCreateWallet(supabase, user.id, "USD", wallet.account_id);
        if (usdWallet && usdWallet.status === "active") {
          logStep("Currency rejected by Stripe — falling back to USD", {
            from: chargeWallet.currency,
            ledgerId,
          });
          chargeWallet = usdWallet;
          fallbackApplied = true;
          await supabase
            .from("transactions")
            .update({
              wallet_id: usdWallet.id,
              currency: "USD",
              metadata: {
                kind: "wallet_deposit",
                wallet_id: usdWallet.id,
                gateway: "stripe",
                requested_currency: requestedCurrency ?? wallet.currency,
                charge_currency: "USD",
                fallback_applied: true,
                fallback_from: wallet.currency,
                stripe_currency_rejection: {
                  type: result.error?.type ?? null,
                  code: result.error?.code ?? null,
                },
                stripe_mode: config.mode,
                account_id: wallet.account_id,
              },
            })
            .eq("uuid_id", ledgerId);
          result = await attempt(chargeWallet, `${ledgerId}:usd-fallback`);
        }
      }
    }

    if (!result.ok || !result.data?.id || !result.data.url) {
      // No session: close the ledger row as failed so it never sits
      // pending pretending money might arrive, and answer plainly.
      await supabase
        .from("transactions")
        .update({
          status: "failed",
          metadata: {
            kind: "wallet_deposit",
            wallet_id: chargeWallet.id,
            gateway: "stripe",
            requested_currency: requestedCurrency ?? wallet.currency,
            charge_currency: chargeWallet.currency,
            fallback_applied: fallbackApplied,
            stripe_mode: config.mode,
            account_id: wallet.account_id,
            failure: "session_create_failed",
            stripe_error_type: result.error?.type ?? null,
            stripe_error_code: result.error?.code ?? null,
          },
        })
        .eq("uuid_id", ledgerId);
      logStep("Session creation failed", { ledgerId, status: result.status });
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
          wallet_id: chargeWallet.id,
          gateway: "stripe",
          requested_currency: requestedCurrency ?? wallet.currency,
          charge_currency: chargeWallet.currency,
          fallback_applied: fallbackApplied,
          ...(fallbackApplied ? { fallback_from: wallet.currency } : {}),
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
      chargeCurrency: chargeWallet.currency,
      fallbackApplied,
      mode: config.mode,
    });

    return json({
      success: true,
      status: "pending",
      transaction_id: ledgerId,
      session_id: session.id,
      url: session.url,
      charge_currency: chargeWallet.currency,
      target_currency: chargeWallet.currency,
      fallback_applied: fallbackApplied,
      mode: config.mode,
      message: fallbackApplied
        ? `Stripe doesn't accept ${wallet.currency} charges on this account, so this top-up is in US dollars and will land in your USD wallet. Your wallet is credited once Stripe confirms the payment.`
        : "Top-up started with Stripe. Your wallet is credited only after Stripe confirms the payment — no money has moved yet.",
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
