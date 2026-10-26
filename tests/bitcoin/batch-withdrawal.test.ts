// Unit tests for the P4 withdrawal-batching policy + builder in
// supabase/functions/_shared/btc-core.ts (2026-10-26): multi-output
// batch construction, per-member fee-share allocation (proportional
// to solo vsize, capped at the reserved solo estimate, remainder
// released, overage platform-absorbed), and the formation trigger
// (fee window OR hard max wait).
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
const tmpModulePath = path.join(here, ".tmp-btc-core-batch.mjs");

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

function utxo(value: number, index: number, chain: 0 | 1 = 0): TestUtxo {
  return {
    txid: (index + 1).toString(16).padStart(64, "0"),
    vout: 0,
    value,
    chain,
    index,
  };
}

// ── allocateBatchFeeShares ────────────────────────────────────────────────

describe("allocateBatchFeeShares", () => {
  it("splits proportionally to solo vsize when nothing is capped", () => {
    const out = core.allocateBatchFeeShares(
      [
        { id: "a", soloVsize: 200, reservedFeeSats: 10_000 },
        { id: "b", soloVsize: 100, reservedFeeSats: 10_000 },
        { id: "c", soloVsize: 100, reservedFeeSats: 10_000 },
      ],
      800,
    );
    expect(out.shares).toEqual([
      { id: "a", shareSats: 400 },
      { id: "b", shareSats: 200 },
      { id: "c", shareSats: 200 },
    ]);
    expect(out.absorbedSats).toBe(0);
  });

  it("distributes the flooring remainder deterministically (largest fraction first)", () => {
    // 100 sats over weights 3:2:2 -> raw 42.857/28.571/28.571,
    // floors 42/28/28 = 98, remainder 2 goes to .857 then .571(a<b order).
    const out = core.allocateBatchFeeShares(
      [
        { id: "a", soloVsize: 3, reservedFeeSats: 1_000 },
        { id: "b", soloVsize: 2, reservedFeeSats: 1_000 },
        { id: "c", soloVsize: 2, reservedFeeSats: 1_000 },
      ],
      100,
    );
    const total = out.shares.reduce((s, x) => s + x.shareSats, 0);
    expect(total + out.absorbedSats).toBe(100);
    expect(out.absorbedSats).toBe(0);
    expect(out.shares[0].shareSats).toBe(43);
    expect(out.shares[1].shareSats + out.shares[2].shareSats).toBe(57);
  });

  it("caps every member at their reserved solo estimate and absorbs the overage", () => {
    // Both members reserved 150; the actual fee is 1,000 — far above
    // the sum of caps (a fee spike between queue and broadcast).
    // The platform absorbs the difference; nobody pays above cap.
    const out = core.allocateBatchFeeShares(
      [
        { id: "a", soloVsize: 200, reservedFeeSats: 150 },
        { id: "b", soloVsize: 200, reservedFeeSats: 150 },
      ],
      1_000,
    );
    expect(out.shares).toEqual([
      { id: "a", shareSats: 150 },
      { id: "b", shareSats: 150 },
    ]);
    expect(out.absorbedSats).toBe(700);
  });

  it("redistributes around a capped member to members with headroom", () => {
    // a is capped at 100 of a raw 500 share; the remainder must flow
    // to b (who has headroom), not to absorbed.
    const out = core.allocateBatchFeeShares(
      [
        { id: "a", soloVsize: 100, reservedFeeSats: 100 },
        { id: "b", soloVsize: 100, reservedFeeSats: 10_000 },
      ],
      1_000,
    );
    expect(out.shares[0].shareSats).toBe(100);
    expect(out.shares[1].shareSats).toBe(900);
    expect(out.absorbedSats).toBe(0);
  });

  it("handles a single member and a zero fee", () => {
    const single = core.allocateBatchFeeShares(
      [{ id: "a", soloVsize: 180, reservedFeeSats: 500 }],
      320,
    );
    expect(single.shares).toEqual([{ id: "a", shareSats: 320 }]);
    expect(single.absorbedSats).toBe(0);

    const zero = core.allocateBatchFeeShares(
      [{ id: "a", soloVsize: 180, reservedFeeSats: 500 }],
      0,
    );
    expect(zero.shares).toEqual([{ id: "a", shareSats: 0 }]);
    expect(zero.absorbedSats).toBe(0);
  });

  it("keeps the invariant Σ shares + absorbed === actual across a sweep", () => {
    for (let fee = 0; fee <= 5_000; fee += 137) {
      const members = [
        { id: "a", soloVsize: 141 + (fee % 60), reservedFeeSats: 300 + (fee % 400) },
        { id: "b", soloVsize: 210, reservedFeeSats: 250 },
        { id: "c", soloVsize: 168, reservedFeeSats: 900 },
        { id: "d", soloVsize: 110, reservedFeeSats: 120 },
      ];
      const out = core.allocateBatchFeeShares(members, fee);
      const sum = out.shares.reduce((s, x) => s + x.shareSats, 0);
      expect(sum + out.absorbedSats).toBe(fee);
      out.shares.forEach((s, i) => {
        expect(s.shareSats).toBeGreaterThanOrEqual(0);
        expect(s.shareSats).toBeLessThanOrEqual(members[i].reservedFeeSats);
      });
    }
  });
});

