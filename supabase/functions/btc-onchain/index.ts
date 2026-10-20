// btc-onchain: custodial on-chain Bitcoin — deposits, detection, sends.
//
// Actions (POST JSON { action, ... }):
//   receive         (user JWT)  → the caller's unique BIP84 deposit address
//   check_deposits  (service role only) → scan assigned addresses on an
//                   esplora API, record deposits, credit at 1 confirmation
//   send            (user JWT)  → withdraw to an external mainnet address;
//                   reserved → built → signed → broadcast → finalized,
//                   with automatic refund if broadcast provably fails
//
// Secrets (no defaults, hard-fail when absent):
//   BTC_XPUB           account zpub (watch-only derivation for receive)
//   BTC_SEED_MNEMONIC  master seed (send signing) — must match BTC_XPUB
// Optional config:
//   ESPLORA_API_URL    default https://mempool.space/api
//   BTC_MIN_WITHDRAWAL_SATS (10000), BTC_MAX_TX_SATS (2000000),
//   BTC_MAX_DAILY_SATS (5000000)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import {
  accountKeyFromMnemonic,
  buildWithdrawalTx,
  deriveAddress,
  deriveScript,
  parseAccountKey,
  selectCoins,
  validateMainnetAddress,
  type Utxo,
} from "../_shared/btc-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ESPLORA = (Deno.env.get("ESPLORA_API_URL") || "https://mempool.space/api").replace(/\/$/, "");
const REQUIRED_CONFIRMATIONS = 1;
const MAX_SCAN_ADDRESSES = 2000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // ── check_deposits: scheduler-only ─────────────────────────────────────
    if (action === "check_deposits") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!serviceKey || !timingSafeEqual(token, serviceKey)) {
        return json(401, { error: "Service role required" });
      }
      return await checkDeposits(supabase);
    }

    // ── Everything else needs a real user ──────────────────────────────────
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    if (action === "receive") return await receive(supabase, user.id);
    if (action === "send") return await send(supabase, user.id, body);

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("btc-onchain error:", e);
    return json(500, { error: e instanceof Error ? e.message : "Bitcoin operation failed" });
  }
});

// ── receive ────────────────────────────────────────────────────────────────

async function receive(supabase: any, userId: string) {
  const { data: existing } = await supabase
    .from("btc_address_assignments")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    return json(200, { address: existing.address, record: existing });
  }

  const xpub = Deno.env.get("BTC_XPUB");
  if (!xpub) return json(500, { error: "BTC_XPUB is not configured" });
  let account;
  try {
    account = parseAccountKey(xpub);
  } catch (e) {
    return json(500, { error: `BTC_XPUB is invalid: ${(e as Error).message}` });
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

          const { data: result, error: rpcErr } = await supabase.rpc("btc_record_deposit", {
            p_user_id: assignment.user_id,
            p_address: assignment.address,
            p_txid: tx.txid,
            p_vout: voutIndex,
            p_amount_sats: vout.value,
            p_confirmations: confirmations,
            p_required_confs: REQUIRED_CONFIRMATIONS,
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

  return json(200, {
    checked_addresses: assignments?.length ?? 0,
    deposits_seen: seen,
    credited,
    errors,
  });
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

// ── send ───────────────────────────────────────────────────────────────────

async function send(supabase: any, userId: string, body: any) {
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
  const { data: recent } = await supabase
    .from("btc_withdrawals")
    .select("amount_sats")
    .eq("user_id", userId)
    .in("status", ["reserved", "broadcast", "confirmed"])
    .gte("created_at", dayAgo);
  const sentToday = (recent ?? []).reduce((s: number, r: any) => s + Number(r.amount_sats), 0);
  if (sentToday + amountSats > maxDailySats) {
    return json(400, { error: `Daily withdrawal limit is ${maxDailySats} sats` });
  }

  // Keys: hard-fail if either secret is absent. Never simulate a send.
  const mnemonic = Deno.env.get("BTC_SEED_MNEMONIC");
  const xpub = Deno.env.get("BTC_XPUB");
  if (!mnemonic || !xpub) {
    return json(500, { error: "Bitcoin withdrawals are not configured (missing seed/xpub secret)" });
  }
  const accountPriv = accountKeyFromMnemonic(mnemonic);
  const accountPub = parseAccountKey(xpub);
  // Safety interlock: the seed must control the same wallet the zpub watches,
  // otherwise deposits and withdrawals would silently use different wallets.
  if (deriveAddress(accountPriv, 0, 0) !== deriveAddress(accountPub, 0, 0)) {
    return json(500, { error: "BTC_SEED_MNEMONIC and BTC_XPUB do not match" });
  }

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

  // Build + sign. A build failure here is safe: nothing was broadcast, so
  // the reservation is refunded by btc_fail_withdrawal.
  let built;
  try {
    built = buildWithdrawalTx({
      accountPriv, accountPub, utxos,
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

  // Broadcast. If the outcome is ambiguous, check the network before
  // deciding whether a refund is safe.
  const broadcast = await broadcastTx(built.hex, built.txid);
  if (!broadcast.ok) {
    await supabase.rpc("btc_fail_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_error: broadcast.error,
    });
    return json(502, { error: "Broadcast failed; your balance was refunded" });
  }

  const { error: finErr } = await supabase.rpc("btc_finalize_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_txid: built.txid,
  });
  if (finErr) {
    // The BTC has left the wallet but the ledger row is still 'reserved'.
    // Do NOT refund. Surface loudly for manual reconciliation (runbook §8).
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

async function gatherUtxos(supabase: any, accountPub: any): Promise<Utxo[]> {
  const { data: maxRow } = await supabase
    .from("btc_address_assignments")
    .select("derivation_index")
    .order("derivation_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxExternal = maxRow ? Number(maxRow.derivation_index) : -1;

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

async function broadcastTx(
  hex: string,
  expectedTxid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await esplora("/tx", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: hex,
    });
    if (res.ok) {
      const txid = (await res.text()).trim();
      if (txid === expectedTxid) return { ok: true };
      return { ok: false, error: `Esplora returned unexpected txid ${txid}` };
    }
    const detail = await res.text().catch(() => "");
    // A rejected POST can still mean "already on the network" in timeout
    // races — verify before declaring failure.
    const check = await esplora(`/tx/${expectedTxid}`);
    if (check.ok) return { ok: true };
    return { ok: false, error: `Broadcast rejected: ${res.status} ${detail.slice(0, 200)}` };
  } catch (e) {
    const check = await esplora(`/tx/${expectedTxid}`).catch(() => null);
    if (check && check.ok) return { ok: true };
    return { ok: false, error: `Broadcast error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
