// breez-lightning: Lightning Network via Breez nodeless API.
// Actions:
//   POST { action: "create_invoice", amount_sats, description } → bolt11 invoice
//   POST { action: "pay_invoice", bolt11 } → pay from user balance
//   POST { action: "check_status", breez_invoice_id } → poll invoice status
//        (breez_invoice_id is the lightning_payments row id returned as
//        payment_id by create_invoice)
//
// Auth: user JWT required; identity comes from the verified token only.
// Balances are integer sats in crypto_wallets, moved ONLY through the
// btc_adjust_crypto_wallet RPC (row-locked, non-negative) or the atomic
// claim-then-credit sequence in check_status — a settled invoice can
// never be credited twice, and an outbound payment can never overdraw
// or double-spend the wallet.
//
// History note: the previous version decoded invoice amounts with
// floating-point math (mispricing pico-denominated invoices) and did
// read-modify-write balance updates, so two concurrent calls could
// double-credit or double-pay. Amounts are now decoded with BigInt via
// _shared/btc-core.ts (unit-tested).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { custodyStatus, decodeBolt11Msat } from "../_shared/btc-core.ts";

const BREEZ_API = "https://api.breez.technology";
const MAX_SATS = (() => {
  const raw = Deno.env.get("BREEZ_MAX_SATS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Thrown when the Breez server key is absent. Mapped in the top-level
 * catch to a designed 503 refusal — Lightning being unconfigured is a
 * deployment state the user should be told about truthfully, not a
 * bare 500 leaking the secret's name.
 */
class LightningNotConfiguredError extends Error {}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Designed refusals: Lightning deposits/payments credit and debit the
// SAME custodial BTC balance as on-chain custody, so while custody is
// not genuinely configured (seed and MATCHED xpub both present — see
// custodyStatus in btc-core) they refuse with these plain-language
// messages, in the { error } shape the frontend surfaces verbatim.
// Gating creation is also what closes the deposit-credit failure
// window for new invoices: no invoice can be created — and therefore
// no paid invoice can be stranded awaiting its credit — until custody
// is configured and the credit path is reviewed for live funds.
const LIGHTNING_DEPOSITS_NOT_CONFIGURED =
  "Lightning deposits are not available yet — Bitcoin custody is not configured on this deployment.";
const LIGHTNING_PAYMENTS_NOT_CONFIGURED =
  "Lightning payments are not available yet — Bitcoin custody is not configured on this deployment.";

function custodyGate(refusal: string): Response | null {
  const c = custodyStatus(
    Deno.env.get("BTC_SEED_MNEMONIC"),
    Deno.env.get("BTC_XPUB"),
  );
  if (c.configured) return null;
  console.error("breez-lightning: custody not configured (" + c.reason + ")");
  return json(503, { error: refusal });
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

async function breezFetch(path: string, method: string, body?: unknown) {
  const apiKey = Deno.env.get("BREEZ_API_KEY");
  if (!apiKey) throw new LightningNotConfiguredError("BREEZ_API_KEY not configured");
  const res = await fetch(`${BREEZ_API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Breez API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    const { action, amount_sats, description, bolt11, breez_invoice_id } = await req.json();

    // ── Create inbound Lightning invoice ──
    if (action === "create_invoice") {
      const gate = custodyGate(LIGHTNING_DEPOSITS_NOT_CONFIGURED);
      if (gate) return gate;

      const sats = Number(amount_sats);
      if (!Number.isInteger(sats) || sats <= 0 || sats > MAX_SATS) {
        return json(400, { error: `amount_sats must be an integer between 1 and ${MAX_SATS}` });
      }

      const invoice = await breezFetch("/v2/invoices", "POST", {
        amount_msat: sats * 1000,
        description: description || `Deposit for ${user.id.slice(0, 8)}`,
      });
      const bolt11Invoice = invoice.bolt11 || invoice.invoice;
      const breezId = invoice.id || invoice.invoice_id;
      if (!bolt11Invoice || !breezId) {
        throw new Error("Breez returned an incomplete invoice");
      }

      const { data: payment, error } = await supabase.from("lightning_payments").insert({
        user_id: user.id,
        direction: "inbound",
        amount_sats: sats,
        breez_invoice_id: breezId,
        bolt11: bolt11Invoice,
        payment_hash: invoice.payment_hash ?? null,
        status: "pending",
      }).select("id").single();

      if (error) throw error;

      return json(200, {
        payment_id: payment.id,
        bolt11: bolt11Invoice,
        payment_hash: invoice.payment_hash ?? null,
      });
    }

    // ── Pay an outbound Lightning invoice (from wallet balance) ──
    if (action === "pay_invoice") {
      const gate = custodyGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;

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
      const { data: payment, error: insErr } = await supabase.from("lightning_payments").insert({
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
      const { error: reserveErr } = await supabase.rpc("btc_adjust_crypto_wallet", {
        p_user_id: user.id,
        p_delta_balance: 0,
        p_delta_available: -sats,
      });
      if (reserveErr) {
        await supabase.from("lightning_payments")
          .update({ status: "failed" }).eq("id", payment.id);
        return json(400, { error: "Insufficient BTC balance" });
      }

      // Balance reserved — now pay via Breez.
      let payResult: any;
      try {
        payResult = await breezFetch("/v2/payments", "POST", { bolt11 });
      } catch (e) {
        // Payment provably not made by us: release the reservation.
        await supabase.rpc("btc_adjust_crypto_wallet", {
          p_user_id: user.id,
          p_delta_balance: 0,
          p_delta_available: sats,
        });
        await supabase.from("lightning_payments")
          .update({ status: "failed" }).eq("id", payment.id);
        throw e;
      }

      // Settle the total balance (available was already reduced). If this
      // ever failed, the reservation still prevents re-spending the sats
      // and the paid lightning_payments row is the reconciliation record.
      const { error: settleErr } = await supabase.rpc("btc_adjust_crypto_wallet", {
        p_user_id: user.id,
        p_delta_balance: -sats,
        p_delta_available: 0,
      });
      if (settleErr) {
        console.error("CRITICAL: Lightning paid but balance settle failed", payment.id, settleErr);
      }

      const paymentHash = payResult.payment_hash ?? null;
      await supabase.from("lightning_payments").update({
        status: "paid",
        payment_hash: paymentHash,
        settled_at: new Date().toISOString(),
      }).eq("id", payment.id);

      const { error: txErr } = await supabase.from("transactions").insert({
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

      const { data: payment } = await supabase.from("lightning_payments")
        .select("*").eq("id", breez_invoice_id).eq("user_id", user.id).single();

      if (!payment) return json(404, { error: "Payment not found" });
      if (payment.direction !== "inbound") {
        return json(400, { error: "Not an inbound invoice" });
      }
      if (payment.status === "paid") return json(200, { status: "paid" });
      if (payment.status === "expired" || payment.status === "failed") {
        return json(200, { status: payment.status });
      }

      const status = await breezFetch(`/v2/invoices/${payment.breez_invoice_id}`, "GET");
      const isPaid = status.settled || status.status === "paid";

      if (!isPaid) {
        if (status.status === "expired" || status.expired) {
          await supabase.from("lightning_payments")
            .update({ status: "expired" }).eq("id", payment.id);
          return json(200, { status: "expired" });
        }
        return json(200, { status: "pending" });
      }

      // CLAIM before crediting: only the caller that flips
      // pending → paid (conditional on the row still being pending)
      // may credit. Concurrent polls lose the claim and skip crediting.
      //
      // RESIDUAL WINDOW (known, accepted for now): if the process is
      // hard-stopped BETWEEN the claim commit and the credit RPC — not
      // a clean error, which rolls the claim back below — the row stays
      // 'paid' uncredited and later polls early-return at the status
      // check above. Exactly-once credit cannot be built from separate
      // non-atomic calls; the real fix is a single-transaction
      // claim+credit RPC, to land before Lightning handles live funds.
      // Until then this window can only contain invoices created while
      // custody was configured — creation is gated (see create_invoice),
      // so no new invoice can enter it in the unconfigured state.
      const { data: claimed, error: claimErr } = await supabase
        .from("lightning_payments")
        .update({ status: "paid", settled_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("status", "pending")
        .select("id");
      if (claimErr) throw claimErr;
      if (!claimed || claimed.length === 0) {
        return json(200, { status: "paid" }); // settled by a concurrent call
      }

      const sats = Number(payment.amount_sats);
      const { error: creditErr } = await supabase.rpc("btc_adjust_crypto_wallet", {
        p_user_id: user.id,
        p_delta_balance: sats,
        p_delta_available: sats,
      });
      if (creditErr) {
        // The row is already marked paid, so a naive retry would skip
        // crediting. Roll the claim back to pending so the next poll
        // can complete the credit, and surface the failure.
        await supabase.from("lightning_payments")
          .update({ status: "pending", settled_at: null })
          .eq("id", payment.id);
        throw creditErr;
      }

      const { error: txErr } = await supabase.from("transactions").insert({
        user_id: user.id,
        currency: "BTC",
        amount: sats / 100_000_000,
        direction: "incoming",
        payment_method: "lightning",
        status: "completed",
        description: "Lightning deposit",
        reference: payment.payment_hash,
        category: "lightning_deposit",
        transaction_id: payment.payment_hash || `ln-in-${payment.id}`,
        idempotency_key: `ln-in:${payment.id}`,
        metadata: { type: "lightning_deposit", sats },
      });
      if (txErr) console.error("Lightning deposit ledger row failed:", txErr);

      return json(200, { status: "paid" });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    if (e instanceof LightningNotConfiguredError) {
      console.error("breez-lightning: BREEZ_API_KEY not configured");
      return json(503, { error: "Lightning is not available yet — it is not configured on this deployment." });
    }
    console.error("breez-lightning error:", e);
    return json(500, { error: thrownMessage(e, "Lightning operation failed") });
  }
});
