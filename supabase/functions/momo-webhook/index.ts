// momo-webhook: the mobile-money gateway's event endpoint for
// MERCHANT collections (one shared URL; the merchant enters it in
// their own gateway dashboard — their account, their webhook).
//
// Protection model:
//   * verify_jwt = false (the gateway sends no Supabase JWT). The
//     actual gate is the per-merchant signature: the header carries
//     HMAC-SHA512 of the raw body keyed with SHA256(merchant's API
//     token) — verified against the token in THAT merchant's
//     encrypted connection, found via the collection reference in
//     the payload. Anything unverifiable answers 401.
//   * The payload is a HINT, never the truth: on a verified event we
//     re-query the gateway and settle only from its answer, through
//     the exactly-once settle RPC. Duplicate deliveries (the gateway
//     retries for 24h) are therefore harmless no-ops.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyWebhookSignature } from "../_shared/momo-rail.ts";
import { loadConnection, refreshCollectionFromRail } from "../_shared/momo-rail-server.ts";
import { dispatchPaymentLinkPaid } from "../_shared/developer-webhooks.ts";
import { platformChargeFor } from "../_shared/momo-rail.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const db = admin();
  try {
    const rawBody = await req.text();
    let payload: { event?: string; data?: { reference?: string } } = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_payload" }, 400);
    }
    const reference = typeof payload?.data?.reference === "string" ? payload.data.reference : "";
    if (!reference) return json({ error: "unverifiable" }, 401);

    const { data: row } = await db
      .from("momo_collections")
      .select("id, user_id, environment, payment_link_id")
      .eq("reference", reference)
      .maybeSingle();
    if (!row) return json({ error: "unverifiable" }, 401);

    const conn = await loadConnection(db, row.user_id, row.environment);
    if (!conn?.secretKey) return json({ error: "unverifiable" }, 401);

    const signature = req.headers.get("x-lenco-signature");
    const verified = await verifyWebhookSignature(rawBody, conn.secretKey, signature);
    if (!verified) return json({ error: "invalid_signature" }, 401);

    // Verified hint: re-query and settle from the gateway's answer.
    const outcome = await refreshCollectionFromRail(db, reference);

    if (outcome.just_settled && outcome.payment_link_id) {
      const { data: link } = await db
        .from("payment_links")
        .select("id, link_code, title, user_id, fee_payer")
        .eq("id", outcome.payment_link_id)
        .maybeSingle();
      if (link && outcome.transaction_id && outcome.amount != null) {
        await dispatchPaymentLinkPaid(db, link, {
          ownerTransactionId: outcome.transaction_id,
          amount: outcome.amount,
          currency: "ZMW",
          paymentMethod: "mobile_money",
          feePayer: link.fee_payer === "buyer" ? "buyer" : "seller",
          // The recorded 1% charge is 1% of the PRODUCT amount —
          // never of the grossed total a buyer-bears collection
          // charges on top (migration 20261266).
          feeAmount: platformChargeFor(outcome.base_amount ?? outcome.amount),
          totalCharged: outcome.amount,
          settledAt: new Date().toISOString(),
        }).catch((e) => console.error("payment_link.paid dispatch failed:", e));
      }
    }

    return json({ received: true, status: outcome.collection_status ?? "pending" });
  } catch (e) {
    console.error("momo-webhook failed:", e instanceof Error ? e.message : e);
    // A 500 invites the gateway's 30-minute retries — right for
    // transient failures on verified traffic.
    return json({ error: "internal_error" }, 500);
  }
});
