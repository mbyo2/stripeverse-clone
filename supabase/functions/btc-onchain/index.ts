// btc-onchain: custodial on-chain Bitcoin — deposits, detection, sends.
//
// Actions (POST JSON { action, ... }):
//   receive         (user JWT)  → the caller's unique BIP84 deposit address
//   check_deposits  (service role only) → scan assigned addresses on an
//                   esplora API, record deposits, credit at the tiered
//                   confirmation count (audit M2: 2 confs below
//                   BTC_DEPOSIT_MEDIUM_SATS, 3 at/above it; deposits at
//                   or above BTC_DEPOSIT_LARGE_SATS must additionally
//                   agree on a second, independent explorer)
//   send            (user JWT)  → withdraw to an external mainnet address;
//                   reserved → built → signed → broadcast → finalized,
//                   with automatic refund ONLY for failures BEFORE
//                   broadcast; a broadcast that is not positively
//                   confirmed leaves the row 'reserved' for manual
//                   reconciliation (never auto-refunded —
//                   see classifyBroadcastOutcome in btc-core)
//
// Concurrency (audit M1): the reservation is the serialization
// point. After reserving, send() re-validates against state that
// includes every reservation made so far — coin selection excludes
// outpoints already spent by another in-flight withdrawal's known
// transaction, the daily-cap is re-checked immediately before
// broadcast, and the built inputs are re-confirmed unspent — with
// every refusal still pre-broadcast, hence refundable.
//
// Secrets (capability-gated — see bitcoinCapabilities in btc-core):
//   BTC_XPUB           account zpub — ALONE enables receive +
//                      check_deposits (watch-only; funds land in the
//                      wallet the zpub came from)
//   BTC_SEED_MNEMONIC  master seed — additionally enables send, and
//                      only when it matches BTC_XPUB (the interlock)
// Optional config:
//   ESPLORA_API_URL    default https://mempool.space/api
//   ESPLORA_SECONDARY_API_URL  default https://blockstream.info/api —
//                      the independent explorer for the M2 cross-check
//   BTC_MIN_WITHDRAWAL_SATS (10000), BTC_MAX_TX_SATS (2000000),
//   BTC_MAX_DAILY_SATS (5000000)
//   BTC_DEPOSIT_MEDIUM_SATS (500000), BTC_DEPOSIT_LARGE_SATS (2000000)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import {
  buildConsolidationTx,
  buildWithdrawalTx,
  classifyBroadcastOutcome,
  crossCheckDeposit,
  custodyStatus,
  depositNeedsCrossCheck,
  deriveAddress,
  deriveScript,
  estimateVsize,
  filterUncommittedUtxos,
  planConsolidation,
  receiveStatus,
  requiredConfirmationsFor,
  selectCoins,
  spentOutpointsFromTx,
  validateMainnetAddress,
  type BroadcastClassification,
  type ConsolidationPlan,
  type DepositCrossCheck,
  type DepositTxView,
  type Outpoint,
  type Utxo,
} from "../_shared/btc-core.ts";
import { dispatchPaymentLinkPaid } from "../_shared/developer-webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ESPLORA = (Deno.env.get("ESPLORA_API_URL") || "https://mempool.space/api").replace(/\/$/, "");
// Deposit crediting tiers (audit M2 / P2-16): deposits used to credit
// at 1 confirmation trusting this one explorer. Now the count is
// tiered by amount — 2 confirmations below BTC_DEPOSIT_MEDIUM_SATS
// (default 500_000), 3 at or above it — and deposits at or above
// BTC_DEPOSIT_LARGE_SATS (default 2_000_000) must ALSO agree on a
// second, independent explorer (default blockstream.info) before they
// may credit. The tier/cross-check decisions are the pure policy in
// btc-core (requiredConfirmationsFor / crossCheckDeposit); the
// thresholds are read per scan in checkDeposits.
const ESPLORA_SECONDARY = (Deno.env.get("ESPLORA_SECONDARY_API_URL") || "https://blockstream.info/api").replace(/\/$/, "");
const MAX_SCAN_ADDRESSES = 2000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Designed refusals, in the { error } shape the frontend surfaces
// verbatim. Capabilities gate SEPARATELY (bitcoinCapabilities in
// btc-core): deposits refuse only when no parseable xpub is configured
// — receiving is watch-only and needs nothing more — while withdrawals
// refuse until the full seed⇄xpub interlock holds. The specific failed
// check is operator detail and goes to the logs only.
const DEPOSITS_NOT_CONFIGURED =
  "Bitcoin deposits are not available yet — Bitcoin custody is not configured on this deployment.";
const WITHDRAWALS_NOT_CONFIGURED =
  "Bitcoin withdrawals are not available yet — Bitcoin custody is not configured on this deployment.";

