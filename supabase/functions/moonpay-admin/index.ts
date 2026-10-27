// moonpay-admin: admin operations for the MoonPay card on-ramp
// (JWT on — see supabase/config.toml).
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Role: admin / super_admin only (canUseMoonpayAdmin via
//      user_roles) — everyone else gets the crafted 403.
//
// Actions:
//   - { action: "status" } — truthful configuration state: whether
//     the widget keys exist, the environment they select, whether
//     the webhook key is present, the moonpay_enabled kill switch,
//     the webhook URL to register in MoonPay's dashboard, and
//     transaction counts. Secret VALUES never leave this function.
//   - { action: "list", limit? } — the latest tracking rows (default
//     50, max 200), each with the owner's email resolved in a second
//     step (profiles lookup by user_id, falling back to the auth
//     record; unmatched webhook rows show email null).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  canUseMoonpayAdmin,
  moonpayConfig,
  MOONPAY_ADMIN_REFUSAL_MESSAGE,
  MOONPAY_WEBHOOK_URL,
} from "../_shared/moonpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[MOONPAY-ADMIN] ${step}${detailsStr}`);
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

    // ── 2. Role gate ──
    if (!(await canUseMoonpayAdmin(supabase, user.id))) {
      return json({ success: false, status: "forbidden", error: MOONPAY_ADMIN_REFUSAL_MESSAGE }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    const config = moonpayConfig({
      publishableKey: Deno.env.get("MOONPAY_PUBLISHABLE_KEY") ?? null,
      secretKey: Deno.env.get("MOONPAY_SECRET_KEY") ?? null,
      webhookKey: Deno.env.get("MOONPAY_WEBHOOK_KEY") ?? null,
    });

    // ── Status ──
    if (action === "status") {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("moonpay_enabled, moonpay_selfcustody_enabled")
        .eq("id", true)
        .maybeSingle();

      const { data: statusRows, error: countError } = await supabase
        .from("moonpay_transactions")
        .select("status");
      if (countError) throw new Error(`MoonPay transaction count failed: ${countError.message}`);
      const byStatus: Record<string, number> = {};
      for (const r of (statusRows ?? []) as Array<{ status: string }>) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      }

      return json({
        success: true,
        configured: config.configured,
        environment: config.environment,
        keyEnvironmentMismatch: config.keyEnvironmentMismatch,
        publishableKeyPresent: config.publishableKey !== null,
        secretKeyPresent: config.secretKey !== null,
        webhookKeyPresent: config.hasWebhookKey,
        moonpayEnabled: settings?.moonpay_enabled === true,
        // The self-custody buy's kill switch (migration 20261239,
        // default TRUE — it guards the already-live Breez-arranged
        // checkout, a separate path from this function's rail).
        moonpaySelfcustodyEnabled: settings?.moonpay_selfcustody_enabled === true,
        webhookUrl: MOONPAY_WEBHOOK_URL,
        counts: { total: (statusRows ?? []).length, byStatus },
      });
    }

    // ── List ──
    if (action === "list") {
      const requested = typeof body.limit === "number" ? body.limit : 50;
      const limit = Math.min(200, Math.max(1, Math.floor(requested) || 50));
      const { data: rows, error: listError } = await supabase
        .from("moonpay_transactions")
        .select(
          "id, user_id, external_reference, moonpay_transaction_id, deposit_address, " +
          "fiat_currency, fiat_amount, crypto_currency, crypto_amount, fee_amount, " +
          "crypto_transaction_id, status, raw_status, failure_reason, environment, " +
          "source, last_webhook_event, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (listError) throw new Error(`MoonPay transaction list failed: ${listError.message}`);

      const list = (rows ?? []) as Array<Record<string, unknown> & { user_id: string | null }>;

      // Resolve owner emails in a second step: profiles lookup by
      // user_id first (the sibling-admin pattern), the auth record
      // as fallback; unmatched rows (user_id NULL) show email null.
      const userIds = [...new Set(list.map((r) => r.user_id).filter((v): v is string => !!v))];
      const emailByUser = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        for (const p of (profiles ?? []) as Array<{ id: string; email?: string | null }>) {
          if (p.email) emailByUser.set(p.id, p.email);
        }
        for (const id of userIds) {
          if (!emailByUser.has(id)) {
            try {
              const { data: authUser } = await supabase.auth.admin.getUserById(id);
              emailByUser.set(id, authUser?.user?.email ?? null);
            } catch {
              emailByUser.set(id, null);
            }
          }
        }
      }

      return json({
        success: true,
        transactions: list.map((r) => ({
          ...r,
          email: r.user_id ? (emailByUser.get(r.user_id) ?? null) : null,
        })),
      });
    }

    return json({
      success: false,
      status: "invalid",
      error: "That action is not supported. Please try again.",
    }, 400);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in moonpay-admin", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong with that request. No money has moved — please try again.",
    }, 500);
  }
});
