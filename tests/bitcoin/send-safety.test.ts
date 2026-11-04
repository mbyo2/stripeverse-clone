// Custodial-send safety (liquidity research steps 0–1, 2026-11-04):
// the withdrawal guard, fee-rate sources + cache, Esplora failover
// policy, the persisted-UTXO staleness policy, pool reconciliation,
// and the Coinos balance read behind the Lightning pool cap — plus
// source pins that the guards are actually wired into the deployed
// functions, the migration, and the runbook.
//
// btc-core is loaded with the same rewrite-and-transpile trick as
// tests/bitcoin/btc-core.test.ts; lightning-provider is imported
// directly (dependency-free), with fetch stubbed.

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  LightningNotConfiguredError,
  LightningUpstreamError,
  parseCoinosBalance,
  providerGetBalance,
} from "../../supabase/functions/_shared/lightning-provider";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  const m = spec.match(/^npm:((?:@[^/]+\/)?[^@/]+)(?:@[^/"]+)?(\/.*)?$/);
  if (!m) return spec;
  return m[1] + (m[2] ?? "");
}

beforeAll(async () => {
  const coreSourcePath = path.resolve(repoRoot, "supabase/functions/_shared/btc-core.ts");
  const tmpModulePath = path.join(here, ".tmp-btc-core-safety.mjs");
  const source = fs.readFileSync(coreSourcePath, "utf8");
  const rewritten = source.replace(
    /from\s+"(npm:[^"]+)"/g,
    (_all, spec: string) => `from "${bareSpecifier(spec)}"`,
  );
  const { outputText } = ts.transpileModule(rewritten, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(tmpModulePath, outputText);
  core = await import(tmpModulePath);
});

const CFG = { provider: "coinos", token: "test-token", base: "https://coinos.test/api" };

function stubFetch(status: number, payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── The withdrawal guard ─────────────────────────────────────────────

const BASE = {
  amountSats: 50_000,
  isOperator: false,
  minSats: 32_000,
  maxTxSats: 2_000_000,
  userDailyUsedSats: 0,
  maxDailySats: 5_000_000,
  platformDailyUsedSats: 0,
  maxPlatformDailySats: 20_000_000,
  poolSats: 1_000_000 as number | null,
};

describe("checkWithdrawalGuard", () => {
  it("allows an ordinary send inside every bound", () => {
    expect(core.checkWithdrawalGuard(BASE)).toEqual({ allowed: true });
  });

  it("refuses a regular user below the minimum", () => {
    expect(core.checkWithdrawalGuard({ ...BASE, amountSats: 31_999 })).toEqual({
      allowed: false,
      refusal: "below_minimum",
    });
  });

  it("exempts the operator from the minimum (proof sends stay possible)", () => {
    expect(
      core.checkWithdrawalGuard({ ...BASE, amountSats: 500, isOperator: true }),
    ).toEqual({ allowed: true });
  });

  it("refuses above the per-transaction cap, operator included", () => {
    expect(
      core.checkWithdrawalGuard({ ...BASE, amountSats: 2_000_001, isOperator: true }),
    ).toEqual({ allowed: false, refusal: "above_max_tx" });
  });

  it("refuses when the user's daily cap would be exceeded", () => {
    expect(
      core.checkWithdrawalGuard({ ...BASE, userDailyUsedSats: 4_960_000 }),
    ).toEqual({ allowed: false, refusal: "above_user_daily_cap" });
  });

  it("refuses when the platform daily cap would be exceeded", () => {
    expect(
      core.checkWithdrawalGuard({ ...BASE, platformDailyUsedSats: 19_960_000 }),
    ).toEqual({ allowed: false, refusal: "above_platform_daily_cap" });
  });

  it("refuses an amount above the actual pool even with a huge ledger allowance", () => {
    // The ledger leg is the caller's balance; the pool leg is reality.
    // min(ledger, pool): pool wins.
    expect(core.checkWithdrawalGuard({ ...BASE, poolSats: 40_000 })).toEqual({
      allowed: false,
      refusal: "above_pool_balance",
      poolReason: "INSUFFICIENT_PLATFORM_FUNDS",
    });
  });

  it("classifies a pool refusal as POOL_SHORT_REBALANCE_NEEDED when combined backing covers it", () => {
    // This rail holds 40,000; the amount is 50,000; the other rail
    // holds 20,000 — combined 60,000 covers it. Cross-rail decision
    // (CEO 2026-11-04): distinguishable from true insufficiency.
    const decision = core.checkWithdrawalGuard({
      ...BASE,
      poolSats: 40_000,
      otherRailPoolSats: 20_000,
    });
    expect(decision).toEqual({
      allowed: false,
      refusal: "above_pool_balance",
      poolReason: "POOL_SHORT_REBALANCE_NEEDED",
    });
  });

  it("classifies as INSUFFICIENT_PLATFORM_FUNDS when even the combined backing is short", () => {
    const decision = core.checkWithdrawalGuard({
      ...BASE,
      poolSats: 40_000,
      otherRailPoolSats: 5_000,
    });
    expect(decision).toEqual({
      allowed: false,
      refusal: "above_pool_balance",
      poolReason: "INSUFFICIENT_PLATFORM_FUNDS",
    });
  });

  it("poolShortfallReason: unknown other rail classifies conservatively", () => {
    expect(core.poolShortfallReason(50_000, 40_000, null)).toBe("INSUFFICIENT_PLATFORM_FUNDS");
    expect(core.poolShortfallReason(50_000, 40_000, 10_000)).toBe("POOL_SHORT_REBALANCE_NEEDED");
    expect(core.poolShortfallReason(50_000, 40_000, 9_999)).toBe("INSUFFICIENT_PLATFORM_FUNDS");
  });

  it("skips the pool leg when the caller could not read the pool (null)", () => {
    expect(core.checkWithdrawalGuard({ ...BASE, poolSats: null })).toEqual({
      allowed: true,
    });
  });

  it("reports the minimum before the pool (cheapest refusal first)", () => {
    expect(
      core.checkWithdrawalGuard({ ...BASE, amountSats: 100, poolSats: 0 }),
    ).toEqual({ allowed: false, refusal: "below_minimum" });
  });
});

// ── Fee-rate sources + cache ─────────────────────────────────────────

describe("fee rate sources", () => {
  it("reads halfHourFee from a mempool.space recommended payload", () => {
    expect(
      core.feeRateFromMempoolRecommended({ fastestFee: 3, halfHourFee: 2, hourFee: 1 }),
    ).toBe(2);
  });

  it("ceils fractional rates and rejects unusable payloads", () => {
    expect(core.feeRateFromMempoolRecommended({ halfHourFee: 1.2 })).toBe(2);
    expect(core.feeRateFromMempoolRecommended({ halfHourFee: 0 })).toBeNull();
    expect(core.feeRateFromMempoolRecommended({})).toBeNull();
    expect(core.feeRateFromMempoolRecommended(null)).toBeNull();
    expect(core.feeRateFromMempoolRecommended("nope")).toBeNull();
  });

  it("reads the 3-block target from a Blockstream fee-estimates payload", () => {
    expect(
      core.feeRateFromBlockstreamEstimates({ "1": 5.4, "3": 2.1, "6": 1.5, "144": 1.0 }),
    ).toBe(3);
  });

  it("falls back to slower-quoted targets, never to a made-up rate", () => {
    expect(core.feeRateFromBlockstreamEstimates({ "6": 1.1 })).toBe(2);
    expect(core.feeRateFromBlockstreamEstimates({})).toBeNull();
    expect(core.feeRateFromBlockstreamEstimates(null)).toBeNull();
  });

  it("caches within the TTL and expires after it (injected clock)", () => {
    const cache = core.createFeeRateCache(300_000);
    expect(cache.get(1_000)).toBeNull();
    cache.set(4, 1_000);
    expect(cache.get(1_000)).toBe(4);
    expect(cache.get(300_999)).toBe(4);
    expect(cache.get(301_000)).toBeNull();
  });
});

// ── Esplora resilience policy ────────────────────────────────────────

describe("esplora failover policy", () => {
  it("fails over on throttling, server errors and network failure", () => {
    expect(core.esploraShouldFailover(429)).toBe(true);
    expect(core.esploraShouldFailover(500)).toBe(true);
    expect(core.esploraShouldFailover(503)).toBe(true);
    expect(core.esploraShouldFailover(null)).toBe(true);
  });

  it("does not fail over on real answers", () => {
    expect(core.esploraShouldFailover(200)).toBe(false);
    expect(core.esploraShouldFailover(400)).toBe(false);
    expect(core.esploraShouldFailover(404)).toBe(false);
  });

  it("backs off exponentially and caps", () => {
    expect(core.esploraBackoffMs(1)).toBe(300);
    expect(core.esploraBackoffMs(2)).toBe(1_000);
    expect(core.esploraBackoffMs(3)).toBe(3_000);
    expect(core.esploraBackoffMs(9)).toBe(3_000);
  });
});

// ── Persisted UTXO set policy ────────────────────────────────────────

describe("persisted UTXO set", () => {
  it("is stale when never refreshed or past the TTL", () => {
    expect(core.utxoSetStale(null, 1_000_000)).toBe(true);
    expect(core.utxoSetStale(0, 600_000)).toBe(true);
    expect(core.utxoSetStale(0, 599_999)).toBe(false);
  });

  it("totals a UTXO list (the on-chain pool balance)", () => {
    const utxos = [
      { txid: "a", vout: 0, value: 10_000, chain: 0 as const, index: 0 },
      { txid: "b", vout: 1, value: 25_500, chain: 1 as const, index: 3 },
    ];
    expect(core.poolTotalSats(utxos)).toBe(35_500);
    expect(core.poolTotalSats([])).toBe(0);
  });
});

// ── Pool reconciliation ──────────────────────────────────────────────

describe("computePoolReconciliation", () => {
  it("is ok when pools cover liabilities + fee income exactly", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 100_000,
      feeIncomeSats: 5_000,
      poolOnchainSats: 80_000,
      poolLightningSats: 25_000,
    });
    expect(rec).toEqual({
      totalLedgerSats: 105_000,
      totalPoolSats: 105_000,
      floatSats: 0,
      status: "ok",
    });
  });

  it("reports a positive float when pools exceed the ledger", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 100_000,
      feeIncomeSats: 0,
      poolOnchainSats: 150_000,
      poolLightningSats: 0,
    });
    expect(rec.floatSats).toBe(50_000);
    expect(rec.status).toBe("ok");
  });

  it("flags under_backed when pools fall short of the ledger", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 100_000,
      feeIncomeSats: 5_000,
      poolOnchainSats: 90_000,
      poolLightningSats: 0,
    });
    expect(rec.floatSats).toBe(-15_000);
    expect(rec.status).toBe("under_backed");
  });

  it("is partial (never a verdict) when a pool could not be read", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 100_000,
      feeIncomeSats: 0,
      poolOnchainSats: 500_000,
      poolLightningSats: null,
    });
    expect(rec.status).toBe("partial");
    expect(rec.totalPoolSats).toBeNull();
    expect(rec.floatSats).toBeNull();
  });
});

