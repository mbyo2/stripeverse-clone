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
//     order is created and returned as status 'pending' with its
//     approval URL. The payment is NOT complete here: no wallet moves
//     and nothing is marked completed. Settlement happens when the
//     order is captured (the platform's paypal-webhook/capture flow).
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
import { classifyProvider } from "../_shared/payment-providers.ts";

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
      description: paymentData.description,
    });
    if (!order) {
      return json({
        success: false,
        status: "failed",
        error: "PayPal could not create this payment. No money was charged.",
      });
    }

    return json({
      success: false,
      status: "pending",
      reference: order.id,
      transaction_id: order.id,
      approval_url: order.approvalUrl,
      message:
        "Payment initiated with PayPal. It completes only after approval and capture — no money has moved yet.",
    });
  } catch (error) {
    console.error("Process payment error:", error);
    return json(
      { success: false, status: "error", error: error instanceof Error ? error.message : "Payment processing failed" },
      400,
    );
  }
});

// ── PayPal REST (mirrors paypal-checkout's token/order pattern) ──────────

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

async function createPayPalOrder(
  accessToken: string,
  input: { amount: number; currency: string; description?: string },
): Promise<{ id: string; approvalUrl: string | null } | null> {
  const isProduction = Deno.env.get("PAYPAL_ENV") === "production";
  const baseUrl = isProduction ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
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
          description: input.description || "BMaGlass Pay payment",
        }],
      }),
    });
    if (!response.ok) {
      console.error("PayPal order failed:", response.status, await response.text());
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
