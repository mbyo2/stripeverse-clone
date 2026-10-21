// Unit tests for src/utils/paymentLinkSettlement.ts — the client-side
// mirror of the payment-link settlement rules (Phase 1.5): which
// account a link settles into, what amount a payment must be, and which
// payments may proceed to the (authoritative) server settlement.

import { describe, it, expect } from "vitest";
import {
  settlementTargetLabel,
  resolveLinkAmount,
  validateLinkPayment,
  selectableSettlementAccounts,
  type PaymentLinkLike,
} from "../../src/utils/paymentLinkSettlement";

const link = (over: Partial<PaymentLinkLike>): PaymentLinkLike => ({
  amount: null,
  currency: "ZMW",
  user_id: "owner-1",
  account_id: null,
  ...over,
});

describe("settlementTargetLabel", () => {
  it("labels a NULL account_id as the Main account", () => {
    expect(settlementTargetLabel(null, [])).toBe("Main account");
    expect(settlementTargetLabel(undefined, [])).toBe("Main account");
  });

  it("uses the account's name when the account row is known", () => {
    const accounts = [{ id: "acc-1", name: "Shop Takings" }];
    expect(settlementTargetLabel("acc-1", accounts)).toBe("Shop Takings");
  });

  it("falls back without inventing a name for an unknown account", () => {
    expect(settlementTargetLabel("acc-gone", [])).toBe("Sub-account");
  });
});

describe("resolveLinkAmount", () => {
  it("lets the link's fixed amount win over anything entered", () => {
    expect(resolveLinkAmount(link({ amount: 150 }), "999")).toBe(150);
    expect(resolveLinkAmount(link({ amount: 150 }), "")).toBe(150);
  });

  it("parses a payer-entered amount for open links", () => {
    expect(resolveLinkAmount(link({}), "250")).toBe(250);
    expect(resolveLinkAmount(link({}), 75.5)).toBe(75.5);
  });

  it("rejects empty, non-numeric, zero and negative amounts", () => {
    expect(resolveLinkAmount(link({}), "")).toBeNull();
    expect(resolveLinkAmount(link({}), "abc")).toBeNull();
    expect(resolveLinkAmount(link({}), "0")).toBeNull();
    expect(resolveLinkAmount(link({}), -5)).toBeNull();
    expect(resolveLinkAmount(link({}), null)).toBeNull();
    expect(resolveLinkAmount(link({ amount: 0 }), "10")).toBeNull();
  });
});

describe("validateLinkPayment", () => {
  it("accepts a signed-in wallet payment of the right amount", () => {
    expect(
      validateLinkPayment({ link: link({}), amount: 100, method: "wallet", payerId: "payer-9" }),
    ).toBeNull();
  });

  it("rejects a missing or invalid amount for every method", () => {
    expect(
      validateLinkPayment({ link: link({}), amount: null, method: "card", payerId: null }),
    ).toMatch(/valid amount/i);
    expect(
      validateLinkPayment({ link: link({}), amount: 0, method: "wallet", payerId: "payer-9" }),
    ).toMatch(/valid amount/i);
  });

  it("enforces the exact amount on fixed-amount links", () => {
    const err = validateLinkPayment({
      link: link({ amount: 200 }), amount: 150, method: "wallet", payerId: "payer-9",
    });
    expect(err).toMatch(/exactly ZMW 200\.00/);
  });

  it("requires sign-in for wallet payments", () => {
    expect(
      validateLinkPayment({ link: link({}), amount: 100, method: "wallet", payerId: null }),
    ).toMatch(/sign in/i);
  });

  it("blocks the owner from paying their own link", () => {
    expect(
      validateLinkPayment({ link: link({}), amount: 100, method: "wallet", payerId: "owner-1" }),
    ).toMatch(/own payment link/i);
  });

  it("lets guests proceed with external methods (the server answers honestly)", () => {
    expect(
      validateLinkPayment({ link: link({}), amount: 100, method: "card", payerId: null }),
    ).toBeNull();
    expect(
      validateLinkPayment({ link: link({}), amount: 100, method: "mobile_money", payerId: null }),
    ).toBeNull();
  });
});

describe("selectableSettlementAccounts", () => {
  it("excludes closed accounts but keeps active and frozen ones", () => {
    const accounts = [
      { id: "a", status: "active" },
      { id: "b", status: "frozen" },
      { id: "c", status: "closed" },
    ];
    expect(selectableSettlementAccounts(accounts).map((a) => a.id)).toEqual(["a", "b"]);
  });
});
