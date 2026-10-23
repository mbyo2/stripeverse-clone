// Unit tests for supabase/functions/_shared/price-index.ts — the
// shared BTC price index behind the p2p edge function's
// refresh_price_index action (scope §2.2). Same loader pattern as
// tests/bitcoin/btc-core.test.ts: the real source is transpiled and
// tested byte-identical (the module is import-free by design).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadShared(name: string) {
  const source = fs.readFileSync(
    path.resolve(here, "../../supabase/functions/_shared", name),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: name,
  });
  const tmp = path.join(here, `.tmp-${name.replace(/\.ts$/, ".mjs")}`);
  fs.writeFileSync(tmp, outputText);
  return import(tmp);
}

type Index = typeof import("../../supabase/functions/_shared/price-index");
let idx: Index;

beforeAll(async () => {
  idx = await loadShared("price-index.ts");
});

function stubFetch(responses: Record<string, unknown>) {
  return async (url: string) => ({
    ok: true,
    json: async () => {
      for (const key of Object.keys(responses)) {
        if (url.includes(key)) return responses[key];
      }
      throw new Error(`unstubbed url ${url}`);
    },
  });
}

describe("computeBtcIndex", () => {
  it("computes the ZMW index from Coinbase × USD/ZMW", () => {
    const r = idx.computeBtcIndex(100_000, 99_000, 25);
    expect(r.divergence).toBeCloseTo(0.01);
    expect(r.isStale).toBe(false);
    expect(r.indexZmw).toBe(2_500_000);
  });

  it("marks divergence beyond 3% as stale (§2.2)", () => {
    const r = idx.computeBtcIndex(100_000, 96_000, 25);
    expect(r.divergence).toBeCloseTo(0.04);
    expect(r.isStale).toBe(true);
  });

  it("treats exactly 3% divergence as NOT stale", () => {
    const r = idx.computeBtcIndex(100_000, 97_000, 25);
    expect(r.divergence).toBeCloseTo(0.03);
    expect(r.isStale).toBe(false);
  });

  it("throws on non-positive prices instead of indexing garbage", () => {
    expect(() => idx.computeBtcIndex(0, 99_000, 25)).toThrow();
    expect(() => idx.computeBtcIndex(100_000, -1, 25)).toThrow();
    expect(() => idx.computeBtcIndex(100_000, 99_000, 0)).toThrow();
    expect(() => idx.computeBtcIndex(NaN, 99_000, 25)).toThrow();
  });
});

describe("buildSnapshotInsert", () => {
  it("shapes the p2p_price_snapshots row (proof-fixture source keys)", () => {
    const row = idx.buildSnapshotInsert(idx.computeBtcIndex(100_000, 96_000, 25));
    expect(row.asset).toBe("BTC");
    expect(row.index_zmw).toBe(2_500_000);
    expect(row.is_stale).toBe(true);
    expect(row.sources.coinbase_usd).toBe(100_000);
    expect(row.sources.kraken_usd).toBe(96_000);
    expect(row.sources.usd_zmw).toBe(25);
  });
});

describe("isFxDeviationStale (delta-audit E5)", () => {
  it("exposes the 5% band", () => {
    expect(idx.FX_DEVIATION_LIMIT).toBe(0.05);
  });

  it("passes small FX moves", () => {
    expect(idx.isFxDeviationStale(25, 25.5)).toBe(false); // +2%
    expect(idx.isFxDeviationStale(25, 24.4)).toBe(false); // -2.4%
    expect(idx.isFxDeviationStale(25, 25)).toBe(false);
  });

  it("flags a single bad FX row in either direction", () => {
    expect(idx.isFxDeviationStale(25, 27)).toBe(true); // +8%
    expect(idx.isFxDeviationStale(25, 23.5)).toBe(true); // -6%
    expect(idx.isFxDeviationStale(25, 250)).toBe(true); // decimal slip
    expect(idx.isFxDeviationStale(25, 2.5)).toBe(true); // decimal slip
  });

  it("treats exactly 5% as inside the band", () => {
    expect(idx.isFxDeviationStale(25, 26.25)).toBe(false);
    expect(idx.isFxDeviationStale(25, 23.75)).toBe(false);
  });

  it("never stale without a usable previous value", () => {
    expect(idx.isFxDeviationStale(null, 25)).toBe(false);
    expect(idx.isFxDeviationStale(undefined, 25)).toBe(false);
    expect(idx.isFxDeviationStale(0, 25)).toBe(false);
    expect(idx.isFxDeviationStale(NaN, 25)).toBe(false);
  });
});

describe("fetchers", () => {
  it("parses Coinbase and Kraken payloads like btc-trade", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "101234.50" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["100900.1", "0.5"] } } },
    });
    const r = await idx.fetchBtcUsdPrices(fetchFn as any);
    expect(r.coinbaseUsd).toBeCloseTo(101234.5);
    expect(r.krakenUsd).toBeCloseTo(100900.1);
  });

  it("throws when a source returns no price", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "not-a-number" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["100900.1"] } } },
    });
    await expect(idx.fetchBtcUsdPrices(fetchFn as any)).rejects.toThrow();
  });

  it("reads USD/ZMW from the fallback source shape", async () => {
    const fetchFn = stubFetch({
      "exchangerate-api.com": { rates: { ZMW: 25.5 } },
    });
    await expect(idx.fetchUsdZmwFallback(fetchFn as any)).resolves.toBe(25.5);
  });

  it("throws when the fallback has no ZMW rate", async () => {
    const fetchFn = stubFetch({ "exchangerate-api.com": { rates: {} } });
    await expect(idx.fetchUsdZmwFallback(fetchFn as any)).rejects.toThrow();
  });
});
