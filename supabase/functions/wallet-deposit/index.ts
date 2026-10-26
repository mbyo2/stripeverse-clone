// wallet-deposit: adds money to ONE explicitly chosen wallet, and only
// against a genuinely confirmed payment.
//
// History: this function carried the comment "For MVP beta, simulate
// successful deposit for all methods" — it fabricated a success (and a
// random reference), credited whichever wallet an unfiltered
// `.maybeSingle()` happened to return, and used Math.random. Deposits
// were fiction written straight into balances.
//
// Now it follows the platform's honesty policy (see
// _shared/payment-providers.ts):
//   - The caller names the target wallet (the account + currency they
//     selected on the Wallet page). The wallet must belong to the
//     caller and be active; only that wallet can ever be credited.
//   - PayPal (when PAYPAL_CLIENT_ID/SECRET are configured) → a real
//     PayPal order is created and a PENDING deposit row is recorded
//     against the target wallet. Response: status 'pending' with the
//     approval URL. Nothing is credited here — the wallet is credited
//     only when the order is captured and confirmed (paypal-webhook /
//     capture flow), never on initiation.
//   - Mobile money, card, or PayPal-without-credentials →
//     status 'not_configured' with a truthful explanation. No rows
//     are written and no balance moves for a payment no gateway will
//     ever settle.
//   - No Math.random anywhere; references come from the gateway.
//
// Input: { amount, paymentMethod ('mobile_money' | 'paypal' | 'card'),
//          provider?, wallet_id?, currency?, return_url?, cancel_url? }
//   wallet_id omitted → the caller's Main wallet (account_id IS NULL)
//   in the requested currency, created on demand if missing.
//   return_url / cancel_url are handed to PayPal as the order's
//   application_context so the user lands back on the Wallet page
//   after approving (or cancelling) — the deposit-capture return flow
//   keys off them. Only well-formed https URLs are accepted; anything
//   else is ignored, never forwarded to PayPal.
//
// Response shape: { success, status, transaction_id?, reference?,
//                   approval_url?, message?, error? }
// `success` is never true from this function — no deposit completes
// synchronously; completion exists only after gateway confirmation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyProvider, paypalDepositCurrencyRefusal } from "../_shared/payment-providers.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import { paypalErrorTrace } from "../_shared/deposit-capture.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[WALLET-DEPOSIT] ${step}${detailsStr}`);
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
    logStep("Function started");

    // Service-role client that forwards NO caller Authorization header:
    // the caller is resolved explicitly from the bearer token below.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user?.id) throw new Error("User not authenticated");

    const body = await req.json();
    const amount = Number(body.amount);
    const paymentMethod = String(body.paymentMethod || "mobile_money").toLowerCase();
    const requestedCurrency = body.currency
      ? String(body.currency).toUpperCase()
      : null;
    // Optional post-PayPal landing URLs from the caller. Sanitised to
    // https-only; an invalid value is dropped, never forwarded, so a
    // caller cannot steer PayPal's redirect to an arbitrary scheme.
    const returnUrl = sanitizeRedirectUrl(body.return_url);
    const cancelUrl = sanitizeRedirectUrl(body.cancel_url);
    if (body.return_url && !returnUrl) logStep("Ignored non-https return_url");
    if (body.cancel_url && !cancelUrl) logStep("Ignored non-https cancel_url");
    logStep("Deposit request", { amount, paymentMethod, userId: user.id });

    // ── Validation ──
    // FIX-1: whole-ngwee only (validator enforces > 0 too), cap 50,000.
    const amtCheck = validateFiatAmount(body.amount, 50000);
    if (!amtCheck.ok) throw new Error(amtCheck.error);

    // ── Resolve the ONE target wallet ──
    let wallet: { id: string; currency: string; status: string } | null = null;

    if (body.wallet_id) {
      const { data, error } = await supabase
        .from("wallets")
        .select("id, currency, status, user_id")
        .eq("id", body.wallet_id)
        .maybeSingle();
      if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
      if (!data) throw new Error("Target wallet not found");
      if (data.user_id !== user.id) {
        return json({ success: false, status: "forbidden", error: "Target wallet does not belong to you" }, 403);
      }
      wallet = data;
      if (requestedCurrency && requestedCurrency !== wallet.currency) {
        throw new Error(`Currency ${requestedCurrency} does not match the target wallet's currency ${wallet.currency}`);
      }
    } else {
      // Deterministic fallback (no unfiltered .maybeSingle() roulette):
      // the caller's Main wallet for the currency, created if missing.
      const currency = requestedCurrency || "ZMW";
      const { data, error } = await supabase
        .from("wallets")
        .select("id, currency, status")
        .eq("user_id", user.id)
        .eq("currency", currency)
        .is("account_id", null)
        .maybeSingle();
      if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
      wallet = data;
      if (!wallet) {
        const { data: created, error: createError } = await supabase
          .from("wallets")
          .insert({ user_id: user.id, balance: 0, currency, status: "active" })
          .select("id, currency, status")
          .single();
        if (createError) throw new Error(`Failed to create wallet: ${createError.message}`);
        wallet = created;
      }
    }

    if (!wallet) throw new Error("Target wallet could not be resolved");
    if (wallet.status !== "active") throw new Error("Target wallet is not active");

    const currency = wallet.currency;

    // ── Route by provider (shared honesty classifier) ──
    const providerKey = paymentMethod === "mobile_money" || paymentMethod === "mobile"
      ? String(body.provider || "mobile_money").toLowerCase()
      : paymentMethod;

    const route = classifyProvider(providerKey, {
      paypalConfigured: Boolean(
        Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_CLIENT_SECRET"),
      ),
    });

    if (route.kind === "not_configured") {
      // Truthful refusal: nothing written, nothing credited.
      logStep("Provider not configured", { providerKey });
      return json({ success: false, status: "not_configured", error: route.error });
    }

    // PayPal settles USD wallets only (PayPal has no ZMW at all):
    // refuse a non-USD target up front instead of letting PayPal
    // reject the order after a round-trip (audit 2026-10-26).
    const currencyRefusal = paypalDepositCurrencyRefusal(currency);
    if (currencyRefusal) {
      logStep("PayPal deposit refused on currency", { currency });
      return json({ success: false, status: "unsupported_currency", error: currencyRefusal });
    }

    // ── PayPal: create a real order; completion waits for capture ──
    const accessToken = await getPayPalAccessToken();
    if (!accessToken) {
      return json({
        success: false,
        status: "not_configured",
        error: "PayPal is not configured on this platform yet.",
      });
    }

    const order = await createPayPalOrder(accessToken, {
      amount,
      currency,
      description: "BMaGlass Pay wallet deposit",
      returnUrl,
      cancelUrl,
    });
    if (!order) {
      return json({
        success: false,
        status: "failed",
        error: "PayPal could not create this deposit. No money was charged.",
      });
    }

    // Record the PENDING deposit against the target wallet. The wallet
    // is credited only after the order is captured and confirmed —
    // the capture path finds this row by its PayPal order reference.
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        wallet_id: wallet.id,
        amount,
        currency,
        direction: "incoming",
        status: "pending",
        payment_method: "paypal",
        provider: "paypal",
        reference: order.id,
        description: "Wallet deposit via PayPal (awaiting confirmation)",
        category: "deposit",
        metadata: { kind: "wallet_deposit", wallet_id: wallet.id, paypal_order_id: order.id },
      })
      .select("uuid_id")
      .single();

    if (txError) {
      logStep("Pending deposit insert failed", txError);
      throw new Error(`Failed to record deposit: ${txError.message}`);
    }

    logStep("Deposit pending PayPal confirmation", {
      transactionId: transaction.uuid_id, walletId: wallet.id, amount, reference: order.id,
    });

    return json({
      success: false,
      status: "pending",
      transaction_id: transaction.uuid_id,
      reference: order.id,
      approval_url: order.approvalUrl,
      message:
        "Deposit initiated with PayPal. Your wallet is credited only after you approve and the payment is captured — no money has moved yet.",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in wallet-deposit", { message: errorMessage });
    return json({ success: false, status: "error", error: errorMessage }, 500);
  }
});

