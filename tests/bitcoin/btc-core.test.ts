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

describe("mnemonic normalization (operator paste forgiveness)", () => {
  const WORDS = MNEMONIC.split(" ");
  const numbered = WORDS.map((w, i) => `${i + 1}. ${w}`).join(", ");
  const commaSeparated = WORDS.join(", ");
  const newlineSeparated = WORDS.join("\n");
  const shouty = "  " + WORDS.join("   ").toUpperCase() + "  ";

  it("normalizes a numbered, comma-separated list to the bare words", () => {
    expect(core.normalizeMnemonic(numbered)).toBe(MNEMONIC);
  });

  it("normalizes comma / newline / mixed-case extra-space forms identically", () => {
    expect(core.normalizeMnemonic(commaSeparated)).toBe(MNEMONIC);
    expect(core.normalizeMnemonic(newlineSeparated)).toBe(MNEMONIC);
    expect(core.normalizeMnemonic(shouty)).toBe(MNEMONIC);
    expect(core.normalizeMnemonic(MNEMONIC)).toBe(MNEMONIC);
  });

  it("accepts every decorated form through the full custody interlock", () => {
    for (const variant of [numbered, commaSeparated, newlineSeparated, shouty]) {
      const status = core.custodyStatus(variant, ACCOUNT_ZPUB);
      expect(status.configured).toBe(true);
      const key = core.accountKeyFromMnemonic(variant);
      expect(core.deriveAddress(key, 0, 0)).toBe(ADDR_0_0);
    }
  });

  it("still rejects a non-wordlist word outright, decorated or not", () => {
    const bogusWords = [...WORDS.slice(0, 11), "bitcoin"]; // not a BIP39 word
    const bogus = bogusWords.join(" ");
    const bogusNumbered = bogusWords.map((w, i) => `${i + 1}. ${w}`).join(", ");
    expect(() => core.accountKeyFromMnemonic(bogus)).toThrow();
    expect(core.custodyStatus(bogus, ACCOUNT_ZPUB)).toEqual({
      configured: false,
      reason: "invalid_seed",
    });
    expect(core.custodyStatus(bogusNumbered, ACCOUNT_ZPUB)).toEqual({
      configured: false,
      reason: "invalid_seed",
    });
  });

  it("still rejects a real wordlist word in the wrong place", () => {
    const swapped = [...WORDS.slice(0, 11), "zoo"].join(" ");
    expect(core.custodyStatus(swapped, ACCOUNT_ZPUB).configured).toBe(false);
  });

  it("still rejects 13-word and 25-word inputs", () => {
    expect(() => core.accountKeyFromMnemonic(MNEMONIC + " abandon")).toThrow();
    expect(() =>
      core.accountKeyFromMnemonic(MNEMONIC + " " + MNEMONIC + " abandon"),
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

describe("spent-outpoint tracking (audit M1: concurrent sends share one UTXO pool)", () => {
  const utxo = (txid: string, vout: number, value: number, index: number) => ({
    txid, vout, value, chain: 0 as const, index,
  });

  it("parses the spent outpoints from an esplora transaction's vin", () => {
    const tx = {
      vin: [
        { txid: "aa".repeat(32), vout: 0 },
        { txid: "bb".repeat(32), vout: 3 },
      ],
      vout: [{ value: 1000 }],
    };
    expect(core.spentOutpointsFromTx(tx)).toEqual([
      { txid: "aa".repeat(32), vout: 0 },
      { txid: "bb".repeat(32), vout: 3 },
    ]);
  });

  it("skips malformed vin entries instead of throwing", () => {
    const tx = {
      vin: [
        { txid: "aa".repeat(32), vout: 1 },
        { txid: "", vout: 0 },
        { vout: 2 },
        { txid: "cc".repeat(32), vout: 1.5 },
        { txid: "dd".repeat(32), vout: "0" },
        null,
        "garbage",
      ],
    };
    expect(core.spentOutpointsFromTx(tx)).toEqual([
      { txid: "aa".repeat(32), vout: 1 },
    ]);
    expect(core.spentOutpointsFromTx(null)).toEqual([]);
    expect(core.spentOutpointsFromTx({})).toEqual([]);
    expect(core.spentOutpointsFromTx({ vin: "nope" })).toEqual([]);
  });

  it("excludes committed outpoints and preserves order (deterministic selection)", () => {
    const pool = [
      utxo("aa".repeat(32), 0, 90_000, 0),
      utxo("bb".repeat(32), 1, 50_000, 1),
      utxo("cc".repeat(32), 0, 20_000, 2),
    ];
    const filtered = core.filterUncommittedUtxos(pool, [
      { txid: "bb".repeat(32), vout: 1 },
    ]);
    expect(filtered.map((u) => u.txid)).toEqual(["aa".repeat(32), "cc".repeat(32)]);
    // The same outpoint at a DIFFERENT vout is a different coin.
    const untouched = core.filterUncommittedUtxos(pool, [
      { txid: "bb".repeat(32), vout: 9 },
    ]);
    expect(untouched).toHaveLength(3);
  });

  it("an unaffected re-selection after filtering is identical (same fee)", () => {
    const script = new Uint8Array(22);
    const pool = [
      utxo("aa".repeat(32), 0, 90_000, 0),
      utxo("bb".repeat(32), 1, 50_000, 1),
    ];
    const before = core.selectCoins(pool, 50_000, 10, script, script);
    // Committed outpoint is NOT one the selection needs.
    const after = core.selectCoins(
      core.filterUncommittedUtxos(pool, [{ txid: "bb".repeat(32), vout: 1 }]),
      50_000, 10, script, script,
    );
    expect(after).not.toBeNull();
    expect(after!.feeSats).toBe(before!.feeSats);
    expect(after!.selected.map((u) => u.txid)).toEqual(before!.selected.map((u) => u.txid));
  });

  it("filtering out the selected coin forces a different, valid selection or none", () => {
    const script = new Uint8Array(22);
    const pool = [
      utxo("aa".repeat(32), 0, 90_000, 0),
      utxo("bb".repeat(32), 1, 50_000, 1),
    ];
    // The largest coin is committed to another withdrawal: selection
    // must fall back to the smaller coin (fee too large here → null),
    // never silently reuse the committed coin.
    const filtered = core.filterUncommittedUtxos(pool, [
      { txid: "aa".repeat(32), vout: 0 },
    ]);
    expect(core.selectCoins(filtered, 50_000, 10, script, script)).toBeNull();
    // With a smaller target the fallback coin IS used.
    const fallback = core.selectCoins(filtered, 40_000, 10, script, script);
    expect(fallback!.selected.map((u) => u.txid)).toEqual(["bb".repeat(32)]);
  });

  it("outpointKey distinguishes txid and vout", () => {
    expect(core.outpointKey("ab", 0)).not.toBe(core.outpointKey("ab", 1));
    expect(core.outpointKey("ab", 0)).not.toBe(core.outpointKey("ac", 0));
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

describe("custodyStatus (seed⇄xpub interlock)", () => {
  const OTHER_MNEMONIC =
    "legal winner thank year wave sausage worth useful legal winner thank yellow";

  it("refuses when both secrets are absent or blank", () => {
    expect(core.custodyStatus(undefined, undefined)).toEqual({
      configured: false,
      reason: "missing_seed",
    });
    expect(core.custodyStatus("", "   ")).toEqual({
      configured: false,
      reason: "missing_seed",
    });
  });

  it("refuses when only the xpub is present (the production state)", () => {
    expect(core.custodyStatus(null, ACCOUNT_ZPUB)).toEqual({
      configured: false,
      reason: "missing_seed",
    });
  });

  it("refuses when only the seed is present", () => {
    expect(core.custodyStatus(MNEMONIC, null)).toEqual({
      configured: false,
      reason: "missing_xpub",
    });
    expect(core.custodyStatus(MNEMONIC, "")).toEqual({
      configured: false,
      reason: "missing_xpub",
    });
  });

  it("refuses an invalid mnemonic", () => {
    expect(core.custodyStatus("not a real mnemonic at all", ACCOUNT_ZPUB)).toEqual({
      configured: false,
      reason: "invalid_seed",
    });
  });

  it("refuses an invalid xpub", () => {
    expect(core.custodyStatus(MNEMONIC, "zpubINVALIDCHECKSUM")).toEqual({
      configured: false,
      reason: "invalid_xpub",
    });
    expect(core.custodyStatus(MNEMONIC, "garbage")).toEqual({
      configured: false,
      reason: "invalid_xpub",
    });
  });

  it("refuses a valid seed paired with a DIFFERENT account's key", () => {
    const otherPub = core.accountKeyFromMnemonic(OTHER_MNEMONIC).publicExtendedKey;
    expect(core.custodyStatus(MNEMONIC, otherPub)).toEqual({
      configured: false,
      reason: "seed_xpub_mismatch",
    });
    expect(core.custodyStatus(OTHER_MNEMONIC, ACCOUNT_ZPUB)).toEqual({
      configured: false,
      reason: "seed_xpub_mismatch",
    });
  });

  it("accepts the matched published test-vector pair", () => {
    const status = core.custodyStatus(MNEMONIC, ACCOUNT_ZPUB);
    expect(status.configured).toBe(true);
    if (status.configured) {
      expect(core.deriveAddress(status.accountPub, 0, 0)).toBe(ADDR_0_0);
      expect(core.deriveAddress(status.accountPriv, 0, 0)).toBe(ADDR_0_0);
    }
  });
});

describe("receiveStatus (xpub-only receiving)", () => {
  it("refuses when the xpub is absent or blank", () => {
    expect(core.receiveStatus(undefined)).toEqual({
      configured: false,
      reason: "missing_xpub",
    });
    expect(core.receiveStatus(null)).toEqual({
      configured: false,
      reason: "missing_xpub",
    });
    expect(core.receiveStatus("   ")).toEqual({
      configured: false,
      reason: "missing_xpub",
    });
  });

  it("refuses an unparseable xpub", () => {
    expect(core.receiveStatus("zpubINVALIDCHECKSUM")).toEqual({
      configured: false,
      reason: "invalid_xpub",
    });
    expect(core.receiveStatus("garbage")).toEqual({
      configured: false,
      reason: "invalid_xpub",
    });
  });

  it("accepts a parseable xpub with NO seed involved", () => {
    const status = core.receiveStatus(ACCOUNT_ZPUB);
    expect(status.configured).toBe(true);
    if (status.configured) {
      // The watch-only key derives the same receiving address the
      // matched seed derives — receiving needs nothing more.
      expect(core.deriveAddress(status.accountPub, 0, 0)).toBe(ADDR_0_0);
    }
  });
});

describe("bitcoinCapabilities (per-capability gates)", () => {
  const OTHER_MNEMONIC =
    "legal winner thank year wave sausage worth useful legal winner thank yellow";
  const KEY = "test-breez-key";

  it("nothing present → nothing enabled", () => {
    const caps = core.bitcoinCapabilities({});
    expect(caps.canReceive).toBe(false);
    expect(caps.canLightning).toBe(false);
    expect(caps.canSpend).toBe(false);
  });

  it("xpub only (the production state): receive on, spend off", () => {
    const caps = core.bitcoinCapabilities({ xpub: ACCOUNT_ZPUB });
    expect(caps.canReceive).toBe(true);
    expect(caps.canSpend).toBe(false);
    expect(caps.spend).toEqual({ configured: false, reason: "missing_seed" });
    expect(caps.canLightning).toBe(false);
  });

  it("xpub + Breez key: receive and Lightning on, spend still off", () => {
    const caps = core.bitcoinCapabilities({
      xpub: ACCOUNT_ZPUB,
      breezApiKey: KEY,
    });
    expect(caps.canReceive).toBe(true);
    expect(caps.canLightning).toBe(true);
    expect(caps.canSpend).toBe(false);
  });

  it("Breez key alone enables Lightning without any custody secrets", () => {
    const caps = core.bitcoinCapabilities({ breezApiKey: KEY });
    expect(caps.canLightning).toBe(true);
    expect(caps.canReceive).toBe(false);
    expect(caps.canSpend).toBe(false);
  });

  it("a blank Breez key does not enable Lightning", () => {
    const caps = core.bitcoinCapabilities({
      xpub: ACCOUNT_ZPUB,
      breezApiKey: "   ",
    });
    expect(caps.canLightning).toBe(false);
  });

  it("matched seed + xpub + key: everything on", () => {
    const caps = core.bitcoinCapabilities({
      mnemonic: MNEMONIC,
      xpub: ACCOUNT_ZPUB,
      breezApiKey: KEY,
    });
    expect(caps.canReceive).toBe(true);
    expect(caps.canLightning).toBe(true);
    expect(caps.canSpend).toBe(true);
    expect(caps.spend.configured).toBe(true);
  });

  it("mismatched seed + xpub: receive stays on, spend refuses", () => {
    const caps = core.bitcoinCapabilities({
      mnemonic: OTHER_MNEMONIC,
      xpub: ACCOUNT_ZPUB,
      breezApiKey: KEY,
    });
    expect(caps.canReceive).toBe(true);
    expect(caps.canLightning).toBe(true);
    expect(caps.canSpend).toBe(false);
    expect(caps.spend).toEqual({
      configured: false,
      reason: "seed_xpub_mismatch",
    });
  });

  it("invalid xpub: receive and spend both off, Lightning unaffected", () => {
    const caps = core.bitcoinCapabilities({
      mnemonic: MNEMONIC,
      xpub: "garbage",
      breezApiKey: KEY,
    });
    expect(caps.canReceive).toBe(false);
    expect(caps.canSpend).toBe(false);
    expect(caps.canLightning).toBe(true);
  });

  it("seed only: nothing on (receive needs the xpub, spend needs both)", () => {
    const caps = core.bitcoinCapabilities({ mnemonic: MNEMONIC });
    expect(caps.canReceive).toBe(false);
    expect(caps.canSpend).toBe(false);
    expect(caps.spend).toEqual({ configured: false, reason: "missing_xpub" });
  });
});

describe("classifyBroadcastOutcome (no broadcast outcome may authorise a refund)", () => {
  const TXID = "aa".repeat(32);
  const OTHER_TXID = "bb".repeat(32);
  const classify = (
    obs: Partial<Parameters<typeof core.classifyBroadcastOutcome>[0]>,
  ) =>
    core.classifyBroadcastOutcome(
      { postStatus: null, postBody: "", postTxid: null, lookupFound: false, ...obs },
      TXID,
    );

  it("confirmed by POST: 2xx returns our exact txid", () => {
    const cls = classify({ postStatus: 200, postTxid: TXID });
    expect(cls.outcome).toBe("confirmed");
    expect(cls.reason).toBe("post_txid_match");
  });

  it("confirmed by lookup after a rejected POST (timeout race)", () => {
    const cls = classify({
      postStatus: 400,
      postBody: "bad-txns-inputs-missingorspent",
      lookupFound: true,
    });
    expect(cls.outcome).toBe("confirmed");
    expect(cls.reason).toBe("lookup_found");
  });

  it("confirmed by lookup after the POST request itself failed", () => {
    const cls = classify({ postStatus: null, lookupFound: true });
    expect(cls.outcome).toBe("confirmed");
  });

  it("unknown: 400 rejections of EVERY class — no rejection authorises a refund", () => {
    // A 400 is one endpoint's answer about its own mempool view; even
    // structural classes (bad-txns, bad-witness, missingorspent) and
    // policy classes (nonstandard, dust, bare 'invalid') cannot prove
    // the signed transaction can never be accepted anywhere. The
    // withdrawal stays reserved for a human refund decision.
    for (const postBody of [
      "bad-txns-inputs-missingorspent", // already-spent / missing inputs
      "bad-txns-vout-toolarge",
      "bad-witness-nonstandard",
      "non-standard transaction input",
      "dust output below the dust limit",
      "invalid transaction: bad sig",
    ]) {
      const cls = classify({ postStatus: 400, postBody, lookupFound: false });
      expect(cls.outcome, postBody).toBe("unknown");
      expect(cls.reason).toBe("post_http_400");
    }
  });

  it("unknown: 400 with an ambiguous (fee-policy) body + lookup miss — never refunded", () => {
    const cls = classify({
      postStatus: 400,
      postBody: "min relay fee not met",
      lookupFound: false,
    });
    expect(cls.outcome).toBe("unknown");
  });

  it("unknown: timeout / no response + lookup miss — the POST may have landed", () => {
    const cls = classify({ postStatus: null, lookupFound: false });
    expect(cls.outcome).toBe("unknown");
    expect(cls.reason).toBe("post_no_response");
  });

  it("unknown: 5xx from the broadcast endpoint + lookup miss", () => {
    for (const postStatus of [500, 502, 503]) {
      const cls = classify({ postStatus, postBody: "upstream error", lookupFound: false });
      expect(cls.outcome, String(postStatus)).toBe("unknown");
    }
  });

  it("unknown: 2xx with an UNEXPECTED txid + lookup miss (no network check = no refund)", () => {
    const cls = classify({ postStatus: 200, postTxid: OTHER_TXID, lookupFound: false });
    expect(cls.outcome).toBe("unknown");
    expect(cls.reason).toBe("unexpected_txid");
  });

  it("confirmed: 2xx with an unexpected txid, but the lookup finds OUR txid", () => {
    const cls = classify({ postStatus: 200, postTxid: OTHER_TXID, lookupFound: true });
    expect(cls.outcome).toBe("confirmed");
    expect(cls.reason).toBe("lookup_found");
  });

  it("unknown: non-400 client errors are not treated as validation proof", () => {
    const cls = classify({
      postStatus: 413,
      postBody: "bad-txns-request-too-large",
      lookupFound: false,
    });
    expect(cls.outcome).toBe("unknown");
  });
});
