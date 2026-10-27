// btc-sell-selfcustody: SELF-CUSTODY sell-to-ZMW intents.
//
// Actions (POST JSON { action, ... }, user JWT):
//   quote_preview { amount_sats } | { amount_zmw }
//       → indicative (unlocked) quote at the current platform rate.
//   create_intent { rail: "onchain", amount_sats }
//       → locks a quote into an intent and returns the user's own
//         custodial deposit address to send to. The address comes
//         from btc_address_assignments — the user must already have
//         one (the client obtains it via btc-onchain `receive`
//         first); this function never allocates addresses itself.
//   create_intent { rail: "lightning", amount_sats, lightning_payment_id }
//       → binds an intent to an invoice the user already created via
//         lightning-service `create_invoice` (validated: own, inbound,
//         amount matches, not already bound). Returns the bolt11.
//   check { intent_id }
//       → status + one settlement attempt: finds the intent's
//         credited deposit (existing btc_deposits / lightning_payments
//         ledgers) and runs btc_settle_selfcustody_sell. Also lazily
//         expires intents past their settle deadline.
//   list {} → the caller's intents, newest first.
//   cancel { intent_id } → cancel an awaiting intent.
//
// Settlement ALSO runs automatically inside the existing deposit
// paths (btc-onchain check_deposits after btc_record_deposit credits;
// lightning-service check_status after btc_settle_lightning_deposit
// credits) — `check` is the retry, not the primary path. The deposit
// detection/settlement itself is NOT duplicated here.
//
// Policy (see _shared/selfcustody-sell.ts): 1.5% sell fee, quote
// locked at intent creation; deposits credited within the intent
// window + 60-minute grace settle at the locked rate; settlement is
// on the ACTUAL sats received.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import { custodyStatus } from "../_shared/btc-core.ts";
import { resolveQuoteRates } from "../_shared/price-index.ts";
import {
  GRACE_SECONDS,
  INTENT_TTL_SECONDS,
  MAX_SELL_SATS,
  MIN_SELL_SATS,
  SELL_FEE_BPS,
  pickSettlingDeposit,
  satsForTargetZmw,
  sellQuoteMath,
  type DepositCandidate,
} from "../_shared/selfcustody-sell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRICE_DIVERGENCE_LIMIT = 0.03;