// ── shouldFormBatch ───────────────────────────────────────────────────────

describe("shouldFormBatch", () => {
  const base = {
    queuedCount: 3,
    feeRateSatVb: 9,
    batchCapSatVb: 5,
    oldestQueuedAgeHours: 1,
    maxWaitHours: 6,
  };

  it("forms inside the fee window", () => {
    expect(core.shouldFormBatch({ ...base, feeRateSatVb: 5 }))
      .toEqual({ form: true, forcedByWait: false });
    expect(core.shouldFormBatch({ ...base, feeRateSatVb: 1 }))
      .toEqual({ form: true, forcedByWait: false });
  });

  it("waits above the cap while the oldest member is young", () => {
    expect(core.shouldFormBatch(base)).toEqual({ form: false, forcedByWait: false });
  });

  it("forces formation at the hard max wait, at market", () => {
    expect(core.shouldFormBatch({ ...base, oldestQueuedAgeHours: 6 }))
      .toEqual({ form: true, forcedByWait: true });
    expect(core.shouldFormBatch({ ...base, oldestQueuedAgeHours: 24 }))
      .toEqual({ form: true, forcedByWait: true });
  });

  it("never forms an empty queue, even past the max wait", () => {
    expect(core.shouldFormBatch({ ...base, queuedCount: 0, oldestQueuedAgeHours: 99 }))
      .toEqual({ form: false, forcedByWait: false });
  });
});

// ── selectCoinsMulti + buildBatchWithdrawalTx ─────────────────────────────

describe("batch transaction building", () => {
  it("builds one transaction paying every member, fee from the built tx", () => {
    const priv = core.accountKeyFromMnemonic(MNEMONIC);
    const pub = core.parseAccountKey(ACCOUNT_ZPUB);
    const addrA = core.deriveAddress(pub, 0, 30);
    const addrB = core.deriveAddress(pub, 0, 31);
    const built = core.buildBatchWithdrawalTx({
      accountPriv: priv,
      accountPub: pub,
      utxos: [utxo(500_000, 0), utxo(300_000, 1)],
      payments: [
        { toAddress: addrA, amountSats: 100_000 },
        { toAddress: addrB, amountSats: 150_000 },
      ],
      feeRateSatVb: 3,
      changeIndex: 7,
    });

    const tx = Transaction.fromRaw(Uint8Array.from(Buffer.from(built.hex, "hex")));
    expect(tx.outputsLength).toBe(3); // two payments + change
    const amounts = Array.from({ length: tx.outputsLength }, (_, i) =>
      Number(tx.getOutput(i).amount),
    ).sort((a, b) => a - b);
    expect(amounts).toContain(100_000);
    expect(amounts).toContain(150_000);
    expect(built.changeSats).toBeGreaterThan(0);
    // fee = inputs − outputs, consistent with the reported figure
    expect(built.feeSats).toBe(800_000 - amounts.reduce((s, x) => s + x, 0));
    // vsize scales with outputs: a 2-payment batch is bigger than a
    // solo send but far smaller than two solo sends.
    const soloVsize = core.estimateVsize(2, [
      core.deriveScript(pub, 0, 30),
      core.deriveScript(pub, 1, 7),
    ]);
    expect(built.vsize).toBeGreaterThan(soloVsize);
    expect(built.vsize).toBeLessThan(soloVsize * 2);
  });

  it("folds dust change into the fee instead of creating a dust output", () => {
    const priv = core.accountKeyFromMnemonic(MNEMONIC);
    const pub = core.parseAccountKey(ACCOUNT_ZPUB);
    const addrA = core.deriveAddress(pub, 0, 30);
    // One UTXO barely above amount + fee: change would be dust.
    const feeRate = 2;
    const soloFee = core.estimateVsize(1, [
      core.deriveScript(pub, 0, 30),
      core.deriveScript(pub, 1, 0),
    ]) * feeRate;
    const built = core.buildBatchWithdrawalTx({
      accountPriv: priv,
      accountPub: pub,
      utxos: [utxo(100_000 + soloFee + 100, 0)],
      payments: [{ toAddress: addrA, amountSats: 100_000 }],
      feeRateSatVb: feeRate,
      changeIndex: 0,
    });
    const tx = Transaction.fromRaw(Uint8Array.from(Buffer.from(built.hex, "hex")));
    expect(tx.outputsLength).toBe(1);
    expect(built.changeSats).toBe(0);
  });

  it("refuses a dust payment and an empty batch", () => {
    const priv = core.accountKeyFromMnemonic(MNEMONIC);
    const pub = core.parseAccountKey(ACCOUNT_ZPUB);
    const addrA = core.deriveAddress(pub, 0, 30);
    expect(() =>
      core.buildBatchWithdrawalTx({
        accountPriv: priv,
        accountPub: pub,
        utxos: [utxo(500_000, 0)],
        payments: [{ toAddress: addrA, amountSats: 500 }],
        feeRateSatVb: 2,
        changeIndex: 0,
      }),
    ).toThrow(/dust/i);
    expect(() =>
      core.buildBatchWithdrawalTx({
        accountPriv: priv,
        accountPub: pub,
        utxos: [utxo(500_000, 0)],
        payments: [],
        feeRateSatVb: 2,
        changeIndex: 0,
      }),
    ).toThrow(/empty/i);
  });

  it("throws when the pool cannot cover the batch", () => {
    const priv = core.accountKeyFromMnemonic(MNEMONIC);
    const pub = core.parseAccountKey(ACCOUNT_ZPUB);
    const addrA = core.deriveAddress(pub, 0, 30);
    expect(() =>
      core.buildBatchWithdrawalTx({
        accountPriv: priv,
        accountPub: pub,
        utxos: [utxo(50_000, 0)],
        payments: [{ toAddress: addrA, amountSats: 100_000 }],
        feeRateSatVb: 2,
        changeIndex: 0,
      }),
    ).toThrow(/insufficient/i);
    expect(
      core.selectCoinsMulti(
        [utxo(50_000, 0)],
        100_000,
        2,
        [core.deriveScript(pub, 0, 30)],
        core.deriveScript(pub, 1, 0),
      ),
    ).toBeNull();
  });
});

