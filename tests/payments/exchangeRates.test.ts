// Unit tests for src/utils/exchangeRates.ts — the client-side mirror
// of execute_currency_conversion's rate resolution. The regression
// being pinned: open-ended rates (valid_until IS NULL) are LIVE for
// the RPC but were discarded by the old UI query, so the Convert
// dialog refused pairs the server would have accepted.

import { describe, it, expect } from "vitest";
import {
  resolveExchangeRate,
  isRateLive,
  type ExchangeRateRow,
} from "../../src/utils/exchangeRates";

const NOW = new Date("2026-10-22T10:00:00.000Z");

const row = (over: Partial<ExchangeRateRow>): ExchangeRateRow => ({
  from_currency: "USD",
  to_currency: "ZMW",
  rate: 25,
  valid_from: "2026-10-01T00:00:00.000Z",
  valid_until: null,
  ...over,
});

describe("isRateLive", () => {
  it("treats an open-ended rate (valid_until NULL) as live", () => {
    expect(isRateLive(row({}), NOW)).toBe(true);
  });

  it("treats a not-yet-valid rate as not live", () => {
    expect(isRateLive(row({ valid_from: "2026-11-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("treats an expired rate as not live", () => {
    expect(isRateLive(row({ valid_until: "2026-10-21T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("treats a rate expiring exactly now as live", () => {
    expect(isRateLive(row({ valid_until: NOW.toISOString() }), NOW)).toBe(true);
  });
});

describe("resolveExchangeRate", () => {
  it("returns the direct rate", () => {
    expect(resolveExchangeRate([row({})], "USD", "ZMW", NOW)).toBe(25);
  });

  it("resolves ZMW → USD from the inverse of USD → ZMW (the QA case)", () => {
    expect(resolveExchangeRate([row({})], "ZMW", "USD", NOW)).toBeCloseTo(1 / 25);
  });

  it("prefers the latest valid_from among live rows for a pair", () => {
    const rows = [
      row({ rate: 20, valid_from: "2026-09-01T00:00:00.000Z" }),
      row({ rate: 26, valid_from: "2026-10-15T00:00:00.000Z" }),
    ];
    expect(resolveExchangeRate(rows, "USD", "ZMW", NOW)).toBe(26);
  });

  it("ignores expired rows even when they are the newest", () => {
    const rows = [
      row({ rate: 20, valid_from: "2026-09-01T00:00:00.000Z" }),
      row({ rate: 26, valid_from: "2026-10-15T00:00:00.000Z", valid_until: "2026-10-20T00:00:00.000Z" }),
    ];
    expect(resolveExchangeRate(rows, "USD", "ZMW", NOW)).toBe(20);
  });

  it("returns null when no live rate exists in either direction", () => {
    expect(resolveExchangeRate([row({ valid_until: "2026-01-01T00:00:00.000Z" })], "USD", "ZMW", NOW)).toBeNull();
    expect(resolveExchangeRate([], "USD", "ZMW", NOW)).toBeNull();
    expect(resolveExchangeRate(null, "USD", "ZMW", NOW)).toBeNull();
  });

  it("returns 1 for a same-currency pair", () => {
    expect(resolveExchangeRate([], "ZMW", "ZMW", NOW)).toBe(1);
  });
});
