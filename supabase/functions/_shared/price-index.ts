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

/** The p2p_price_snapshots row for an index. The sources JSONB keeps
 *  the exact key names the Phase 1a proof fixtures established
 *  (coinbase_usd / kraken_usd / usd_zmw) — order snapshots copy this
 *  object, so its shape is part of the audit record. */
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
