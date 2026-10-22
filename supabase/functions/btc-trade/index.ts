// btc-trade: buy/sell Bitcoin against the user's internal ZMW balance.
//
// Actions (POST JSON { action, ... }):
//   quote    (user JWT) { side: "buy",  amount_zmw }  → locked 60s quote
//            (user JWT) { side: "sell", amount_sats } → locked 60s quote
//   execute  (user JWT) { quote_id, idempotency_key } → atomic settlement
//            via public.btc_execute_trade (one DB transaction: ZMW wallet,
//            BTC wallet, treasury float, two ledger legs, quote consumed)
//
// Pricing: BTC/USD from Coinbase spot, cross-checked against Kraken
// (a >3% divergence refuses to quote). USD/ZMW from the app's own
// exchange_rates table (populated by fetch-exchange-rates), falling back
// to the same public source that function uses. The spread
// (TRADE_FEE_BPS, default 150 = 1.5%) is applied inside the shared
// quote math in _shared/btc-core.ts and disclosed on every quote.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { custodyStatus, quoteBuySats, quoteSellZmw } from "../_shared/btc-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QUOTE_TTL_SECONDS = 60;
const MIN_BUY_ZMW = 10;
const MAX_BUY_ZMW = 1_000_000;
const MIN_SELL_SATS = 1_000;
const MAX_SELL_SATS = 100_000_000;
const PRICE_DIVERGENCE_LIMIT = 0.03;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Designed refusal: while custody is not genuinely configured (seed and
// MATCHED xpub both present — see custodyStatus in btc-core), buying and
// selling answer 503 with this plain-language message, in the { error }
// shape the frontend surfaces verbatim. There is no treasury to settle
// against before then, so quoting would be theatre.
const TRADE_NOT_CONFIGURED =
  "Bitcoin buying and selling are not available yet — Bitcoin custody is not configured on this deployment.";

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

function feeBps(): number {
  const raw = Deno.env.get("TRADE_FEE_BPS");
  if (!raw) return 150;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 1000) {
    throw new Error("Invalid TRADE_FEE_BPS configuration");
  }
  return n;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Price source failed: ${res.status} ${url}`);
  return res.json();
}

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

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // Custody gate: quotes and executions both refuse while custody is
    // not configured. This runs BEFORE any price fetch — a feature that
    // is off should not depend on external price sources being up.
    const custody = custodyStatus(
      Deno.env.get("BTC_SEED_MNEMONIC"),
      Deno.env.get("BTC_XPUB"),
    );
    if (!custody.configured) {
      console.error("btc-trade: custody not configured (" + custody.reason + ")");
      return json(503, { error: TRADE_NOT_CONFIGURED });
    }

    if (action === "quote") {
      const side = body?.side;
      if (side !== "buy" && side !== "sell") {
        return json(400, { error: "side must be 'buy' or 'sell'" });
      }

      let btcUsd: number, usdZmw: number;
      try {
        [btcUsd, usdZmw] = await Promise.all([fetchBtcUsd(), fetchUsdZmw(supabase)]);
      } catch (e) {
        // Every fetch is bounded (AbortSignal.timeout in fetchJson), so
        // a failure here is a definitive answer, not a hang. The user
        // gets plain language; the technical detail goes to the logs.
        console.error("btc-trade price fetch failed:", e);
        return json(503, { error: "Bitcoin prices are unavailable right now. Please try again in a few minutes." });
      }
      const midRate = btcUsd * usdZmw;
      const bps = feeBps();
      const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();

      let amountZmw: number;
      let amountSats: number;
      let feeZmw: number;

      if (side === "buy") {
        amountZmw = Number(body?.amount_zmw);
        if (!(amountZmw >= MIN_BUY_ZMW) || amountZmw > MAX_BUY_ZMW) {
          return json(400, { error: `Buy amount must be between ${MIN_BUY_ZMW} and ${MAX_BUY_ZMW} ZMW` });
        }
        amountZmw = Math.round(amountZmw * 100) / 100;
        const q = quoteBuySats(amountZmw, midRate, bps);
        amountSats = q.sats;
        feeZmw = q.feeZmw;
        if (amountSats < 546) {
          return json(400, { error: "Amount too small to buy Bitcoin" });
        }
      } else {
        amountSats = Number(body?.amount_sats);
        if (!Number.isInteger(amountSats) || amountSats < MIN_SELL_SATS || amountSats > MAX_SELL_SATS) {
          return json(400, { error: `Sell amount must be between ${MIN_SELL_SATS} and ${MAX_SELL_SATS} sats` });
        }
        const q = quoteSellZmw(amountSats, midRate, bps);
        amountZmw = q.zmw;
        feeZmw = q.feeZmw;
        if (amountZmw < 0.01) {
          return json(400, { error: "Amount too small to sell" });
        }
      }

      const { data: quote, error } = await supabase
        .from("btc_quotes")
        .insert({
          user_id: user.id,
          side,
          mid_rate_zmw: Math.round(midRate * 100) / 100,
          fee_bps: bps,
          fee_zmw: feeZmw,
          amount_zmw: amountZmw,
          amount_sats: amountSats,
          expires_at: expiresAt,
        })
        .select()
        .single();
      if (error) {
        // Do NOT `throw` this: a PostgREST error is a plain object, and
        // the outer catch used to collapse it into a contentless
        // "Trade failed". Answer with an honest, specific message and
        // keep the technical detail in the logs.
        console.error("btc-trade quote insert failed:", error);
        return json(500, { error: "Could not save your quote. Please try again." });
      }

      return json(200, {
        quote_id: quote.id,
        side,
        mid_rate_zmw: Number(quote.mid_rate_zmw),
        fee_bps: bps,
        fee_zmw: feeZmw,
        amount_zmw: amountZmw,
        amount_sats: amountSats,
        expires_at: expiresAt,
      });
    }

    if (action === "execute") {
      const quoteId = typeof body?.quote_id === "string" ? body.quote_id : "";
      const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : "";
      if (!quoteId) return json(400, { error: "quote_id is required" });
      if (idempotencyKey.length < 8 || idempotencyKey.length > 80) {
        return json(400, { error: "idempotency_key is required (8–80 chars)" });
      }

      const { data, error } = await supabase.rpc("btc_execute_trade", {
        p_user_id: user.id,
        p_quote_id: quoteId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) {
        // Business-rule failures from the RPC are client-actionable.
        const known = /Quote|Insufficient|No ZMW wallet|temporarily unavailable/i.test(error.message);
        return json(known ? 400 : 500, { error: error.message });
      }
      const row = Array.isArray(data) ? data[0] : data;
      return json(200, {
        quote_id: row.quote_id,
        side: row.side,
        amount_zmw: Number(row.amount_zmw),
        amount_sats: Number(row.amount_sats),
        new_zmw_balance: Number(row.new_zmw_balance),
        new_btc_sats: Number(row.new_btc_sats),
      });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("btc-trade error:", e);
    return json(500, { error: thrownMessage(e, "Trade failed") });
  }
});