// ── Coinos balance (the Lightning pool) ──────────────────────────────

describe("parseCoinosBalance / providerGetBalance", () => {
  it("parses the live-verified top-level balance shape", () => {
    expect(parseCoinosBalance({ id: "acct", balance: 123_456 })).toBe(123_456);
    expect(parseCoinosBalance({ balance: 0 })).toBe(0);
  });

  it("accepts a nested account object and truncates fractions", () => {
    expect(parseCoinosBalance({ user: { balance: 99.9 } })).toBe(99);
  });

  it("sums the accounts array the current coinos-server /me attaches", () => {
    expect(
      parseCoinosBalance({
        username: "pooled",
        accounts: [{ balance: 300 }, { balance: 200 }, { id: "no-balance" }],
      }),
    ).toBe(500);
    expect(parseCoinosBalance({ accounts: [] })).toBe(0);
  });

  it("returns null on any other shape — never a guess", () => {
    expect(parseCoinosBalance({})).toBeNull();
    expect(parseCoinosBalance({ balance: "1000" })).toBeNull();
    expect(parseCoinosBalance(null)).toBeNull();
    expect(parseCoinosBalance([1, 2])).toBeNull();
  });

  it("providerGetBalance reads GET /me and returns the balance", async () => {
    const fetchMock = stubFetch(200, { balance: 42_000 });
    await expect(providerGetBalance(CFG)).resolves.toBe(42_000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string }];
    expect(url).toBe("https://coinos.test/api/me");
    expect(init.method).toBe("GET");
  });

  it("providerGetBalance throws upstream on a balanceless payload", async () => {
    stubFetch(200, { username: "bmaglass" });
    await expect(providerGetBalance(CFG)).rejects.toBeInstanceOf(LightningUpstreamError);
  });

  it("providerGetBalance with no config resolves config from env (regression: a wrong resolver name shipped as a ReferenceError that only the no-config path hits)", async () => {
    stubFetch(200, { balance: 1 });
    await expect(providerGetBalance()).rejects.toBeInstanceOf(LightningNotConfiguredError);
  });
});

