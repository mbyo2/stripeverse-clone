// Bitcoin chain watcher: reads the real chain through an Esplora node API and
// credits confirmed on-chain deposits to crypto_wallets, settles native BTC
// invoices, and tracks withdrawal confirmations.
//
// Can be called by a signed-in user (scans only their own addresses) or as a
// cron/service job with the CRON_SECRET header (scans everything).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  confirmationsFor,
  EsploraTx,
  explorerTxUrl,
  getAddressTxs,
  getTipHeight,
  getTx,
  MIN_CONFIRMATIONS,
  loadXpub,
  previewKey,
} from "../_shared/bitcoin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

serve(async (req) => {
  await loadXpub();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const providedSecret = req.headers.get("x-cron-secret") || "";
    let isCron = cronSecret.length > 0 && providedSecret === cronSecret;
    if (!isCron && providedSecret.length > 0) {
      const { data } = await admin.rpc("verify_cron_token", {
        p_name: "btc-watcher",
        p_token: providedSecret,
      });
      isCron = data === true;
    }

    let userId: string | null = null;
    if (!isCron) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: "Unauthorized" }, 401);
      userId = data.user.id;
    }

    const tip = await getTipHeight();

    // ---- 1. Scan deposit addresses ----
    let addrQuery = admin
      .from("btc_deposit_addresses")
      .select("id, user_id, address, invoice_id")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(isCron ? 250 : 25);
    if (userId) addrQuery = addrQuery.eq("user_id", userId);

    const { data: addresses, error: addrErr } = await addrQuery;
    if (addrErr) return json({ error: "Failed to load addresses" }, 500);

    let credited = 0;
    let checkoutSettled = 0;
    let detected = 0;

    for (const addr of addresses ?? []) {
      // Checkout addresses (created for a payment-link payer) are settled in
      // fiat to the merchant — they must not also be credited as BTC deposits.
      let isCheckout = false;
      if (addr.invoice_id) {
        const { data: inv } = await admin
          .from("crypto_invoices")
          .select("payment_link_code")
          .eq("invoice_id", addr.invoice_id)
          .maybeSingle();
        isCheckout = !!inv?.payment_link_code;
      }

      // Retire malformed placeholder addresses instead of failing every scan.
      if (!/^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{11,87}$/.test(addr.address) || /^bc1q{20,}/.test(addr.address)) {
        await admin.from("btc_deposit_addresses").update({ is_active: false }).eq("id", addr.id);
        continue;
      }
      let txs: EsploraTx[] = [];
      try {
        txs = await getAddressTxs(addr.address);
      } catch (e) {
        console.error(`Address scan failed for ${addr.address}:`, e);
        continue;
      }

      for (const tx of txs) {
        const confirmations = confirmationsFor(tip, tx.status?.block_height);

        for (let vout = 0; vout < (tx.vout?.length || 0); vout++) {
          const out = tx.vout[vout];
          if (out.scriptpubkey_address !== addr.address) continue;
          const sats = Math.floor(Number(out.value) || 0);
          if (sats <= 0) continue;
          detected++;

          if (isCheckout) {
            // Payment-link checkout: settle the invoice, complete the pending
            // checkout transaction and credit the merchant's fiat wallet. The
            // BTC never enters the custodial crypto wallet.
            if (confirmations >= MIN_CONFIRMATIONS) {
              const { data: paidInvoices } = await admin
                .from("crypto_invoices")
                .update({
                  status: "paid",
                  paid_at: new Date().toISOString(),
                  txid: tx.txid,
                  confirmations,
                })
                .eq("address", addr.address)
                .in("status", ["pending", "expired"])
                .select("invoice_id, user_id, amount_fiat, fiat_currency");

              if (paidInvoices?.length) checkoutSettled += paidInvoices.length;

              for (const inv of paidInvoices ?? []) {
                if (!inv.user_id) continue;
                const { data: txn } = await admin
                  .from("transactions")
                  .update({ status: "completed" })
                  .eq("external_reference", inv.invoice_id)
                  .eq("status", "pending")
                  .select("id");
                if (!txn?.length) continue; // already settled
                const { error: creditErr } = await admin.rpc("increment_wallet_balance", {
                  p_user_id: inv.user_id,
                  p_amount: Number(inv.amount_fiat || 0),
                });
                if (creditErr) console.error("Checkout fiat credit failed:", inv.invoice_id, creditErr);
                await admin.from("notifications").insert({
                  user_id: inv.user_id,
                  title: "Bitcoin payment received",
                  message: `A customer paid ${Number(inv.amount_fiat || 0)} ${inv.fiat_currency || ""} via Bitcoin checkout (tx ${tx.txid.slice(0, 10)}…).`,
                  type: "success",
                });
              }
            }
            continue;
          }

          const { data: existing } = await admin
            .from("btc_onchain_deposits")
            .select("id, status")
            .eq("txid", tx.txid)
            .eq("vout", vout)
            .maybeSingle();

          if (!existing) {
            await admin.from("btc_onchain_deposits").insert({
              user_id: addr.user_id,
              address: addr.address,
              txid: tx.txid,
              vout,
              amount_sats: sats,
              confirmations,
              block_height: tx.status?.block_height ?? null,
              status: "pending",
            });
          } else if (existing.status === "credited") {
            continue;
          } else {
            await admin
              .from("btc_onchain_deposits")
              .update({ confirmations, block_height: tx.status?.block_height ?? null })
              .eq("id", existing.id);
          }

          // Credit once, only when confirmed enough
          if (confirmations >= MIN_CONFIRMATIONS) {
            const { data: locked } = await admin
              .from("btc_onchain_deposits")
              .update({
                status: "credited",
                credited_at: new Date().toISOString(),
                confirmations,
              })
              .eq("txid", tx.txid)
              .eq("vout", vout)
              .neq("status", "credited")
              .select("id")
              .maybeSingle();

            if (!locked) continue; // someone else credited it

            const { error: incErr } = await admin.rpc("increment_crypto_balance", {
              p_user_id: addr.user_id,
              p_asset: "BTC",
              p_amount_sats: sats,
            });
            if (incErr) {
              console.error("Credit failed:", incErr);
              await admin
                .from("btc_onchain_deposits")
                .update({ status: "pending", credited_at: null })
                .eq("id", locked.id);
              continue;
            }

            const { error: notifErr } = await admin.from("notifications").insert({
              user_id: addr.user_id,
              title: "Bitcoin deposit confirmed",
              message: `${(sats / 1e8).toFixed(8)} BTC was confirmed (${confirmations} confirmation${confirmations === 1 ? "" : "s"}) and added to your wallet balance. Tx ${tx.txid.slice(0, 10)}…`,
              type: "success",
            });
            if (notifErr) console.error("Notification insert failed:", notifErr);

            await admin.from("transactions").insert({
              user_id: addr.user_id,
              amount: sats / 1e8,
              currency: "BTC",
              payment_method: "bitcoin",
              direction: "incoming",
              status: "completed",
              provider: "bitcoin-node",
              transaction_id: `${tx.txid}:${vout}`,
              reference: "btc_deposit",
              category: "general",
              metadata: {
                type: "deposit",
                network: "bitcoin",
                address: addr.address,
                txid: tx.txid,
                vout,
                confirmations,
                explorer: explorerTxUrl(tx.txid),
              },
            });

            // Settle a matching native BTC invoice, if any
            await admin
              .from("crypto_invoices")
              .update({
                status: "paid",
                paid_at: new Date().toISOString(),
                txid: tx.txid,
                confirmations,
              })
              .eq("address", addr.address)
              .neq("status", "paid");

            credited++;
          }
        }
      }

      await admin
        .from("btc_deposit_addresses")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", addr.id);
    }

    // ---- 2. Track broadcast withdrawals ----
    let wdQuery = admin
      .from("btc_withdrawals")
      .select("id, user_id, txid, status")
      .not("txid", "is", null)
      .in("status", ["broadcasted", "awaiting_broadcast"])
      .limit(100);
    if (userId) wdQuery = wdQuery.eq("user_id", userId);

    const { data: withdrawals } = await wdQuery;
    let settledWithdrawals = 0;

    for (const wd of withdrawals ?? []) {
      if (!wd.txid) continue;
      try {
        const tx = await getTx(wd.txid);
        const confirmations = confirmationsFor(tip, tx.status?.block_height);
        const status = confirmations >= MIN_CONFIRMATIONS ? "completed" : "broadcasted";
        await admin
          .from("btc_withdrawals")
          .update({ confirmations, status, updated_at: new Date().toISOString() })
          .eq("id", wd.id);
        if (status === "completed") {
          settledWithdrawals++;
          await admin
            .from("transactions")
            .update({ status: "completed" })
            .eq("transaction_id", wd.txid)
            .eq("reference", "btc_onchain_send");
          await admin
            .from("transactions")
            .update({ status: "completed", transaction_id: wd.txid })
            .eq("transaction_id", wd.id)
            .eq("reference", "btc_onchain_send");
        }
      } catch (e) {
        console.error(`Withdrawal tx lookup failed for ${wd.txid}:`, e);
      }
    }

    // ---- 3. Expire stale invoices ----
    await admin
      .from("crypto_invoices")
      .update({ status: "expired" })
      .lt("expires_at", new Date().toISOString())
      .eq("status", "pending");

    return json({
      tipHeight: tip,
      addressesScanned: addresses?.length ?? 0,
      outputsSeen: detected,
      deposited: credited,
      checkoutSettled,
      withdrawalsSettled: settledWithdrawals,
      minConfirmations: MIN_CONFIRMATIONS,
    });
  } catch (e) {
    console.error("btc-watcher error:", e);
    return json({ error: "Internal error" }, 500);
  }
});