const SELL_NOT_CONFIGURED =
  "Selling Bitcoin for ZMW is not available yet — Bitcoin custody is not configured on this deployment.";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function thrownMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  const m = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof m === "string" && m.trim()) return m;
  return fallback;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Price source failed: ${res.status} ${url}`);
  return res.json();
}

// Live price fetchers — the FALLBACK path only, identical to
// btc-trade's (snapshot-first via resolveQuoteRates).
async function fetchBtcUsd(): Promise<number> {
  const [coinbase, kraken] = await Promise.all([
    fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD"),
  ]);
  const cb = Number.parseFloat(coinbase?.data?.amount);
  const kr = Number.parseFloat(kraken?.result?.XXBTZUSD?.c?.[0]);
  if (!(cb > 0) || !(kr > 0)) throw new Error("Price source returned no BTC/USD price");
  if (Math.abs(cb - kr) / cb > PRICE_DIVERGENCE_LIMIT) {
    throw new Error("Price sources diverge — refusing to quote");
  }
  return cb;
}

async function fetchUsdZmw(supabase: any): Promise<number> {
  const { data } = await supabase
    .from("exchange_rates")
    .select("rate")
    .eq("from_currency", "USD")
    .eq("to_currency", "ZMW")
    .gt("valid_until", new Date().toISOString())
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.rate && Number(data.rate) > 0) return Number(data.rate);
  const live = await fetchJson("https://api.exchangerate-api.com/v4/latest/USD");
  const zmw = Number(live?.rates?.ZMW);
  if (!(zmw > 0)) throw new Error("No USD/ZMW rate available");
  return zmw;
}

async function currentMidRate(admin: any): Promise<number> {
  const rates = await resolveQuoteRates(admin, {
    fetchBtcUsd,
    fetchUsdZmw: () => fetchUsdZmw(admin),
  });
  return rates.btcUsd * rates.usdZmw;
}

function intentView(row: any) {
  return {
    intent_id: row.id,
    rail: row.rail,
    status: row.status,
    mid_rate_zmw: Number(row.mid_rate_zmw),
    fee_bps: row.fee_bps,
    fee_zmw: Number(row.expected_fee_zmw),
    expected_sats: Number(row.expected_sats),
    expected_zmw: Number(row.expected_zmw),
    deposit_address: row.deposit_address,
    lightning_payment_id: row.lightning_payment_id,
    bolt11: row.bolt11,
    deposit_txid: row.deposit_txid,
    deposit_vout: row.deposit_vout,
    actual_sats: row.actual_sats === null ? null : Number(row.actual_sats),
    zmw_credited: row.zmw_credited === null ? null : Number(row.zmw_credited),
    fee_zmw_actual: row.fee_zmw_actual === null ? null : Number(row.fee_zmw_actual),
    expires_at: row.expires_at,
    settle_deadline: new Date(
      new Date(row.expires_at).getTime() + Number(row.grace_seconds) * 1000,
    ).toISOString(),
    settled_at: row.settled_at,
    created_at: row.created_at,
  };
}

/**
 * One settlement attempt for an awaiting intent. Returns the intent
 * view plus a `phase` and, when a deposit settled it, the RPC result.
 */
async function attemptSettle(admin: any, intent: any) {
  const view = intentView(intent);
  if (intent.status !== "awaiting") return { ...view, phase: intent.status };

  // Lazily expire: past the settle deadline with no credited deposit
  // inside it, the intent can never settle at the locked rate.
  const deadline =
    new Date(intent.expires_at).getTime() + Number(intent.grace_seconds) * 1000;

  if (intent.rail === "lightning") {
    const { data: payment } = await admin
      .from("lightning_payments")
      .select("id, status, settled_at")
      .eq("id", intent.lightning_payment_id)
      .maybeSingle();
    if (!payment) return { ...view, phase: "awaiting" };
    if (payment.status !== "paid") {
      if (Date.now() > deadline) {
        await admin.from("btc_selfcustody_sell_intents")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", intent.id).eq("status", "awaiting");
        return { ...view, status: "expired", phase: "expired" };
      }
      return { ...view, phase: "awaiting" };
    }
    const { data, error } = await admin.rpc("btc_settle_selfcustody_sell", {
      p_intent_id: intent.id,
      p_deposit_kind: "lightning",
      p_txid: null,
      p_vout: null,
      p_lightning_payment_id: intent.lightning_payment_id,
    });
    if (error) {
      // Business refusals (e.g. the credited BTC was already spent)
      // leave the intent awaiting; surface the phase, not a 500.
      console.error("btc-sell-selfcustody settle failed:", error.message);
      return { ...view, phase: "received", settle_error: "The received Bitcoin could not be converted yet. It stays in your custodial Bitcoin wallet — try again, or sell it from there." };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const { data: fresh } = await admin
      .from("btc_selfcustody_sell_intents").select("*").eq("id", intent.id).single();
    return {
      ...intentView(fresh),
      phase: fresh.status === "settled" ? "settled" : row?.outcome === "expired_after_grace" ? "expired" : "received",
      settle_outcome: row?.outcome ?? null,
    };
  }

  // On-chain rail: candidate deposits are the user's own btc_deposits
  // rows recorded at/after the intent was created and not already
  // bound to a settled intent.
  const { data: deposits } = await admin
    .from("btc_deposits")
    .select("txid, vout, amount_sats, status, created_at, credited_at")
    .eq("user_id", intent.user_id)
    .gte("created_at", intent.created_at)
    .order("created_at", { ascending: true })
    .limit(50);
  const { data: bound } = await admin
    .from("btc_selfcustody_sell_intents")
    .select("deposit_txid, deposit_vout")
    .eq("status", "settled")
    .not("deposit_txid", "is", null);
  const boundKeys = new Set(
    (bound ?? []).map((b: any) => `${b.deposit_txid}:${b.deposit_vout}`),
  );
  const candidates: DepositCandidate[] = (deposits ?? [])
    .filter((d: any) => !boundKeys.has(`${d.txid}:${d.vout}`))
    .map((d: any) => ({
      txid: d.txid,
      vout: d.vout,
      amountSats: Number(d.amount_sats),
      status: d.status,
      createdAt: d.created_at,
    }));
  const pick = pickSettlingDeposit(candidates, Number(intent.expected_sats));

  if (!pick) {
    const detected = candidates.some((c) => c.status === "detected");
    if (Date.now() > deadline && !detected) {
      // A credited deposit inside the window would have been picked
      // above; a merely-detected one keeps the phase "received" —
      // if it credits after the deadline the RPC expires the intent
      // on the next attempt.
      await admin.from("btc_selfcustody_sell_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", intent.id).eq("status", "awaiting");
      return { ...view, status: "expired", phase: "expired" };
    }
    return { ...view, phase: detected ? "received" : "awaiting" };
  }

  const { data, error } = await admin.rpc("btc_settle_selfcustody_sell", {
    p_intent_id: intent.id,
    p_deposit_kind: "onchain",
    p_txid: pick.txid,
    p_vout: pick.vout,
    p_lightning_payment_id: null,
  });
  if (error) {
    console.error("btc-sell-selfcustody settle failed:", error.message);
    return { ...view, phase: "received", settle_error: "The received Bitcoin could not be converted yet. It stays in your custodial Bitcoin wallet — try again, or sell it from there." };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const { data: fresh } = await admin
    .from("btc_selfcustody_sell_intents").select("*").eq("id", intent.id).single();
  return {
    ...intentView(fresh),
    phase: fresh.status === "settled" ? "settled" : row?.outcome === "expired_after_grace" ? "expired" : "received",
    settle_outcome: row?.outcome ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const admin = getServiceRoleClient();
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // Reads and cancels do not need custody; creating an intent does
    // (its settlement moves the treasury float, like btc-trade).
    if (action === "quote_preview" || action === "create_intent") {
      const custody = custodyStatus(
        Deno.env.get("BTC_SEED_MNEMONIC"),
        Deno.env.get("BTC_XPUB"),
      );
      if (!custody.configured) {
        console.error("btc-sell-selfcustody: custody not configured (" + custody.reason + ")");
        return json(503, { error: SELL_NOT_CONFIGURED });
      }
    }

    if (action === "quote_preview" || action === "create_intent") {
      let midRate: number;
      try {
        midRate = await currentMidRate(admin);
      } catch (e) {
        console.error("btc-sell-selfcustody price fetch failed:", e);
        return json(503, { error: "Bitcoin prices are unavailable right now. Please try again in a few minutes." });
      }
      const midRateRounded = Math.round(midRate * 100) / 100;

      let amountSats: number;
      if (body?.amount_sats !== undefined && body?.amount_sats !== null) {
        amountSats = Number(body.amount_sats);
      } else if (body?.amount_zmw !== undefined && body?.amount_zmw !== null) {
        const target = Number(body.amount_zmw);
        if (!(target > 0) || target > 1_000_000) {
          return json(400, { error: "amount_zmw must be between 0 and 1000000" });
        }
        amountSats = satsForTargetZmw(target, midRateRounded, SELL_FEE_BPS);
      } else {
        return json(400, { error: "amount_sats or amount_zmw is required" });
      }
      if (!Number.isInteger(amountSats) || amountSats < MIN_SELL_SATS || amountSats > MAX_SELL_SATS) {
        return json(400, { error: `Sell amount must be between ${MIN_SELL_SATS} and ${MAX_SELL_SATS} sats` });
      }
      const q = sellQuoteMath(amountSats, midRateRounded, SELL_FEE_BPS);
      if (q.zmw < 0.01) {
        return json(400, { error: "Amount too small to sell" });
      }

      if (action === "quote_preview") {
        return json(200, {
          mid_rate_zmw: midRateRounded,
          fee_bps: SELL_FEE_BPS,
          fee_zmw: q.feeZmw,
          amount_sats: amountSats,
          amount_zmw: q.zmw,
          locked: false,
        });
      }

      // create_intent: a frozen account cannot start a sell (its
      // settlement credits ZMW it could not then use — same guard
      // family as btc-trade's execute freeze check).
      if (await isAccountFrozen(admin, user.id)) {
        return json(403, { error: ACCOUNT_FROZEN_MESSAGE });
      }

      const rail = body?.rail;
      if (rail !== "onchain" && rail !== "lightning") {
        return json(400, { error: "rail must be 'onchain' or 'lightning'" });
      }

      const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
      const base = {
        user_id: user.id,
        rail,
        mid_rate_zmw: midRateRounded,
        fee_bps: SELL_FEE_BPS,
        expected_sats: amountSats,
        expected_zmw: q.zmw,
        expected_fee_zmw: q.feeZmw,
        expires_at: expiresAt,
        grace_seconds: GRACE_SECONDS,
      };

      if (rail === "onchain") {
        const { data: assignment } = await admin
          .from("btc_address_assignments")
          .select("address")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!assignment) {
          return json(400, {
            error: "You do not have a custodial deposit address yet. Open your custodial Bitcoin wallet's Receive tab first, then try again.",
          });
        }
        const { data: intent, error } = await admin
          .from("btc_selfcustody_sell_intents")
          .insert({ ...base, deposit_address: assignment.address })
          .select().single();
        if (error) {
          console.error("btc-sell-selfcustody intent insert failed:", error);
          return json(500, { error: "Could not create your sell. Please try again." });
        }
        return json(200, intentView(intent));
      }

      // Lightning rail: bind an invoice created via lightning-service.
      const paymentId = typeof body?.lightning_payment_id === "string" ? body.lightning_payment_id : "";
      if (!paymentId) return json(400, { error: "lightning_payment_id is required" });
      const { data: payment } = await admin
        .from("lightning_payments")
        .select("id, user_id, direction, amount_sats, bolt11, status")
        .eq("id", paymentId)
        .maybeSingle();
      if (!payment || payment.user_id !== user.id || payment.direction !== "inbound") {
        return json(404, { error: "That Lightning invoice was not found for your account." });
      }
      if (Number(payment.amount_sats) !== amountSats) {
        return json(400, { error: "The invoice amount does not match the sell amount. Create a new invoice for the exact amount." });
      }
      if (payment.status !== "pending" && payment.status !== "paid") {
        return json(400, { error: "That Lightning invoice can no longer be paid. Create a new one." });
      }
      const { data: intent, error } = await admin
        .from("btc_selfcustody_sell_intents")
        .insert({ ...base, lightning_payment_id: payment.id, bolt11: payment.bolt11 })
        .select().single();
      if (error) {
        if ((error as any)?.code === "23505") {
          return json(409, { error: "That Lightning invoice is already being used for a sell. Create a new invoice." });
        }
        console.error("btc-sell-selfcustody intent insert failed:", error);
        return json(500, { error: "Could not create your sell. Please try again." });
      }
      return json(200, intentView(intent));
    }

    if (action === "check" || action === "cancel") {
      const intentId = typeof body?.intent_id === "string" ? body.intent_id : "";
      if (!intentId) return json(400, { error: "intent_id is required" });
      const { data: intent } = await admin
        .from("btc_selfcustody_sell_intents")
        .select("*")
        .eq("id", intentId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!intent) return json(404, { error: "Sell not found" });
      if (action === "cancel") {
        if (intent.status !== "awaiting") {
          return json(200, intentView(intent));
        }
        const { data: updated } = await admin
          .from("btc_selfcustody_sell_intents")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", intent.id).eq("status", "awaiting")
          .select().single();
        return json(200, intentView(updated ?? intent));
      }
      return json(200, await attemptSettle(admin, intent));
    }

    if (action === "list") {
      const { data } = await admin
        .from("btc_selfcustody_sell_intents")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return json(200, { intents: (data ?? []).map(intentView) });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("btc-sell-selfcustody error:", e);
    return json(500, { error: thrownMessage(e, "Sell failed") });
  }
});
