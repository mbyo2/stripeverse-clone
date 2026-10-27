// Self-custody sell-to-ZMW (TASK B3): quote math (1.5% fee exactness),
// intent state machine, expiry/grace policy, settle-on-actual policy,
// deposit-candidate selection, and source pins for the migration,
// the settle RPC's exactly-once guards, the edge function, the
// deposit-path hooks, and the wallet UI panel.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRACE_SECONDS,
  INTENT_TTL_SECONDS,
  SELL_FEE_BPS,
  pickSettlingDeposit,
  satsForTargetZmw,
  sellPhase,
  sellQuoteMath,
  settleDeadline,
  settlesAtLockedRate,
  type DepositCandidate,
  type SellIntentLike,
} from "../../supabase/functions/_shared/selfcustody-sell";
import { SELL_PHASE_COPY, sellPhaseOf } from "../../src/lib/selfcustody/sellToZmw";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const RATE = 2_000_000; // ZMW per BTC

describe("quote math — 1.5% sell fee, floored to ngwee", () => {
  it("uses the platform sell fee of exactly 150 bps", () => {
    expect(SELL_FEE_BPS).toBe(150);
    expect(INTENT_TTL_SECONDS).toBe(1800);
    expect(GRACE_SECONDS).toBe(3600);
  });

  it("prices a round sell exactly: 50,000 sats at K2,000,000/BTC nets K985.00 with a K15.00 fee", () => {
    const q = sellQuoteMath(50_000, RATE);
    expect(q.grossZmw).toBe(1000);
    expect(q.zmw).toBe(985);
    expect(q.feeZmw).toBe(15);
  });

  it("floors the net to whole ngwee — rounding never creates value", () => {
    // gross 666.66; 666.66 * 0.985 = 656.6601 → net 656.66, fee 10.00
    const q = sellQuoteMath(33_333, RATE);
    expect(q.grossZmw).toBe(666.66);
    expect(q.zmw).toBe(656.66);
    expect(q.feeZmw).toBe(10);
  });

  it("matches the custodial sell formula on a small amount", () => {
    // 1,000 sats at K1,500,000: gross 15.00, net floor(14.775) = 14.77, fee 0.23
    const q = sellQuoteMath(1_000, 1_500_000);
    expect(q.zmw).toBe(14.77);
    expect(q.feeZmw).toBe(0.23);
  });

  it("settle-on-actual: an under-payment prices the ACTUAL sats at the locked rate", () => {
    // Intent expected 50,000 sats but only 40,000 arrived → K788.00, not K985.00
    const q = sellQuoteMath(40_000, RATE);
    expect(q.zmw).toBe(788);
    expect(q.feeZmw).toBe(12);
  });

  it("settle-on-actual: an over-payment prices the ACTUAL sats too", () => {
    const q = sellQuoteMath(60_000, RATE);
    expect(q.zmw).toBe(1182);
  });

  it("refuses non-positive / fractional / rate-less inputs", () => {
    expect(() => sellQuoteMath(0, RATE)).toThrow();
    expect(() => sellQuoteMath(1.5, RATE)).toThrow();
    expect(() => sellQuoteMath(1000, 0)).toThrow();
    expect(() => sellQuoteMath(1000, RATE, -1)).toThrow();
  });

  it("satsForTargetZmw inverts the quote so the target is met, not missed", () => {
    const sats = satsForTargetZmw(985, RATE);
    expect(sats).toBe(50_000);
    expect(sellQuoteMath(sats, RATE).zmw).toBeGreaterThanOrEqual(985);
    expect(sellQuoteMath(satsForTargetZmw(500, RATE), RATE).zmw).toBeGreaterThanOrEqual(500);
  });
});

const intent = (over: Partial<SellIntentLike> = {}): SellIntentLike => ({
  status: "awaiting",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:30:00.000Z",
  graceSeconds: GRACE_SECONDS,
  ...over,
});

