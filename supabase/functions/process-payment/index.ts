// process-payment: the generic payment processor behind the in-app
// Checkout components (CardPayment / MobileMoneyPayment / UssdPayment)
// and usePaymentProcessing.
//
// History: this function used to SIMULATE every provider — MTN, Airtel,
// Zamtel and card payments "succeeded" on a Math.random() roll, the
// caller's wallet was debited/credited against that fiction, and a
// compliance check was written as 'passed'. None of it was real, and it
// also settled against the *caller's* wallet, which made it unusable
// for payment links (a guest paying a link would have needed an account
// and would have paid themselves).
//
// Now it is an honest router (see _shared/payment-providers.ts):
//   - provider "paypal" with credentials configured → a real PayPal
//     order is created, a PENDING checkout row is recorded against
//     the merchant named in metadata.merchant_user_id (see
//     _shared/checkout-capture.ts — an order that cannot name its
//     merchant can never settle, so it is refused up front), and the
//     order is returned as status 'pending' with its approval URL.
//     The payment is NOT complete here: no wallet moves and nothing
//     is marked completed. Settlement happens on capture — the
//     paypal-checkout-capture return flow or the paypal-webhook
//     backstop (via _shared/paypal-checkout.ts and the
//     complete_checkout_payment RPC), which credit the merchant's
//     settlement wallet exactly once against a verified capture.
//   - any other provider, or PayPal without credentials →
//     status 'not_configured' with a truthful explanation. No database
//     rows are written and no balances move for a payment no gateway
//     will ever settle.
//   - Wallet-balance payments never come through here at all: they run
//     through atomic-transfer / internal-transfer /
//     payment-link-checkout, which settle atomically server-side.
//
// Auth: a signed-in user is required (every real caller is an in-app
// page). Payment-link guests use `payment-link-checkout` instead.
//
// Response shape is unchanged for existing callers:
//   { success, status, transaction_id?, reference?, approval_url?, error? }
// `success` is never true from this function anymore — a synchronous
// "completed" state does not exist for gateway payments.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyProvider,
  paypalFundingIntent,
  paypalLandingPageForFunding,
  paypalOrderCurrencyRefusal,
} from "../_shared/payment-providers.ts";
import { getPayPalAccessToken, paypalBaseUrl } from "../_shared/paypal-deposit.ts";
import { assertAccountNotFrozen } from "../_shared/account-freeze.ts";
import { paypalErrorTrace } from "../_shared/deposit-capture.ts";
import { parseCheckoutTerms } from "../_shared/checkout-capture.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
  provider: string;
  recipientAccount?: string;
  recipientName?: string;
  description?: string;
  /** The payer's chosen way to pay THROUGH PayPal ("paypal_card" |
   *  "paypal_account"); validated server-side, steering only. */
  paypal_funding?: unknown;
  metadata?: Record<string, unknown>;
}

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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // The caller must be a signed-in user (unchanged from before).
    const authHeader = req.headers.get("Authorization") || "";
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return json({ success: false, status: "unauthorized", error: "Unauthorized" }, 401);
    }

    // ── Freeze guard: a frozen account cannot move money out ──
    // (supabaseClient here is the service-role client.)
    await assertAccountNotFrozen(supabaseClient, user.id);

    const paymentData: PaymentRequest = await req.json();

    // ── Validation ──
    const amount = Number(paymentData.amount);
    if (!amount || amount <= 0) {
      return json({ success: false, status: "invalid", error: "Invalid payment amount" }, 400);
    }
    const currency = (paymentData.currency || "ZMW").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return json({ success: false, status: "invalid", error: "Invalid currency" }, 400);
    }
    if (!paymentData.provider) {
      return json({ success: false, status: "invalid", error: "Payment provider is required" }, 400);
    }

    // ── Route ──
    const route = classifyProvider(paymentData.provider, {
      paypalConfigured: Boolean(
        Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_CLIENT_SECRET"),
      ),
    });

    if (route.kind === "not_configured") {
      // Truthful refusal: no rows written, no balances touched.
      return json({ success: false, status: "not_configured", error: route.error });
    }

    // D3 (audit 2026-10-26): the one PayPal order-currency allowlist,
    // refused up front. This also retires the silent "ZMW" default
    // above for PayPal payments: a missing or kwacha currency can
    // never become a PayPal order (ZMW is not a PayPal currency), and
    // the refusal lands BEFORE any wallet is resolved or created, so
    // an unsettleable payment leaves no trace.
    const currencyRefusal = paypalOrderCurrencyRefusal(currency);
    if (currencyRefusal) {
      return json({ success: false, status: "unsupported_currency", error: currencyRefusal }, 400);
    }

    // ── PayPal: record the checkout, create a real order; ──────────
    // completion waits for capture (paypal-checkout-capture /
    // paypal-webhook, settling via complete_checkout_payment).
    //
    // The order settles to a MERCHANT, so the terms are validated
    // BEFORE PayPal is touched: no merchant named → no order, no
    // charge, no pending row (an unsettleable order must never exist).
    const termsResult = parseCheckoutTerms(paymentData.metadata, user.id);
    if (!termsResult.ok) {
      return json({ success: false, status: "invalid", error: termsResult.error }, 400);
    }
    const terms = termsResult.terms;

    // A named settlement account must belong to the merchant.
    if (terms.accountId) {
      const { data: account, error: accountError } = await supabaseClient
        .from("accounts")
        .select("id, user_id, status")
        .eq("id", terms.accountId)
        .maybeSingle();
      if (accountError) throw new Error(`Settlement account lookup failed: ${accountError.message}`);
      if (!account || account.user_id !== terms.merchantUserId) {
        return json({
          success: false,
          status: "invalid",
          error: "The settlement account does not belong to the named merchant.",
        }, 400);
      }
      if (account.status === "closed") {
        return json({
          success: false,
          status: "invalid",
          error: "The merchant's settlement account is closed and cannot receive payments.",
        }, 400);
      }
    }

    // Resolve the merchant's settlement wallet for this currency
    // (created on demand, as execute_payment_link_settlement does).
    // A closed wallet can never receive, so it refuses the order here
    // rather than after the customer has paid; a frozen one may
    // receive (receiving is not sending).
    let walletQuery = supabaseClient
      .from("wallets")
      .select("id, status")
      .eq("user_id", terms.merchantUserId)
      .eq("currency", currency);
    walletQuery = terms.accountId
      ? walletQuery.eq("account_id", terms.accountId)
      : walletQuery.is("account_id", null);
    const { data: existingWallet, error: walletError } = await walletQuery.maybeSingle();
    if (walletError) throw new Error(`Settlement wallet lookup failed: ${walletError.message}`);

    let settlementWallet = existingWallet;
    if (!settlementWallet) {
      const { data: created, error: createError } = await supabaseClient
        .from("wallets")
        .insert({
          user_id: terms.merchantUserId,
          account_id: terms.accountId,
          balance: 0,
          currency,
          status: "active",
        })
        .select("id, status")
        .single();
      if (createError) throw new Error(`Failed to resolve settlement wallet: ${createError.message}`);
      settlementWallet = created;
    }
    if (!settlementWallet) throw new Error("Settlement wallet could not be resolved");
    if (settlementWallet.status === "closed") {
      return json({
        success: false,
        status: "failed",
        error: "The merchant's settlement wallet is closed and cannot receive payments.",
      });
    }

    const accessToken = await getPayPalAccessToken();
    if (!accessToken) {
      return json({
        success: false,
        status: "not_configured",
        error: "PayPal is not configured on this platform yet.",
      });
    }

    // Our own transaction id is generated BEFORE the order so the
    // PayPal order itself carries it (purchase-unit reference_id and
    // custom_id): the completion path is keyed on the order's own
    // metadata, in our records and in PayPal's.
    const transactionUuid = crypto.randomUUID();
    // The payer's PayPal funding intent, validated against the two
    // known values; anything else is dropped, never forwarded.
    const fundingIntent = paypalFundingIntent(paymentData.paypal_funding);
    const order = await createPayPalOrder(accessToken, {
      amount,
      currency,
      description: paymentData.description,
      referenceId: transactionUuid,
      returnUrl: terms.returnUrl,
      cancelUrl: terms.cancelUrl,
      landingPage: paypalLandingPageForFunding(paymentData.paypal_funding),
    });
    if (!order) {
      return json({
        success: false,
        status: "failed",
        error: "PayPal could not create this payment. No money was charged.",
      });
    }

    // Record the PENDING checkout payment against the merchant's
    // settlement wallet. The wallet is credited only after the order
    // is captured and confirmed — the capture path finds this row by
    // its PayPal order reference.
    const { error: txError } = await supabaseClient
      .from("transactions")
      .insert({
        uuid_id: transactionUuid,
        user_id: terms.merchantUserId,
        wallet_id: settlementWallet.id,
        amount,
        currency,
        direction: "incoming",
        status: "pending",
        payment_method: "paypal",
        provider: "paypal",
        reference: order.id,
        description: paymentData.description || "Checkout payment via PayPal (awaiting confirmation)",
        category: "checkout",
        metadata: {
          kind: "checkout_payment",
          payer_user_id: user.id,
          merchant_user_id: terms.merchantUserId,
          account_id: terms.accountId,
          wallet_id: settlementWallet.id,
          paypal_order_id: order.id,
          ...(fundingIntent ? { paypal_funding: fundingIntent } : {}),
        },
      });
    if (txError) {
      console.error("Pending checkout insert failed:", txError);
      return json({
        success: false,
        status: "failed",
        error: "The payment could not be recorded, so it was not started. No money was charged.",
      });
    }

    return json({
      success: false,
      status: "pending",
      reference: order.id,
      transaction_id: transactionUuid,
      approval_url: order.approvalUrl,
      message:
        "Payment initiated with PayPal. It completes only after approval and capture, which settles the merchant — no money has moved yet.",
    });
  } catch (error) {
    console.error("Process payment error:", error);
    return json(
      { success: false, status: "error", error: error instanceof Error ? error.message : "Payment processing failed" },
      400,
    );
  }
});