// ── source pins: migration + function + UI carry the contract ────────────

describe("P4 source pins", () => {
  const repoRoot = path.resolve(here, "../..");
  const migration = fs.readFileSync(
    path.join(repoRoot, "supabase/migrations/20261225_btc_withdrawal_batching.sql"),
    "utf8",
  );
  const fn = fs.readFileSync(
    path.join(repoRoot, "supabase/functions/btc-onchain/index.ts"),
    "utf8",
  );
  const wallet = fs.readFileSync(
    path.join(repoRoot, "src/pages/BitcoinWallet.tsx"),
    "utf8",
  );

  it("migration defines the queue/cancel/claim/settle contract, service-role only", () => {
    for (const name of [
      "btc_queue_batched_withdrawal",
      "btc_cancel_batched_withdrawal",
      "btc_claim_withdrawal_batch",
      "btc_release_batch_claim",
      "btc_record_batch_txid",
      "btc_mark_batch_broadcast_unknown",
      "btc_settle_withdrawal_batch",
    ]) {
      expect(migration).toContain(`FUNCTION public.${name}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${name}`);
    }
    expect(migration).toContain("btc_withdrawal_batches");
    expect(migration).toContain("btc-batch-withdrawals");
    expect(migration).toContain("btc_batch_enabled");
    // The instant path's cap counts queued funds too (the one
    // deliberate delta to btc_reserve_withdrawal).
    expect(migration).toContain("'queued', 'batched'");
  });

  it("the settle RPC refunds the unused reserve and never pays above it", () => {
    expect(migration).toContain("v_refund := v_member.fee_sats - v_share");
    expect(migration).toContain("above the reserved fee cap");
    expect(migration).toContain("absorbed_sats");
  });

  it("the function exposes queue/cancel/run_batch beside the solo path", () => {
    expect(fn).toContain('action === "queue_send"');
    expect(fn).toContain('action === "cancel_batch_send"');
    expect(fn).toContain('action === "run_batch"');
    expect(fn).toContain("allocateBatchFeeShares");
    expect(fn).toContain("buildBatchWithdrawalTx");
    expect(fn).toContain("shouldFormBatch");
    // Batched members' committed inputs are excluded from later sends.
    expect(fn).toContain('"reserved", "broadcast", "batched"');
    // The estimate carries the batch policy for the send form's copy.
    expect(fn).toContain("batch_max_wait_hours");
  });

  it("the wallet offers the batch choice with honest timing copy and a cancel path", () => {
    expect(wallet).toContain("Low-fee batch");
    expect(wallet).toContain("Queue for low-fee batch");
    expect(wallet).toContain("usually within the hour, always within");
    expect(wallet).toContain("waiting for a low-fee window");
    expect(wallet).toContain("cancel_batch_send");
    expect(wallet).toContain("queue_send");
  });
});
