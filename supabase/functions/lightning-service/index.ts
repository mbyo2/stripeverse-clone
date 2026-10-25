// lightning-service: custodial Lightning Network via the configured
// Lightning provider (Coinos — see _shared/lightning-provider.ts).
// The function name is historical (the original Breez leg is gone);
// clients invoke it as "lightning-service" and its response shapes are
// unchanged.
// Actions:
//   POST { action: "create_invoice", amount_sats, description } → bolt11 invoice
//   POST { action: "pay_invoice", bolt11 } → pay from user balance
//   POST { action: "check_status", breez_invoice_id } → poll invoice status
//        (breez_invoice_id is the lightning_payments row id returned as
//        payment_id by create_invoice)
//
// Auth: user JWT required; identity comes from the verified token only.
// Balances are integer sats in crypto_wallets, moved ONLY through the
// btc_adjust_crypto_wallet RPC (row-locked, non-negative), the atomic
// btc_settle_lightning_deposit RPC in check_status (single-transaction
// claim + credit — a settled invoice can never be credited twice), or
// the reserve/settle RPC sequence in pay_invoice (an outbound payment
// can never overdraw or double-spend the wallet).
//
// History note: the previous version decoded invoice amounts with
// floating-point math (mispricing pico-denominated invoices) and did
// read-modify-write balance updates, so two concurrent calls could
// double-credit or double-pay. Amounts are now decoded with BigInt via
// _shared/btc-core.ts (unit-tested).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import { decodeBolt11Msat } from "../_shared/btc-core.ts";
import {
  LightningNotConfiguredError,
  LightningUpstreamError,
  PROVIDER_PAY_CONFIRMED,
  lightningProviderConfigured,
  providerCreateInvoice,
  providerGetInvoice,
  providerPayInvoice,
} from "../_shared/lightning-provider.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  ACCOUNT_STATUS_UNVERIFIED_MESSAGE,
  assertAccountNotFrozen,
} from "../_shared/account-freeze.ts";