function custody() {
  return custodyStatus(
    Deno.env.get("BTC_SEED_MNEMONIC"),
    Deno.env.get("BTC_XPUB"),
  );
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

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${name} configuration`);
  }
  return n;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function esplora(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ESPLORA}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    // All DB work below runs through the dedicated service-role client:
    // the btc_* RPCs are service_role-only and the btc_* tables are
    // service-write-only under RLS, while the request client forwards
    // the caller's JWT (PostgREST would run as `authenticated` and be
    // denied). Identity is verified from the JWT via `supabase`; money
    // and rows move via `admin`. (Pattern: atomic-transfer.)
    const admin = getServiceRoleClient();
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // ── check_deposits: scheduler-only ─────────────────────────────────────
    if (action === "check_deposits") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!serviceKey || !timingSafeEqual(token, serviceKey)) {
        return json(401, { error: "Service role required" });
      }
      // Deposit detection needs only the zpub: crediting a deposit
      // moves no platform funds — it records BTC that already arrived
      // in the wallet the zpub watches. Without a parseable xpub there
      // are no legitimate addresses to scan, so skip quietly
      // (scheduler context — a 200 with the reason, not an error).
      const r = receiveStatus(Deno.env.get("BTC_XPUB"));
      if (!r.configured) {
        console.error("btc-onchain check_deposits skipped: receiving not configured (" + r.reason + ")");
        return json(200, { skipped: true, reason: "receive_not_configured" });
      }
      return await checkDeposits(admin);
    }

    // ── consolidate: scheduler-only (protection P2b) ─────────────────────
    if (action === "consolidate") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!serviceKey || !timingSafeEqual(token, serviceKey)) {
        return json(401, { error: "Service role required" });
      }
      return await consolidate(admin);
    }

    // ── Everything else needs a real user ──────────────────────────────────
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    if (action === "receive") return await receive(admin, user.id);
    if (action === "estimate_send") return await estimateSend(admin, user.id, body);
    if (action === "send") return await send(admin, user.id, body);

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("btc-onchain error:", e);
    return json(500, { error: thrownMessage(e, "Bitcoin operation failed") });
  }
});

// ── receive ────────────────────────────────────────────────────────────────

async function receive(supabase: any, userId: string) {
  // Receive gate FIRST — before any assignment lookup or allocation.
  // A parseable account zpub ALONE enables deposits: receiving is
  // watch-only (the address derives from the public key, funds land in
  // the wallet the zpub came from, and no spending is possible from a
  // zpub), so the seed is neither required nor wanted on this path.
  // Only a missing/unparseable xpub refuses, with the designed
  // message. An address is never issued from an unparseable key, and a
  // previously assigned one is not handed back either — it came from
  // the same key that just failed to parse.
  const r = receiveStatus(Deno.env.get("BTC_XPUB"));
  if (!r.configured) {
    console.error("btc-onchain receive: receiving not configured (" + r.reason + ")");
    return json(503, { error: DEPOSITS_NOT_CONFIGURED });
  }
  const account = r.accountPub;

  const { data: existing } = await supabase
    .from("btc_address_assignments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    return json(200, { address: existing.address, record: existing });
  }

  // Allocate (index, address) atomically-ish: the sequence guarantees a
  // fresh index; the unique constraints + retry loop make double-assignment
  // impossible even under concurrent requests.
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: idx, error: seqErr } = await supabase.rpc("btc_next_derivation_index");
    if (seqErr) throw seqErr;
    const index = Number(idx);
    const address = deriveAddress(account, 0, index);

    const { data: row, error: insErr } = await supabase
      .from("btc_address_assignments")
      .insert({ user_id: userId, derivation_index: index, address })
      .select()
      .single();

    if (!insErr && row) {
      return json(200, { address: row.address, record: row });
    }
    if (insErr?.code === "23505") {
      // Either this user was assigned concurrently (return that row) or the
      // index/address collided with another user's (retry with next index).
      const { data: mine } = await supabase
        .from("btc_address_assignments")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (mine) return json(200, { address: mine.address, record: mine });
      continue;
    }
    throw insErr;
  }
  return json(500, { error: "Could not allocate a deposit address" });
}

// ── check_deposits ─────────────────────────────────────────────────────────

async function checkDeposits(supabase: any) {
  const { data: assignments, error } = await supabase
    .from("btc_address_assignments")
    .select("user_id, address")
    .order("created_at", { ascending: true })
    .limit(MAX_SCAN_ADDRESSES);
  if (error) throw error;

  const mediumSats = envInt("BTC_DEPOSIT_MEDIUM_SATS", 500_000);
  const largeSats = envInt("BTC_DEPOSIT_LARGE_SATS", 2_000_000);

  const tipRes = await esplora("/blocks/tip/height");
  if (!tipRes.ok) throw new Error(`Esplora tip height failed: ${tipRes.status}`);
  const tipHeight = Number.parseInt(await tipRes.text(), 10);

  let seen = 0;
  let credited = 0;
  const errors: Array<{ address: string; error: string }> = [];

  for (const assignment of assignments ?? []) {
    try {
      const txs = await fetchAddressTxs(assignment.address);
      for (const tx of txs) {
        const vouts = tx.vout ?? [];
        for (let voutIndex = 0; voutIndex < vouts.length; voutIndex++) {
          const vout = vouts[voutIndex];
          if (vout.scriptpubkey_address !== assignment.address) continue;
          if (!vout.value || vout.value <= 0) continue;

          const confirmations = tx.status?.confirmed && tx.status.block_height
            ? tipHeight - tx.status.block_height + 1
            : 0;

          // M2: the required count is per-deposit, tiered by amount.
          const requiredConfs = requiredConfirmationsFor(vout.value, mediumSats, largeSats);

          // M2: a large deposit that is otherwise creditable must
          // first agree on the second, independent explorer. A held
          // deposit is NOT recorded this round (no RPC call) — the
          // next scan retries it; fail-closed.
          if (
            depositNeedsCrossCheck(vout.value, largeSats) &&
            confirmations >= requiredConfs
          ) {
            const verdict = await crossCheckLargeDeposit(tx, voutIndex, assignment.address, vout.value);
            if (!verdict.ok) {
              errors.push({
                address: assignment.address,
                error: `cross-check pending for large deposit ${tx.txid}: ${verdict.reason}`,
              });
              continue;
            }
          }

          const { data: result, error: rpcErr } = await supabase.rpc("btc_record_deposit", {
            p_user_id: assignment.user_id,
            p_address: assignment.address,
            p_txid: tx.txid,
            p_vout: voutIndex,
            p_amount_sats: vout.value,
            p_confirmations: confirmations,
            p_required_confs: requiredConfs,
          });
          if (rpcErr) throw rpcErr;
          seen++;
          if (result === "credited") credited++;
        }
      }
    } catch (e) {
      errors.push({
        address: assignment.address,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Payment-link attempts (additive; isolated so a failure here
  //    can never break the proven user-deposit scan above) ──
  let linkAttempts = { checked: 0, credited: 0, settled: 0 };
  try {
    linkAttempts = await scanLinkAttempts(supabase, tipHeight, mediumSats, largeSats);
  } catch (e) {
    console.error("check_deposits: link-attempt scan failed (user scan unaffected):", e);
    errors.push({
      address: "(payment-link attempts)",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return json(200, {
    checked_addresses: assignments?.length ?? 0,
    deposits_seen: seen,
    credited,
    errors,
    link_attempts: linkAttempts,
  });
}

/** "Pay with Bitcoin" attempts: scan each OPEN attempt's dedicated
 *  address with the same confirmation tiers and large-deposit
 *  cross-check as user deposits, accumulate via
 *  btc_record_link_attempt_deposit (escrow — the merchant's
 *  spendable balance is untouched until settlement), then settle
 *  covered attempts through the same exactly-once settlement +
 *  payment_link.paid dispatch the checkout function uses, and close
 *  out expired part-paid attempts. */
async function scanLinkAttempts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tipHeight: number,
  mediumSats: number,
  largeSats: number,
): Promise<{ checked: number; credited: number; settled: number }> {
  const { data: attempts, error } = await supabase
    .from("payment_link_btc_attempts")
    .select("*")
    .in("status", ["waiting", "partial", "expired"])
    .not("onchain_address", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;

  let credited = 0;
  let settled = 0;
  for (const attempt of attempts ?? []) {
    const address = attempt.onchain_address as string;
    let txs;
    try {
      txs = await fetchAddressTxs(address);
    } catch {
      continue; // explorer hiccup on this address — next scan retries
    }
    for (const tx of txs) {
      const vouts = tx.vout ?? [];
      for (let voutIndex = 0; voutIndex < vouts.length; voutIndex++) {
        const vout = vouts[voutIndex];
        if (vout.scriptpubkey_address !== address) continue;
        if (!vout.value || vout.value <= 0) continue;

        const confirmations = tx.status?.confirmed && tx.status.block_height
          ? tipHeight - tx.status.block_height + 1
          : 0;
        const requiredConfs = requiredConfirmationsFor(vout.value, mediumSats, largeSats);

        if (
          depositNeedsCrossCheck(vout.value, largeSats) &&
          confirmations >= requiredConfs
        ) {
          const verdict = await crossCheckLargeDeposit(tx, voutIndex, address, vout.value);
          if (!verdict.ok) continue; // held this round, like user deposits
        }

        const { data: result, error: rpcErr } = await supabase.rpc(
          "btc_record_link_attempt_deposit",
          {
            p_attempt_id: attempt.id,
            p_address: address,
            p_txid: tx.txid,
            p_vout: voutIndex,
            p_amount_sats: vout.value,
            p_confirmations: confirmations,
            p_required_confs: requiredConfs,
          },
        );
        if (rpcErr) {
          console.error("link attempt deposit record failed:", rpcErr.message);
          continue;
        }
        if (result === "credited") credited++;
      }
    }

    // Reload the attempt (deposits may have moved it), then run the
    // same lifecycle transitions the payer's status poll drives.
    const { data: fresh } = await supabase
      .from("payment_link_btc_attempts")
      .select("*")
      .eq("id", attempt.id)
      .maybeSingle();
    if (!fresh) continue;

    if (Number(fresh.received_sats) >= Number(fresh.required_sats)) {
      const { data: settleRows, error: settleErr } = await supabase.rpc(
        "execute_payment_link_btc_settlement",
        { p_attempt_id: fresh.id, p_payment_method: "bitcoin_onchain" },
      );
      if (settleErr) {
        console.error("link attempt settlement failed:", settleErr.message);
        continue;
      }
      const row = Array.isArray(settleRows) ? settleRows[0] : settleRows;
      settled++;
      if (row?.owner_transaction_id) {
        try {
          const { data: settledLink } = await supabase
            .from("payment_links")
            .select("id, link_code, title, user_id, payment_count, total_collected, metadata")
            .eq("id", fresh.link_id)
            .maybeSingle();
          if (settledLink) {
            await dispatchPaymentLinkPaid(supabase, settledLink, {
              ownerTransactionId: row.owner_transaction_id,
              payerTransactionId: null,
              amount: Number(fresh.fiat_amount),
              currency: fresh.fiat_currency,
              paymentMethod: "bitcoin_onchain",
              // The attempt's locked fee truth, as on the checkout
              // function's dispatch.
              feePayer: fresh.fee_payer,
              feeAmount: Number(fresh.fee_fiat),
              totalCharged: fresh.fee_payer === "buyer"
                ? Number(fresh.fiat_amount) + Number(fresh.fee_fiat)
                : Number(fresh.fiat_amount),
              settledAt: new Date().toISOString(),
            });
          }
        } catch (whErr) {
          console.error("payment_link.paid dispatch failed (BTC settlement unaffected):", whErr);
        }
      }
    } else if (new Date(fresh.expires_at).getTime() <= Date.now()) {
      // Window closed: plain expiry when nothing arrived, full
      // no-fee credit for a partial.
      const { error: finErr } = await supabase.rpc("finalize_payment_link_btc_partial", {
        p_attempt_id: fresh.id,
      });
      if (finErr) console.error("link attempt close-out failed:", finErr.message);
    }
  }
  return { checked: (attempts ?? []).length, credited, settled };
}

/**
 * M2 cross-check: fetch the deposit's transaction from the SECOND,
 * independent explorer and let the pure btc-core policy judge the
 * agreement. Any fetch failure or non-OK answer yields a null
 * secondary view, which the policy treats as a hold (fail-closed).
 */
async function crossCheckLargeDeposit(
  primaryTx: any,
  voutIndex: number,
  address: string,
  valueSats: number,
): Promise<DepositCrossCheck> {
  const primary: DepositTxView = {
    confirmed: primaryTx.status?.confirmed === true,
    blockHeight: primaryTx.status?.block_height ?? null,
    voutValue: null,
    voutAddress: null,
  };
  let secondary: DepositTxView | null = null;
  try {
    const res = await fetch(`${ESPLORA_SECONDARY}/tx/${primaryTx.txid}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const tx2 = await res.json();
      const v2 = tx2.vout?.[voutIndex];
      secondary = {
        confirmed: tx2.status?.confirmed === true,
        blockHeight: tx2.status?.block_height ?? null,
        voutValue: v2 ? Number(v2.value) : null,
        voutAddress: v2?.scriptpubkey_address ?? null,
      };
    }
  } catch {
    secondary = null;
  }
  return crossCheckDeposit(primary, secondary, address, valueSats);
}

