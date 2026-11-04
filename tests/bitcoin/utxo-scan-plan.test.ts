// Tests for planUtxoScan in supabase/functions/_shared/btc-core.ts —
// the pure policy btc-onchain's gatherUtxos uses to bound its pooled
// UTXO scan (fix shipped 2026-11-04).
//
// The regression being pinned: gatherUtxos used to bound its chain-1
// (change) scan by COUNT(btc_withdrawals) + COUNT(btc_withdrawal_
// batches). btc_withdrawal_batches doubles as the run_batch audit
// log, and the 5-minute batcher cron wrote a `skipped_empty` row on
// every empty run — 2,588 never-broadcast audit rows by 2026-11-04,
// against ZERO formed batches and ZERO allocated change indices.
// The count-based bound crossed MAX_SCAN_ADDRESSES (2,000) and every
// on-chain send failed with "Wallet UTXO scan limit reached" before
// any money logic ran.
//
// The fix: the change bound is the change allocator's high-water mark
// (the highest index btc_next_change_index has ever handed out,
// exposed by the btc_change_index_high_water RPC, migration 20261249)
// — audit rows allocate nothing, so they move nothing. These tests
// model the audit-row flood explicitly: the inputs a count-based
// bound would have consumed are simply NOT inputs to the plan, and
// the plan stays within limits at the exact live values that broke
// production, while a genuinely huge allocation count still trips
// the guard (its safety purpose is unchanged).
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
const fnSourcePath = path.resolve(
  here,
  "../../supabase/functions/btc-onchain/index.ts",
);
const migrationSourcePath = path.resolve(
  here,
  "../../supabase/migrations/20261249_btc_change_index_high_water.sql",
);
const tmpModulePath = path.join(here, ".tmp-btc-core-scanplan.mjs");

type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  const m = spec.match(/^npm:((?:@[^/]+\/)?[^@/]+)(?:@[^/"]+)?(\/.*)?$/);
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

const MAX = 2000; // btc-onchain's MAX_SCAN_ADDRESSES

describe("planUtxoScan — the Nov 2026 audit-row flood cannot block a send", () => {
  it("stays within the limit at the exact live values that broke production", () => {
    // Live, 2026-11-04: highest external index 39 (deposit + payment-
    // link attempt assignments), change allocator NEVER called
    // (high-water -1) — while btc_withdrawal_batches held 2,588
    // skipped_* audit rows. The old count-based bound computed
    // 0 withdrawals + 2,588 batches + 1 = 2,589 change targets and
    // threw. The plan never sees audit rows: it sees allocations.
    const plan = core.planUtxoScan({
      highestExternalIndex: 39,
      highestAllocatedChangeIndex: -1,
      maxScanAddresses: MAX,
    });
    expect(plan.withinLimit).toBe(true);
    expect(plan.maxChangeIndex).toBe(0);
    expect(plan.targetCount).toBe(40 + 1);
  });

  it("an unbounded count of skipped/empty batches contributes nothing — the bound tracks allocations, not rows", () => {
    // Simulate the flood growing 100x past the breaking point: what
    // the plan consumes is still only the allocator high-water mark,
    // which skipped batches never move (they allocate no index).
    for (const skippedRows of [2_588, 25_000, 258_800]) {
      void skippedRows; // audit-row count is not, and must never be, a plan input
      const plan = core.planUtxoScan({
        highestExternalIndex: 39,
        highestAllocatedChangeIndex: -1,
        maxScanAddresses: MAX,
      });
      expect(plan.withinLimit).toBe(true);
      expect(plan.targetCount).toBe(41);
    }
  });

  it("scans every allocated change index plus the one-index margin", () => {
    const plan = core.planUtxoScan({
      highestExternalIndex: 10,
      highestAllocatedChangeIndex: 5,
      maxScanAddresses: MAX,
    });
    expect(plan.maxExternalIndex).toBe(10);
    expect(plan.maxChangeIndex).toBe(6); // allocated 0..5 + margin
    expect(plan.targetCount).toBe(11 + 7);
    expect(plan.withinLimit).toBe(true);
  });

  it("covers change index 0 even when nothing was ever allocated", () => {
    const plan = core.planUtxoScan({
      highestExternalIndex: -1,
      highestAllocatedChangeIndex: -1,
      maxScanAddresses: MAX,
    });
    expect(plan.maxChangeIndex).toBe(0);
    expect(plan.targetCount).toBe(1);
    expect(plan.withinLimit).toBe(true);
  });

  it("still trips the guard when REAL allocations genuinely exceed the fan-out limit", () => {
    // The guard's safety purpose is unchanged: ~2,000 real change
    // allocations (or external assignments) must still refuse.
    const byChange = core.planUtxoScan({
      highestExternalIndex: 10,
      highestAllocatedChangeIndex: 2_500,
      maxScanAddresses: MAX,
    });
    expect(byChange.withinLimit).toBe(false);
    const byExternal = core.planUtxoScan({
      highestExternalIndex: 2_500,
      highestAllocatedChangeIndex: -1,
      maxScanAddresses: MAX,
    });
    expect(byExternal.withinLimit).toBe(false);
  });

  it("normalises junk inputs instead of producing a negative or NaN plan", () => {
    const plan = core.planUtxoScan({
      highestExternalIndex: Number.NaN,
      highestAllocatedChangeIndex: -42,
      maxScanAddresses: MAX,
    });
    expect(plan.maxExternalIndex).toBe(-1);
    expect(plan.maxChangeIndex).toBe(0);
    expect(plan.targetCount).toBe(1);
    expect(plan.withinLimit).toBe(true);
  });
});

describe("btc-onchain wiring — the fix is what the function actually runs", () => {
  const fnSource = fs.readFileSync(fnSourcePath, "utf8");
  const migration = fs.readFileSync(migrationSourcePath, "utf8");

  it("gatherUtxos reads the allocator high-water mark via the RPC", () => {
    expect(fnSource).toContain('rpc("btc_change_index_high_water")');
    expect(fnSource).toContain("planUtxoScan({");
  });

  it("gatherUtxos no longer counts withdrawal or batch rows for its bound", () => {
    expect(fnSource).not.toContain("withdrawalCount");
    expect(fnSource).not.toContain("batchCount");
  });

  it("the migration defines the RPC, service-role only", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.btc_change_index_high_water()");
    expect(migration).toContain("FROM public.btc_change_index_seq");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.btc_change_index_high_water() FROM PUBLIC");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.btc_change_index_high_water() TO service_role");
  });

  it("run_batch no longer writes an audit row for the routine empty-queue no-op", () => {
    expect(fnSource).toContain('skip("skipped_empty", "No queued withdrawals", {}, false)');
    // …while the claim-race skipped_empty (a real event) still audits.
    expect(fnSource).toContain('"Queue was claimed by another formation first"');
  });
});
