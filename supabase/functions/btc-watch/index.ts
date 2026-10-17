// btc-watch: monitor derived deposit addresses for incoming on-chain
// payments. Runs on a schedule (pg_cron). For each tracked address,
// checks mempool.space for confirmed UTXOs not yet credited, then
// credits the user's crypto_wallets row and logs to transactions.
//
// Idempotent: skips any txid already recorded in transactions.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MEMPOOL_API = "https://mempool.space/api";
const CONFIRMATIONS_REQUIRED = 1;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const results: Array<Record<string, unknown>> = [];

  try {
    // All tracked deposit addresses
    const { data: addresses, error: addrError } = await supabase
      .from("btc_deposit_addresses")
      .select("user_id, address");

    if (addrError) throw addrError;

    for (const row of addresses || []) {
      const addr = row.address as string;
      const userId = row.user_id as string;

      // Fetch UTXOs for this address
      const utxoRes = await fetch(`${MEMPOOL_API}/address/${addr}/utxo`);
      if (!utxoRes.ok) {
        results.push({ address: addr, error: `mempool.space ${utxoRes.status}` });
        continue;
      }
      const utxos: Array<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }> =
        await utxoRes.json();

      for (const utxo of utxos) {
        if (!utxo.status?.confirmed) continue; // wait for at least 1 confirmation

        // Skip if already credited
        const { data: seen } = await supabase
          .from("transactions")
          .select("id")
          .eq("transaction_id", utxo.txid)
          .eq("user_id", userId)
          .limit(1);

        if (seen && seen.length > 0) continue;

        const sats = utxo.value;

        // Credit the wallet (upsert)
        const { data: wallet } = await supabase
          .from("crypto_wallets")
          .select("id, balance_sats, available_sats")
          .eq("user_id", userId)
          .eq("asset", "BTC")
          .maybeSingle();

        if (wallet) {
          await supabase.from("crypto_wallets").update({
            balance_sats: (wallet.balance_sats || 0) + sats,
            available_sats: (wallet.available_sats || 0) + sats,
            updated_at: new Date().toISOString(),
          }).eq("id", wallet.id);
        } else {
          await supabase.from("crypto_wallets").insert({
            user_id: userId,
            asset: "BTC",
            balance_sats: sats,
            available_sats: sats,
          });
        }

        // Log the transaction
        await supabase.from("transactions").insert({
          user_id: userId,
          currency: "BTC",
          amount: sats / 100_000_000,
          status: "completed",
          transaction_id: utxo.txid,
          metadata: { type: "onchain_deposit", address: addr, vout: utxo.vout, sats },
        });

        results.push({ address: addr, txid: utxo.txid, sats_credited: sats });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Watch failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