async function fetchAddressTxs(address: string): Promise<any[]> {
  const byId = new Map<string, any>();
  // Confirmed history (newest 25 — sufficient at custodial launch scale;
  // deposits are credited when fresh) plus the mempool view.
  for (const suffix of ["/txs", "/txs/mempool"]) {
    const res = await esplora(`/address/${address}${suffix}`);
    if (!res.ok) throw new Error(`Esplora ${suffix} failed: ${res.status}`);
    const txs = await res.json();
    for (const tx of txs) byId.set(tx.txid, tx);
  }
  return [...byId.values()];
}

// ── estimate_send (protection P3) ────────────────────────────────────────

/**
 * Read-only fee estimate for the send form: the SAME esplora rate and
 * the SAME first-pass coin selection the send path reserves at, for
 * the entered amount — so the confirm step can show an honest
 * estimate before the user commits. Moves nothing, reserves nothing.
 * The exact fee is only known at broadcast (the send path recomputes
 * it from the built transaction), which is why this is labelled an
 * estimate end-to-end.
 */
async function estimateSend(supabase: any, userId: string, body: any) {
  void userId; // identity already verified by the router; the estimate is pool-level
  const c = custody();
  if (!c.configured) {
    console.error("btc-onchain estimate_send: custody not configured (" + c.reason + ")");
    return json(503, { error: WITHDRAWALS_NOT_CONFIGURED });
  }
  const accountPub = c.accountPub;

  const toAddress = typeof body?.to_address === "string" ? body.to_address.trim() : "";
  const amountSats = Number(body?.amount_sats);
  if (!toAddress) return json(400, { error: "to_address is required" });
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return json(400, { error: "amount_sats must be a positive integer" });
  }
  let recipient;
  try {
    recipient = validateMainnetAddress(toAddress);
  } catch {
    return json(400, { error: "Invalid mainnet Bitcoin address" });
  }

  const feeRes = await esplora("/v1/fees/recommended");
  if (!feeRes.ok) return json(502, { error: "Fee estimation unavailable" });
  const fees = await feeRes.json();
  const feeRate = Math.max(1, Math.ceil(Number(fees.halfHourFee) || 0));
  if (!feeRate) return json(502, { error: "Fee estimation unavailable" });

  const utxos = await gatherUtxos(supabase, accountPub);
  const changeScript = deriveScript(accountPub, 1, 0);
  const selection = selectCoins(utxos, amountSats, feeRate, recipient.script, changeScript);
  if (!selection) {
    return json(200, {
      estimate_available: true,
      sufficient: false,
      fee_rate_sat_vb: feeRate,
      estimated_fee_sats: null,
      estimated_vsize: null,
      input_count: null,
    });
  }
  return json(200, {
    estimate_available: true,
    sufficient: true,
    fee_rate_sat_vb: feeRate,
    estimated_fee_sats: selection.feeSats,
    estimated_vsize: estimateVsize(selection.selected.length, [recipient.script, changeScript]),
    input_count: selection.selected.length,
    total_debit_sats: amountSats + selection.feeSats,
  });
}

