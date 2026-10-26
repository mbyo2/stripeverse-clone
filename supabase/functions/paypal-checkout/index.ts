// paypal-checkout: PayPal SUBSCRIPTION checkout only (audit D1/D4,
// 2026-10-26).
//
// History: this function also created one-time payment ORDERS. Those
// orders could never settle: their return_url AND cancel_url pointed
// at the webhook endpoint, no code path ever captured them, and the
// webhook ignored their rows — a buyer could approve in good faith
// and nothing would ever complete. One-time PayPal payments now live
// in the flows that do settle: wallet deposits (wallet-deposit +
// paypal-deposit-capture) and checkout payments (process-payment +
// paypal-checkout-capture), both capture-verified and exactly-once.
// A one-time request here is refused with that explanation, in plain
// language, before anything touches PayPal or the database.
//
// Subscriptions stay — they settle through the subscription rail
// (BILLING.SUBSCRIPTION.ACTIVATED + PAYMENT.SALE.COMPLETED in
// paypal-webhook) — with the D4 fixes:
//   - plans are created against a REAL PayPal product (created once,
//     its id stored in platform_settings.paypal_subscription_product_id);
//     the previous code passed the client tier string ("basic") as
//     product_id, which is not a product and could never have worked;
//   - a plan is minted ONCE per price point and reused
//     (paypal_billing_plans catalogue) — the previous code created a
//     brand-new plan on every checkout;
//   - the subscriptions row stores the RETURNED plan id (P-…), not
//     the tier string it used to store in paypal_plan_id;
//   - buyers return to the app (sanitised caller URLs), never to the
//     webhook endpoint;
//   - currency passes the one PAYPAL_ORDER_CURRENCIES allowlist (D3).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getPayPalAccessToken, paypalBaseUrl } from "../_shared/paypal-deposit.ts";
import { paypalOrderCurrencyRefusal } from "../_shared/payment-providers.ts";
import { validateFiatAmount } from "../_shared/fiat-amount.ts";
import { paypalErrorTrace } from "../_shared/deposit-capture.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAYPAL-CHECKOUT] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const ONE_TIME_DEPRECATED_MESSAGE =
  "One-time PayPal payments no longer run through this checkout — they complete through wallet deposits and payment links, which settle only after PayPal confirms the capture. Nothing was charged.";

const PLAN_NAMES: Record<string, string> = {
  basic: "Basic Plan",
  premium: "Premium Plan",
  enterprise: "Enterprise Plan",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user?.id || !user?.email) throw new Error("User not authenticated");

    const body = await req.json();
    const type = body.type ?? 'subscription';

    // D1: one-time orders from this function can never settle (see
    // header). Refuse before any PayPal call or database write.
    if (type !== 'subscription') {
      logStep("One-time payment refused (deprecated path)", { userId: user.id });
      return json({ success: false, status: "deprecated", error: ONE_TIME_DEPRECATED_MESSAGE }, 400);
    }

    const planId = body.planId;
    const amount = Number(body.amount);
    const currency = String(body.currency ?? '').toUpperCase();

    if (!planId || typeof planId !== 'string') {
      throw new Error('Plan ID required for subscriptions');
    }
    const amtCheck = validateFiatAmount(body.amount);
    if (!amtCheck.ok) throw new Error(amtCheck.error);
    if (amount > 999999.99) {
      throw new Error('Invalid payment amount');
    }
    // D3: the one allowlist, refused up front.
    const currencyRefusal = paypalOrderCurrencyRefusal(currency);
    if (currencyRefusal) {
      return json({ success: false, status: "unsupported_currency", error: currencyRefusal }, 400);
    }

    logStep("Subscription checkout request", { planId, amount, currency, userId: user.id });

    const accessToken = await getPayPalAccessToken();
    if (!accessToken) throw new Error("Failed to authenticate with PayPal");

    const productId = await ensureSubscriptionProduct(supabaseClient, accessToken);
    if (!productId) throw new Error("PayPal subscription product could not be prepared");

    const billingPlanId = await ensureBillingPlan(supabaseClient, accessToken, {
      tier: planId,
      productId,
      amount,
      currency,
    });
    if (!billingPlanId) throw new Error("PayPal billing plan could not be prepared");

    const returnUrl = sanitizeRedirectUrl(body.return_url);
    const cancelUrl = sanitizeRedirectUrl(body.cancel_url);
    const subscription = await createPayPalSubscription(accessToken, {
      planId: billingPlanId,
      email: user.email,
      returnUrl,
      cancelUrl,
    });
    if (!subscription) throw new Error("PayPal subscription creation failed");

    const { error: insertError } = await supabaseClient.from('subscriptions').insert({
      user_id: user.id,
      subscription_tier: planId,
      paypal_subscription_id: subscription.subscriptionId,
      paypal_plan_id: billingPlanId,
      status: 'pending'
    });
    if (insertError) throw new Error(`Failed to record subscription: ${insertError.message}`);

    logStep("Subscription created", { subscriptionId: subscription.subscriptionId, billingPlanId });

    return json({
      success: true,
      approvalUrl: subscription.approvalUrl,
      subscriptionId: subscription.subscriptionId
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-checkout", { message: errorMessage });

    return json({
      success: false,
      error: errorMessage
    }, 500);
  }
});