const MAX_SATS = (() => {
  const raw = Deno.env.get("BREEZ_MAX_SATS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Designed refusals, in the { error } shape the frontend surfaces
// verbatim. Lightning gates on the provider configuration alone
// (LIGHTNING_PROVIDER + provider token): the provider runs its own
// custodial wallet server-side, so the on-chain seed⇄xpub interlock
// does not apply here and the wording names Lightning, not Bitcoin
// custody. Inbound settlement is exactly-once by construction:
// check_status credits through the single-transaction
// btc_settle_lightning_deposit RPC (migration 20261022), never through
// separate claim/credit calls.
const LIGHTNING_DEPOSITS_NOT_CONFIGURED =
  "Lightning deposits are not available yet — Lightning is not configured on this deployment.";
const LIGHTNING_PAYMENTS_NOT_CONFIGURED =
  "Lightning payments are not available yet — Lightning is not configured on this deployment.";
// Upstream-unreachable refusals: truthful and plain. Lightning deposits
// and payments are not available on the custodial wallet yet (Lightning
// lives in the self-custody Spark wallet); on-chain Bitcoin works.
const LIGHTNING_DEPOSITS_UNAVAILABLE =
  "Lightning deposits are not available yet — please use an on-chain Bitcoin deposit for now.";
const LIGHTNING_PAYMENTS_UNAVAILABLE =
  "Lightning payments are not available yet — please use an on-chain Bitcoin payment for now.";

// Returns the designed 503 refusal while the provider is not
// configured, else null.
function lightningProviderGate(refusal: string): Response | null {
  if (!lightningProviderConfigured()) {
    console.error("lightning-service: Lightning provider not configured");
    return json(503, { error: refusal });
  }
  return null;
}

// PostgREST/RPC failures are plain objects with a message, not Error
// instances — an `instanceof Error` test alone collapses them into a
// contentless fallback and the user learns nothing. Extract the real
// message from any thrown value that carries one.
function thrownMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  const m = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof m === "string" && m.trim()) return m;
  return fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let currentAction = "";
  try {
    const supabase = getSupabaseClient(req);
    // All DB work below runs through the dedicated service-role client:
    // lightning_payments is SELECT-own-only under RLS and the btc_* RPCs
    // are service_role-only, while the request client forwards the
    // caller's JWT (PostgREST would run as `authenticated` and be
    // denied). Identity is verified from the JWT via `supabase`; rows
    // and money move via `admin`. (Pattern: atomic-transfer.)
    const admin = getServiceRoleClient();
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    const { action, amount_sats, description, bolt11, breez_invoice_id } = await req.json();
    currentAction = typeof action === "string" ? action : "";

    // ── Create inbound Lightning invoice ──
    if (action === "create_invoice") {
      const gate = lightningProviderGate(LIGHTNING_DEPOSITS_NOT_CONFIGURED);
      if (gate) return gate;

      const sats = Number(amount_sats);
      if (!Number.isInteger(sats) || sats <= 0 || sats > MAX_SATS) {
        return json(400, { error: `amount_sats must be an integer between 1 and ${MAX_SATS}` });
      }

      const invoice = await providerCreateInvoice(
        sats,
        description || `Deposit for ${user.id.slice(0, 8)}`,
      );

      // Never trust the provider's say-so on the amount: decode the
      // returned bolt11 with integer math and refuse (upstream error)
      // if it does not encode exactly the requested sats — crediting
      // keys off the ledger row amount, so a mismatched invoice must
      // never reach the ledger at all.
      const msat = decodeBolt11Msat(invoice.bolt11);
      if (msat === null || msat !== BigInt(sats) * 1000n) {
        throw new LightningUpstreamError(
          "Lightning provider returned an invoice with a mismatched amount",
        );
      }

      // breez_invoice_id stores the provider's invoice id — it is
      // the status-lookup key for check_status (the Coinos payment
      // hash is kept separately in payment_hash).
      const { data: payment, error } = await admin.from("lightning_payments").insert({
        user_id: user.id,
        direction: "inbound",
        amount_sats: sats,
        breez_invoice_id: invoice.providerId,
        bolt11: invoice.bolt11,
        payment_hash: invoice.paymentHash,
        status: "pending",
      }).select("id").single();

      if (error) throw error;

      return json(200, {
        payment_id: payment.id,
        bolt11: invoice.bolt11,
        payment_hash: invoice.paymentHash,
      });
    }

    // ── Pay an outbound Lightning invoice (from wallet balance) ──
    if (action === "pay_invoice") {
      const gate = lightningProviderGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;

      // Freeze guard: a frozen account cannot send Lightning payments
      // (receiving stays open). Refuse with the shared crafted message
      // BEFORE any balance is reserved. A failed status read fails
      // closed with the unverified message, same as every other
      // money-out function using this helper.
      try {
        await assertAccountNotFrozen(admin, user.id);
      } catch (e) {
        const msg = thrownMessage(e, ACCOUNT_STATUS_UNVERIFIED_MESSAGE);
        if (msg === ACCOUNT_FROZEN_MESSAGE) return json(403, { error: msg });
        return json(503, { error: msg });
      }

      // The provider's pay contract could not be confirmed live
      // (Coinos POST /payments answered 200/empty with no observable
      // effect at zero balance for every probed shape), so outbound
      // Lightning stays at the designed not-available refusal — with
      // the full reserve/pay/settle flow below wired and ready —
      // until a funded drill confirms the shape and flips
      // PROVIDER_PAY_CONFIRMED in _shared/lightning-provider.ts.
      if (!PROVIDER_PAY_CONFIRMED) {
        return json(503, { error: LIGHTNING_PAYMENTS_UNAVAILABLE });
      }

      if (!bolt11 || typeof bolt11 !== "string") {
        return json(400, { error: "bolt11 required" });
      }

      // Decode the amount with integer math BEFORE any money moves, and
      // verify the balance covers it. Our ledger is whole sats, so
      // sub-sat (millisat remainder) invoices are refused, not rounded.
      const msat = decodeBolt11Msat(bolt11);
      if (msat === null || msat <= 0n) {
        return json(400, { error: "Could not decode invoice amount" });
      }
      if (msat % 1000n !== 0n) {
        return json(400, { error: "Invoice amount must be a whole number of sats" });
      }
      const sats = Number(msat / 1000n);
      if (sats > MAX_SATS) {
        return json(400, { error: `Invoice exceeds the ${MAX_SATS} sat payment limit` });
      }

      // Record the attempt first — it is the audit + idempotency anchor.
      const { data: payment, error: insErr } = await admin.from("lightning_payments").insert({
        user_id: user.id,
        direction: "outbound",
        amount_sats: sats,
        bolt11,
        status: "pending",
      }).select("id").single();
      if (insErr) throw insErr;

      // Reserve spendable balance atomically (row-locked RPC; raises on
      // insufficient funds). A concurrent payment now cannot pass with
      // the same sats.
      const { error: reserveErr } = await admin.rpc("btc_adjust_crypto_wallet", {
        p_user_id: user.id,
        p_delta_balance: 0,
        p_delta_available: -sats,
      });
      if (reserveErr) {
        await admin.from("lightning_payments")
          .update({ status: "failed" }).eq("id", payment.id);
        return json(400, { error: "Insufficient BTC balance" });
      }

      // Balance reserved — now pay via the Lightning provider.
      let payResult: { paymentHash?: string };
      try {
        payResult = await providerPayInvoice(bolt11);
      } catch (e) {
        // Payment provably not made by us: release the reservation.
        await admin.rpc("btc_adjust_crypto_wallet", {
          p_user_id: user.id,
          p_delta_balance: 0,
          p_delta_available: sats,
        });
        await admin.from("lightning_payments")
          .update({ status: "failed" }).eq("id", payment.id);
        throw e;
      }

      // Settle the total balance (available was already reduced). If this
      // ever failed, the reservation still prevents re-spending the sats
      // and the paid lightning_payments row is the reconciliation record.
      const { error: settleErr } = await admin.rpc("btc_adjust_crypto_wallet", {
        p_user_id: user.id,
        p_delta_balance: -sats,
        p_delta_available: 0,
      });
      if (settleErr) {
        console.error("CRITICAL: Lightning paid but balance settle failed", payment.id, settleErr);
      }

      const paymentHash = payResult.paymentHash ?? null;
      await admin.from("lightning_payments").update({
        status: "paid",
        payment_hash: paymentHash,
        settled_at: new Date().toISOString(),
      }).eq("id", payment.id);

      const { error: txErr } = await admin.from("transactions").insert({
        user_id: user.id,
        currency: "BTC",
        amount: sats / 100_000_000,
        direction: "outgoing",
        payment_method: "lightning",
        status: "completed",
        description: "Lightning payment",
        reference: paymentHash,
        category: "lightning_payment",
        transaction_id: paymentHash || `ln-out-${payment.id}`,
        idempotency_key: `ln-out:${payment.id}`,
        metadata: { type: "lightning_payment", sats },
      });
      if (txErr) console.error("Lightning payment ledger row failed:", txErr);

      return json(200, { ok: true, paid_sats: sats, payment_id: payment.id });
    }

    // ── Check inbound invoice status; credit on settlement ──
    if (action === "check_status") {
      if (!breez_invoice_id) {
        return json(400, { error: "breez_invoice_id required" });
      }

      const { data: payment } = await admin.from("lightning_payments")
        .select("*").eq("id", breez_invoice_id).eq("user_id", user.id).single();

      if (!payment) return json(404, { error: "Payment not found" });
      if (payment.direction !== "inbound") {
        return json(400, { error: "Not an inbound invoice" });
      }
      if (payment.status === "paid") return json(200, { status: "paid" });
      if (payment.status === "expired" || payment.status === "failed") {
        return json(200, { status: payment.status });
      }

      const { state } = await providerGetInvoice(payment.breez_invoice_id);
      const isPaid = state === "paid";

      if (!isPaid) {
        if (state === "expired") {
          await admin.from("lightning_payments")
            .update({ status: "expired" }).eq("id", payment.id);
          return json(200, { status: "expired" });
        }
        return json(200, { status: "pending" });
      }

      // Settle EXACTLY ONCE through the single-transaction RPC
      // (btc_settle_lightning_deposit, migration 20261022): the claim
      // (pending → paid), the wallet credit and the ledger row commit
      // or roll back TOGETHER, so no hard stop can strand a paid-but-
      // uncredited invoice and no retry or concurrent poll can
      // double-credit. The RPC credits the amount recorded on the
      // payment row — never a caller-supplied figure — and is
      // idempotent on the payment id.
      const { data: settleRows, error: settleErr } = await admin.rpc(
        "btc_settle_lightning_deposit",
        { p_payment_id: payment.id },
      );
      if (settleErr) throw settleErr;
      const outcome = Array.isArray(settleRows) ? settleRows[0] : settleRows;
      if (!outcome) throw new Error("btc_settle_lightning_deposit returned no row");
      if (outcome.outcome === "credited" || outcome.outcome === "already_settled") {
        return json(200, { status: "paid" });
      }
      // The row changed state under us (e.g. expired concurrently) —
      // report its recorded status rather than inventing one.
      console.error(
        "lightning-service check_status: settle outcome",
        outcome.outcome, "for payment", payment.id,
      );
      return json(200, { status: outcome.payment_status ?? "pending" });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    if (e instanceof LightningNotConfiguredError) {
      console.error("lightning-service: Lightning provider not configured");
      return json(503, { error: "Lightning is not available yet — it is not configured on this deployment." });
    }
    if (e instanceof LightningUpstreamError) {
      // The provider could not be reached or answered with an error.
      // Log the real cause server-side; the user gets the plain truth:
      // Lightning is not available on the custodial wallet yet. Never
      // leak the raw network/provider error (live-proven leak,
      // 2026-10-22: verbatim DNS failure text reached the API caller).
      console.error("lightning-service: Lightning provider unavailable:", e.message);
      return json(503, {
        error: currentAction === "pay_invoice"
          ? LIGHTNING_PAYMENTS_UNAVAILABLE
          : LIGHTNING_DEPOSITS_UNAVAILABLE,
      });
    }
    console.error("lightning-service error:", e);
    return json(500, { error: thrownMessage(e, "Lightning operation failed") });
  }
});
