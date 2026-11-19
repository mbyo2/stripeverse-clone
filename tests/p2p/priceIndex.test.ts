// Unit tests for supabase/functions/_shared/price-index.ts — the
// shared BTC price index behind the p2p edge function's
// refresh_price_index action (scope §2.2) and, since the scalability
// fix, btc-trade's snapshot-first quote-rate resolution. Since the
// 2026-11-19 FX upgrade the index is a three-source median
// (Coinbase, Kraken, Binance) with staleness judged against the
// median. Same loader pattern as tests/bitcoin/btc-core.test.ts:
// the real source is transpiled and tested byte-identical (the
// module is import-free by design).

import { describe, it, expect, beforeAll, vi } from "vitest";
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
  it("prices at the median of the three sources", () => {
    const r = idx.computeBtcIndex(
      { coinbaseUsd: 100_000, krakenUsd: 99_000, binanceUsdt: 101_000 },
      25,
    );
    expect(r.indexUsd).toBe(100_000);
    expect(r.divergence).toBeCloseTo(0.01);
    expect(r.isStale).toBe(false);
    expect(r.indexZmw).toBe(2_500_000);
    expect(r.sourcesUsed).toBe(3);
  });

  it("degrades to the mean of two when one source is down", () => {
    const r = idx.computeBtcIndex(
      { coinbaseUsd: 100_000, krakenUsd: 99_000, binanceUsdt: null },
      25,
    );
    expect(r.indexUsd).toBe(99_500);
    expect(r.divergence).toBeCloseTo(0.00503);
    expect(r.isStale).toBe(false);
    expect(r.indexZmw).toBe(2_487_500);
    expect(r.sourcesUsed).toBe(2);
  });

  it("a single outlier cannot drag the index — it only marks it stale", () => {
    const r = idx.computeBtcIndex(
      { coinbaseUsd: 100_000, krakenUsd: 100_500, binanceUsdt: 130_000 },
      25,
    );
    expect(r.indexUsd).toBe(100_500);
    expect(r.isStale).toBe(true);
  });

  it("treats exactly 3% divergence from the median as NOT stale", () => {
    const r = idx.computeBtcIndex(
      { coinbaseUsd: 100_000, krakenUsd: 100_000, binanceUsdt: 103_000 },
      25,
    );
    expect(r.divergence).toBeCloseTo(0.03);
    expect(r.isStale).toBe(false);
  });

  it("marks 3.1% divergence from the median as stale", () => {
    const r = idx.computeBtcIndex(
      { coinbaseUsd: 100_000, krakenUsd: 100_000, binanceUsdt: 103_100 },
      25,
    );
    expect(r.isStale).toBe(true);
  });

  it("throws on fewer than two usable sources instead of indexing garbage", () => {
    expect(() =>
      idx.computeBtcIndex(
        { coinbaseUsd: 100_000, krakenUsd: null, binanceUsdt: null },
        25,
      ),
    ).toThrow();
    expect(() =>
      idx.computeBtcIndex(
        { coinbaseUsd: 0, krakenUsd: -1, binanceUsdt: NaN },
        25,
      ),
    ).toThrow();
    expect(() =>
      idx.computeBtcIndex(
        { coinbaseUsd: null, krakenUsd: null, binanceUsdt: null },
        25,
      ),
    ).toThrow();
    expect(() =>
      idx.computeBtcIndex(
        { coinbaseUsd: 100_000, krakenUsd: 99_000, binanceUsdt: 101_000 },
        0,
      ),
    ).toThrow();
  });
});