// ── consolidate (protection P2b) ─────────────────────────────────────────

/**
 * The UTXO consolidation duty: sweep small pooled UTXOs into one
 * output when the network is cheap, so they never inflate future
 * withdrawal fees (gas audit row 4). Every invocation — executed or
 * not — writes a btc_consolidation_runs audit row saying what was
 * decided and why. The plan is the pure planConsolidation policy in
 * btc-core; the fee is paid from the PLATFORM OPERATOR's BTC fee
 * income via btc_record_consolidation, booked only after the
 * broadcast is positively confirmed (an unconfirmed broadcast stays
 * 'broadcast_unknown' for human reconciliation — the withdrawal
 * doctrine, applied to housekeeping).
 */
async function consolidate(supabase: any) {
  const recordRun = async (
    status: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ) => {
    const { data, error } = await supabase
      .from("btc_consolidation_runs")
      .insert({ status, reason, ...extra })
      .select("id")
      .single();
    if (error) console.error("btc-onchain consolidate: audit row failed:", error);
    return data?.id as string | undefined;
  };
  const skip = async (status: string, reason: string, extra: Record<string, unknown> = {}) => {
    const runId = await recordRun(status, reason, extra);
    return json(200, { consolidated: false, status, reason, run_id: runId ?? null });
  };

  // Policy from platform_settings (the shared fee-window policy, P4).
  const { data: settings } = await supabase
    .from("platform_settings")
    .select(
      "btc_consolidation_enabled, btc_fee_window_consolidation_max_sat_vb, " +
      "btc_consolidation_min_inputs, btc_consolidation_small_max_sats",
    )
    .limit(1)
    .maybeSingle();
  const enabled = settings?.btc_consolidation_enabled !== false;
  const policy = {
    smallMaxSats: Number(settings?.btc_consolidation_small_max_sats ?? 10_000),
    minInputs: Number(settings?.btc_consolidation_min_inputs ?? 10),
    maxInputs: 200,
    maxFeeRateSatVb: Number(settings?.btc_fee_window_consolidation_max_sat_vb ?? 2),
  };
  if (!enabled) return await skip("skipped_disabled", "Consolidation is switched off in platform settings");

  // At most one executed consolidation per UTC day.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: doneToday } = await supabase
    .from("btc_consolidation_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "broadcast")
    .gte("created_at", dayStart.toISOString());
  if ((doneToday ?? 0) >= 1) {
    return await skip("skipped_daily_limit", "A consolidation already broadcast today");
  }

  // Fee window: the live network rate must be at/under the cap.
  const feeRes = await esplora("/v1/fees/recommended");
  if (!feeRes.ok) {
    return await skip("failed", "Fee estimation unavailable — esplora did not answer");
  }
  const fees = await feeRes.json();
  const feeRate = Math.max(1, Math.ceil(Number(fees.halfHourFee) || 0));
  if (!feeRate) return await skip("failed", "Fee estimation unavailable — no halfHourFee");

  const r = receiveStatus(Deno.env.get("BTC_XPUB"));
  if (!r.configured) {
    return await skip("skipped_no_custody", "Receiving not configured (" + r.reason + ")", {
      fee_rate_sat_vb: feeRate,
    });
  }
  const accountPub = r.accountPub;

  // Spendable pool, minus outpoints committed to in-flight withdrawals.
  const utxos = await gatherUtxos(supabase, accountPub);
  const committed = await committedOutpoints(supabase, "00000000-0000-0000-0000-000000000000");
  const spendable = filterUncommittedUtxos(utxos, committed);
  const eligibleCount = spendable.filter((u) => u.value > 0 && u.value <= policy.smallMaxSats).length;

  // Any P2WPKH script sizes the plan identically; index 0 is a valid
  // stand-in for planning, as in the send path's change script.
  const planOrSkip = planConsolidation(
    spendable, policy, feeRate, deriveScript(accountPub, 0, 0),
  );
  if ("skip" in planOrSkip) {
    const status = planOrSkip.skip === "fee_window_closed"
      ? "skipped_fee_window"
      : planOrSkip.skip === "output_below_dust"
        ? "skipped_output_dust"
        : "skipped_min_inputs";
    return await skip(status, `planConsolidation: ${planOrSkip.skip}`, {
      fee_rate_sat_vb: feeRate,
      input_count: eligibleCount,
    });
  }
  const plan: ConsolidationPlan = planOrSkip;

  // The fee comes out of the platform operator's BTC fee income
  // (earliest admin — the settlement rule). Insufficient fee income
  // skips the run; a user never pays for housekeeping.
  const { data: opRows } = await supabase
    .from("user_roles")
    .select("user_id, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(1);
  const operatorId = opRows?.[0]?.user_id as string | undefined;
  if (!operatorId) return await skip("skipped_fee_unfunded", "No platform operator exists");
  const { data: opWallet } = await supabase
    .from("crypto_wallets")
    .select("balance_sats")
    .eq("user_id", operatorId)
    .eq("asset", "BTC")
    .maybeSingle();
  if (Number(opWallet?.balance_sats ?? 0) < plan.feeSats) {
    return await skip("skipped_fee_unfunded",
      `Operator BTC fee income ${Number(opWallet?.balance_sats ?? 0)} sats < consolidation fee ${plan.feeSats} sats`,
      { fee_rate_sat_vb: feeRate, input_count: plan.inputs.length, fee_sats: plan.feeSats });
  }

  // Signing needs the full custody interlock.
  const c = custody();
  if (!c.configured) {
    return await skip("skipped_no_custody", "Custody not configured (" + c.reason + ")", {
      fee_rate_sat_vb: feeRate, input_count: plan.inputs.length,
    });
  }

  // Output: a fresh chain-0 address from the shared derivation
  // sequence (never a user assignment, never an attempt address —
  // the deposit scanner cannot credit it, and gatherUtxos' scan bound
  // now covers consolidation outputs, so the coin stays spendable).
  const { data: idxData, error: idxErr } = await supabase.rpc("btc_next_derivation_index");
  if (idxErr) return await skip("failed", "Output index allocation failed");
  const outputIndex = Number(idxData);
  const outputAddress = deriveAddress(accountPub, 0, outputIndex);

  const runId = await recordRun("broadcast_unknown", "in flight", {
    fee_rate_sat_vb: feeRate,
    input_count: plan.inputs.length,
    inputs: plan.inputs,
    total_in_sats: plan.totalInSats,
    fee_sats: plan.feeSats,
    output_sats: plan.outputSats,
    output_address: outputAddress,
    output_derivation_index: outputIndex,
  });
  if (!runId) return json(500, { error: "Could not open the consolidation audit row" });

  let built;
  try {
    built = buildConsolidationTx({
      accountPriv: c.accountPriv, accountPub,
      inputs: plan.inputs, feeRateSatVb: feeRate,
      outputChain: 0, outputIndex, expectedFeeSats: plan.feeSats,
    });
    if (built.feeSats !== plan.feeSats) {
      throw new Error("Fee mismatch between consolidation plan and built transaction");
    }
  } catch (e) {
    await supabase.from("btc_consolidation_runs")
      .update({ status: "failed", reason: thrownMessage(e, "build failed"), updated_at: new Date().toISOString() })
      .eq("id", runId);
    return json(200, { consolidated: false, status: "failed", run_id: runId });
  }

  const broadcast = await broadcastTx(built.hex, built.txid);
  // Record the txid whatever the outcome (reconciliation + input
  // exclusion), mirroring recordWithdrawalTxid.
  await supabase.from("btc_consolidation_runs")
    .update({ txid: built.txid, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (broadcast.outcome === "unknown") {
    console.error(
      "CRITICAL: consolidation broadcast outcome unknown — run left 'broadcast_unknown' for reconciliation (fee NOT booked)",
      runId, built.txid, broadcast.detail,
    );
    return json(202, { consolidated: false, status: "broadcast_unknown", run_id: runId, txid: built.txid });
  }

  const { error: bookErr } = await supabase.rpc("btc_record_consolidation", {
    p_run_id: runId,
    p_operator_user_id: operatorId,
    p_txid: built.txid,
    p_fee_sats: built.feeSats,
  });
  if (bookErr) {
    console.error("CRITICAL: consolidation broadcast but fee booking failed", runId, built.txid, bookErr);
    return json(500, {
      consolidated: true, status: "broadcast_unbooked", run_id: runId, txid: built.txid,
    });
  }
  return json(200, {
    consolidated: true, status: "broadcast", run_id: runId,
    txid: built.txid, fee_sats: built.feeSats, input_count: plan.inputs.length,
  });
}

// ── send ───────────────────────────────────────────────────────────────────

async function send(supabase: any, userId: string, body: any) {
  // Custody gate FIRST: while custody is not genuinely configured, every
  // withdrawal attempt gets the designed refusal — never a simulation,
  // never a later failure from a half-configured money path. The gate
  // includes the seed⇄xpub interlock (custodyStatus), so the keys used
  // below are guaranteed to control the same wallet.
  const c = custody();
  if (!c.configured) {
    console.error("btc-onchain send: custody not configured (" + c.reason + ")");
    return json(503, { error: WITHDRAWALS_NOT_CONFIGURED });
  }

  // ── Freeze guard: a frozen account cannot withdraw on-chain ──
  // (Receiving stays open; only the send path checks.)
  if (await isAccountFrozen(supabase, userId)) {
    return json(403, { error: ACCOUNT_FROZEN_MESSAGE });
  }
  const accountPriv = c.accountPriv;
  const accountPub = c.accountPub;

  const toAddress = typeof body?.to_address === "string" ? body.to_address.trim() : "";
  const amountSats = Number(body?.amount_sats);
  const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key : "";

  if (!toAddress) return json(400, { error: "to_address is required" });
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return json(400, { error: "amount_sats must be a positive integer" });
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 80) {
    return json(400, { error: "idempotency_key is required (8–80 chars)" });
  }

  let recipient;
  try {
    recipient = validateMainnetAddress(toAddress);
  } catch {
    return json(400, { error: "Invalid mainnet Bitcoin address" });
  }

  // Replay of an earlier request? Return its recorded outcome, never re-send.
  const { data: prior } = await supabase
    .from("btc_withdrawals")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (prior) {
    if (prior.user_id !== userId) {
      return json(409, { error: "Idempotency key already used" });
    }
    if (prior.status === "broadcast" || prior.status === "confirmed") {
      return json(200, {
        withdrawal_id: prior.id, txid: prior.txid,
        amount_sats: prior.amount_sats, fee_sats: prior.fee_sats,
        status: prior.status,
      });
    }
    if (prior.status === "failed") {
      return json(400, { error: `This withdrawal already failed: ${prior.error ?? "unknown"}` });
    }
    return json(409, { error: "This withdrawal is already in progress" });
  }

  // Limits (config constants with env overrides).
  const minSats = envInt("BTC_MIN_WITHDRAWAL_SATS", 10_000);
  const maxTxSats = envInt("BTC_MAX_TX_SATS", 2_000_000);
  const maxDailySats = envInt("BTC_MAX_DAILY_SATS", 5_000_000);
  if (amountSats < minSats) {
    return json(400, { error: `Minimum withdrawal is ${minSats} sats` });
  }
  if (amountSats > maxTxSats) {
    return json(400, { error: `Maximum per-transaction withdrawal is ${maxTxSats} sats` });
  }
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sentToday = await sumRecentWithdrawalSats(supabase, userId, dayAgo);
  if (sentToday + amountSats > maxDailySats) {
    return json(400, { error: `Daily withdrawal limit is ${maxDailySats} sats` });
  }

  // (Keys and the seed⇄xpub interlock were verified by the custody gate
  // at the top of this function — accountPriv/accountPub come from it.)

  // Fee rate from the network (hard-fail if unavailable — never guess fees).
  const feeRes = await esplora("/v1/fees/recommended");
  if (!feeRes.ok) return json(502, { error: "Fee estimation unavailable" });
  const fees = await feeRes.json();
  const feeRate = Math.max(1, Math.ceil(Number(fees.halfHourFee) || 0));
  if (!feeRate) return json(502, { error: "Fee estimation unavailable" });

  // Gather confirmed UTXOs across the platform wallet.
  const utxos = await gatherUtxos(supabase, accountPub);
  // Coin selection needs a change script for fee sizing only — every
  // BIP84 change script has identical length, so index 0 is a valid
  // stand-in. The real change index is allocated after the reservation,
  // which keeps "one allocated index per withdrawal row" true and lets
  // gatherUtxos bound its change scan by the withdrawals count.
  const selection = selectCoins(
    utxos, amountSats, feeRate, recipient.script, deriveScript(accountPub, 1, 0),
  );
  if (!selection) {
    return json(409, {
      error: "Platform funds are not yet available for withdrawal (awaiting confirmations or insufficient confirmed balance)",
    });
  }

  // Reserve the user's ledger balance atomically.
  const { data: reserveRows, error: reserveErr } = await supabase.rpc("btc_reserve_withdrawal", {
    p_user_id: userId,
    p_to_address: toAddress,
    p_amount_sats: amountSats,
    p_fee_sats: selection.feeSats,
    p_idempotency_key: idempotencyKey,
    // M1 (P2-15): the cap is enforced inside the reserving
    // transaction, under a per-user advisory lock — this pre-check
    // above and the post-reservation re-check remain as outer layers.
    p_max_daily_sats: maxDailySats,
  });
  if (reserveErr) {
    return json(400, { error: reserveErr.message });
  }
  const withdrawal = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
  const withdrawalId = withdrawal.withdrawal_id;

  // Allocate the change index now that a withdrawal row exists.
  const { data: changeIdx, error: changeErr } = await supabase.rpc("btc_next_change_index");
  if (changeErr) {
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: "change index allocation failed",
    });
    return json(500, { error: "Could not prepare the withdrawal; your balance was refunded" });
  }
  const changeIndex = Number(changeIdx);

  // ── Concurrency hardening (audit M1) ─────────────────────────────────
  // Two sends racing through this function share one pooled UTXO set,
  // and both selected coins from the same pre-reservation snapshot.
  // The btc_withdrawals schema records no per-withdrawal input set,
  // so the committed set is reconstructed from what IS recorded: any
  // OTHER withdrawal in 'reserved' (broadcast outcome unresolved) or
  // 'broadcast' carrying a txid has a transaction on the network
  // whose inputs are spoken for. Exclude those outpoints and re-run
  // selection; if the spendable remainder no longer covers the
  // reserved amount at the reserved fee, fail honestly — still
  // pre-broadcast, so btc_fail_withdrawal refunds in full.
  const committed = await committedOutpoints(supabase, withdrawalId);
  const spendableUtxos = filterUncommittedUtxos(utxos, committed);
  const reselection = selectCoins(
    spendableUtxos, amountSats, feeRate, recipient.script, deriveScript(accountPub, 1, 0),
  );
  if (!reselection || reselection.feeSats !== selection.feeSats) {
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: "coin selection changed after reservation",
    });
    return json(500, { error: "Could not prepare the withdrawal; your balance was refunded" });
  }

  // Build + sign. A build failure here is safe: nothing was broadcast, so
  // the reservation is refunded by btc_fail_withdrawal.
  let built;
  try {
    built = buildWithdrawalTx({
      accountPriv, accountPub, utxos: spendableUtxos,
      toAddress, amountSats, feeRateSatVb: feeRate, changeIndex,
    });
    if (built.feeSats !== selection.feeSats) {
      throw new Error("Fee mismatch between selection and built transaction");
    }
  } catch (e) {
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: e instanceof Error ? e.message : "build failed",
    });
    return json(500, { error: "Could not build the withdrawal transaction; your balance was refunded" });
  }

  // ── Pre-broadcast re-validation (audit M1), the last free exit ──────
  // (a) Daily-cap re-check. The pre-reservation check ran against a
  // snapshot a concurrent send from the same user could also have
  // passed; this sum counts every 'reserved' row — this withdrawal
  // and any racer's — and a reservation cannot slip between the two
  // racers' re-checks uncounted: reservations precede re-checks, so
  // whoever re-checks with the higher total already on the books
  // fails their own withdrawal and is refunded here, pre-broadcast.
  const sentAfterReserve = await sumRecentWithdrawalSats(supabase, userId, dayAgo);
  if (sentAfterReserve > maxDailySats) {
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: "daily withdrawal limit exceeded",
    });
    return json(400, { error: `Daily withdrawal limit is ${maxDailySats} sats` });
  }

  // (b) Input re-confirmation. Every input of the built transaction
  // must still be unspent. If a concurrent withdrawal won the race
  // to broadcast, the shared input disappears from the UTXO set once
  // the indexer sees its transaction; catching that here converts a
  // stuck 'reserved' row into a clean pre-broadcast refund. A lookup
  // failure proves nothing and blocks nothing (the broadcast
  // classification below remains the safety net), so errors are
  // logged and treated as "still unspent".
  const spentInput = await firstSpentInput(accountPub, reselection.selected);
  if (spentInput) {
    console.error(
      "btc-onchain send: built input already spent, refunding before broadcast",
      withdrawalId, spentInput.txid, spentInput.vout,
    );
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: "input already committed to another withdrawal",
    });
    return json(409, {
      error: "Could not complete the withdrawal safely; your balance was refunded — please try again",
    });
  }

  // Broadcast. The outcome is classified by the pure policy in btc-core
  // (classifyBroadcastOutcome), which has NO refunding outcome: no
  // network response can prove the transaction was not accepted, so
  // anything short of positive confirmation leaves the withdrawal
  // 'reserved' for a human refund decision (runbook §8). Automatic
  // refunds happen only before this point, where non-broadcast is
  // proven by construction (reserve/build failures above).
  const broadcast = await broadcastTx(built.hex, built.txid);
  if (broadcast.outcome === "unknown") {
    // The signed transaction MAY be on the network despite the ambiguous
    // answer. Refunding here is the one unforgivable outcome: if the tx
    // later confirms, the user would hold both the refund and the BTC.
    // Leave the row 'reserved' (no refund, no finalize) and log loudly
    // for manual reconciliation (runbook §8), mirroring the
    // finalize-failure path below. 202, not 5xx: the request was
    // accepted and its verification is ongoing — a failure status would
    // invite a retry, and a retry could pay out twice.
    // Record the txid on the row (status untouched — still
    // 'reserved', still no refund): reconciliation can then find
    // the transaction in the table rather than only in logs, and
    // later sends exclude this transaction's inputs from coin
    // selection via committedOutpoints above.
    await recordWithdrawalTxid(supabase, withdrawalId, built.txid);
    console.error(
      "CRITICAL: broadcast outcome unknown — withdrawal left 'reserved' for reconciliation (do NOT refund)",
      withdrawalId, built.txid, broadcast.detail,
    );
    return json(202, {
      error:
        "Your withdrawal was sent to the network but its confirmation is delayed — it is being verified, do not retry",
      txid: built.txid,
      withdrawal_id: withdrawalId,
      status: "verifying",
    });
  }

  const { error: finErr } = await supabase.rpc("btc_finalize_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_txid: built.txid,
  });
  if (finErr) {
    // The BTC has left the wallet but the ledger row is still 'reserved'.
    // Do NOT refund. Surface loudly for manual reconciliation (runbook §8).
    // Record the txid on the row first (status untouched) so the
    // transaction is findable in the table and its inputs are
    // excluded from later coin selections.
    await recordWithdrawalTxid(supabase, withdrawalId, built.txid);
    console.error("CRITICAL: broadcast succeeded but finalize failed", withdrawalId, built.txid, finErr);
    return json(500, {
      error: "Withdrawal broadcast but not yet recorded — support has the txid",
      txid: built.txid,
      withdrawal_id: withdrawalId,
    });
  }

  // Activity-feed ledger row (best-effort; btc_withdrawals is authoritative).
  const { error: txErr } = await supabase.from("transactions").insert({
    user_id: userId,
    amount: (amountSats + selection.feeSats) / 100_000_000,
    currency: "BTC",
    direction: "outgoing",
    payment_method: "bitcoin_onchain",
    status: "completed",
    description: "Bitcoin withdrawal (on-chain)",
    reference: built.txid,
    category: "btc_withdrawal",
    idempotency_key: `btc-wd:${withdrawalId}`,
    metadata: { type: "withdrawal", txid: built.txid, fee_sats: selection.feeSats },
  });
  if (txErr) console.error("Withdrawal ledger row failed:", txErr);

  return json(200, {
    withdrawal_id: withdrawalId,
    txid: built.txid,
    amount_sats: amountSats,
    fee_sats: selection.feeSats,
    status: "broadcast",
  });
}

