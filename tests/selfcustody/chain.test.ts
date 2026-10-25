import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { netChangeSats, esploraUrls, ESPLORA_BASES, scanWallet, fetchRecommendedFeeRate, resetEsploraPreference } from "../../src/lib/selfcustody/chain";

// The sticky endpoint preference (chain.ts) is module state: reset
// it before each test so fallback-order assertions stay canonical.
beforeEach(() => {
  resetEsploraPreference();
});
import { accountFromMnemonic } from "../../src/lib/selfcustody/wallet";

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

describe("esploraUrls — endpoint fallback order", () => {
  it("puts mempool.space first and blockstream.info second", () => {
    expect(ESPLORA_BASES[0]).toBe("https://mempool.space/api");
    expect(esploraUrls("/address/bc1qxyz")).toEqual([
      "https://mempool.space/api/address/bc1qxyz",
      "https://blockstream.info/api/address/bc1qxyz",
    ]);
  });
});

const EMPTY_STATS = { chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("Esplora fallback (primary down → fallback answers)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scanWallet completes via the fallback when the primary is unreachable", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.startsWith("https://mempool.space/")) throw new TypeError("Failed to fetch");
        if (url.includes("/address/")) return jsonResponse(EMPTY_STATS);
        throw new Error(`unexpected url ${url}`);
      }),
    );
    const account = accountFromMnemonic(
      "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
    );
    const scan = await scanWallet(account);
    expect(scan.balanceSats).toBe(0);
    expect(scan.utxos).toEqual([]);
    expect(scan.nextReceiveIndex).toBe(0);
    // The primary really was tried (and failed) before the fallback.
    expect(calls.some((u) => u.startsWith("https://mempool.space/"))).toBe(true);
    expect(calls.some((u) => u.startsWith("https://blockstream.info/"))).toBe(true);
  });

  it("uses only the primary while it is healthy (fallback untouched)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse({ halfHourFee: 7 });
      }),
    );
    await expect(fetchRecommendedFeeRate()).resolves.toBe(7);
    expect(calls).toEqual(["https://mempool.space/api/v1/fees/recommended"]);
  });

  it("falls back on an HTTP error status too, not just network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://mempool.space/")) return jsonResponse("rate limited", false, 429);
        return jsonResponse({ halfHourFee: 9 });
      }),
    );
    await expect(fetchRecommendedFeeRate()).resolves.toBe(9);
  });

  it("surfaces an error only when EVERY endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(fetchRecommendedFeeRate()).rejects.toThrow(/Failed to fetch/);
  });
});