describe("buildSnapshotInsert", () => {
  it("shapes the p2p_price_snapshots row (proof-fixture source keys)", () => {
    const row = idx.buildSnapshotInsert(
      idx.computeBtcIndex(
        { coinbaseUsd: 100_000, krakenUsd: 96_000, binanceUsdt: 130_000 },
        25,
      ),
    );
    expect(row.asset).toBe("BTC");
    expect(row.index_zmw).toBe(2_500_000);
    expect(row.is_stale).toBe(true);
    expect(row.sources.coinbase_usd).toBe(100_000);
    expect(row.sources.kraken_usd).toBe(96_000);
    expect(row.sources.binance_usdt).toBe(130_000);
    expect(row.sources.index_usd).toBe(100_000);
    expect(row.sources.usd_zmw).toBe(25);
  });

  it("records a down source as null, never omitted", () => {
    const row = idx.buildSnapshotInsert(
      idx.computeBtcIndex(
        { coinbaseUsd: 100_000, krakenUsd: 99_000, binanceUsdt: null },
        25,
      ),
    );
    expect(row.sources.binance_usdt).toBeNull();
    expect(row.sources.index_usd).toBe(99_500);
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
  it("parses Coinbase, Kraken and Binance payloads", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "101234.50" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["100900.1", "0.5"] } } },
      "data-api.binance.vision": { symbol: "BTCUSDT", price: "100700.25" },
    });
    const r = await idx.fetchBtcUsdPrices(fetchFn as any);
    expect(r.coinbaseUsd).toBeCloseTo(101234.5);
    expect(r.krakenUsd).toBeCloseTo(100900.1);
    expect(r.binanceUsdt).toBeCloseTo(100700.25);
  });

  it("one source down still resolves with that source null", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "not-a-number" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["100900.1"] } } },
      "data-api.binance.vision": { symbol: "BTCUSDT", price: "100700.25" },
    });
    const r = await idx.fetchBtcUsdPrices(fetchFn as any);
    expect(r.coinbaseUsd).toBeNull();
    expect(r.krakenUsd).toBeCloseTo(100900.1);
    expect(r.binanceUsdt).toBeCloseTo(100700.25);
  });

  it("throws when fewer than two sources return a price", async () => {
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

describe("medianIndexUsd / fetchMedianBtcUsd", () => {
  it("medianIndexUsd picks the middle of three", () => {
    const r = idx.medianIndexUsd({
      coinbaseUsd: 99_000,
      krakenUsd: 101_000,
      binanceUsdt: 100_000,
    });
    expect(r.indexUsd).toBe(100_000);
    expect(r.sourcesUsed).toBe(3);
  });

  it("medianIndexUsd averages the two in the degradation case", () => {
    const r = idx.medianIndexUsd({
      coinbaseUsd: 100_000,
      krakenUsd: 99_000,
      binanceUsdt: null,
    });
    expect(r.indexUsd).toBe(99_500);
    expect(r.sourcesUsed).toBe(2);
  });

  it("fetchMedianBtcUsd resolves the median from stubbed fetchers", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "100000" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["99000"] } } },
      "data-api.binance.vision": { symbol: "BTCUSDT", price: "101000" },
    });
    await expect(idx.fetchMedianBtcUsd(fetchFn as any)).resolves.toBe(100_000);
  });

  it("fetchMedianBtcUsd rejects when a source deviates >3% from the median", async () => {
    const fetchFn = stubFetch({
      "api.coinbase.com": { data: { amount: "100000" } },
      "api.kraken.com": { result: { XXBTZUSD: { c: ["100500"] } } },
      "data-api.binance.vision": { symbol: "BTCUSDT", price: "130000" },
    });
    await expect(idx.fetchMedianBtcUsd(fetchFn as any)).rejects.toThrow(
      "Price sources diverge — refusing to quote",
    );
  });
});

// ---------------------------------------------------------------------
// Snapshot-first quote-rate resolution (scalability fix #1):
// btc-trade quotes read p2p_price_snapshots instead of calling
// Coinbase/Kraken live on every quote.
// ---------------------------------------------------------------------

/** A chainable stand-in for the Supabase query builder that applies
 *  eq/gte filters, ordering and limit over fixture rows — enough of
 *  PostgREST's behaviour for fetchSnapshotQuoteRates' two queries
 *  (platform_settings, p2p_price_snapshots) to be exercised for real:
 *  staleness here is decided by the same filter predicates the live
 *  query sends, not by the mock's say-so. */
function queryStub(rows: Record<string, unknown>[]) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const state: { orderCol: string | null; ascending: boolean; limitN: number | null } = {
    orderCol: null,
    ascending: true,
    limitN: null,
  };
  // deno-lint-ignore no-explicit-any
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return q;
    },
    gte: (col: string, val: string) => {
      filters.push((r) => String(r[col]) >= val);
      return q;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      state.orderCol = col;
      state.ascending = opts.ascending;
      return q;
    },
    limit: (n: number) => {
      state.limitN = n;
      return q;
    },
    maybeSingle: async () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (state.orderCol) {
        const col = state.orderCol;
        out = [...out].sort((a, b) =>
          state.ascending
            ? String(a[col]).localeCompare(String(b[col]))
            : String(b[col]).localeCompare(String(a[col])),
        );
      }
      if (state.limitN != null) out = out.slice(0, state.limitN);
      return { data: out[0] ?? null, error: null };
    },
  };
  return q;
}