describe("expiry / grace policy", () => {
  it("the settle deadline is expiry + 60-minute grace", () => {
    expect(new Date(settleDeadline(intent())).toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });

  it("a deposit credited inside the window settles at the locked rate", () => {
    expect(settlesAtLockedRate(intent(), "2026-01-01T00:10:00.000Z")).toBe(true);
  });

  it("a deposit credited during grace (after expiry, before deadline) still settles at the locked rate", () => {
    expect(settlesAtLockedRate(intent(), "2026-01-01T01:00:00.000Z")).toBe(true);
    expect(settlesAtLockedRate(intent(), "2026-01-01T01:30:00.000Z")).toBe(true);
  });

  it("a deposit credited after the grace deadline does NOT settle the intent", () => {
    expect(settlesAtLockedRate(intent(), "2026-01-01T01:30:00.001Z")).toBe(false);
    expect(settlesAtLockedRate(intent(), "2026-01-02T00:00:00.000Z")).toBe(false);
  });

  it("phase machine: awaiting → received → settled, with expired/cancelled terminal", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    expect(sellPhase(intent(), false, now)).toBe("awaiting");
    expect(sellPhase(intent(), true, now)).toBe("received");
    expect(sellPhase(intent({ status: "settled" }), true, now)).toBe("settled");
    expect(sellPhase(intent({ status: "cancelled" }), false, now)).toBe("cancelled");
    expect(sellPhase(intent(), false, new Date("2026-01-01T02:00:00.000Z"))).toBe("expired");
    expect(sellPhase(intent({ status: "expired" }), false, now)).toBe("expired");
  });

  it("client phase derivation prefers the server phase and falls back to status", () => {
    const base = {
      intent_id: "x", rail: "onchain" as const, status: "awaiting", mid_rate_zmw: RATE,
      fee_bps: 150, fee_zmw: 15, expected_sats: 50_000, expected_zmw: 985,
      deposit_address: "bc1qexample", lightning_payment_id: null, bolt11: null,
      deposit_txid: null, deposit_vout: null, actual_sats: null, zmw_credited: null,
      fee_zmw_actual: null, expires_at: "2026-01-01T00:30:00.000Z",
      settle_deadline: "2026-01-01T01:30:00.000Z", settled_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    expect(sellPhaseOf({ ...base, phase: "received" })).toBe("received");
    expect(sellPhaseOf({ ...base, status: "settled" })).toBe("settled");
    expect(sellPhaseOf(base)).toBe("awaiting");
    for (const phase of ["awaiting", "received", "settled", "expired", "cancelled"] as const) {
      expect(SELL_PHASE_COPY[phase].length).toBeGreaterThan(20);
    }
  });
});

describe("deposit candidate selection (exactly-once binding input)", () => {
  const cand = (over: Partial<DepositCandidate>): DepositCandidate => ({
    txid: "t", vout: 0, amountSats: 50_000, status: "credited",
    createdAt: "2026-01-01T00:05:00.000Z", ...over,
  });

  it("prefers an exact-amount credited deposit", () => {
    const pick = pickSettlingDeposit([
      cand({ txid: "a", amountSats: 10_000, createdAt: "2026-01-01T00:04:00.000Z" }),
      cand({ txid: "b", amountSats: 50_000, createdAt: "2026-01-01T00:06:00.000Z" }),
    ], 50_000);
    expect(pick?.txid).toBe("b");
  });

  it("falls back to the earliest credited deposit (settle-on-actual)", () => {
    const pick = pickSettlingDeposit([
      cand({ txid: "b", amountSats: 40_000, createdAt: "2026-01-01T00:06:00.000Z" }),
      cand({ txid: "a", amountSats: 45_000, createdAt: "2026-01-01T00:04:00.000Z" }),
    ], 50_000);
    expect(pick?.txid).toBe("a");
  });

  it("never settles on a detected-but-uncredited deposit", () => {
    expect(pickSettlingDeposit([cand({ status: "detected" })], 50_000)).toBeNull();
    expect(pickSettlingDeposit([], 50_000)).toBeNull();
  });
});

describe("migration 20261235 — exactly-once settle RPC", () => {
  const sql = read("../../supabase/migrations/20261235_selfcustody_sell_intents.sql");

  it("creates the intents table with a locked quote snapshot and RLS read-own only", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.btc_selfcustody_sell_intents");
    expect(sql).toContain("mid_rate_zmw NUMERIC(20, 2) NOT NULL");
    expect(sql).toContain("fee_bps INTEGER NOT NULL DEFAULT 150");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('USING (auth.uid() = user_id)');
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE) TO authenticated/);
  });

  it("binds a deposit to at most one intent and an invoice to at most one live intent", () => {
    expect(sql).toContain("uq_sc_sell_intents_onchain_deposit");
    expect(sql).toContain("WHERE deposit_txid IS NOT NULL AND status = 'settled'");
    expect(sql).toContain("uq_sc_sell_intents_lightning_payment");
    expect(sql).toContain("status IN ('awaiting', 'settled')");
  });

  it("the RPC replays settled intents, enforces the grace deadline, and prices ACTUAL sats", () => {
    expect(sql).toContain("btc_settle_selfcustody_sell");
    expect(sql).toContain("outcome := 'already_settled'");
    expect(sql).toContain("make_interval(secs => v_intent.grace_seconds)");
    expect(sql).toContain("outcome := 'expired_after_grace'");
    expect(sql).toContain("v_actual_sats::numeric * v_intent.mid_rate_zmw / 100000000");
    expect(sql).toContain("FLOOR(v_gross * (1 - v_intent.fee_bps::numeric / 10000) * 100) / 100");
    expect(sql).toContain("outcome := 'deposit_already_bound'");
    expect(sql).toContain("outcome := 'deposit_not_credited'");
  });

  it("the RPC moves money like a custodial sell and is service_role-only", () => {
    expect(sql).toContain("float_sats = float_sats + v_actual_sats");
    expect(sql).toContain("concat('sc-sell:', v_intent.id::text, ':zmw')");
    expect(sql).toContain("concat('sc-sell:', v_intent.id::text, ':btc')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) FROM anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) TO service_role");
  });

  it("contains no array-append or unqualified digest hazards (AGENTS.md migration rules)", () => {
    expect(sql).not.toContain("digest(");
    expect(sql).not.toMatch(/\|\| '/);
  });
});

