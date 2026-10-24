// currency-convert: server-side conversion between two of the user's
// OWN wallets in different currencies, at the stored exchange rate.
//
// Why an edge function: conversion used to be a browser-side insert
// into currency_conversions — a history row with no money movement,
// toasted as success. The real movement runs through the
// execute_currency_conversion RPC (SECURITY DEFINER, service_role-only),
// which reads the rate from exchange_rates itself, debits the source
// wallet, credits the destination wallet, and writes the conversion
// record + both ledger legs in one transaction. It is invoked here
// with a service-role client that forwards no caller token — the same
// proven path as internal-transfer, required because
// protect_wallet_balance() silently neutralizes wallet balance UPDATEs
// made while a user JWT is present.
//
// Input:
//   {
//     from_wallet_id, to_wallet_id, from_amount,
//     expected_rate (optional — the rate the UI displayed; the RPC
//     refuses if the stored rate has moved more than 2% from it),
//     idempotency_key
//   }
//
// Auth: user JWT required. The RPC re-checks that both wallets belong
// to the resolved user.
//
// Returns: { success, transaction_id, conversion_id, exchange_rate,
//            to_amount, new_from_balance, new_to_balance }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { assertAccountNotFrozen } from "../_shared/account-freeze.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Resolve the caller from their JWT ──
    const supabase = getSupabaseClient(req);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      from_wallet_id, to_wallet_id, from_amount,
      expected_rate, idempotency_key,
    } = body;

    // ── Validation ──
    if (!from_wallet_id) throw new Error("from_wallet_id required");
    if (!to_wallet_id) throw new Error("to_wallet_id required");
    if (from_wallet_id === to_wallet_id) {
      throw new Error("Source and destination wallets must differ");
    }
    const amt = Number(from_amount);
    if (!amt || amt <= 0) throw new Error("Amount must be greater than zero");
    if (typeof idempotency_key !== "string" || idempotency_key.length < 8) {
      throw new Error("idempotency_key must be a string of at least 8 characters");
    }

    // ── Execute via Postgres function with a service-role client ──
    // Deliberately NOT the request-scoped client above: that one forwards
    // the caller's Authorization header, which would put auth.uid() back
    // in scope for the RPC and trip the balance-protection trigger.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ── Freeze guard: a frozen account cannot move money out ──
    await assertAccountNotFrozen(admin, user.id);

    const { data, error } = await admin.rpc("execute_currency_conversion", {
      p_user_id: user.id,
      p_from_wallet_id: from_wallet_id,
      p_to_wallet_id: to_wallet_id,
      p_from_amount: amt,
      p_expected_rate: expected_rate != null ? Number(expected_rate) : null,
      p_idempotency_key: idempotency_key,
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return new Response(JSON.stringify({
      success: true,
      transaction_id: row.transaction_id,
      conversion_id: row.conversion_id,
      exchange_rate: Number(row.exchange_rate),
      to_amount: Number(row.to_amount),
      new_from_balance: Number(row.new_from_balance),
      new_to_balance: Number(row.new_to_balance),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Conversion failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