function mockAdmin(tables: Record<string, Record<string, unknown>[]>) {
  return { from: (table: string) => queryStub(tables[table] ?? []) };
}

const QUOTE_NOW = new Date("2026-10-23T12:00:00.000Z");

function snapshotRow(
  ageMinutes: number,
  overrides: Record<string, unknown> = {},
  base: Date = QUOTE_NOW,
) {
  return {
    asset: "BTC",
    index_zmw: 2_600_000,
    is_stale: false,
    created_at: new Date(base.getTime() - ageMinutes * 60_000).toISOString(),
    sources: {
      coinbase_usd: 104_000,
      kraken_usd: 103_500,
      usd_zmw: 25,
      divergence: 0.0048,
      writer: "p2p-price-index",
    },
    ...overrides,
  };
}

function settingsRow(staleMinutes: unknown) {
  return { p2p_price_stale_minutes: staleMinutes };
}

describe("snapshotQuoteRates", () => {
  it("extracts the Coinbase BTC/USD and USD/ZMW legs from pre-median sources", () => {
    expect(idx.snapshotQuoteRates(snapshotRow(1))).toEqual({
      btcUsd: 104_000,
      usdZmw: 25,
    });
  });

  it("prefers index_usd (the median) when the snapshot carries one", () => {
    expect(
      idx.snapshotQuoteRates({
        sources: { coinbase_usd: 104_000, index_usd: 103_800, usd_zmw: 25 },
      }),
    ).toEqual({ btcUsd: 103_800, usdZmw: 25 });
  });

  it("falls back to coinbase_usd when index_usd is unusable", () => {
    expect(
      idx.snapshotQuoteRates({
        sources: { coinbase_usd: 104_000, index_usd: 0, usd_zmw: 25 },
      }),
    ).toEqual({ btcUsd: 104_000, usdZmw: 25 });
  });

  it("refuses partial or unusable snapshots instead of inventing a leg", () => {
    expect(idx.snapshotQuoteRates(null)).toBeNull();
    expect(idx.snapshotQuoteRates(undefined)).toBeNull();
    expect(idx.snapshotQuoteRates({})).toBeNull();
    expect(idx.snapshotQuoteRates({ sources: { usd_zmw: 25 } })).toBeNull();
    expect(idx.snapshotQuoteRates({ sources: { coinbase_usd: 104_000 } })).toBeNull();
    expect(
      idx.snapshotQuoteRates({ sources: { coinbase_usd: 0, usd_zmw: 25 } }),
    ).toBeNull();
    expect(
      idx.snapshotQuoteRates({ sources: { coinbase_usd: 104_000, usd_zmw: -1 } }),
    ).toBeNull();
    expect(
      idx.snapshotQuoteRates({
        sources: { coinbase_usd: "not-a-number", usd_zmw: 25 },
      }),
    ).toBeNull();
  });
});

describe("fetchSnapshotQuoteRates", () => {
  it("returns the newest fresh snapshot's rates", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [
        snapshotRow(3, {
          sources: { coinbase_usd: 100_000, kraken_usd: 99_500, usd_zmw: 24 },
        }),
        snapshotRow(1),
      ],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toEqual({
      btcUsd: 104_000,
      usdZmw: 25,
    });
  });

  it("returns null when the only snapshot is older than the stale bound", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [snapshotRow(10)],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toBeNull();
  });

  it("returns null when the newest snapshot is flagged stale", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [snapshotRow(1, { is_stale: true })],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toBeNull();
  });

  it("returns null when no snapshot exists yet", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toBeNull();
  });

  it("honours a wider configured stale bound (platform_settings)", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(30)],
      p2p_price_snapshots: [snapshotRow(20)],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toEqual({
      btcUsd: 104_000,
      usdZmw: 25,
    });
  });

  it("falls back to 5 minutes when the settings value is unusable", async () => {
    for (const bad of [null, 0, -3, "soon"]) {
      const fresh = mockAdmin({
        platform_settings: [settingsRow(bad)],
        p2p_price_snapshots: [snapshotRow(4)],
      });
      await expect(
        idx.fetchSnapshotQuoteRates(fresh, QUOTE_NOW),
      ).resolves.not.toBeNull();
      const stale = mockAdmin({
        platform_settings: [settingsRow(bad)],
        p2p_price_snapshots: [snapshotRow(10)],
      });
      await expect(
        idx.fetchSnapshotQuoteRates(stale, QUOTE_NOW),
      ).resolves.toBeNull();
    }
    // No settings row at all behaves the same.
    const noSettings = mockAdmin({
      platform_settings: [],
      p2p_price_snapshots: [snapshotRow(10)],
    });
    await expect(
      idx.fetchSnapshotQuoteRates(noSettings, QUOTE_NOW),
    ).resolves.toBeNull();
    expect(idx.DEFAULT_PRICE_STALE_MINUTES).toBe(5);
  });

  it("returns null when the newest fresh snapshot's sources are unusable", async () => {
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [
        snapshotRow(1, { sources: { coinbase_usd: 0, usd_zmw: 25 } }),
      ],
    });
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toBeNull();
  });

  it("resolves null (never throws) when the read itself fails", async () => {
    const admin = {
      from: () => {
        throw new Error("database unreachable");
      },
    };
    await expect(idx.fetchSnapshotQuoteRates(admin, QUOTE_NOW)).resolves.toBeNull();
  });
});