// ── Wiring pins: the guards are in the deployed surface ──────────────

describe("send-safety wiring (source pins)", () => {
  const onchain = fs.readFileSync(
    path.join(repoRoot, "supabase/functions/btc-onchain/index.ts"),
    "utf8",
  );
  const lightning = fs.readFileSync(
    path.join(repoRoot, "supabase/functions/lightning-service/index.ts"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(repoRoot, "supabase/migrations/20261250_btc_send_safety.sql"),
    "utf8",
  );
  const runbook = fs.readFileSync(
    path.join(repoRoot, "docs/bitcoin-custody-runbook.md"),
    "utf8",
  );

  it("btc-onchain evaluates the guard on both send paths before reserving", () => {
    expect(onchain).toContain("checkWithdrawalGuard");
    expect(onchain).toContain("above_pool_balance");
    expect(onchain).toContain("withdrawalLimits");
    expect(onchain).toContain("isOperator");
    // Cross-rail refusal classification (CEO 2026-11-04).
    expect(onchain).toContain("poolShortfallReason");
    expect(onchain).toContain("lightningPoolSatsOrNull");
  });

  it("btc-onchain persists the UTXO set and reconciles on a service action", () => {
    expect(onchain).toContain("btc_pool_utxos");
    expect(onchain).toContain("btc_pool_sync_state");
    expect(onchain).toContain('action === "reconcile_pools"');
    expect(onchain).toContain("btc_ledger_buckets");
    expect(onchain).toContain("computePoolReconciliation");
  });

  it("btc-onchain caches fee rates and fails Esplora reads over", () => {
    expect(onchain).toContain("fetchFeeRateSatVb");
    expect(onchain).toContain("createFeeRateCache");
    expect(onchain).toContain("esploraShouldFailover");
    expect(onchain).toContain("feeRateFromBlockstreamEstimates");
  });

  it("lightning-service guards sends with the minimum and the Coinos pool cap", () => {
    expect(lightning).toContain("lightningSendGuard");
    expect(lightning).toContain("providerGetBalance");
    expect(lightning).toContain("btc_min_withdrawal_lightning_sats");
    expect(lightning).toContain("Minimum Lightning payment is");
    expect(lightning).toContain("poolShortfallReason");
  });

  it("the migration carries the policy columns, the UTXO set, buckets and the cron", () => {
    expect(migration).toContain("btc_min_withdrawal_onchain_sats");
    expect(migration).toContain("btc_min_withdrawal_lightning_sats");
    expect(migration).toContain("btc_max_platform_daily_sats");
    expect(migration).toContain("btc_pool_utxos");
    expect(migration).toContain("btc_reconciliation_runs");
    expect(migration).toContain("btc_ledger_buckets()");
    expect(migration).toContain("btc-reconcile-pools");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.btc_ledger_buckets() TO service_role");
  });

  it("the runbook documents the manual pool-rebalancing procedure", () => {
    expect(runbook).toContain("Pool rebalancing (Sparrow ⇄ Coinos) — manual, operator-run");
    expect(runbook).toContain("btc_reconciliation_runs");
  });
});
