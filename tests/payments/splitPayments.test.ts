// Unit tests for src/utils/splitPayments.ts — the client-side mirror of
// the split-execution arithmetic implemented authoritatively in SQL by
// supabase/migrations/20261022_split_payments_execution.sql and
// 20261022_split_platform_fee.sql. These pin the leg math: the platform
// fee (2.5% at launch) comes off the payment first, percentage shares
// are of the original amount rounded to 2dp, flat legs are as
// configured, every leg is capped at the remainder, and fee + legs +
// owner always equals the payment exactly.

import { describe, it, expect } from "vitest";
import {
  computeSplitLegs,
  computePlatformFee,
  computeSplitPreview,
  committedPercentage,
  splitRulesWarning,
  roundMoney,
  type SplitRuleLike,
} from "../../src/utils/splitPayments";

const pct = (id: string, split_value: number, extra?: Partial<SplitRuleLike>): SplitRuleLike => ({
  id,
  split_type: "percentage",
  split_value,
  ...extra,
});
const flat = (id: string, split_value: number, extra?: Partial<SplitRuleLike>): SplitRuleLike => ({
  id,
  split_type: "flat",
  split_value,
  ...extra,
});

describe("roundMoney", () => {
  it("rounds to 2dp, half-up", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe("computeSplitLegs", () => {
  it("returns no legs and the full amount for the owner when there are no rules", () => {
    expect(computeSplitLegs(500, [])).toEqual({ legs: [], ownerKeeps: 500 });
  });

  it("pays a single percentage leg as a share of the payment", () => {
    const { legs, ownerKeeps } = computeSplitLegs(500, [pct("r1", 20)]);
    expect(legs).toEqual([{ ruleId: "r1", amount: 100 }]);
    expect(ownerKeeps).toBe(400);
  });

  it("computes percentages on the ORIGINAL amount, not the remainder", () => {
    const { legs, ownerKeeps } = computeSplitLegs(200, [pct("r1", 50), pct("r2", 25)]);
    expect(legs).toEqual([
      { ruleId: "r1", amount: 100 },
      { ruleId: "r2", amount: 50 },
    ]);
    expect(ownerKeeps).toBe(50);
  });

  it("rounds percentage legs to 2dp and leaves the rounding residue with the owner", () => {
    // 33% of 99.99 = 32.9967 → 33.00; owner keeps the exact remainder.
    const { legs, ownerKeeps } = computeSplitLegs(99.99, [pct("r1", 33)]);
    expect(legs).toEqual([{ ruleId: "r1", amount: 33 }]);
    expect(ownerKeeps).toBe(66.99);
    expect(legs[0].amount + ownerKeeps).toBe(99.99);
  });

  it("pays flat legs as configured", () => {
    const { legs, ownerKeeps } = computeSplitLegs(300, [flat("r1", 50)]);
    expect(legs).toEqual([{ ruleId: "r1", amount: 50 }]);
    expect(ownerKeeps).toBe(250);
  });

  it("caps a flat leg at what remains of the payment", () => {
    const { legs, ownerKeeps } = computeSplitLegs(40, [flat("r1", 50)]);
    expect(legs).toEqual([{ ruleId: "r1", amount: 40 }]);
    expect(ownerKeeps).toBe(0);
  });

  it("caps later percentage rules when earlier rules exhaust the payment", () => {
    const { legs, ownerKeeps } = computeSplitLegs(100, [pct("r1", 60), pct("r2", 60)]);
    expect(legs).toEqual([
      { ruleId: "r1", amount: 60 },
      { ruleId: "r2", amount: 40 },
    ]);
    expect(ownerKeeps).toBe(0);
  });

  it("mixes flat and percentage legs in rule order", () => {
    const { legs, ownerKeeps } = computeSplitLegs(1000, [flat("r1", 100), pct("r2", 10)]);
    expect(legs).toEqual([
      { ruleId: "r1", amount: 100 },
      { ruleId: "r2", amount: 100 },
    ]);
    expect(ownerKeeps).toBe(800);
  });

  it("skips inert rules (zero or negative values)", () => {
    const { legs, ownerKeeps } = computeSplitLegs(100, [pct("r1", 0), flat("r2", -5), pct("r3", 10)]);
    expect(legs).toEqual([{ ruleId: "r3", amount: 10 }]);
    expect(ownerKeeps).toBe(90);
  });

  it("skips rules flagged non-executable without consuming the remainder", () => {
    const { legs, ownerKeeps } = computeSplitLegs(100, [
      pct("r1", 50, { executable: false }),
      pct("r2", 50),
    ]);
    expect(legs).toEqual([{ ruleId: "r2", amount: 50 }]);
    expect(ownerKeeps).toBe(50);
  });

  it("never lets legs exceed the payment across many small rules", () => {
    const rules = Array.from({ length: 10 }, (_, i) => pct(`r${i}`, 15));
    const { legs, ownerKeeps } = computeSplitLegs(77.77, rules);
    const total = legs.reduce((s, l) => s + l.amount, 0);
    expect(roundMoney(total + ownerKeeps)).toBe(77.77);
    expect(total).toBeLessThanOrEqual(77.77);
  });

  it("handles a zero or invalid payment amount", () => {
    expect(computeSplitLegs(0, [pct("r1", 50)])).toEqual({ legs: [], ownerKeeps: 0 });
  });
});

describe("committedPercentage / splitRulesWarning", () => {
  it("sums only percentage rules", () => {
    expect(committedPercentage([pct("r1", 30), flat("r2", 50), pct("r3", 25)])).toBe(55);
  });

  it("warns when percentage rules exceed 100%, in order-paid language", () => {
    const warning = splitRulesWarning([pct("r1", 70), pct("r2", 50)]);
    expect(warning).toMatch(/120%/);
    expect(warning).toMatch(/order they were created/i);
  });

  it("stays silent at or under 100%", () => {
    expect(splitRulesWarning([pct("r1", 60), pct("r2", 40)])).toBeNull();
    expect(splitRulesWarning([flat("r1", 500)])).toBeNull();
  });

  it("counts the platform fee toward the committed percentage", () => {
    expect(committedPercentage([pct("r1", 30)], 2.5)).toBe(32.5);
    expect(committedPercentage([pct("r1", 30)])).toBe(30);
  });

  it("warns when rules plus the platform fee exceed 100%", () => {
    const warning = splitRulesWarning([pct("r1", 98)], 2.5);
    expect(warning).toMatch(/100\.5%/);
    expect(warning).toMatch(/platform fee/i);
    expect(splitRulesWarning([pct("r1", 90)], 2.5)).toBeNull();
  });
});

describe("computePlatformFee (rate 2.5%, the launch default)", () => {
  it("takes 2.5% of the payment", () => {
    expect(computePlatformFee(100, 2.5)).toBe(2.5);
    expect(computePlatformFee(1000, 2.5)).toBe(25);
  });

  it("rounds the fee to 2dp, half-up", () => {
    // 2.5% of K15 = K0.375 → K0.38.
    expect(computePlatformFee(15, 2.5)).toBe(0.38);
  });

  it("is capped at the payment amount", () => {
    expect(computePlatformFee(10, 150)).toBe(10);
    expect(computePlatformFee(10, 100)).toBe(10);
  });

  it("is zero when the rate is zero or negative", () => {
    expect(computePlatformFee(100, 0)).toBe(0);
    expect(computePlatformFee(100, -2.5)).toBe(0);
  });

  it("is zero for a zero or invalid amount", () => {
    expect(computePlatformFee(0, 2.5)).toBe(0);
  });
});

describe("computeSplitPreview (platform fee first, then rules)", () => {
  it("takes the fee before rules and still sums exactly to the payment", () => {
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(200, [pct("r1", 50)], 2.5);
    expect(platformFee).toBe(5);
    // The percentage leg is still a share of the ORIGINAL K200.
    expect(legs).toEqual([{ ruleId: "r1", amount: 100 }]);
    expect(ownerKeeps).toBe(95);
    expect(platformFee + legs[0].amount + ownerKeeps).toBe(200);
  });

  it("caps a merchant leg at what the fee leaves behind (fee-first ordering)", () => {
    // Without the fee first, the flat K99 leg would take K99.
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(100, [flat("r1", 99)], 2.5);
    expect(platformFee).toBe(2.5);
    expect(legs).toEqual([{ ruleId: "r1", amount: 97.5 }]);
    expect(ownerKeeps).toBe(0);
  });

  it("caps a percentage leg at the post-fee remainder too", () => {
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(100, [pct("r1", 99)], 2.5);
    expect(platformFee).toBe(2.5);
    expect(legs).toEqual([{ ruleId: "r1", amount: 97.5 }]);
    expect(ownerKeeps).toBe(0);
  });

  it("charges no fee at a zero rate", () => {
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(100, [pct("r1", 20)], 0);
    expect(platformFee).toBe(0);
    expect(legs).toEqual([{ ruleId: "r1", amount: 20 }]);
    expect(ownerKeeps).toBe(80);
  });

  it("rounds the fee on a small payment and leaves the residue exact", () => {
    // 2.5% of K15 = K0.38; with a 20% rule (K3.00) the owner keeps K11.62.
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(15, [pct("r1", 20)], 2.5);
    expect(platformFee).toBe(0.38);
    expect(legs).toEqual([{ ruleId: "r1", amount: 3 }]);
    expect(ownerKeeps).toBe(11.62);
    expect(roundMoney(platformFee + legs[0].amount + ownerKeeps)).toBe(15);
  });

  it("with no rules, the owner keeps the payment minus the fee", () => {
    const { platformFee, legs, ownerKeeps } = computeSplitPreview(15, [], 2.5);
    expect(platformFee).toBe(0.38);
    expect(legs).toEqual([]);
    expect(ownerKeeps).toBe(14.62);
  });

  it("handles a zero payment amount", () => {
    expect(computeSplitPreview(0, [pct("r1", 50)], 2.5)).toEqual({
      platformFee: 0,
      legs: [],
      ownerKeeps: 0,
    });
  });
});