// ── PayPal REST ──────────────────────────────────────────────────
// The OAuth token comes from the shared, cached getter in
// _shared/paypal-deposit.ts (audit D7 — this function's private
// copy is deleted).

async function createPayPalOrder(
  accessToken: string,
  input: {
    amount: number;
    currency: string;
    description?: string;
    /** Our transaction uuid — stamped on the order as the purchase
     *  unit's reference_id and custom_id, so the order carries its
     *  own settlement key. */
    referenceId?: string;
    returnUrl?: string | null;
    cancelUrl?: string | null;
    /** Orders API landing_page steering for the chosen PayPal
     *  funding intent (BILLING = card form first, LOGIN = PayPal
     *  sign-in first); null = no steering, as before. */
    landingPage?: "LOGIN" | "BILLING" | null;
  },
): Promise<{ id: string; approvalUrl: string | null } | null> {
  const baseUrl = paypalBaseUrl();
  try {
    const applicationContext = input.returnUrl || input.cancelUrl || input.landingPage
      ? {
          ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
          ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
          ...(input.landingPage ? { landing_page: input.landingPage } : {}),
        }
      : undefined;
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Idempotency at PayPal (audit D8): keyed on our transaction
        // uuid, so a retried create for the same payment replays the
        // original order instead of minting a second one.
        ...(input.referenceId
          ? { "PayPal-Request-Id": `paypal-order-${input.referenceId}` }
          : {}),
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          ...(input.referenceId
            ? { reference_id: input.referenceId, custom_id: input.referenceId }
            : {}),
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
          description: input.description || "BMaGlass Pay payment",
        }],
        ...(applicationContext ? { application_context: applicationContext } : {}),
      }),
    });
    if (!response.ok) {
      // Trace fields only (audit L1) — never the raw error body.
      console.error("PayPal order failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    const data = await response.json();
    const approval = Array.isArray(data.links)
      ? data.links.find((l: { rel?: string }) => l.rel === "approve" || l.rel === "payer-action")
      : null;
    return { id: data.id, approvalUrl: approval?.href ?? null };
  } catch (e) {
    console.error("PayPal order error:", e);
    return null;
  }
}