/** https-only redirect sanitiser (mirrors wallet-deposit's rule). */
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

/**
 * The ONE PayPal product the platform's subscription plans belong
 * to. Created on first use and remembered in platform_settings; the
 * tier string the client sends is a plan name, never a product id.
 */
async function ensureSubscriptionProduct(supabase: any, accessToken: string): Promise<string | null> {
  const { data: settings, error } = await supabase
    .from("platform_settings")
    .select("paypal_subscription_product_id")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`Settings lookup failed: ${error.message}`);
  if (settings?.paypal_subscription_product_id) {
    return settings.paypal_subscription_product_id as string;
  }

  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/catalogs/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": "bmaglass-paypal-subscription-product",
      },
      body: JSON.stringify({
        name: "BMaGlass Pay Subscriptions",
        description: "BMaGlass Pay subscription plans",
        type: "SERVICE",
        category: "SOFTWARE",
      }),
    });
    if (!response.ok) {
      console.error("PayPal product create failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    const product = await response.json();
    if (!product?.id) return null;

    const { error: updateError } = await supabase
      .from("platform_settings")
      .update({ paypal_subscription_product_id: product.id })
      .eq("id", true);
    if (updateError) throw new Error(`Product id could not be stored: ${updateError.message}`);

    // Prefer whatever is stored now (a racing first checkout may
    // have stored its own product first — one stored id must win so
    // every plan hangs off the same product).
    const { data: stored } = await supabase
      .from("platform_settings")
      .select("paypal_subscription_product_id")
      .eq("id", true)
      .maybeSingle();
    return (stored?.paypal_subscription_product_id as string) ?? product.id;
  } catch (e) {
    console.error("PayPal product create error:", e);
    return null;
  }
}

/**
 * Find-or-create the PayPal billing plan for one price point
 * (tier + currency + amount). Plans are immutable at PayPal, so the
 * catalogue row is the reuse mechanism: a repeat checkout at the
 * same price returns the stored P-… id and mints nothing.
 */
async function ensureBillingPlan(
  supabase: any,
  accessToken: string,
  input: { tier: string; productId: string; amount: number; currency: string },
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from("paypal_billing_plans")
    .select("plan_id")
    .eq("tier", input.tier)
    .eq("currency", input.currency)
    .eq("amount", input.amount)
    .maybeSingle();
  if (error) throw new Error(`Billing plan lookup failed: ${error.message}`);
  if (existing?.plan_id) return existing.plan_id as string;

  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/billing/plans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // Deterministic per price point: a retried plan creation for
        // the same price point replays at PayPal instead of minting
        // a twin.
        "PayPal-Request-Id": `paypal-plan-${input.tier}-${input.currency}-${Math.round(input.amount * 100)}`,
      },
      body: JSON.stringify({
        product_id: input.productId,
        name: PLAN_NAMES[input.tier] || input.tier,
        description: `${PLAN_NAMES[input.tier] || input.tier} subscription`,
        status: "ACTIVE",
        billing_cycles: [{
          frequency: {
            interval_unit: "MONTH",
            interval_count: 1
          },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: input.amount.toFixed(2),
              currency_code: input.currency
            }
          }
        }],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3
        }
      }),
    });
    if (!response.ok) {
      console.error("PayPal plan create failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    const plan = await response.json();
    if (!plan?.id) return null;

    const { error: insertError } = await supabase
      .from("paypal_billing_plans")
      .insert({
        tier: input.tier,
        currency: input.currency,
        amount: input.amount,
        product_id: input.productId,
        plan_id: plan.id,
      });
    if (insertError) {
      // A racing checkout stored a plan for this price point first:
      // use the stored one so the catalogue stays single.
      const { data: raced } = await supabase
        .from("paypal_billing_plans")
        .select("plan_id")
        .eq("tier", input.tier)
        .eq("currency", input.currency)
        .eq("amount", input.amount)
        .maybeSingle();
      if (raced?.plan_id) return raced.plan_id as string;
      throw new Error(`Billing plan could not be stored: ${insertError.message}`);
    }
    return plan.id as string;
  } catch (e) {
    console.error("PayPal plan create error:", e);
    return null;
  }
}

async function createPayPalSubscription(
  accessToken: string,
  input: { planId: string; email: string; returnUrl: string | null; cancelUrl: string | null },
): Promise<{ subscriptionId: string; approvalUrl: string | null } | null> {
  try {
    const applicationContext = input.returnUrl || input.cancelUrl
      ? {
          brand_name: "BMaGlass Pay",
          user_action: "SUBSCRIBE_NOW",
          ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
          ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
        }
      : undefined;
    const response = await fetch(`${paypalBaseUrl()}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        plan_id: input.planId,
        subscriber: {
          email_address: input.email
        },
        ...(applicationContext ? { application_context: applicationContext } : {}),
      }),
    });
    if (!response.ok) {
      console.error("PayPal subscription create failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    const subscription = await response.json();
    const approvalUrl = subscription.links?.find((link: any) => link.rel === "approve")?.href ?? null;
    return { subscriptionId: subscription.id, approvalUrl };
  } catch (e) {
    console.error("PayPal subscription create error:", e);
    return null;
  }
}