describe("resolveQuoteRates (btc-trade quote path)", () => {
  it("snapshot hit: ZERO external calls — live fetchers are never invoked", async () => {
    const fetchBtcUsd = vi.fn(async () => 999_999);
    const fetchUsdZmw = vi.fn(async () => 99);
    // Belt and braces: even a stray global fetch would be caught.
    const globalFetch = vi.fn(() => {
      throw new Error("external call on the snapshot path");
    });
    vi.stubGlobal("fetch", globalFetch);
    try {
      const admin = mockAdmin({
        platform_settings: [settingsRow(5)],
        // resolveQuoteRates reads the wall clock (no injected now),
        // so this fixture's age is relative to the real current time.
        p2p_price_snapshots: [snapshotRow(1, {}, new Date())],
      });
      const rates = await idx.resolveQuoteRates(admin, { fetchBtcUsd, fetchUsdZmw });
      expect(rates).toEqual({ btcUsd: 104_000, usdZmw: 25 });
      expect(fetchBtcUsd).not.toHaveBeenCalled();
      expect(fetchUsdZmw).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stale snapshot: falls back to the live fetchers exactly once each", async () => {
    const fetchBtcUsd = vi.fn(async () => 105_000);
    const fetchUsdZmw = vi.fn(async () => 25.5);
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [snapshotRow(10)],
    });
    const rates = await idx.resolveQuoteRates(admin, { fetchBtcUsd, fetchUsdZmw });
    expect(rates).toEqual({ btcUsd: 105_000, usdZmw: 25.5 });
    expect(fetchBtcUsd).toHaveBeenCalledTimes(1);
    expect(fetchUsdZmw).toHaveBeenCalledTimes(1);
  });

  it("no snapshot and live fetch down: rejects — no rate is fabricated", async () => {
    const fetchBtcUsd = vi.fn(async () => {
      throw new Error("Price source failed: 503");
    });
    const fetchUsdZmw = vi.fn(async () => 25);
    const admin = mockAdmin({
      platform_settings: [settingsRow(5)],
      p2p_price_snapshots: [],
    });
    await expect(
      idx.resolveQuoteRates(admin, { fetchBtcUsd, fetchUsdZmw }),
    ).rejects.toThrow();
  });
});

describe("btc-trade wiring (source pins)", () => {
  const tradeSource = fs.readFileSync(
    path.resolve(here, "../../supabase/functions/btc-trade/index.ts"),
    "utf8",
  );

  it("quotes resolve rates through the shared snapshot-first resolver", () => {
    expect(tradeSource).toContain(
      'import { resolveQuoteRates } from "../_shared/price-index.ts";',
    );
    expect(tradeSource).toContain("await resolveQuoteRates(admin, {");
  });

  it("the no-price refusal stays the crafted plain-language 503", () => {
    expect(tradeSource).toContain(
      '"Bitcoin prices are unavailable right now. Please try again in a few minutes."',
    );
  });

  it("the live fetchers survive only as the fallback (still divergence-checked)", () => {
    expect(tradeSource).toContain("PRICE_DIVERGENCE_LIMIT");
    expect(tradeSource).toContain("Price sources diverge — refusing to quote");
  });
});
