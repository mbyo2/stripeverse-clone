// Unit tests for src/utils/accountGrouping.ts — the pure helper that splits
// a user's wallets into Main (account_id NULL) and per-sub-account groups
// for the Sub-accounts page, the header switcher and the Dashboard card.

import { describe, it, expect } from "vitest";
import {
  groupWalletsByAccount,
  totalZmwAcrossGroups,
  type AccountRow,
  type WalletRow,
} from "../../src/utils/accountGrouping";

const account = (over: Partial<AccountRow>): AccountRow => ({
  closed_at: null,
  created_at: "2026-10-21T00:00:00Z",
  id: "acc-1",
  kind: "business",
  metadata: {},
  name: "Shop Takings",
  status: "active",
  user_id: "user-1",
  ...over,
});

const wallet = (over: Partial<WalletRow>): WalletRow => ({
  account_id: null,
  balance: 0,
  created_at: "2026-10-21T00:00:00Z",
  currency: "ZMW",
  id: "wal-1",
  status: "active",
  updated_at: "2026-10-21T00:00:00Z",
  user_id: "user-1",
  ...over,
});

describe("groupWalletsByAccount", () => {
  it("puts wallets with account_id NULL in the Main group, first", () => {
    const groups = groupWalletsByAccount(
      [wallet({ id: "w-main-zmw" }), wallet({ id: "w-main-usd", currency: "USD" })],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].isMain).toBe(true);
    expect(groups[0].accountId).toBeNull();
    expect(groups[0].name).toBe("Main account");
    expect(groups[0].wallets.map((w) => w.id)).toEqual(["w-main-zmw", "w-main-usd"]);
  });

  it("groups sub-account wallets under their account, after Main", () => {
    const acc = account({ id: "acc-1", name: "Shop Takings" });
    const groups = groupWalletsByAccount(
      [
        wallet({ id: "w-sub", account_id: "acc-1" }),
        wallet({ id: "w-main", account_id: null }),
      ],
      [acc],
    );
    expect(groups.map((g) => g.name)).toEqual(["Main account", "Shop Takings"]);
    expect(groups[0].wallets.map((w) => w.id)).toEqual(["w-main"]);
    expect(groups[1].wallets.map((w) => w.id)).toEqual(["w-sub"]);
    expect(groups[1].account).toEqual(acc);
    expect(groups[1].isMain).toBe(false);
  });

  it("keeps an (empty) group for accounts that hold no wallets yet", () => {
    const groups = groupWalletsByAccount([], [account({ id: "acc-9", name: "Savings" })]);
    expect(groups).toHaveLength(2);
    expect(groups[1].name).toBe("Savings");
    expect(groups[1].wallets).toEqual([]);
    expect(groups[1].totalZMW).toBe(0);
  });

  it("sums ZMW and per-currency totals per group", () => {
    const acc = account({ id: "acc-1" });
    const groups = groupWalletsByAccount(
      [
        wallet({ id: "a", currency: "ZMW", balance: 150.5 }),
        wallet({ id: "b", currency: "USD", balance: 20 }),
        wallet({ id: "c", account_id: "acc-1", currency: "ZMW", balance: 49.5 }),
        wallet({ id: "d", account_id: "acc-1", currency: "ZMW", balance: 0 }),
        wallet({ id: "e", account_id: "acc-1", currency: "GBP", balance: 7 }),
      ],
      [acc],
    );
    expect(groups[0].totalZMW).toBeCloseTo(150.5);
    expect(groups[0].totalByCurrency).toEqual({ ZMW: 150.5, USD: 20 });
    expect(groups[1].totalZMW).toBeCloseTo(49.5);
    expect(groups[1].totalByCurrency).toEqual({ ZMW: 49.5, GBP: 7 });
  });

  it("totalZmwAcrossGroups sums every group's ZMW", () => {
    const acc = account({ id: "acc-1" });
    const groups = groupWalletsByAccount(
      [
        wallet({ id: "a", balance: 100 }),
        wallet({ id: "b", account_id: "acc-1", balance: 250 }),
        wallet({ id: "c", account_id: "acc-1", currency: "USD", balance: 999 }),
      ],
      [acc],
    );
    expect(totalZmwAcrossGroups(groups)).toBe(350);
  });

  it("keeps orphan wallets (unknown account_id) in a trailing group so totals stay correct", () => {
    const groups = groupWalletsByAccount(
      [wallet({ id: "orphan", account_id: "acc-missing", balance: 42 })],
      [],
    );
    expect(groups).toHaveLength(2);
    expect(groups[1].accountId).toBe("acc-missing");
    expect(groups[1].totalZMW).toBe(42);
    expect(totalZmwAcrossGroups(groups)).toBe(42);
  });

  it("handles no wallets and no accounts", () => {
    const groups = groupWalletsByAccount([], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].isMain).toBe(true);
    expect(groups[0].totalZMW).toBe(0);
  });
});