// ── send helpers (audit M1) ──────────────────────────────────────────────

/**
 * Sum of a user's withdrawals in the window across every status that
 * still commits funds ('reserved' included, so a freshly created
 * reservation counts the moment it exists). Used by both the
 * pre-reservation cap check and the pre-broadcast re-check.
 */
async function sumRecentWithdrawalSats(supabase: any, userId: string, sinceIso: string): Promise<number> {
  const { data: recent } = await supabase
    .from("btc_withdrawals")
    .select("amount_sats")
    .eq("user_id", userId)
    .in("status", ["reserved", "broadcast", "confirmed"])
    .gte("created_at", sinceIso);
  return (recent ?? []).reduce((s: number, r: any) => s + Number(r.amount_sats), 0);
}

/**
 * Outpoints already committed to OTHER in-flight withdrawals: every
 * 'reserved' (broadcast outcome unresolved) or 'broadcast' row that
 * carries a txid has a transaction on the network, and its inputs
 * are spoken for. The txids are resolved through esplora; a lookup
 * failure is logged and skipped — the UTXO endpoint the caller
 * gathered from is the same provider, and the broadcast
 * classification remains the safety net for anything missed here.
 */
async function committedOutpoints(supabase: any, excludeWithdrawalId: string): Promise<Outpoint[]> {
  const { data: rows } = await supabase
    .from("btc_withdrawals")
    .select("id, txid")
    .in("status", ["reserved", "broadcast"])
    .not("txid", "is", null)
    .neq("id", excludeWithdrawalId);
  const out: Outpoint[] = [];
  for (const row of rows ?? []) {
    if (!row.txid) continue;
    try {
      const res = await esplora(`/tx/${row.txid}`);
      if (!res.ok) {
        console.error(
          "btc-onchain: could not fetch in-flight withdrawal tx for coin exclusion",
          row.id, row.txid, res.status,
        );
        continue;
      }
      out.push(...spentOutpointsFromTx(await res.json()));
    } catch (e) {
      console.error("btc-onchain: coin exclusion lookup failed", row.id, row.txid, e);
    }
  }
  return out;
}