describe("edge function + deposit-path hooks", () => {
  const fn = read("../../supabase/functions/btc-sell-selfcustody/index.ts");
  const onchain = read("../../supabase/functions/btc-onchain/index.ts");
  const lightning = read("../../supabase/functions/lightning-service/index.ts");

  it("the sell function locks quotes server-side and binds Lightning intents to validated invoices", () => {
    expect(fn).toContain('action === "create_intent"');
    expect(fn).toContain("sellQuoteMath");
    expect(fn).toContain("SELL_FEE_BPS");
    expect(fn).toContain("payment.user_id !== user.id");
    expect(fn).toContain("Number(payment.amount_sats) !== amountSats");
    expect(fn).toContain('action === "check"');
    expect(fn).toContain('action === "cancel"');
    expect(fn).toContain('action === "list"');
    expect(fn).toContain("btc_settle_selfcustody_sell");
    expect(fn).toContain("isAccountFrozen");
  });

  it("settlement is attempted inside the EXISTING deposit paths, isolated from them", () => {
    expect(onchain).toContain("trySettleSellIntents");
    expect(onchain).toContain('result === "credited"');
    expect(lightning).toContain("trySettleSellIntent");
    expect(lightning).toContain("btc_settle_lightning_deposit");
  });

  it("the sell function never allocates deposit addresses or invents a watcher", () => {
    expect(fn).not.toContain("btc_next_derivation_index");
    expect(fn).not.toContain('.rpc("btc_record_deposit"');
    expect(fn).not.toContain("esplora");
  });
});

describe("SelfCustodyWallet sell panel", () => {
  const page = read("../../src/pages/SelfCustodyWallet.tsx");

  it("renders the sell panel with quote review, locked-rate and settle-on-actual copy", () => {
    expect(page).toContain("Sell Bitcoin for ZMW");
    expect(page).toContain("Lock quote &amp; create sell");
    expect(page).toContain("Rate locked at");
    expect(page).toContain("you are credited for the");
    expect(page).toContain("amount that actually arrives, at this locked rate");
    expect(page).toContain("SELL_PHASE_COPY[sellPhase]");
  });

  it("offers BOTH rails and BOTH amount entry modes", () => {
    expect(page).toContain("Lightning (fastest)");
    expect(page).toContain("On-chain");
    expect(page).toContain("Amount in sats");
    expect(page).toContain("Amount in ZMW");
  });

  it("wires the in-app send through the existing Spark prepare → confirm plumbing, never faking it", () => {
    expect(page).toContain("doSellPrepareInApp");
    expect(page).toContain("sparkPrepareSend(");
    expect(page).toContain("sparkSendPrepared(session.mnemonic, sellPrepared)");
    expect(page).toContain("Nothing is sent until you confirm");
    expect(page).toContain("In-app sending from this wallet is not enabled on this deployment");
  });

  it("guides an external send with QR + copy and polls status truthfully", () => {
    expect(page).toContain("checkSellIntent(sellIntent.intent_id)");
    expect(page).toContain("checkCustodialInvoice(sellIntent.lightning_payment_id)");
    expect(page).toContain("15_000");
  });
});
