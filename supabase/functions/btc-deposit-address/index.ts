// btc-deposit-address: derive a fresh BIP84 native-segwit address per user
// from the platform BTC_XPUB (mainnet). Each call returns the next
// unused derivation index for that user: m/84'/0'/0'/0/<index>.
//
// Auth: user JWT required. Service role used for DB writes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
// @ts-ignore - esm.sh Deno import
import * as bip32 from "https://esm.sh/bip32@4.0.0";
// @ts-ignore - esm.sh Deno import
import * as bitcoin from "https://esm.sh/bitcoinjs-lib@6.1.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xpub = Deno.env.get("BTC_XPUB");
    if (!xpub) {
      return new Response(JSON.stringify({ error: "BTC_XPUB not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the next derivation index for this user
    const { data: existing } = await supabase
      .from("btc_deposit_addresses")
      .select("derivation_index")
      .eq("user_id", user.id)
      .order("derivation_index", { ascending: false })
      .limit(1);

    const nextIndex = existing && existing.length > 0 ? existing[0].derivation_index + 1 : 0;

    // Derive m/84'/0'/0'/0/<nextIndex> from the account xpub.
    // The xpub is already at m/84'/0'/0', so we derive 0/<index>.
    const node = bip32.fromBase58(xpub, bitcoin.networks.bitcoin);
    const child = node.derive(0).derive(nextIndex);
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: child.publicKey,
      network: bitcoin.networks.bitcoin,
    });

    if (!address) {
      throw new Error("Address derivation failed");
    }

    // Store it
    const { error: insertError } = await supabase
      .from("btc_deposit_addresses")
      .insert({
        user_id: user.id,
        address,
        derivation_index: nextIndex,
      });

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ address, derivation_index: nextIndex }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Derivation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
