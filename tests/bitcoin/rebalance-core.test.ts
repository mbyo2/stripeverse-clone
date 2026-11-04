// Tests for the cross-rail rebalancing policy in
// supabase/functions/_shared/btc-core.ts (migration 20261251) —
// the pure core of the engine that implements the CEO's 2026-11-04
// unified-balance decision: money received on either rail is
// sendable on either rail, with the platform bridging the shortfall
// between its pools.
//
// Pinned here:
//   - planRebalanceAmount: shortfall + bounded buffer, capped by
//     the per-tx ceiling and by what the source pool actually
//     holds; dust never bridges; a partial bridge that still covers
//     the minimum is viable (the queued send re-requests any
//     remainder after it lands).
//   - proactiveRebalanceNeed: a pool below its target draws at most
//     the other pool's spare ABOVE ITS OWN target — a top-up never
//     creates the shortage it is meant to prevent.
//   - rebalanceExpired: the bounded wait.
//   - computePoolReconciliation with inTransitSats: sats inside an
//     executing bridge still back the ledger, so a bridging pool
//     never reads as missing backing.
//   - the user-facing copy constants: plain language, and none of
//     the internal vocabulary (no "rebalance", no "pool").
//
// Loaded with the same npm:-rewrite + transpile trick as
// tests/bitcoin/btc-core.test.ts (own tmp path — no cross-file race).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSourcePath = path.resolve(
  here,
  "../../supabase/functions/_shared/btc-core.ts",
);
const tmpModulePath = path.join(here, ".tmp-btc-core-rebalance.mjs");

type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  const m = spec.match(/^npm:((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?(\/.*)?$/);
  if (!m) return spec;
  return m[1] + (m[2] ?? "");
}

beforeAll(async () => {
  const source = fs.readFileSync(coreSourcePath, "utf8");
  const rewritten = source.replace(
    /from\s+"(npm:[^"]+)"/g,
    (_all, spec: string) => `from "${bareSpecifier(spec)}"`,
  );
  const { outputText } = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  fs.writeFileSync(tmpModulePath, outputText);
  core = await import(tmpModulePath);
});

describe("planRebalanceAmount", () => {
  it("bridges the shortfall plus the buffer", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 100_000, bufferSats: 50_000,
      sourcePoolSats: 1_000_000, minSats: 10_000, maxTxSats: 2_000_000,
    });
    expect(plan).toEqual({ amountSats: 150_000, viable: true });
  });

  it("is capped by what the source pool actually holds", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 100_000, bufferSats: 50_000,
      sourcePoolSats: 120_000, minSats: 10_000, maxTxSats: 2_000_000,
    });
    expect(plan.amountSats).toBe(120_000);
    expect(plan.viable).toBe(true);
  });

  it("is capped by the per-transaction ceiling", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 900_000, bufferSats: 500_000,
      sourcePoolSats: 5_000_000, minSats: 10_000, maxTxSats: 1_000_000,
    });
    expect(plan.amountSats).toBe(1_000_000);
  });

  it("never bridges dust: below the minimum is not viable", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 300, bufferSats: 0,
      sourcePoolSats: 5_000, minSats: 10_000, maxTxSats: 2_000_000,
    });
    expect(plan.amountSats).toBe(300);
    expect(plan.viable).toBe(false);
  });

  it("an empty source pool bridges nothing", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 50_000, bufferSats: 50_000,
      sourcePoolSats: 0, minSats: 1, maxTxSats: 2_000_000,
    });
    expect(plan).toEqual({ amountSats: 0, viable: false });
  });

  it("a zero shortfall with a buffer still tops up (proactive shape)", () => {
    const plan = core.planRebalanceAmount({
      shortfallSats: 0, bufferSats: 40_000,
      sourcePoolSats: 100_000, minSats: 10_000, maxTxSats: 2_000_000,
    });
    expect(plan).toEqual({ amountSats: 40_000, viable: true });
  });
});

