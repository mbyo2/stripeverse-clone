import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Mobile Money Simulation Edge Function
 * Simulates MTN MoMo, Airtel Money, and Zamtel Kwacha flows
 * with realistic delays, callbacks, and status updates.
 */

interface SimRequest {
  provider: "mtn" | "airtel" | "zamtel";
  phoneNumber: string;
  amount: number;
  currency?: string;
  idempotencyKey?: string;
  direction?: "deposit" | "withdraw";
}

interface SimResponse {
  success: boolean;
  transactionId: string;
  status: "pending" | "completed" | "failed";
  message: string;
  provider: string;
  simulatedDelay: number;
  referenceCode: string;
}

// Simulated provider configs
const PROVIDER_CONFIG = {
  mtn: { name: "MTN MoMo", successRate: 0.92, avgDelayMs: 2000, prefix: "MTN" },
  airtel: { name: "Airtel Money", successRate: 0.90, avgDelayMs: 1800, prefix: "AIR" },
  zamtel: { name: "Zamtel Kwacha", successRate: 0.85, avgDelayMs: 2500, prefix: "ZTL" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: SimRequest = await req.json();
    const { provider, phoneNumber, amount, currency = "ZMW", idempotencyKey, direction = "deposit" } = body;

    // Validate
    if (!provider || !PROVIDER_CONFIG[provider]) {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!phoneNumber || !/^0[79]\d{8}$/.test(phoneNumber)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number. Use format 09XXXXXXXX or 07XXXXXXXX" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!amount || amount <= 0 || amount > 50000) {
      return new Response(
        JSON.stringify({ error: "Amount must be between 1 and 50,000" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency check
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from("transactions")
        .select("uuid_id, status")
        .eq("reference", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            success: existing.status === "completed",
            transactionId: existing.uuid_id,
            status: existing.status,
            message: "Duplicate request — returning existing transaction",
            provider: PROVIDER_CONFIG[provider].name,
            simulatedDelay: 0,
            referenceCode: idempotencyKey,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const config = PROVIDER_CONFIG[provider];
    const txnRef = `${config.prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const reference = idempotencyKey || txnRef;

    // Simulate provider processing delay
    const delay = config.avgDelayMs + Math.random() * 1000;
    await new Promise((r) => setTimeout(r, Math.min(delay, 3000)));

    // Simulate success/failure
    const isSuccess = Math.random() < config.successRate;
    const txnDirection = direction === "deposit" ? "incoming" : "outgoing";

    // Get user wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("currency", currency)
      .maybeSingle();

    // Record transaction
    const { data: txn, error: txnError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        wallet_id: wallet?.id || null,
        amount,
        currency,
        direction: txnDirection,
        payment_method: "mobile_money",
        provider,
        status: isSuccess ? "completed" : "failed",
        recipient_name: config.name,
        recipient_account: phoneNumber,
        reference,
        description: `${config.name} ${direction} via ${phoneNumber}`,
        metadata: {
          provider,
          phoneNumber,
          simulatedDelay: delay,
          idempotencyKey: reference,
        },
      })
      .select("uuid_id")
      .single();

    if (txnError) {
      console.error("Transaction insert error:", txnError);
      return new Response(
        JSON.stringify({ error: "Failed to record transaction" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update wallet balance on success
    if (isSuccess && direction === "deposit") {
      await supabase.rpc("increment_wallet_balance", {
        p_user_id: user.id,
        p_amount: amount,
      });
    }

    const response: SimResponse = {
      success: isSuccess,
      transactionId: txn.uuid_id,
      status: isSuccess ? "completed" : "failed",
      message: isSuccess
        ? `${config.name} ${direction} of K${amount.toFixed(2)} completed successfully.`
        : `${config.name} ${direction} failed. Please try again or contact ${config.name} support.`,
      provider: config.name,
      simulatedDelay: Math.round(delay),
      referenceCode: reference,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mobile-money-sim error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
