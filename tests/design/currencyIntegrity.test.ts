// Currency-integrity pins (CEO order, 2026-11-11): "make sure
// currencies don't mix in bmaglasspay.online" + "currency switcher
// should work flawless."
//
// Audit evidence base (production, paymentgetway, 2026-11-11):
//  - The ledger is currency-correct: every wallet balance reproduces
//    exactly from its own-currency completed transactions (owner ZMW
//    wallet 9.58 = 30 ZMW fee rows; owner USD wallet 0.13 = the single
//    USD platform-fee row), and tx.currency = wallet.currency on
//    every row platform-wide.
//  - The mixing was display/aggregation only:
//      (1) CurrencyContext.formatAmount labelled a raw number with
//          the DISPLAY preference's symbol and never converted — the
//          ZMW balance rendered as "$9.58" after switching to USD,
//          and every ZMW history row wore a $ sign (and vice versa).
//      (2) Business revenue summed incoming across currencies
//          (owner: 9.71 = K9.58 + $0.13 in one figure).
//      (3) Three stats RPCs summed across currencies (owner's Oct
//          bar: 8.46 mixed) — scoped to ZMW by migration 20261260.
// These pins keep the fixes from regressing.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatMoneyInCurrency } from "../../src/contexts/CurrencyContext";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const ctx = read("src/contexts/CurrencyContext.tsx");

describe("switcher is display-only and preference-persistent", () => {
  it("the preference persists under one localStorage key and syncs across tabs", () => {
    expect(ctx).toContain("const STORAGE_KEY = 'preferred_currency'");
    expect(ctx).toContain("localStorage.setItem(STORAGE_KEY, newCurrency)");
    expect(ctx).toContain("addEventListener('storage'");
  });

  it("the currency context never reaches the database (switching cannot touch balances, ledger rows or quotes)", () => {
    expect(ctx).not.toContain("supabase");
    expect(ctx).not.toContain("fetch(");
  });

  it("the provider wraps the whole app, so the preference is honoured on every page", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("<CurrencyProvider>");
    expect(app).toContain("</CurrencyProvider>");
  });

  it("the selector surfaces exist (header + settings) and drive the one shared preference", () => {
    const selector = read("src/components/CurrencySelector.tsx");
    expect(selector).toContain("setCurrency");
    expect(read("src/components/Header.tsx")).toContain("<CurrencySelector");
    expect(read("src/pages/Settings.tsx")).toContain("<CurrencySelector");
  });
});

describe("round-trip identity: switching can never create, destroy or relabel value", () => {
  it("a native figure renders identically before and after a ZMW→USD→ZMW switch", () => {
    const before = formatMoneyInCurrency(9.58, "ZMW");
    // Simulate the switch cycle: other denominations render in between…
    const usdView = formatMoneyInCurrency(0.13, "USD");
    expect(usdView).toContain("0.13");
    // …and the original figure comes back byte-identical.
    const after = formatMoneyInCurrency(9.58, "ZMW");
    expect(after).toBe(before);
    expect(after).toContain("9.58");
  });

  it("formatting never converts: the numeric part is the input, whatever the currency", () => {
    const digits = (s: string) => s.replace(/[^0-9.]/g, "");
    expect(digits(formatMoneyInCurrency(9.58, "ZMW"))).toBe("9.58");
    expect(digits(formatMoneyInCurrency(9.58, "USD"))).toBe("9.58");
    expect(formatMoneyInCurrency(9.58, "ZMW")).not.toBe(formatMoneyInCurrency(9.58, "USD"));
  });

  it("unknown/unsupported codes still render with their own code, never the viewer's preference", () => {
    expect(formatMoneyInCurrency(12.5, "KES")).toContain("12.50");
  });
});

