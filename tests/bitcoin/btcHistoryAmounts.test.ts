// Pre-launch sweep 2026-11-05, Defect 1: BTC history rows rendered
// "+0 sats" / "$0.00" for real movements because renderers read only
// the numeric(12,2) amount column (0.001 BTC rounds to 0.00). The true
// amount lives in metadata.sats, written by every BTC writer since
// migration 20261253. These tests pin the resolver + the render sites.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { btcRowSats, formatSatsAmount, formatBtcRowAmount, friendlyTxStatus } from "../../src/lib/btcHistory";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

describe("btcRowSats", () => {
  it("prefers metadata.sats over the rounded amount column", () => {
    expect(btcRowSats({ currency: "BTC", amount: 0, metadata: { sats: 100000 } })).toBe(100000);
    expect(btcRowSats({ currency: "BTC", amount: "0.00", metadata: { sats: 7500 } })).toBe(7500);
  });

  it("accepts a numeric-string sats value", () => {
    expect(btcRowSats({ currency: "BTC", amount: 0, metadata: { sats: "1490" } })).toBe(1490);
  });

  it("falls back to amount x 1e8 for legacy rows without metadata", () => {
    expect(btcRowSats({ currency: "BTC", amount: 0.5, metadata: null })).toBe(50_000_000);
    expect(btcRowSats({ currency: "BTC", amount: 0, metadata: null })).toBe(0);
  });

  it("returns null for non-BTC rows", () => {
    expect(btcRowSats({ currency: "ZMW", amount: 25, metadata: { sats: 5 } })).toBeNull();
    expect(btcRowSats({ currency: "USD", amount: 5 })).toBeNull();
  });
});

describe("formatting", () => {
  it("formats sats with thousands separators", () => {
    expect(formatSatsAmount(100000)).toBe("100,000 sats");
    expect(formatSatsAmount(39)).toBe("39 sats");
  });

  it("formats a BTC row by its true sats, never 0.00", () => {
    expect(formatBtcRowAmount({ currency: "BTC", amount: 0, metadata: { sats: 100000 } })).toBe("100,000 sats");
    expect(formatBtcRowAmount({ currency: "BTC", amount: 0.001, metadata: { sats: 100000 } })).toBe("100,000 sats");
  });
});

describe("friendlyTxStatus", () => {
  it("never shows raw snake_case", () => {
    expect(friendlyTxStatus("awaiting_rebalance")).toBe("Being prepared");
    expect(friendlyTxStatus("completed")).toBe("Completed");
    expect(friendlyTxStatus("some_new_state")).toBe("Some new state");
  });
});

describe("render sites resolve BTC amounts from metadata.sats", () => {
  it("BitcoinWallet recent activity uses the shared resolver + status labels", () => {
    const src = read("src/pages/BitcoinWallet.tsx");
    expect(src).toContain("formatBtcRowAmount");
    expect(src).toContain("friendlyTxStatus");
  });

  it("TransactionList fetches metadata and renders BTC rows in sats", () => {
    const src = read("src/pages/TransactionList.tsx");
    expect(src).toContain("metadata");
    expect(src).toContain("btcRowSats");
  });

  it("Transactions page list renders BTC rows in sats", () => {
    const src = read("src/components/wallet/OptimizedTransactionList.tsx");
    expect(src).toContain("btcRowSats");
    expect(src).toContain("formatSatsAmount");
  });

  it("Dashboard recent activity fetches metadata and renders BTC rows in sats", () => {
    const hook = read("src/hooks/useDashboardData.ts");
    expect(hook).toContain("metadata");
    const page = read("src/pages/Dashboard.tsx");
    expect(page).toContain("formatBtcRowAmount");
  });
});
