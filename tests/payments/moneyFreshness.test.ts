// Balance/activity freshness after money actions (live QA defect,
// 2026-10-22): after a Send Money, the Transfer page header kept the
// pre-send balance, and after a Transfer the Wallet page kept the old
// balance and missed the new activity row, while the Dashboard (30s
// staleTime + realtime) was correct. Root cause: the app QueryClient
// serves a 5-minute staleTime, and the direct-invoke money flows never
// invalidated the wallet/transaction caches.
//
// The fix is centralised in src/utils/moneyFreshness.ts:
//  - invalidateMoneyState() invalidates every balance/activity query
//    root and force-refetches the mounted ones;
//  - the core money queries use MONEY_QUERY_STALE_TIME (0) so a
//    balance surface refetches on mount/focus instead of rendering a
//    value cached by an earlier screen;
//  - every live money flow calls the helper on success.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MONEY_QUERY_KEY_ROOTS,
  MONEY_QUERY_STALE_TIME,
  invalidateMoneyState,
} from "../../src/utils/moneyFreshness";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const fakeQueryClient = () => {
  const invalidated: string[][] = [];
  const refetched: { queryKey: string[]; type?: string }[] = [];
  return {
    invalidated,
    refetched,
    invalidateQueries: (opts: { queryKey: string[] }) => {
      invalidated.push(opts.queryKey);
    },
    refetchQueries: (opts: { queryKey: string[]; type?: string }) => {
      refetched.push(opts);
    },
  };
};

describe("invalidateMoneyState", () => {
  it("invalidates every balance/activity query root", () => {
    const qc = fakeQueryClient();
    invalidateMoneyState(qc as never);
    for (const root of MONEY_QUERY_KEY_ROOTS) {
      expect(qc.invalidated).toContainEqual([root]);
    }
    // The roots that carry what users actually look at after acting.
    for (const root of ["wallet", "multi-wallets", "accounts", "transactions", "recent-transactions"]) {
      expect(MONEY_QUERY_KEY_ROOTS).toContain(root);
    }
  });

  it("force-refetches the mounted balance/activity queries", () => {
    const qc = fakeQueryClient();
    invalidateMoneyState(qc as never);
    for (const root of ["wallet", "multi-wallets", "transactions", "recent-transactions"]) {
      expect(qc.refetched).toContainEqual({ queryKey: [root], type: "active" });
    }
  });

  it("money queries never treat a cached value as fresh", () => {
    expect(MONEY_QUERY_STALE_TIME).toBe(0);
  });
});

describe("core money queries refetch on mount/focus", () => {
  it.each([
    ["useWallet", "../../src/hooks/useWallet.ts"],
    ["useMultiCurrency", "../../src/hooks/useMultiCurrency.ts"],
    ["useAccounts", "../../src/hooks/useAccounts.ts"],
    ["useTransactions", "../../src/hooks/useTransactions.ts"],
  ])("%s uses the shared money stale time", (_name, rel) => {
    const src = read(rel);
    expect(src).toContain("MONEY_QUERY_STALE_TIME");
    expect(src).toContain("staleTime: MONEY_QUERY_STALE_TIME");
    expect(src).toContain("refetchOnWindowFocus: true");
  });
});

describe("money flows refresh shared money state on success", () => {
  it.each([
    ["Send Money", "../../src/pages/SendMoney.tsx", "invalidateMoney();"],
    ["Transfer form", "../../src/components/TransferForm.tsx", "invalidateMoney();"],
    ["QR pay", "../../src/pages/QrPayments.tsx", "invalidateMoney();"],
    ["Payment-link checkout", "../../src/pages/PublicCheckout.tsx", "invalidateMoney();"],
    ["Currency conversion", "../../src/hooks/useMultiCurrency.ts", "invalidateMoneyState(qc)"],
    ["PayPal deposit return", "../../src/hooks/usePayPalDepositReturn.ts", "invalidateMoneyState(queryClient)"],
    ["PayPal checkout return", "../../src/hooks/usePayPalCheckoutReturn.ts", "invalidateMoneyState(queryClient)"],
    ["PayPal withdrawal", "../../src/components/wallet/PayPalWithdraw.tsx", "invalidateMoneyState(queryClient)"],
    ["Wallet deposits/card funding", "../../src/hooks/useWallet.ts", "invalidateMoneyState(queryClient)"],
    ["Savings moves", "../../src/hooks/useSavings.ts", "invalidateMoneyState(queryClient)"],
  ])("%s calls the shared freshness helper", (_name, rel, needle) => {
    expect(read(rel)).toContain(needle);
  });

  it("Bitcoin trade and on-chain send both refresh money state", () => {
    const src = read("../../src/pages/BitcoinWallet.tsx");
    expect(src.match(/invalidateMoney\(\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("QR pay also reloads its own local history list", () => {
    const src = read("../../src/pages/QrPayments.tsx");
    expect(src).toContain("setHistoryVersion(v => v + 1)");
  });

  it("account money changes delegate to the shared helper", () => {
    const src = read("../../src/hooks/useAccounts.ts");
    expect(src).toContain("invalidateMoneyState(qc)");
  });
});