/**
 * The first of `selected` that esplora no longer lists as an unspent
 * output of its address, or null when all are still unspent. Per-input
 * lookup errors are logged and treated as "still unspent": a failed
 * lookup proves nothing, and the broadcast classification below —
 * never this check — is what guards the money.
 */
async function firstSpentInput(accountPub: any, selected: Utxo[]): Promise<Utxo | null> {
  for (const u of selected) {
    try {
      const address = deriveAddress(accountPub, u.chain, u.index);
      const res = await esplora(`/address/${address}/utxo`);
      if (!res.ok) {
        console.error("btc-onchain: input re-check UTXO fetch failed", address, res.status);
        continue;
      }
      const entries = await res.json();
      const stillUnspent = (entries ?? []).some(
        (e: any) => e.txid === u.txid && Number(e.vout) === u.vout,
      );
      if (!stillUnspent) return u;
    } catch (e) {
      console.error("btc-onchain: input re-check failed", u.txid, u.vout, e);
    }
  }
  return null;
}

/**
 * Best-effort: record a broadcast transaction's txid on its
 * withdrawal row WITHOUT changing the row's status. Only used on
 * paths where the row deliberately stays 'reserved' (unknown
 * broadcast outcome, finalize failure) — the recorded txid lets
 * reconciliation find the transaction in the table instead of only
 * in logs, and lets later sends exclude its inputs via
 * committedOutpoints. A failed write changes nothing about the
 * outcome returned to the user.
 */