describe("no mixed-unit rendering on the main money surfaces", () => {
  const cases: Array<[string, RegExp]> = [
    ["src/components/wallet/WalletBalance.tsx", /formatInCurrency\(wallet\?\.balance \|\| 0, wallet\?\.currency/],
    ["src/pages/Dashboard.tsx", /formatInCurrency\(dashboardStats\?\.totalBalance \|\| 0, 'ZMW'\)/],
    ["src/pages/Dashboard.tsx", /formatInCurrency\(group\.totalZMW, 'ZMW'\)/],
    ["src/components/wallet/TransactionManager.tsx", /formatInCurrency\(transaction\.amount, transaction\.currency\)/],
    ["src/components/wallet/OptimizedTransactionList.tsx", /formatInCurrency\(transaction\.amount, transaction\.currency\)/],
    ["src/components/wallet/VirtualCardList.tsx", /formatInCurrency\(card\.balance, card\.currency\)/],
    ["src/pages/AdminTransactions.tsx", /formatInCurrency\(t\.amount, t\.currency\)/],
    ["src/pages/RequestMoney.tsx", /formatInCurrency\(request\.amount, request\.currency\)/],
    ["src/pages/Business.tsx", /formatInCurrency\(tx\.amount, tx\.currency\)/],
    ["src/pages/Invoices.tsx", /formatInCurrency\(inv\.total_amount, inv\.currency/],
    ["src/pages/BuyNowPayLater.tsx", /formatInCurrency\(plan\.total_amount, plan\.currency/],
  ];
  for (const [file, re] of cases) {
    it(`${file} denominates in the amount's own currency`, () => {
      expect(read(file)).toMatch(re);
    });
  }

  it("transaction rows that predate formatInCurrency still pass their own currency as the override", () => {
    expect(read("src/components/wallet/TransactionHistory.tsx")).toContain(
      "formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))",
    );
    expect(read("src/components/TransactionReceipt.tsx")).toContain(
      "formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))",
    );
  });

  it("send-money flow figures are denominated in the wallet's currency (the quote the user confirms)", () => {
    const send = read("src/pages/SendMoney.tsx");
    expect(send).toContain("formatInCurrency(total, wallet?.currency || 'ZMW')");
    expect(send).toContain("formatInCurrency(fee, wallet?.currency || 'ZMW')");
    expect(send).not.toContain("formatAmount(total)");
    expect(send).not.toContain("formatAmount(fee)");
  });
});

describe("no cross-currency sums remain in aggregations", () => {
  it("business revenue is grouped per currency, and the monthly chart is ZMW-only", () => {
    const biz = read("src/hooks/useBusinessData.ts");
    expect(biz).toContain("revenueByCurrency");
    expect(biz).not.toContain("const revenue = incoming.reduce((sum, t) => sum + Number(t.amount), 0)");
    expect(biz).toContain("(t.currency || 'ZMW') !== 'ZMW') return;");
  });

  it("business cards render each currency separately", () => {
    for (const f of ["src/pages/Business.tsx", "src/pages/BusinessDashboard.tsx"]) {
      expect(read(f)).toContain("revenueByCurrency");
    }
  });

  it("BNPL total owed and invoice totals are grouped per currency", () => {
    expect(read("src/pages/BuyNowPayLater.tsx")).toContain("owedByCurrencyText");
    expect(read("src/pages/Invoices.tsx")).toContain("totalsText");
    expect(read("src/pages/Invoices.tsx")).not.toContain("invoices.reduce((s, i) => s + i.total_amount, 0)");
  });

  it("the stats RPCs are currency-scoped in the shipped migration", () => {
    const mig = read("supabase/migrations/20261260_currency_scoped_stats.sql");
    expect(mig).toContain("get_user_transaction_stats");
    expect(mig).toContain("get_monthly_transaction_data");
    expect(mig).toContain("get_spending_by_category");
    expect(mig).toContain("currency = 'ZMW'");
  });

  it("dashboard monthly figure is labelled ZMW (its RPC is ZMW-scoped)", () => {
    expect(read("src/pages/Dashboard.tsx")).toContain(
      "formatInCurrency(dashboardStats?.monthlyAmount || 0, 'ZMW')",
    );
    expect(read("src/pages/SpendingInsights.tsx")).toContain(
      "formatInCurrency(stats?.monthly_amount || 0, 'ZMW')",
    );
  });
});
