// Client-side mirror of the exchange-rate resolution that
// public.execute_currency_conversion (migration
// 20261021_internal_money_fixes.sql) performs server-side, so the
// Convert UI offers exactly the conversions the RPC will accept —
// no more, no fewer.
//
// The RPC's rules:
//   - Consider only rows inside their validity window:
//     valid_from <= now AND (valid_until IS NULL OR valid_until >= now).
//     A NULL valid_until is an open-ended rate and IS live — the old
//     UI query filtered with `valid_until >= now`, which silently
//     discarded every open-ended row, so pairs the RPC would happily
//     convert were refused in the UI as "no live rate".
//   - Among a pair's live rows, the LATEST valid_from wins.
//   - Direct pair first; if none, the inverse of the reverse pair
//     (1 / rate). Same-currency pairs are 1.
//
// The server remains the authority: it re-reads the rate itself and
// refuses if it has moved more than 2% from the rate resolved here.

export interface ExchangeRateRow {
  from_currency: string;
  to_currency: string;
  rate: number | string;
  valid_from: string;
  valid_until: string | null;
}

/** True when the row is inside its validity window at `now`. */
export function isRateLive(row: ExchangeRateRow, now: Date): boolean {
  const from = new Date(row.valid_from).getTime();
  if (Number.isNaN(from) || from > now.getTime()) return false;
  if (row.valid_until == null) return true;
  const until = new Date(row.valid_until).getTime();
  return !Number.isNaN(until) && until >= now.getTime();
}

/**
 * The rate for converting `from` → `to`, or null when no live rate
 * exists (the RPC would refuse the conversion too).
 */
export function resolveExchangeRate(
  rows: ExchangeRateRow[] | null | undefined,
  from: string,
  to: string,
  now: Date = new Date(),
): number | null {
  if (from === to) return 1;
  if (!rows?.length) return null;

  const live = rows
    .filter((r) => isRateLive(r, now))
    .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime());

  const direct = live.find((r) => r.from_currency === from && r.to_currency === to);
  if (direct) {
    const rate = Number(direct.rate);
    return Number.isFinite(rate) && rate !== 0 ? rate : null;
  }

  const inverse = live.find((r) => r.from_currency === to && r.to_currency === from);
  if (inverse) {
    const rate = Number(inverse.rate);
    if (Number.isFinite(rate) && rate !== 0) return 1 / rate;
  }

  return null;
}
