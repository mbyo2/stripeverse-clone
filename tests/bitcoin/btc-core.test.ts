// Unit tests for supabase/functions/_shared/btc-core.ts.
//
// The edge functions run on Deno and import the @scure libraries via
// `npm:` specifiers pinned to exact versions. Those exact versions are
// devDependencies here, so this suite loads the REAL btc-core.ts source,
// rewrites only the `npm:` specifier prefixes to the bare package names,
// transpiles it, and tests the resulting module. The code under test is
// byte-identical to what Deno will run, apart from the specifier strings.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createHash } from "node:crypto";
import { Transaction } from "@scure/btc-signer";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSourcePath = path.resolve(
  here,
  "../../supabase/functions/_shared/btc-core.ts",
);
const tmpModulePath = path.join(here, ".tmp-btc-core.mjs");

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

// Published BIP84 test vector (BIP84 spec): the "abandon … about"
// mnemonic's account at m/84'/0'/0' and its first receiving address.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ACCOUNT_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const ADDR_0_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

describe("BIP84 derivation (published test vectors)", () => {
  it("derives the published first deposit address from the zpub", () => {
    const account = core.parseAccountKey(ACCOUNT_ZPUB);
    expect(core.deriveAddress(account, 0, 0)).toBe(ADDR_0_0);
  });

  it("derives the same addresses from the mnemonic as from the zpub", () => {
    const fromSeed = core.accountKeyFromMnemonic(MNEMONIC);
    const fromZpub = core.parseAccountKey(ACCOUNT_ZPUB);
    for (const index of [0, 1, 2, 5, 42]) {
      expect(core.deriveAddress(fromSeed, 0, index)).toBe(
        core.deriveAddress(fromZpub, 0, index),
      );
    }
    expect(core.deriveAddress(fromSeed, 0, 0)).toBe(ADDR_0_0);
  });

  it("rejects non-BIP84 / testnet extended keys", () => {
    expect(() => core.parseAccountKey("ypub" + ACCOUNT_ZPUB.slice(4))).toThrow();
    expect(() => core.parseAccountKey("tpub" + ACCOUNT_ZPUB.slice(4))).toThrow();
    expect(() => core.parseAccountKey("not-a-key")).toThrow();
  });

  it("rejects an invalid mnemonic", () => {
    expect(() =>
      core.accountKeyFromMnemonic("abandon abandon abandon abandon"),
    ).toThrow();
  });
});

