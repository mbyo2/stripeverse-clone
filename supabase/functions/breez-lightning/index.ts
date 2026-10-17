// breez-lightning: Lightning Network via Breez nodeless API.
// Actions:
//   POST { action: "create_invoice", amount_sats, description } → bolt11 invoice
//   POST { action: "pay_invoice", bolt11 } → pay from user balance
//   POST { action: "check_status", breez_invoice_id } → poll invoice status
//
// Auth: user JWT required. Balances enforced in sats.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";

const BREEZ_API = "https://api.breez.technology";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function breezFetch(path: string, method: string, body?: unknown) {
  const apiKey = Deno.env.get("BREEZ_API_KEY");
  if (!apiKey) throw new Error("BREEZ_API_KEY not configured");
  const res = await fetch(`${BREEZ_API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
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
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, amount_sats, description, bolt11, breez_invoice_id } = await req.json();

    // ── Create inbound Lightning invoice ──
    if (action === "create_invoice") {
      const sats = Math.floor(Number(amount_sats));
      if (!sats || sats <= 0) throw new Error("Invalid amount_sats");

      const invoice = await breezFetch("/v2/invoices", "POST", {
        amount_msat: sats * 1000,
        description: description || `Deposit for ${user.id.slice(0, 8)}`,
      });

      const { data: payment, error } = await supabase.from("lightning_payments").insert({
        user_id: user.id,
        direction: "inbound",
        amount_sats: sats,
        breez_invoice_id: invoice.id || invoice.invoice_id,
        bolt11: invoice.bolt11 || invoice.invoice,
        payment_hash: invoice.payment_hash,
        status: "pending",
      }).select("id").single();

      if (error) throw error;

      return new Response(JSON.stringify({
        payment_id: payment.id,
        bolt11: invoice.bolt11 || invoice.invoice,
        payment_hash: invoice.payment_hash,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Pay an outbound Lightning invoice (from wallet balance) ──
    if (action === "pay_invoice") {
      if (!bolt11 || typeof bolt11 !== "string") throw new Error("bolt11 required");

      // Decode amount from bolt11 (rough parse) or require explicit amount
      // For safety, we debit only after Breez confirms payment.
      const payResult = await breezFetch("/v2/payments", "POST", { bolt11 });

      const paidSats = Math.floor((payResult.amount_msat || 0) / 1000);

      // Debit wallet
      const { data: wallet } = await supabase.from("crypto_wallets")
        .select("id, balance_sats, available_sats")
        .eq("user_id", user.id).eq("asset", "BTC").maybeSingle();

      if (!wallet || (wallet.available_sats || 0) < paidSats) {
        throw new Error("Insufficient BTC balance");
      }

      await supabase.from("crypto_wallets").update({
        balance_sats: (wallet.balance_sats || 0) - paidSats,
        available_sats: (wallet.available_sats || 0) - paidSats,
        updated_at: new Date().toISOString(),
      }).eq("id", wallet.id);

      await supabase.from("lightning_payments").insert({
        user_id: user.id,
        direction: "outbound",
        amount_sats: paidSats,
        bolt11,
        payment_hash: payResult.payment_hash,
        status: "paid",
        settled_at: new Date().toISOString(),
      });

      await supabase.from("transactions").insert({
        user_id: userIdSafe(user),
        currency: "BTC",
        amount: -(paidSats / 100_000_000),
        status: "completed",
        transaction_id: payResult.payment_hash || `ln-${Date.now()}`,
        metadata: { type: "lightning_payment", bolt11: bolt11.slice(0, 32) + "…" },
      });

      return new Response(JSON.stringify({ ok: true, paid_sats: paidSats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Check inbound invoice status; credit on settlement ──
    if (action === "check_status") {
      if (!breez_invoice_id) throw new Error("breez_invoice_id required");

      const { data: payment } = await supabase.from("lightning_payments")
        .select("*").eq("id", breez_invoice_id).eq("user_id", user.id).single();

      if (!payment) throw new Error("Payment not found");
      if (payment.status === "paid") {
        return new Response(JSON.stringify({ status: "paid" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const status = await breezFetch(`/v2/invoices/${payment.breez_invoice_id}`, "GET");
      const isPaid = status.settled || status.status === "paid";

      if (isPaid) {
        const sats = payment.amount_sats;
        const { data: wallet } = await supabase.from("crypto_wallets")
          .select("id, balance_sats, available_sats")
          .eq("user_id", user.id).eq("asset", "BTC").maybeSingle();

        if (wallet) {
          await supabase.from("crypto_wallets").update({
            balance_sats: (wallet.balance_sats || 0) + sats,
            available_sats: (wallet.available_sats || 0) + sats,
            updated_at: new Date().toISOString(),
          }).eq("id", wallet.id);
        } else {
          await supabase.from("crypto_wallets").insert({
            user_id: user.id, asset: "BTC", balance_sats: sats, available_sats: sats,
          });
        }

        await supabase.from("lightning_payments").update({
          status: "paid", settled_at: new Date().toISOString(),
        }).eq("id", payment.id);

        await supabase.from("transactions").insert({
          user_id: user.id,
          currency: "BTC",
          amount: sats / 100_000_000,
          status: "completed",
          transaction_id: payment.payment_hash || `ln-in-${payment.id}`,
          metadata: { type: "lightning_deposit", sats },
        });
      }

      return new Response(JSON.stringify({ status: isPaid ? "paid" : "pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Lightning operation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function userIdSafe(user: { id: string }) { return user.id; }
