// price-index: the shared BTC price index for P2P (scope §2.2).
//
// Generalises btc-trade's proven method: BTC/USD from Coinbase,
// cross-checked against Kraken; USD/ZMW from the platform's
// exchange_rates table (the caller reads it — this module stays free
// of any Supabase import so it is unit-testable under vitest), with
// the same public fallback source fetch-exchange-rates uses.
//
// The one deliberate difference from btc-trade: a quote REFUSES on
// >3% divergence because it is about to settle; a snapshot cache
// instead records the snapshot with is_stale = true (§2.2: "index
// marked stale — order creation refuses"). The Phase 1a RPCs enforce
// staleness twice over — this flag, and snapshot age against
// platform_settings.p2p_price_stale_minutes — so a total feed outage
// also goes stale on its own simply because no fresh row lands.

export const PRICE_DIVERGENCE_LIMIT = 0.03;

export interface BtcIndex {
  /** Coinbase BTC/USD — the primary source, as in btc-trade. */
  coinbaseUsd: number;
  /** Kraken BTC/USD — the cross-check. */
  krakenUsd: number;
  /** USD/ZMW rate the ZMW figure was computed with. */
  usdZmw: number;
  /** |coinbase − kraken| / coinbase. */
  divergence: number;
  /** True when the sources diverge beyond PRICE_DIVERGENCE_LIMIT. */
  isStale: boolean;
  /** index_usd × usd_zmw, rounded to 2dp like btc-trade's mid rate. */
  indexZmw: number;
}

/** Combine the three source values into an index. Pure. Throws on
 *  non-positive inputs — a zero/NaN price must never become a
 *  snapshot the marketplace prices against. */
export function computeBtcIndex(
  coinbaseUsd: number,
  krakenUsd: number,
  usdZmw: number,
): BtcIndex {
  if (!(coinbaseUsd > 0) || !(krakenUsd > 0) || !(usdZmw > 0)) {
    throw new Error("Price source returned no usable price");
  }
  const divergence = Math.abs(coinbaseUsd - krakenUsd) / coinbaseUsd;
  return {
    coinbaseUsd,
    krakenUsd,
    usdZmw,
    divergence,
    isStale: divergence > PRICE_DIVERGENCE_LIMIT,
    indexZmw: Math.round(coinbaseUsd * usdZmw * 100) / 100,
  };
}

/** The FX leg gets its own sanity band (delta-audit E5). The BTC leg
 *  is cross-checked between two exchanges (3% above); USD/ZMW used to
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
 *  object, so its shape is part of the audit record. */export function buildSnapshotInsert(index: BtcIndex): {
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

/** Fetch BTC/USD from both exchanges. Mirrors btc-trade's endpoints
 *  and parsing exactly. Throws if either source fails or returns no
 *  price; divergence is computeBtcIndex's judgement, not this one's. */
export async function fetchBtcUsdPrices(
  fetchFn: FetchFn = fetch,
): Promise<{ coinbaseUsd: number; krakenUsd: number }> {
  const [coinbase, kraken] = await Promise.all([
    fetchJson("https://api.coinbase.com/v2/prices/BTC-USD/spot", fetchFn),
    fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", fetchFn),
  ]);
  const coinbaseUsd = Number.parseFloat(coinbase?.data?.amount);
  const krakenUsd = Number.parseFloat(kraken?.result?.XXBTZUSD?.c?.[0]);
  if (!(coinbaseUsd > 0) || !(krakenUsd > 0)) {
    throw new Error("Price source returned no BTC/USD price");
  }
  return { coinbaseUsd, krakenUsd };
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
// on-platform (p2p_price_snapshots, written from the same Coinbase +
// Kraken cross-check and the same USD/ZMW leg btc-trade used to fetch
// live on every quote). A trade quote therefore reads the latest
// snapshot while it is fresh — fresh in exactly the sense the rest of
// the platform already uses: the row is not flagged stale and its age
// is within platform_settings.p2p_price_stale_minutes (default 5 —
// the POS bridge's latestBtcIndexZmw applies the same bound to the
// same table). Only when no fresh snapshot exists does the caller
// fall back to its live fetchers; if those fail too, resolution
// throws and the caller refuses the quote — a rate is never invented.

/** Fallback for p2p_price_stale_minutes when the settings row has no
 *  usable value: the column default (20261023_p2p_phase1a_core.sql)
 *  and the POS bridge's DEFAULT_STALE_MINUTES. */
export const DEFAULT_PRICE_STALE_MINUTES = 5;

export interface QuoteRates {
  /** BTC/USD — the Coinbase figure, as in btc-trade's live path. */
  btcUsd: number;
  /** USD/ZMW the quote prices with. */
  usdZmw: number;
}

/** The BTC/USD + USD/ZMW pair a quote needs, taken from a
 *  p2p_price_snapshots row's sources (the coinbase_usd / usd_zmw keys
 *  buildSnapshotInsert writes). The product coinbase_usd × usd_zmw
 *  is the same mid rate the live path computes from the same sources
 *  — identical operands, ≤60 s older. Returns null when either leg
 *  is missing or unusable: a partial snapshot must never become a
 *  price. Pure. */
export function snapshotQuoteRates(
  row: { sources?: unknown } | null | undefined,
): QuoteRates | null {
  const sources = row?.sources as
    | { coinbase_usd?: unknown; usd_zmw?: unknown }
    | null
    | undefined;
  const btcUsd = Number(sources?.coinbase_usd);
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
