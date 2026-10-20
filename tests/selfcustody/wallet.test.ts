import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  generateWalletMnemonic,
  isValidMnemonic,
  accountFromMnemonic,
  accountXpub,
  deriveAddress,
  deriveScript,
  selectCoins,
  buildSignedTransaction,
  type ClientUtxo,
} from "../../src/lib/selfcustody/wallet";

// Published BIP84 test vector (BIP84 specification) — same vector the
// custodial suite pins: "abandon" x11 + "about" (12 words).
const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const VECTOR_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const VECTOR_ADDRESS_0_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

describe("client BIP39/BIP84 wallet", () => {
  it("validates mnemonics and rejects corrupted ones", () => {
    expect(isValidMnemonic(VECTOR_MNEMONIC)).toBe(true);
    expect(isValidMnemonic(VECTOR_MNEMONIC.replace("about", "zoo"))).toBe(false);
    expect(isValidMnemonic("not a mnemonic at all")).toBe(false);
  });

  it("derives the published BIP84 account zpub from the vector mnemonic", () => {
    const account = accountFromMnemonic(VECTOR_MNEMONIC);
    expect(accountXpub(account)).toBe(VECTOR_ZPUB);
  });

  it("generates 24-word mnemonics that validate", () => {
    const phrase = generateWalletMnemonic();
    expect(phrase.split(" ")).toHaveLength(24);
    expect(isValidMnemonic(phrase)).toBe(true);
  });

  it("derives the published BIP84 vector address at m/84'/0'/0'/0/0", () => {
    const account = accountFromMnemonic(VECTOR_MNEMONIC);
    expect(deriveAddress(account, 0, 0)).toBe(VECTOR_ADDRESS_0_0);
  });

  it("coin selection folds dust change into the fee (mirrors the server algorithm)", () => {
    const account = accountFromMnemonic(VECTOR_MNEMONIC);
    const utxo: ClientUtxo = {
      txid: "00".repeat(32),
      vout: 0,
      valueSats: 16110n,
      chain: 0,
      index: 0,
      script: deriveScript(account, 0, 0),
    };
    const sel = selectCoins([utxo], 15000n, 10);
    expect(sel.changeSats).toBe(0n);
    expect(sel.feeSats).toBe(1110n);
    expect(() => selectCoins([utxo], 999999n, 10)).toThrow(/Insufficient/);
  });

  it("builds and signs a spend whose txid an independent recomputation confirms", () => {
    const account = accountFromMnemonic(VECTOR_MNEMONIC);
    const utxo: ClientUtxo = {
      txid: "11".repeat(32),
      vout: 1,
      valueSats: 100000n,
      chain: 0,
      index: 0,
      script: deriveScript(account, 0, 0),
    };
    const built = buildSignedTransaction({
      account,
      utxos: [utxo],
      toAddress: VECTOR_ADDRESS_0_0,
      amountSats: 50000n,
      feeRateSatVb: 10,
      changeIndex: 0,
    });
    expect(built.hex.length).toBeGreaterThan(100);
    // Independent txid: double-SHA256 of the witness-stripped serialization, byte-reversed.
    const raw = Buffer.from(built.hex, "hex");
    let offset = 4;
    if (raw[4] === 0x00 && raw[5] === 0x01) offset = 6;
    const stripped: Buffer[] = [raw.subarray(0, 4)];
    let cursor = offset;
    const varint = () => {
      const b = raw[cursor];
      if (b < 0xfd) {
        cursor += 1;
        return b;
      }
      if (b === 0xfd) {
        const v = raw.readUInt16LE(cursor + 1);
        cursor += 3;
        return v;
      }
      throw new Error("unexpected varint");
    };
    const inputsStart = cursor;
    const nIn = varint();
    cursor = inputsStart;
    void nIn;
    // Copy inputs verbatim up to the outputs count by reparsing quickly:
    let p = cursor;
    const readVarintAt = (pos: number): [number, number] => {
      const b = raw[pos];
      if (b < 0xfd) return [b, pos + 1];
      if (b === 0xfd) return [raw.readUInt16LE(pos + 1), pos + 3];
      if (b === 0xfe) return [raw.readUInt32LE(pos + 1), pos + 5];
      return [Number(raw.readBigUInt64LE(pos + 1)), pos + 9];
    };
    let [count, afterCount] = readVarintAt(p);
    p = afterCount;
    for (let i = 0; i < count; i++) {
      p += 36;
      const [scriptLen, afterLen] = readVarintAt(p);
      p = afterLen + scriptLen + 4;
    }
    const inputsEnd = p;
    stripped.push(raw.subarray(cursor, inputsEnd));
    const [nOut, afterOutCount] = readVarintAt(inputsEnd);
    let q = afterOutCount;
    for (let i = 0; i < nOut; i++) {
      q += 8;
      const [scriptLen, afterLen] = readVarintAt(q);
      q = afterLen + scriptLen;
    }
    stripped.push(raw.subarray(inputsEnd, q));
    stripped.push(raw.subarray(raw.length - 4));
    const txidBytes = createHash("sha256")
      .update(createHash("sha256").update(Buffer.concat(stripped)).digest())
      .digest();
    const recomputed = Buffer.from(txidBytes).reverse().toString("hex");
    expect(built.txid).toBe(recomputed);
    expect(built.feeSats).toBeGreaterThan(0n);
    expect(built.changeSats).toBe(100000n - 50000n - built.feeSats);
  });

  it("refuses an invalid recipient address", () => {
    const account = accountFromMnemonic(VECTOR_MNEMONIC);
    const utxo: ClientUtxo = {
      txid: "22".repeat(32),
      vout: 0,
      valueSats: 100000n,
      chain: 0,
      index: 0,
      script: deriveScript(account, 0, 0),
    };
    expect(() =>
      buildSignedTransaction({
        account,
        utxos: [utxo],
        toAddress: "bc1qinvalidchecksumaddress000000000",
        amountSats: 1000n,
        feeRateSatVb: 10,
        changeIndex: 0,
      }),
    ).toThrow(/Invalid Bitcoin address/);
  });
});
