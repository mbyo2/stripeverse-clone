// paypal-admin: admin operations for PayPal withdrawals and the
// PLATFORM FLOAT (JWT on — see supabase/config.toml). Mirrors
// moonpay-admin's gate pattern.
//
// The float (migration 20261213, CEO directive 2026-10-24): a USD
// withdrawal larger than the user's PayPal-sourced mark draws the
// remainder from the platform's own PayPal money, capped by an
// allowance the owner sets to match what that account holds.
// Float-backed payouts settle from the real PayPal account; if it
// cannot cover one, PayPal refuses and the withdrawal refunds in
// full — the allowance is a cap, never a promise the code can keep
// on its own, and this console says so.
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. View: admin / super_admin (canUsePaypalAdminFor).
//   3. Set allowance: super_admin ONLY (canSetPaypalFloatAllowanceFor)
//      — the allowance is the owner's funding promise, not a
//      plain-admin power. Every successful set is audit-logged
//      (audit_logs, the mobile-money pattern: the audit is required,
//      and its failure is surfaced, never hidden).
//
// Actions:
//   - { action: "status" } — allowance, derived float used /
//     remaining, withdrawal counts by status, float drawn totals,
//     and the latest withdrawals WITH their funding split
//     (provenance_amount / float_amount) resolved to owner emails.
//   - { action: "set_allowance", allowance_usd } — super_admin only;
//     updates platform_settings.paypal_float_allowance_usd and
//     writes the audit row.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  canSetPaypalFloatAllowanceFor,
  canUsePaypalAdminFor,
  floatAvailable,
  PAYPAL_ADMIN_REFUSAL_MESSAGE,
  roundMoney,
} from "../_shared/paypal-payout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAYPAL-ADMIN] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SET_REFUSAL_MESSAGE =
  "Only the platform owner (super admin) can set the PayPal float allowance.";

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

    // ── 2. View gate ──
    if (!(await canUsePaypalAdminFor(supabase, user.id))) {
      return json({ success: false, status: "forbidden", error: PAYPAL_ADMIN_REFUSAL_MESSAGE }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    // ── Status ──
    if (action === "status") {
      const { data: settings, error: settingsError } = await supabase
        .from("platform_settings")
        .select("paypal_float_allowance_usd")
        .eq("id", true)
        .maybeSingle();
      if (settingsError) throw new Error(`Float settings read failed: ${settingsError.message}`);
      const allowance = Number(settings?.paypal_float_allowance_usd ?? 0);

      const { data: usedData, error: usedError } = await supabase.rpc("paypal_float_used_usd");
      if (usedError) throw new Error(`Float usage read failed: ${usedError.message}`);
      const used = Number(usedData ?? 0);

      const { data: statusRows, error: countError } = await supabase
        .from("paypal_withdrawals")
        .select("status, float_amount");
      if (countError) throw new Error(`Withdrawal count failed: ${countError.message}`);
      const byStatus: Record<string, number> = {};
      let floatPaidOut = 0;
      for (const r of (statusRows ?? []) as Array<{ status: string; float_amount: number }>) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.status === "completed") floatPaidOut += Number(r.float_amount ?? 0);
      }

      const requested = typeof body.limit === "number" ? body.limit : 50;
      const limit = Math.min(200, Math.max(1, Math.floor(requested) || 50));
      const { data: rows, error: listError } = await supabase
        .from("paypal_withdrawals")
        .select(
          "id, user_id, amount, currency, fee_amount, recipient_email, status, " +
          "provider_status, failure_reason, provenance_amount, float_amount, " +
          "created_at, updated_at, completed_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (listError) throw new Error(`Withdrawal list failed: ${listError.message}`);
      const list = (rows ?? []) as Array<Record<string, unknown> & { user_id: string }>;

      // Resolve owner emails in a second step (the sibling-admin
      // pattern): profiles first, the auth record as fallback.
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
        canSetAllowance: await canSetPaypalFloatAllowanceFor(supabase, user.id),
        float: {
          currency: "USD",
          allowance_usd: allowance,
          used_usd: used,
          remaining_usd: floatAvailable(allowance, used),
          paid_out_usd: roundMoney(floatPaidOut),
        },
        counts: { total: (statusRows ?? []).length, byStatus },
        withdrawals: list.map((r) => ({
          ...r,
          email: emailByUser.get(r.user_id) ?? null,
        })),
      });
    }

    // ── Set allowance (super_admin only, audit-logged) ──
    if (action === "set_allowance") {
      if (!(await canSetPaypalFloatAllowanceFor(supabase, user.id))) {
        return json({ success: false, status: "forbidden", error: SET_REFUSAL_MESSAGE }, 403);
      }
      const raw = typeof body.allowance_usd === "number" ? body.allowance_usd : Number(body.allowance_usd);
      if (!Number.isFinite(raw) || raw < 0) {
        return json({
          success: false,
          status: "invalid",
          error: "Enter an allowance of 0 or more, in US dollars.",
        }, 400);
      }
      const allowance = roundMoney(raw);

      const { data: before, error: beforeError } = await supabase
        .from("platform_settings")
        .select("paypal_float_allowance_usd")
        .eq("id", true)
        .maybeSingle();
      if (beforeError) throw new Error(`Float settings read failed: ${beforeError.message}`);
      const previous = Number(before?.paypal_float_allowance_usd ?? 0);

      const { error: updateError } = await supabase
        .from("platform_settings")
        .update({ paypal_float_allowance_usd: allowance })
        .eq("id", true);
      if (updateError) throw new Error(`Float allowance update failed: ${updateError.message}`);

      // Audit is REQUIRED, not best-effort (the mobile-money
      // pattern): if this insert fails we surface a 500 even though
      // the setting has changed, so the gap is reconciled instead of
      // silently losing the trail for a privileged money setting.
      const { error: auditError } = await supabase
        .from("audit_logs")
        .insert({
          user_id: user.id,
          action: "set_paypal_float_allowance",
          table_name: "platform_settings",
          record_id: "paypal_float_allowance_usd",
          old_values: { paypal_float_allowance_usd: previous },
          new_values: { paypal_float_allowance_usd: allowance },
        });
      if (auditError) {
        logStep("AUDIT INSERT FAILED after allowance update", { message: auditError.message });
        return json({
          success: false,
          status: "error",
          error: "The allowance was updated, but the audit record could not be written. Please tell the platform owner before relying on this change.",
        }, 500);
      }

      const { data: usedData } = await supabase.rpc("paypal_float_used_usd");
      const used = Number(usedData ?? 0);
      return json({
        success: true,
        float: {
          currency: "USD",
          allowance_usd: allowance,
          used_usd: used,
          remaining_usd: floatAvailable(allowance, used),
        },
      });
    }

    return json({
      success: false,
      status: "invalid",
      error: "That action is not supported. Please try again.",
    }, 400);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in paypal-admin", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "Something went wrong with that request. No money has moved — please try again.",
    }, 500);
  }
});
