// moonpay-reconcile: the reconciliation backstop for the MoonPay
// card on-ramp (gap closure 2026-10-27, P1).
//
// MoonPay webhooks are at-least-once with a bounded retry budget;
// a terminal event that exhausts its retries would otherwise leave
// its moonpay_transactions row non-terminal forever. This runner
// re-reads STALE non-terminal rows (untouched for
// MOONPAY_RECONCILE_STALE_MS) from MoonPay's API —
// GET https://api.moonpay.com/v1/transactions/{id}?apiKey=<pk> —
// and applies what it learns through planMoonpayEventApplication,
// the SAME application plan moonpay-webhook uses. There is no
// second settlement path: a poll writes exactly what a webhook
// event carrying the same updatedAt would write (order guard,
// terminal-sticky status machine, tracking fields), and re-polling
// an already-applied state is a no-op by that guard. Like the
// webhook, this is TRACKING ONLY — BTC crediting belongs to the
// deposit-detection pipeline; nothing here touches a balance.
//
// SCHEDULER-ONLY: invoked by pg_cron (migration 20261238) with the
// service-role key as the bearer, the btc-onchain check_deposits /
// consolidate pattern. A signed-in USER gets 403; anything else
// unauthenticated gets 401. verify_jwt stays ON in config.toml so
// the gateway itself rejects non-JWT callers before this code runs.
//
// Quiet-skip semantics (scheduler context, mirroring btc-onchain):
// when the rail is not configured there is nothing to reconcile —
// a 200 { skipped: true } rather than an error, so cron logs stay
// clean while the rail is dark.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  moonpayConfig,
  MOONPAY_NON_TERMINAL_STATUSES,
  parseMoonpayTransactionLookup,
  planMoonpayEventApplication,
  selectStaleMoonpayTransactions,
} from "../_shared/moonpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[MOONPAY-RECONCILE] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Oldest-first batch cap: a backstop, not a bulk sync. */
const BATCH_LIMIT = 50;

const MOONPAY_API_BASE = "https://api.moonpay.com";

/** Constant-time string comparison (the service-key check). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = getServiceRoleClient();

  try {
    // ── Scheduler-only gate ──
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!serviceKey || !token || !timingSafeEqual(token, serviceKey)) {
      // A real signed-in user is told plainly this is not theirs to
      // run (403); anything else is simply unauthenticated (401).
      if (token) {
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user?.id) {
          return json({
            success: false,
            status: "forbidden",
            error: "MoonPay reconciliation runs automatically on the platform's schedule — there's nothing for you to run here.",
          }, 403);
        }
      }
      return json({
        success: false,
        status: "unauthorized",
        error: "Service role required.",
      }, 401);
    }

    // ── Configuration: quiet skip while the rail is dark ──
    const config = moonpayConfig({
      publishableKey: Deno.env.get("MOONPAY_PUBLISHABLE_KEY") ?? null,
      secretKey: Deno.env.get("MOONPAY_SECRET_KEY") ?? null,
      webhookKey: Deno.env.get("MOONPAY_WEBHOOK_KEY") ?? null,
    });
    if (!config.configured || !config.publishableKey) {
      logStep("MoonPay not configured — skipping");
      return json({ success: true, skipped: true, reason: "not_configured" });
    }

    // ── Candidates: this environment's non-terminal rows that
    // carry a MoonPay transaction id, oldest activity first. The
    // stale decision itself is the pure, unit-tested selector.
    const { data: rows, error: selectError } = await supabase
      .from("moonpay_transactions")
      .select("id, status, moonpay_transaction_id, updated_at, last_event_updated_at")
      .eq("environment", config.environment)
      .in("status", [...MOONPAY_NON_TERMINAL_STATUSES])
      .not("moonpay_transaction_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (selectError) {
      throw new Error(`MoonPay reconcile candidate lookup failed: ${selectError.message}`);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    // deno-lint-ignore no-explicit-any
    const candidates = (rows ?? []).map((r: any) => ({
      row: r,
      status: r.status as string | null,
      moonpayTransactionId: r.moonpay_transaction_id as string | null,
      updatedAtMs: r.updated_at ? Date.parse(r.updated_at as string) : null,
    }));
    const stale = selectStaleMoonpayTransactions(candidates, nowMs);

    let polled = 0;
    let applied = 0;
    let duplicates = 0;
    let notFound = 0;
    let mismatched = 0;
    let errors = 0;

    for (const candidate of stale) {
      const row = candidate.row;
      const txId = candidate.moonpayTransactionId as string;
      polled++;
      let payload: unknown;
      try {
        const res = await fetch(
          `${MOONPAY_API_BASE}/v1/transactions/${encodeURIComponent(txId)}` +
            `?apiKey=${encodeURIComponent(config.publishableKey)}`,
          { headers: { "Content-Type": "application/json" } },
        );
        if (res.status === 404) {
          // MoonPay has never heard of an id a webhook once gave
          // us — anomalous, but absence is not evidence of failure,
          // so the row is left exactly as it is and counted.
          notFound++;
          logStep("MoonPay does not know this transaction — row left unchanged", {
            id: row.id,
            moonpayTransactionId: txId,
          });
          continue;
        }
        if (!res.ok) throw new Error(`MoonPay API answered ${res.status}`);
        payload = await res.json();
      } catch (e) {
        errors++;
        logStep("MoonPay lookup failed — row left unchanged", {
          id: row.id,
          moonpayTransactionId: txId,
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const parsed = parseMoonpayTransactionLookup(payload);
      if (parsed.moonpayTransactionId !== txId) {
        // Never apply one transaction's state to another's row.
        mismatched++;
        logStep("MoonPay lookup answered a different transaction — row left unchanged", {
          id: row.id,
          moonpayTransactionId: txId,
          answered: parsed.moonpayTransactionId,
        });
        continue;
      }

      const storedMs = row.last_event_updated_at
        ? Date.parse(row.last_event_updated_at as string)
        : null;
      const plan = planMoonpayEventApplication(
        { status: row.status as string | null, lastEventUpdatedAtMs: storedMs },
        parsed,
        payload,
        nowIso,
        "reconcile_poll",
      );
      if (!plan.apply || !plan.update) {
        // Already applied (a webhook beat the poll, or a previous
        // poll did) — the order guard makes re-polling a no-op.
        duplicates++;
        continue;
      }
      const { error: updateError } = await supabase
        .from("moonpay_transactions")
        .update(plan.update)
        .eq("id", row.id);
      if (updateError) {
        errors++;
        logStep("MoonPay reconcile update failed", {
          id: row.id,
          message: updateError.message,
        });
        continue;
      }
      applied++;
      logStep("Stale purchase reconciled", {
        id: row.id,
        moonpayTransactionId: txId,
        status: plan.update.status ?? row.status,
      });
    }

    const summary = {
      success: true,
      scanned: candidates.length,
      stale: stale.length,
      polled,
      applied,
      duplicates,
      notFound,
      mismatched,
      errors,
      environment: config.environment,
    };
    logStep("Reconcile run complete", summary);
    return json(summary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in moonpay-reconcile", { message: errorMessage });
    return json({
      success: false,
      status: "error",
      error: "MoonPay reconciliation failed — it will run again on schedule.",
    }, 500);
  }
});