async function recordWithdrawalTxid(supabase: any, withdrawalId: string, txid: string): Promise<void> {
  const { error } = await supabase
    .from("btc_withdrawals")
    .update({ txid, updated_at: new Date().toISOString() })
    .eq("id", withdrawalId);
  if (error) {
    console.error("CRITICAL: could not record txid on withdrawal row", withdrawalId, txid, error);
  }
}

async function gatherUtxos(supabase: any, accountPub: any): Promise<Utxo[]> {
  const { data: maxRow } = await supabase
    .from("btc_address_assignments")
    .select("derivation_index")
    .order("derivation_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let maxExternal = maxRow ? Number(maxRow.derivation_index) : -1;

  // Chain-0 indices also come from the SAME sequence for payment-link
  // attempt addresses and consolidation outputs (protection P2b) —
  // their UTXOs are pooled funds too and must stay spendable, so the
  // scan bound covers the highest index any of the three has used.
  const { data: maxAttempt } = await supabase
    .from("payment_link_btc_attempts")
    .select("derivation_index")
    .not("derivation_index", "is", null)
    .order("derivation_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxAttempt) maxExternal = Math.max(maxExternal, Number(maxAttempt.derivation_index));
  const { data: maxCons } = await supabase
    .from("btc_consolidation_runs")
    .select("output_derivation_index")
    .not("output_derivation_index", "is", null)
    .order("output_derivation_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxCons) maxExternal = Math.max(maxExternal, Number(maxCons.output_derivation_index));

  const { count: withdrawalCount } = await supabase
    .from("btc_withdrawals")
    .select("id", { count: "exact", head: true });
  // Every allocated change index belongs to exactly one withdrawal row
  // (allocation happens after reserve), so change outputs can only live
  // at indices 0..(row count). Scan with a small margin.
  const maxChange = (withdrawalCount ?? 0) + 1;

  const targets: Array<{ chain: 0 | 1; index: number }> = [];
  for (let i = 0; i <= maxExternal; i++) targets.push({ chain: 0, index: i });
  for (let i = 0; i <= maxChange; i++) targets.push({ chain: 1, index: i });
  if (targets.length > MAX_SCAN_ADDRESSES) {
    throw new Error("Wallet UTXO scan limit reached — see custody runbook (scaling)");
  }

  const utxos: Utxo[] = [];
  const BATCH = 8;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (t) => {
      const address = deriveAddress(accountPub, t.chain, t.index);
      const res = await esplora(`/address/${address}/utxo`);
      if (!res.ok) throw new Error(`Esplora UTXO fetch failed for ${address}: ${res.status}`);
      const entries = await res.json();
      return entries
        .filter((e: any) => e.status?.confirmed && e.value > 0)
        .map((e: any) => ({
          txid: e.txid as string,
          vout: Number(e.vout),
          value: Number(e.value),
          chain: t.chain,
          index: t.index,
        }));
    }));
    for (const r of results) utxos.push(...r);
  }
  return utxos;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether the network already holds this exact transaction. */
async function lookupTx(txid: string): Promise<boolean> {
  const res = await esplora(`/tx/${txid}`).catch(() => null);
  return res !== null && res.ok;
}

type BroadcastResult =
  | { outcome: "confirmed" }
  | { outcome: "unknown"; detail: string };

/**
 * Broadcast a signed withdrawal and classify what the network proved.
 *
 * The DECISION — above all, that no network observation may authorise
 * a refund — is the pure classifyBroadcastOutcome policy in btc-core;
 * this function only gathers observations: one POST /tx, then
 * GET /tx/{txid} lookups for OUR txid (never the txid a response
 * happened to name). An UNKNOWN verdict is double-checked with two
 * more lookups a short interval apart (indexing lag is seconds-scale)
 * before it is returned — the lookups hunt for positive confirmation;
 * their absence proves nothing and refunds nothing.
 */
async function broadcastTx(hex: string, expectedTxid: string): Promise<BroadcastResult> {
  let postStatus: number | null = null;
  let postBody = "";
  let postTxid: string | null = null;
  let postError: string | null = null;
  try {
    const res = await esplora("/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: hex,
    });
    postStatus = res.status;
    const text = await res.text().catch(() => "");
    if (res.ok) {
      postTxid = text.trim() || null;
    } else {
      postBody = text;
    }
  } catch (e) {
    // Timeout / network error: the POST may still have landed.
    postError = e instanceof Error ? e.message : String(e);
  }

  const classify = (lookupFound: boolean): BroadcastClassification =>
    classifyBroadcastOutcome({ postStatus, postBody, postTxid, lookupFound }, expectedTxid);

  // A txid match on the POST settles it without any lookup. Anything
  // else — rejection, timeout, unexpected txid — is checked against
  // the network before it is believed.
  let cls = classify(false);
  let lookupFound = false;
  if (cls.outcome !== "confirmed") {
    lookupFound = await lookupTx(expectedTxid);
    cls = classify(lookupFound);
  }
  if (cls.outcome === "confirmed") return { outcome: "confirmed" };

  // UNKNOWN: bounded double-check — two further lookups ~1.5s apart
  // (~3s total) — before the withdrawal is left reserved for
  // reconciliation. Classification is recomputed from the same POST
  // observation; only the lookup evidence can change the verdict.
  for (let i = 0; i < 2 && !lookupFound; i++) {
    await sleep(1500);
    lookupFound = await lookupTx(expectedTxid);
  }
  cls = classify(lookupFound);
  if (cls.outcome === "confirmed") return { outcome: "confirmed" };
  const postDesc = postStatus === null
    ? `no response (${postError ?? "request failed"})`
    : `HTTP ${postStatus}${postTxid ? ` txid ${postTxid}` : ""}${postBody ? ` ${postBody.slice(0, 200)}` : ""}`;
  return {
    outcome: "unknown",
    detail: `broadcast unconfirmed after re-checks: ${cls.reason}; POST ${postDesc}`,
  };
}