// ── PayPal REST (mirrors paypal-checkout's token/order pattern) ──────

async function getPayPalAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  try {
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.access_token ?? null;
  } catch (e) {
    console.error("PayPal token error:", e);
    return null;
  }
}

/**
 * Returns the value unchanged only when it is a well-formed https
 * URL; null otherwise. The codebase has no origin allowlist for
 * PayPal flows (paypal-checkout / paypal-marketplace build their
 * application_context server-side), so https + parseable is the bar:
 * it blocks scheme injection (javascript:, data:, http downgrade)
 * without inventing a host policy the platform does not have.
 */
function sanitizeRedirectUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function createPayPalOrder(
  accessToken: string,
  input: {
    amount: number;
    currency: string;
    description?: string;
    returnUrl?: string | null;
    cancelUrl?: string | null;
  },
): Promise<{ id: string; approvalUrl: string | null } | null> {
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  // PayPal sends the user back to these URLs after approval/cancel;
  // without them the deposit-capture return flow can never fire.
  // Included only when at least one valid URL was supplied, so order
  // creation is byte-identical to before when they are absent.
  const applicationContext = input.returnUrl || input.cancelUrl
    ? {
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
        ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
      }
    : undefined;
  try {
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
          description: input.description || "BMaGlass Pay wallet deposit",
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
