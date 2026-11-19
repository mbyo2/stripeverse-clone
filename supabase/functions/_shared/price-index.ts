// price-index: the shared BTC price index for P2P (scope §2.2).
//
// Three-source median method (upgraded 2026-11-19 from the original
// two-source cross-check): BTC/USD is fetched from Coinbase, Kraken
// AND Binance (public data host, no key) in parallel, and the index
// price is the MEDIAN of the sources that answered — a single wild
// source can neither drag the index nor (on its own) halt pricing,
// it can only mark the index stale. Binance quotes BTC/USDT; the
// USDT/USD basis is typically <0.1%, far inside the divergence band,
// and the median makes the index insensitive to it. USD/ZMW comes
// from the platform's exchange_rates table (the caller reads it —
// this module stays free of any Supabase import so it is
// unit-testable under vitest), with the same public fallback source
// fetch-exchange-rates uses.
//
// Staleness is judged against the median: when ANY usable source
// deviates from the median by >3% the index is marked stale — a
// quote path about to settle refuses on stale, while the snapshot
// writer still records the row with is_stale = true (§2.2: "index
// marked stale — order creation refuses"). Fewer than two usable
// sources is not an index at all: the computation throws and no
// price is ever invented. The Phase 1a RPCs enforce staleness twice
// over — the is_stale flag, and snapshot age against
// platform_settings.p2p_price_stale_minutes — so a total feed outage
// also goes stale on its own simply because no fresh row lands.

export const PRICE_DIVERGENCE_LIMIT = 0.03;

/** The three BTC price sources, each null when that source did not
 *  return a usable price (down, timed out, or garbage payload). */
export interface BtcSourcePrices {
  /** Coinbase BTC/USD spot. */
  coinbaseUsd: number | null;
  /** Kraken BTC/USD last trade. */
  krakenUsd: number | null;
  /** Binance BTC/USDT last price (public data host). */
  binanceUsdt: number | null;
}

export interface BtcIndex {
  /** Coinbase BTC/USD, or null when the source was unusable. */
  coinbaseUsd: number | null;
  /** Kraken BTC/USD, or null when the source was unusable. */
  krakenUsd: number | null;
  /** Binance BTC/USDT, or null when the source was unusable. */
  binanceUsdt: number | null;
  /** The median BTC/USD — the price the index actually carries. */
  indexUsd: number;
  /** USD/ZMW rate the ZMW figure was computed with. */
  usdZmw: number;
  /** Max |source − median| / median across the usable sources. */
  divergence: number;
  /** True when any usable source deviates from the median beyond
   *  PRICE_DIVERGENCE_LIMIT. */
  isStale: boolean;
  /** indexUsd × usdZmw, rounded to 2dp. */
  indexZmw: number;
  /** How many sources contributed (2 or 3). */
  sourcesUsed: number;
}

/** A source value counts only when it is a finite, positive number —
 *  a zero/NaN/garbage quote must never become part of a price. */
