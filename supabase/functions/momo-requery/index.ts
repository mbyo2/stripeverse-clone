// momo-requery: the requery poller the gateway's own documentation
// advises (webhooks cannot be relied on completely). Scheduled by
// pg_cron (migration 20261259) every 10 minutes with the Vault-held
// service-role key as bearer; also safe to invoke manually with the
// same credential.
//
// It re-reads pending collections older than 2 minutes and applies
// each through the SAME refresh driver the webhook and status
// endpoints use — one settlement path, exactly-once by the settle
// RPC's row lock + terminal guard. Quiet 200 when nothing pends.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { refreshCollectionFromRail } from "../_shared/momo-rail-server.ts";
import { dispatchPaymentLinkPaid } from "../_shared/developer-webhooks.ts";
import { platformChargeFor } from "../_shared/momo-rail.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || presented !== serviceKey) {
    return json({ error: "unauthorized" }, 401);
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: rows, error } = await db
      .from("momo_collections")
      .select("reference")
      .eq("status", "pending")
      .lt("created_at", staleBefore)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    let settled = 0;
    let failed = 0;
    let stillPending = 0;
    let errors = 0;
    for (const row of rows ?? []) {
      try {
        const outcome = await refreshCollectionFromRail(db, row.reference);
        if (outcome.just_settled) {
          settled++;
          if (outcome.payment_link_id && outcome.transaction_id && outcome.amount != null) {
            const { data: link } = await db
              .from("payment_links")
              .select("id, link_code, title, user_id, fee_payer")
              .eq("id", outcome.payment_link_id)
              .maybeSingle();
            if (link) {
              await dispatchPaymentLinkPaid(db, link, {
                ownerTransactionId: outcome.transaction_id,
                amount: outcome.amount,
                currency: "ZMW",
                paymentMethod: "mobile_money",
                feePayer: link.fee_payer === "buyer" ? "buyer" : "seller",
                // The recorded 1% charge is 1% of the PRODUCT
                // amount — never of the grossed total a buyer-bears
                // collection charges on top (migration 20261266).
                feeAmount: platformChargeFor(outcome.base_amount ?? outcome.amount),
                totalCharged: outcome.amount,
                settledAt: new Date().toISOString(),
              }).catch(() => null);
            }
          }
        } else if (outcome.just_failed) {
          failed++;
        } else {
          stillPending++;
        }
      } catch (e) {
        errors++;
        console.error("momo-requery row failed:", row.reference, e instanceof Error ? e.message : e);
      }
    }
    return json({ success: true, checked: (rows ?? []).length, settled, failed, still_pending: stillPending, errors });
  } catch (e) {
    console.error("momo-requery failed:", e instanceof Error ? e.message : e);
    return json({ success: false, error: "internal_error" }, 500);
  }
});
