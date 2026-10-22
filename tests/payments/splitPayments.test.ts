// Unit tests for src/utils/splitPayments.ts — the client-side mirror of
// the split-execution arithmetic implemented authoritatively in SQL by
// supabase/migrations/20261022_split_payments_execution.sql. These pin
// the leg math: percentage shares of the original amount rounded to
// 2dp, flat legs as configured, every leg capped at the remainder, and
// the owner keeping exactly what is left (legs + owner = payment).

import { describe, it, expect } from "vitest";
import {
  computeSplitLegs,
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
});