function usablePrice(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function usablePrices(prices: BtcSourcePrices): number[] {
  return [
    usablePrice(prices.coinbaseUsd),
    usablePrice(prices.krakenUsd),
    usablePrice(prices.binanceUsdt),
  ].filter((v): v is number => v !== null);
}

/** Median of a non-empty list; the mean of the two middle values for
 *  an even count (the two-source degradation case). Pure. */
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface MedianIndex {
  /** The median BTC/USD across the usable sources. */
  indexUsd: number;
  /** Max |source − median| / median across the usable sources. */
  divergence: number;
  /** True when any usable source deviates from the median beyond
   *  PRICE_DIVERGENCE_LIMIT. */
  isStale: boolean;
  /** How many sources contributed (2 or 3). */
  sourcesUsed: number;
}

/** The median core of the index, shared by computeBtcIndex and the
 *  live-quote helper. Pure. Throws when fewer than two sources are
 *  usable — below two quotes there is no cross-check left, and a
 *  single unchallenged source must never become the price. */
export function medianIndexUsd(prices: BtcSourcePrices): MedianIndex {
  const usable = usablePrices(prices);
  if (usable.length < 2) {
    throw new Error("Price sources returned no usable price");
  }
  const indexUsd = medianOf(usable);
  const divergence = Math.max(
    ...usable.map((v) => Math.abs(v - indexUsd) / indexUsd),
  );
  return {
    indexUsd,
    divergence,
    isStale: divergence > PRICE_DIVERGENCE_LIMIT,
    sourcesUsed: usable.length,
  };
}

/** Combine the source prices and the USD/ZMW leg into an index.
 *  Pure. Throws on fewer than two usable BTC sources or a
 *  non-positive USD/ZMW — garbage must never become a snapshot the
 *  marketplace prices against. */
export function computeBtcIndex(
  prices: BtcSourcePrices,
  usdZmw: number,
): BtcIndex {
  if (!(usdZmw > 0)) {
    throw new Error("Price source returned no usable price");
  }
  const median = medianIndexUsd(prices);
  return {
    coinbaseUsd: usablePrice(prices.coinbaseUsd),
    krakenUsd: usablePrice(prices.krakenUsd),
    binanceUsdt: usablePrice(prices.binanceUsdt),
    indexUsd: median.indexUsd,
    usdZmw,
    divergence: median.divergence,
    isStale: median.isStale,
    indexZmw: Math.round(median.indexUsd * usdZmw * 100) / 100,
    sourcesUsed: median.sourcesUsed,
  };
}

/** The FX leg gets its own sanity band (delta-audit E5). The BTC leg
 *  is cross-checked between exchanges (3% above); USD/ZMW used to
 *  be trusted from a single exchange_rates row (or the public
 *  fallback), so one bad FX row silently mispriced EVERYTHING. USD/ZMW
 *  is a managed-float rate — genuine minute-to-minute moves are a
 *  fraction of a percent — so a >5% jump against the previous
 *  snapshot means the row is wrong, not that the kwacha moved: the
 *  snapshot is written with is_stale = true and order creation
 *  refuses until a sane rate lands. */
export const FX_DEVIATION_LIMIT = 0.05;

/** True when `usdZmw` deviates from the previous snapshot's USD/ZMW
 *  by more than FX_DEVIATION_LIMIT. No previous value (or an unusable
 *  one) is never stale — the first snapshot after an outage must be
 *  able to land, and the age-based staleness already guards gaps. */
export function isFxDeviationStale(
  previousUsdZmw: number | null | undefined,
  usdZmw: number,
): boolean {
  if (
    previousUsdZmw == null ||
    !Number.isFinite(previousUsdZmw) ||
    previousUsdZmw <= 0
  ) {
    return false;
  }
  if (!(usdZmw > 0)) return true;
  return Math.abs(usdZmw - previousUsdZmw) / previousUsdZmw >
    FX_DEVIATION_LIMIT;
}

/** The p2p_price_snapshots row for an index. The sources JSONB keeps
 *  the exact key names the Phase 1a proof fixtures established
 *  (coinbase_usd / kraken_usd / usd_zmw) — order snapshots copy this
 *  object, so its shape is part of the audit record — and adds
 *  binance_usdt plus index_usd (the median actually priced with) so
 *  every historical quote can be re-derived from its snapshot. A
 *  source that was down is recorded as null, never omitted. */
export function buildSnapshotInsert(index: BtcIndex): {
  asset: string;
  index_zmw: number;
  sources: Record<string, unknown>;
  is_stale: boolean;
} {
  return {
    asset: "BTC",
    index_zmw: index.indexZmw,
    sources: {
      coinbase_usd: index.coinbaseUsd,
      kraken_usd: index.krakenUsd,
      binance_usdt: index.binanceUsdt,
      index_usd: index.indexUsd,
      usd_zmw: index.usdZmw,
      divergence: Math.round(index.divergence * 10000) / 10000,
      writer: "p2p-price-index",
    },
    is_stale: index.isStale,
  };
}

type FetchFn = typeof fetch;

async function fetchJson(
  url: string,
  fetchFn: FetchFn,
  timeoutMs = 8_000,
): Promise<any> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Price source failed: ${res.status} ${url}`);
  return res.json();
}

/** Binance's public data host — api.binance.com refuses this
 *  deployment's region, data-api.binance.vision serves the same
 *  public market data without an account or key. */
export const BINANCE_BTC_USDT_URL =
  "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT";

/** Fetch BTC prices from all three exchanges in parallel. Each
 *  source fails independently: a down or garbage source comes back
 *  null instead of sinking the index (the median only needs two).
 *  Throws only when fewer than two sources return a usable price —
 *  with no cross-check left there is no honest price. */
export async function fetchBtcUsdPrices(
  fetchFn: FetchFn = fetch,
): Promise<BtcSourcePrices> {
  const attempt = async (
    parse: () => Promise<number>,
  ): Promise<number | null> => {
    try {
      return usablePrice(await parse());
    } catch {
      return null;
    }
  };
  const [coinbaseUsd, krakenUsd, binanceUsdt] = await Promise.all([
    attempt(async () =>
      Number.parseFloat(
        (await fetchJson(
          "https://api.coinbase.com/v2/prices/BTC-USD/spot",
          fetchFn,
        ))?.data?.amount,
      )
    ),
    attempt(async () =>
      Number.parseFloat(
        (await fetchJson(
          "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
          fetchFn,
        ))?.result?.XXBTZUSD?.c?.[0],
      )
    ),
    attempt(async () =>
      Number.parseFloat(
        (await fetchJson(BINANCE_BTC_USDT_URL, fetchFn))?.price,
      )
    ),
  ]);
  const prices: BtcSourcePrices = { coinbaseUsd, krakenUsd, binanceUsdt };
  if (usablePrices(prices).length < 2) {
    throw new Error("Price sources returned no BTC/USD price");
  }
  return prices;
}

/** The live median BTC/USD for quote paths that price live instead
 *  of from a snapshot (the btc-trade / btc-sell-selfcustody
 *  fallbacks). Throws when fewer than two sources answer or when any
 *  source deviates from the median beyond the divergence limit —
 *  the same refusal the old two-source cross-check made, now
 *  median-based. */
export async function fetchMedianBtcUsd(
  fetchFn: FetchFn = fetch,
): Promise<number> {
  const { indexUsd, isStale } = medianIndexUsd(
    await fetchBtcUsdPrices(fetchFn),
  );
  if (isStale) {
    throw new Error("Price sources diverge — refusing to quote");
  }
  return indexUsd;
}

/** USD/ZMW from the public fallback source — used only when the
 *  exchange_rates table has no live row (same fallback and endpoint
 *  as btc-trade's fetchUsdZmw). */
export async function fetchUsdZmwFallback(
  fetchFn: FetchFn = fetch,
): Promise<number> {
  const live = await fetchJson(
    "https://api.exchangerate-api.com/v4/latest/USD",
    fetchFn,
  );
  const zmw = Number(live?.rates?.ZMW);
  if (!(zmw > 0)) throw new Error("No USD/ZMW rate available");
  return zmw;
}

// ---------------------------------------------------------------------
// Quote-rate resolution (btc-trade): snapshot first, live fetch second.
// ---------------------------------------------------------------------
//
// The per-minute cron refresher above already maintains a BTC index
// on-platform (p2p_price_snapshots, written from the same three-source
// median and the same USD/ZMW leg btc-trade used to fetch live on
// every quote). A trade quote therefore reads the latest snapshot
// while it is fresh — fresh in exactly the sense the rest of the
// platform already uses: the row is not flagged stale and its age is
// within platform_settings.p2p_price_stale_minutes (default 5 —
// the POS bridge's latestBtcIndexZmw applies the same bound to the
// same table). Only when no fresh snapshot exists does the caller
// fall back to its live fetchers; if those fail too, resolution
// throws and the caller refuses the quote — a rate is never invented.

/** Fallback for p2p_price_stale_minutes when the settings row has no
 *  usable value: the column default (20261023_p2p_phase1a_core.sql)
 *  and the POS bridge's DEFAULT_STALE_MINUTES. */
export const DEFAULT_PRICE_STALE_MINUTES = 5;

export interface QuoteRates {
  /** BTC/USD — the snapshot's index_usd (the median) when the row
   *  carries one, else its Coinbase figure (pre-median snapshots);
   *  on the live path, the caller's median fetch. */
  btcUsd: number;
  /** USD/ZMW the quote prices with. */
  usdZmw: number;
}

/** The BTC/USD + USD/ZMW pair a quote needs, taken from a
 *  p2p_price_snapshots row's sources. The BTC leg prefers index_usd
 *  (the median the snapshot priced with); rows written before the
 *  median upgrade have no index_usd and fall back to coinbase_usd —
 *  the figure those rows priced with, so a quote never re-prices a
 *  snapshot at a rate it did not carry. Returns null when either leg
 *  is missing or unusable: a partial snapshot must never become a
 *  price. Pure. */
export function snapshotQuoteRates(
  row: { sources?: unknown } | null | undefined,
): QuoteRates | null {
  const sources = row?.sources as
    | { coinbase_usd?: unknown; index_usd?: unknown; usd_zmw?: unknown }
    | null
    | undefined;
  const indexUsd = Number(sources?.index_usd);
  const btcUsd = Number.isFinite(indexUsd) && indexUsd > 0
    ? indexUsd
    : Number(sources?.coinbase_usd);
  const usdZmw = Number(sources?.usd_zmw);
  if (!(btcUsd > 0) || !(usdZmw > 0)) return null;
  if (!Number.isFinite(btcUsd) || !Number.isFinite(usdZmw)) return null;
  return { btcUsd, usdZmw };
}

/** The latest fresh BTC snapshot's quote rates, or null when there
 *  is no usable one (no rows yet, every row flagged stale, the newest
 *  older than the stale bound, or unusable source values). A failed
 *  read also resolves null — the caller's live fallback is the
 *  fail-over, and only its failure is fatal to the quote. The client
 *  is injected (this module stays import-free); `now` is injectable
 *  for tests. */
export async function fetchSnapshotQuoteRates(
  // deno-lint-ignore no-explicit-any
  admin: any,
  now: Date = new Date(),
): Promise<QuoteRates | null> {
  try {
    const { data: settings } = await admin
      .from("platform_settings")
      .select("p2p_price_stale_minutes")
      .limit(1)
      .maybeSingle();
    const configured = Number(settings?.p2p_price_stale_minutes);
    const staleMinutes =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_PRICE_STALE_MINUTES;
    const cutoff = new Date(
      now.getTime() - staleMinutes * 60_000,
    ).toISOString();
    const { data } = await admin
      .from("p2p_price_snapshots")
      .select("sources, created_at")
      .eq("asset", "BTC")
      .eq("is_stale", false)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? snapshotQuoteRates(data) : null;
  } catch {
    return null;
  }
}

/** Resolve the rates a BTC trade quote prices from: the on-platform
 *  snapshot while fresh, otherwise the caller's live fetchers (run
 *  in parallel, as the live path always did). Propagates the live
 *  fetchers' failure — with no snapshot and no live price there is
 *  no honest quote, and the caller turns the throw into its designed
 *  refusal. */
export async function resolveQuoteRates(
  // deno-lint-ignore no-explicit-any
  admin: any,
  live: {
    fetchBtcUsd: () => Promise<number>;
    fetchUsdZmw: () => Promise<number>;
  },
): Promise<QuoteRates> {
  const snapshot = await fetchSnapshotQuoteRates(admin);
  if (snapshot) return snapshot;
  const [btcUsd, usdZmw] = await Promise.all([
    live.fetchBtcUsd(),
    live.fetchUsdZmw(),
  ]);
  return { btcUsd, usdZmw };
}