describe("address validation", () => {
  it("accepts mainnet SegWit and returns a 22-byte script", () => {
    const v = core.validateMainnetAddress(ADDR_0_0);
    expect(v.type).toBe("wpkh");
    expect(v.script.length).toBe(22);
  });

  it("rejects testnet and garbage addresses", () => {
    expect(() =>
      core.validateMainnetAddress("tb1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    ).toThrow();
    expect(() => core.validateMainnetAddress("bc1qinvalid")).toThrow();
    expect(() => core.validateMainnetAddress("")).toThrow();
  });
});

describe("fee estimation", () => {
  it("matches @scure/btc-signer's vsize for 1-in / 2-out (141 vB)", () => {
    const script = new Uint8Array(22);
    expect(core.estimateVsize(1, [script, script])).toBe(141);
  });
});

describe("coin selection", () => {
  const script = new Uint8Array(22);
  const utxo = (value: number, index: number) => ({
    txid: String(index).padStart(64, "0"),
    vout: 0,
    value,
    chain: 0 as const,
    index,
  });

  it("selects one large UTXO and keeps economical change", () => {
    const sel = core.selectCoins([utxo(100_000, 0)], 50_000, 10, script, script);
    expect(sel).not.toBeNull();
    expect(sel!.selected.length).toBe(1);
    expect(sel!.feeSats).toBe(1410); // 141 vB * 10 sat/vB
    expect(sel!.changeSats).toBe(100_000 - 50_000 - 1410);
  });

  it("folds sub-dust change into the fee instead of creating it", () => {
    const sel = core.selectCoins([utxo(51_500, 0)], 50_000, 10, script, script);
    expect(sel).not.toBeNull();
    expect(sel!.changeSats).toBe(0);
    expect(sel!.feeSats).toBe(1500); // everything above the target
  });

  it("returns null when funds cannot cover target + fee", () => {
    expect(core.selectCoins([utxo(1_000, 0)], 50_000, 10, script, script)).toBeNull();
    expect(core.selectCoins([], 50_000, 10, script, script)).toBeNull();
  });

  it("prefers the largest UTXO first (fewest inputs)", () => {
    const sel = core.selectCoins(
      [utxo(30_000, 0), utxo(90_000, 1), utxo(20_000, 2)],
      50_000, 1, script, script,
    );
    expect(sel!.selected.map((u) => u.value)).toEqual([90_000]);
  });
});

describe("withdrawal building & signing (offline, fabricated UTXO)", () => {
  it("builds a signed tx whose id is the double-SHA256 of the raw tx", () => {
    const accountPriv = core.accountKeyFromMnemonic(MNEMONIC);
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    const toAddress = core.deriveAddress(accountPub, 0, 1);
    const utxos = [{
      txid: "11".repeat(32), vout: 0, value: 100_000,
      chain: 0 as const, index: 0,
    }];
    const built = core.buildWithdrawalTx({
      accountPriv, accountPub, utxos,
      toAddress, amountSats: 50_000, feeRateSatVb: 10, changeIndex: 0,
    });
    expect(built.feeSats).toBe(1410);
    expect(built.changeSats).toBe(48_590);
    expect(built.vsize).toBe(141);

    // The txid commits to the witness-STRIPPED serialization. Re-derive it
    // independently: parse the broadcast bytes back, take the stripped
    // (unsigned-form) serialization — byte-identical to the signed stripped
    // form for SegWit — and double-SHA256 it with node:crypto.
    const parsed = Transaction.fromRaw(Uint8Array.from(Buffer.from(built.hex, "hex")));
    const stripped = Buffer.from(parsed.unsignedTx);
    const first = createHash("sha256").update(stripped).digest();
    const second = createHash("sha256").update(first).digest();
    const expectedTxid = Buffer.from(second).reverse().toString("hex");
    expect(built.txid).toBe(expectedTxid);
    // Re-broadcast sanity: the inputs/outputs survive the round trip.
    expect(parsed.outputs.map((o) => Number(o.amount))).toEqual([50_000, 48_590]);
  });

  it("throws when the platform UTXO set cannot fund the withdrawal", () => {
    const accountPriv = core.accountKeyFromMnemonic(MNEMONIC);
    const accountPub = core.parseAccountKey(ACCOUNT_ZPUB);
    expect(() =>
      core.buildWithdrawalTx({
        accountPriv, accountPub,
        utxos: [{ txid: "22".repeat(32), vout: 0, value: 1_000, chain: 0, index: 0 }],
        toAddress: core.deriveAddress(accountPub, 0, 1),
        amountSats: 50_000, feeRateSatVb: 10, changeIndex: 0,
      }),
    ).toThrow();
  });
});

describe("quote math (rounding always favours the platform)", () => {
  it("buy: credits floored sats at the spread-adjusted rate", () => {
    // mid 2,000,000 ZMW/BTC, 1.5% spread, pay 1,000 ZMW
    const q = core.quoteBuySats(1000, 2_000_000, 150);
    expect(q.sats).toBe(49_261);
    expect(q.feeZmw).toBe(14.78);
  });

  it("sell: credits floored ZMW at the spread-adjusted rate", () => {
    const q = core.quoteSellZmw(49_261, 2_000_000, 150);
    expect(q.zmw).toBe(970.44);
    expect(q.feeZmw).toBe(14.78);
  });

  it("never creates fractional-sat value on buy", () => {
    const q = core.quoteBuySats(100, 3_000_000, 0);
    expect(q.sats).toBe(3333); // 3333.33… floored
  });

  it("floors sub-ngwee sell proceeds", () => {
    const q = core.quoteSellZmw(1, 2_600_000, 0);
    expect(q.zmw).toBe(0.02); // gross 0.026 ZMW
  });

  it("rejects non-positive inputs", () => {
    expect(() => core.quoteBuySats(0, 2_000_000, 150)).toThrow();
    expect(() => core.quoteSellZmw(-5, 2_000_000, 150)).toThrow();
  });
});

describe("BOLT11 amount decoding (integer math)", () => {
  it("decodes the BOLT11 spec example prefix (2500u = 250,000 sats)", () => {
    expect(core.decodeBolt11Msat("lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfpg9scrgwpugp34xsejvtdghgqn0h9ynqp4")).toBe(250_000_000n);
  });

  it("decodes milli- and nano-denominated invoices", () => {
    expect(core.decodeBolt11Msat("lnbc10m1pj9nzfq")).toBe(1_000_000_000n);
    expect(core.decodeBolt11Msat("lnbc100n1pj9nzfq")).toBe(10_000n);
  });

  it("decodes whole-BTC invoices", () => {
    expect(core.decodeBolt11Msat("lnbc21pj9nzfq")).toBe(200_000_000_000n);
  });

  it("rejects amount-less, malformed, and non-whole-msat pico invoices", () => {
    expect(core.decodeBolt11Msat("lnbc1pvjluez")).toBeNull();
    expect(core.decodeBolt11Msat("lnbc15p1pj9nzfq")).toBeNull(); // 15p = 1.5 msat
    expect(core.decodeBolt11Msat("garbage")).toBeNull();
  });

  it("accepts pico amounts divisible by 10", () => {
    expect(core.decodeBolt11Msat("lnbc20p1pj9nzfq")).toBe(2n);
  });
});
