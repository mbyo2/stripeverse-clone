import { describe, it, expect } from "vitest";
import { netChangeSats } from "../../src/lib/selfcustody/chain";

const MINE = "bc1qmine";
const OTHER = "bc1qother";

describe("netChangeSats (history netting)", () => {
  it("deposit: outputs to my address count positive", () => {
    const tx = {
      vout: [{ value: 50000, scriptpubkey_address: MINE }, { value: 1000, scriptpubkey_address: OTHER }],
      vin: [{ prevout: { value: 60000, scriptpubkey_address: OTHER } }],
    };
    expect(netChangeSats(tx, new Set([MINE]))).toBe(50000);
  });

  it("spend with change: inputs from me minus change back equals -(amount+fee)", () => {
    // I spend a 100,000 UTXO: 60,000 to OTHER, 39,000 change to me, 1,000 fee.
    const tx = {
      vout: [
        { value: 60000, scriptpubkey_address: OTHER },
        { value: 39000, scriptpubkey_address: MINE },
      ],
      vin: [{ prevout: { value: 100000, scriptpubkey_address: MINE } }],
    };
    expect(netChangeSats(tx, new Set([MINE]))).toBe(-61000);
  });

  it("self-transfer between two of my addresses nets to -fee only", () => {
    const tx = {
      vout: [{ value: 99000, scriptpubkey_address: MINE }],
      vin: [{ prevout: { value: 100000, scriptpubkey_address: MINE } }],
    };
    // vout 99,000 - vin 100,000 = -1,000 (the fee) — correct.
    expect(netChangeSats(tx, new Set([MINE]))).toBe(-1000);
  });

  it("unrelated tx nets to zero", () => {
    const tx = {
      vout: [{ value: 5000, scriptpubkey_address: OTHER }],
      vin: [{ prevout: { value: 5000, scriptpubkey_address: OTHER } }],
    };
    expect(netChangeSats(tx, new Set([MINE]))).toBe(0);
  });
});
