// Unit tests for the UTXO consolidation policy + builder in
// supabase/functions/_shared/btc-core.ts (protection P2b, 2026-10-26,
// from the gas / network-fee audit row 4: per-attempt and deposit
// UTXOs accumulate unconsolidated in the pooled custodial wallet and
// quietly inflate future withdrawal fees).
//
// Loaded with the same npm:-rewrite + transpile trick as
// tests/bitcoin/btc-core.test.ts (own tmp path — no cross-file race).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Transaction } from "@scure/btc-signer";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSourcePath = path.resolve(
  here,
  "../../supabase/functions/_shared/btc-core.ts",
);
const tmpModulePath = path.join(here, ".tmp-btc-core-cons.mjs");

type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  // npm:@scope/name@1.2.3/sub/path -> @scope/name/sub/path
  // npm:name@1.2.3                 -> name
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

// The published BIP84 "abandon … about" test account (as in
// btc-core.test.ts) — keys are public test vectors, never real funds.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ACCOUNT_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

interface TestUtxo {
  txid: string; vout: number; value: number; chain: 0 | 1; index: number;
}
function utxo(value: number, n: number, chain: 0 | 1 = 0): TestUtxo {
  return {
    txid: n.toString(16).padStart(64, "0"),
    vout: 0,
    value,
    chain,
    index: n,
  };
}
const POLICY = { smallMaxSats: 10_000, minInputs: 10, maxInputs: 200, maxFeeRateSatVb: 2 };

describe("planConsolidation (protection P2b)", () => {
  it("refuses when the fee window is closed (rate above the cap)", () => {
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = Array.from({ length: 20 }, (_, i) => utxo(2_000, i));
    const plan = core.planConsolidation(utxos, POLICY, 3, script);
    expect(plan).toEqual({ skip: "fee_window_closed" });
    // At the cap exactly, the window is open.
    const ok = core.planConsolidation(utxos, POLICY, 2, script);
    expect("skip" in ok).toBe(false);
  });

  it("refuses with too few eligible inputs — big UTXOs are not eligible", () => {
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = [
      ...Array.from({ length: 9 }, (_, i) => utxo(500, i)),
      utxo(5_000_000, 99), // spendable, but not "small"
    ];
    expect(core.planConsolidation(utxos, POLICY, 1, script))
      .toEqual({ skip: "too_few_inputs" });
  });

  it("plans smallest-first and prices the fee with the withdrawal vsize rule", () => {
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = Array.from({ length: 20 }, (_, i) => utxo(2_000, i));
    const plan = core.planConsolidation(utxos, POLICY, 1, script);
    if ("skip" in plan) throw new Error("expected a plan");
    expect(plan.inputs).toHaveLength(20);
    expect(plan.totalInSats).toBe(40_000);
    // vsize = ceil(10.5 + 20×68 + (9+22)) = 1402, at 1 sat/vB.
    expect(plan.feeSats).toBe(1402);
    expect(plan.outputSats).toBe(40_000 - 1402);
    expect(plan.feeRateSatVb).toBe(1);
  });

  it("caps the inputs per run and takes the smallest first", () => {
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = Array.from({ length: 250 }, (_, i) => utxo(1_000 + i, i));
    const plan = core.planConsolidation(
      utxos, { ...POLICY, maxInputs: 100 }, 1, script,
    );
    if ("skip" in plan) throw new Error("expected a plan");
    expect(plan.inputs).toHaveLength(100);
    expect(Math.max(...plan.inputs.map((u) => u.value))).toBe(1_099);
  });

  it("refuses when the single output would fall below dust after fees", () => {
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = Array.from({ length: 10 }, (_, i) => utxo(100, i));
    // total 1,000 sats; fee at 2 sat/vB = 2 × ceil(10.5+680+31) = 1,444 > total.
    expect(core.planConsolidation(utxos, POLICY, 2, script))
      .toEqual({ skip: "output_below_dust" });
  });
});

describe("buildConsolidationTx (protection P2b)", () => {
  it("builds a signed one-output tx spending every planned input, fee as planned", () => {
    const accountPriv = core.accountKeyFromMnemonic(MNEMONIC);
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const script = core.deriveScript(accountPub, 0, 0);
    const utxos = Array.from({ length: 12 }, (_, i) => utxo(3_000, i + 1));
    const plan = core.planConsolidation(utxos, POLICY, 1, script);
    if ("skip" in plan) throw new Error("expected a plan");

    const built = core.buildConsolidationTx({
      accountPriv, accountPub,
      inputs: plan.inputs, feeRateSatVb: 1,
      outputChain: 0, outputIndex: 7,
      expectedFeeSats: plan.feeSats,
    });
    expect(built.feeSats).toBe(plan.feeSats);
    expect(built.outputSats).toBe(plan.outputSats);
    expect(built.txid).toMatch(/^[0-9a-f]{64}$/);

    const parsed = Transaction.fromRaw(Uint8Array.from(Buffer.from(built.hex, "hex")));
    expect(parsed.inputsLength).toBe(12);
    expect(parsed.outputs.map((o) => Number(o.amount))).toEqual([plan.outputSats]);
    // The single output pays the fresh consolidation address.
    const outAddr = core.deriveAddress(accountPub, 0, 7);
    expect(parsed.outputs[0].script).toEqual(core.deriveScript(accountPub, 0, 7));
    expect(outAddr.startsWith("bc1q")).toBe(true);
  });

  it("throws when the built fee would differ from the plan (no surprise broadcasts)", () => {
    const accountPriv = core.accountKeyFromMnemonic(MNEMONIC);
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const utxos = Array.from({ length: 12 }, (_, i) => utxo(3_000, i + 1));
    expect(() =>
      core.buildConsolidationTx({
        accountPriv, accountPub,
        inputs: utxos, feeRateSatVb: 1,
        outputChain: 0, outputIndex: 7,
        expectedFeeSats: 1, // deliberately wrong
      }),
    ).toThrow();
  });

  it("throws on an empty input set", () => {
    const accountPriv = core.accountKeyFromMnemonic(MNEMONIC);
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    expect(() =>
      core.buildConsolidationTx({
        accountPriv, accountPub,
        inputs: [], feeRateSatVb: 1,
        outputChain: 0, outputIndex: 7,
        expectedFeeSats: 0,
      }),
    ).toThrow();
  });
});
