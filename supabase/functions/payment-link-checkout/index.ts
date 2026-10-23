// payment-link-checkout: settlement entry point for public payment
// links (the /pay/:code page). Phase 1.5 — see
// migrations/20261021_checkout_settlement_phase1_5.sql.
//
// Before this function existed, PublicCheckout invoked the mock
// `process-payment`, which required the *payer* to be signed in and
// settled against the *caller's* wallet via .single() — so link income
// never reached the link owner, and multi-wallet users hard-failed.
//
// What happens now:
//   - The link names a settlement account (payment_links.account_id,
//     NULL = Main). On a successful payment the OWNER's wallet for that
//     account and the link currency is credited — by
//     execute_payment_link_settlement, executed here with a dedicated
//     service-role client. The caller's JWT is never forwarded into the
//     money path: the protect_wallet_balance trigger silently
//     neutralizes balance UPDATEs made under a user session.
//   - Paying from a BMaGlass wallet balance requires the payer to be
//     signed in; the RPC debits their Main wallet and credits the owner
//     atomically, with ledger rows on both sides and idempotency.
//   - Card / mobile money / bank for links have no live gateway behind
//     them today, so they return a truthful 'not_configured' state
//     (see _shared/payment-providers.ts). A guest does NOT need a
//     BMaGlass account for those methods in principle — the day a real
//     gateway is connected, its completion path credits the owner via
//     the same RPC with p_payer_user_id NULL (credit-only leg).
//
// Actions:
//   { action: "describe", link_code }
//       → { success, settlement_account_name, link } — lets the public
//         page render the link (title/amount/currency) AND show where
//         the money settles. The page loads the link from HERE, not
//         from a direct payment_links select: table RLS gives anon a
//         public read but authenticated non-owners no read, so any
//         signed-in third party — exactly who wallet payment is for —
//         got "link not found" from the table while guests saw it
//         fine. Accounts are owner-only under RLS, so the settlement
//         name is also served from here, service-role side.
//       → link carries only what the checkout page displays:
//         { id, title, description, amount, currency, status,
//           user_id, account_id }. user_id lets the page keep its
//         client-side "you cannot pay your own link" pre-check; the
//         pay action re-checks it server-side regardless.
//   { link_code, payment_method, amount?, idempotency_key, email? }
//       → wallet settlement or a truthful not_configured refusal.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyLinkMethod } from "../_shared/payment-providers.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    // Dedicated service-role client — deliberately NOT the shared
    // request-scoped one: that forwards the caller's Authorization
    // header, which would put auth.uid() back in scope for the RPC and
    // trip the balance-protection trigger (internal-transfer's lesson).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json();
    const linkCode = typeof body.link_code === "string" ? body.link_code.trim() : "";
    if (!linkCode) {
      return json({ success: false, status: "invalid", error: "link_code is required" }, 400);
    }

    const { data: link, error: linkError } = await admin
      .from("payment_links")
      .select("id, user_id, title, description, amount, currency, status, account_id, expires_at, max_payments, payment_count")
      .eq("link_code", linkCode)
      .maybeSingle();

    if (linkError) throw new Error(linkError.message);
    if (!link || link.status !== "active") {
      return json({ success: false, status: "not_found", error: "Payment link not found or no longer active" }, 404);
    }

    // ── describe: the public link payload + where its money settles ──
    if (body.action === "describe") {
      let settlementAccountName = "Main account";
      if (link.account_id) {
        const { data: account } = await admin
          .from("accounts")
          .select("name")
          .eq("id", link.account_id)
          .maybeSingle();
        if (account?.name) settlementAccountName = account.name;
      }
      return json({
        success: true,
        settlement_account_name: settlementAccountName,
        link: {
          id: link.id,
          title: link.title,
          description: link.description ?? null,
          amount: link.amount != null ? Number(link.amount) : null,
          currency: link.currency,
          status: link.status,
          user_id: link.user_id,
          account_id: link.account_id,
        },
      });
    }

    // ── pay ──
    const route = classifyLinkMethod(String(body.payment_method || ""));
    if (route.kind === "not_configured") {
      // Truthful refusal: nothing is charged and nothing settles.
      return json({ success: false, status: "not_configured", error: route.error });
    }

    // Wallet payment: the payer must be signed in. The Authorization
    // header carries the anon key for guests — getUser rejects it.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return json({
        success: false,
        status: "unauthorized",
        error: "Sign in with your BMaGlass account to pay from your wallet balance.",
      }, 401);
    }
    if (user.id === link.user_id) {
      return json({
        success: false,
        status: "invalid",
        error: "You cannot pay your own payment link.",
      }, 400);
    }

    // ── Freeze guard: a frozen account cannot pay from its wallet ──
    if (await isAccountFrozen(admin, user.id)) {
      return json({
        success: false,
        status: "account_frozen",
        error: ACCOUNT_FROZEN_MESSAGE,
      }, 403);
    }

    const amount = link.amount != null ? Number(link.amount) : Number(body.amount);
    if (!amount || amount <= 0) {
      return json({ success: false, status: "invalid", error: "Enter a valid amount" }, 400);
    }
    if (amount > 1_000_000) {
      return json({ success: false, status: "invalid", error: "Amount exceeds the per-payment limit" }, 400);
    }
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    if (idempotencyKey.length < 8) {
      return json({ success: false, status: "invalid", error: "A valid idempotency_key is required" }, 400);
    }

    const { data, error } = await admin.rpc("execute_payment_link_settlement", {
      p_link_id: link.id,
      p_payer_user_id: user.id,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
      p_payment_method: "wallet",
      p_description: `Payment link: ${link.title}`,
    });
    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return json({
      success: true,
      status: "completed",
      transaction_id: row.transaction_id,
      owner_transaction_id: row.owner_transaction_id,
      payer_new_balance: row.payer_new_balance != null ? Number(row.payer_new_balance) : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Payment could not be processed";
    return json({ success: false, status: "error", error: message }, 400);
  }
});