describe("proactiveRebalanceNeed", () => {
  it("is zero when the pool is at or above target", () => {
    expect(core.proactiveRebalanceNeed({
      poolSats: 200_000, targetSats: 200_000,
      otherPoolSats: 900_000, otherTargetSats: 200_000,
    })).toBe(0);
    expect(core.proactiveRebalanceNeed({
      poolSats: 250_000, targetSats: 200_000,
      otherPoolSats: 900_000, otherTargetSats: 200_000,
    })).toBe(0);
  });

  it("draws the deficit when the other pool has spare above its own target", () => {
    expect(core.proactiveRebalanceNeed({
      poolSats: 10, targetSats: 200_000,
      otherPoolSats: 1_000_000, otherTargetSats: 200_000,
    })).toBe(199_990);
  });

  it("never drains the other pool below its own target", () => {
    expect(core.proactiveRebalanceNeed({
      poolSats: 0, targetSats: 200_000,
      otherPoolSats: 230_000, otherTargetSats: 200_000,
    })).toBe(30_000);
  });

  it("is zero when the other pool has nothing spare", () => {
    expect(core.proactiveRebalanceNeed({
      poolSats: 0, targetSats: 200_000,
      otherPoolSats: 150_000, otherTargetSats: 200_000,
    })).toBe(0);
  });
});

describe("rebalanceExpired (the bounded wait)", () => {
  const created = 1_700_000_000_000;
  it("is false inside the window and true at/after it", () => {
    expect(core.rebalanceExpired(created, created + 59 * 60_000, 60)).toBe(false);
    expect(core.rebalanceExpired(created, created + 60 * 60_000, 60)).toBe(true);
    expect(core.rebalanceExpired(created, created + 61 * 60_000, 60)).toBe(true);
  });
  it("a zero/negative window still means at least a minute", () => {
    expect(core.rebalanceExpired(created, created + 30_000, 0)).toBe(false);
    expect(core.rebalanceExpired(created, created + 60_000, 0)).toBe(true);
  });
});

describe("computePoolReconciliation with in-flight bridges", () => {
  it("counts in-transit sats toward backing (a bridging pool is not missing funds)", () => {
    // Ledger promises 100,000; pools visibly hold 10 (Lightning) +
    // 0 (on-chain) while a 100,000 bridge is in flight.
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 90_000,
      feeIncomeSats: 10_000,
      poolOnchainSats: 0,
      poolLightningSats: 10,
      inTransitSats: 100_000,
    });
    expect(rec.totalPoolSats).toBe(100_010);
    expect(rec.floatSats).toBe(10);
    expect(rec.status).toBe("ok");
  });

  it("without the in-transit leg the same moment reads under_backed (the bug this prevents)", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 90_000,
      feeIncomeSats: 10_000,
      poolOnchainSats: 0,
      poolLightningSats: 10,
    });
    expect(rec.status).toBe("under_backed");
  });

  it("stays partial when a pool is unreadable, in-transit or not", () => {
    const rec = core.computePoolReconciliation({
      userLiabilitiesSats: 0,
      feeIncomeSats: 0,
      poolOnchainSats: null,
      poolLightningSats: 10,
      inTransitSats: 100_000,
    });
    expect(rec.status).toBe("partial");
    expect(rec.totalPoolSats).toBeNull();
  });
});

describe("queued-send user copy", () => {
  it("is plain language with no internal vocabulary", () => {
    for (const copy of [
      core.AWAITING_REBALANCE_MESSAGE,
      core.REBALANCE_TIMEOUT_MESSAGE,
      core.REBALANCE_FAILED_MESSAGE,
    ]) {
      const lower = copy.toLowerCase();
      expect(lower).not.toContain("rebalance");
      expect(lower).not.toContain("pool");
      expect(lower).not.toContain("bridge");
      expect(lower).not.toContain("awaiting_rebalance");
    }
  });
  it("the failure copies promise the full refund", () => {
    expect(core.REBALANCE_TIMEOUT_MESSAGE).toContain("back in your balance in full");
    expect(core.REBALANCE_FAILED_MESSAGE).toContain("back in your balance in full");
  });
});
