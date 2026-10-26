// Unit tests for supabase/functions/_shared/fee-math.ts — the exact
// integer-ngwee fee code the edge functions run (developer-api link
// responses, payment-link-checkout describe). It must agree with the
// settlement RPC's SQL fee step — round(p_amount * rate / 100, 2) on
// Postgres numeric: round-half-up to whole ngwee, capped at the
// price — and with the dashboard's accepted mirror (computePlatformFee)
// on the amounts the product actually quotes.
import { describe, it, expect } from "vitest";
import {
  platformFeeFor,
  paymentLinkAmounts,
  parseDecimalRational,
} from "../../supabase/functions/_shared/fee-math";
import { computePlatformFee } from "../../src/utils/splitPayments";

describe("platformFeeFor", () => {
  it("charges 2.5% at K100 — the CEO's example", () => {
    expect(platformFeeFor(100, "2.5")).toBe(2.5);
    expect(platformFeeFor(100, 2.5)).toBe(2.5);
  });

  it("rounds half-up on exact decimal halves where floats fail", () => {
    // 2.5% of 40.20 is exactly 1.005 in decimal → 1.01 half-up.
    // In binary floats 40.20 * 2.5 / 100 = 1.00499999… → would be 1.00.
    expect(platformFeeFor(40.2, "2.5")).toBe(1.01);
    // 2.5% of 15 = 0.375 → 0.38.
    expect(platformFeeFor(15, "2.5")).toBe(0.38);
    // 2.5% of 5 = 0.125 → 0.13.
    expect(platformFeeFor(5, "2.5")).toBe(0.13);
  });

  it("is capped at the price and zero for non-positive inputs", () => {
    expect(platformFeeFor(10, "150")).toBe(10);
    expect(platformFeeFor(0, "2.5")).toBe(0);
    expect(platformFeeFor(100, "0")).toBe(0);
    expect(platformFeeFor(100, "not-a-rate")).toBe(0);
  });

  it("agrees with the dashboard mirror across a quoting grid", () => {
    const amounts = [0.5, 1, 2, 5, 9.99, 10.1, 25.5, 40.2, 99.99, 100, 250.75, 1000];
    const rates = ["0.5", "1.5", "2.5", "3.75"];
    for (const a of amounts) {
      for (const r of rates) {
        expect(platformFeeFor(a, r), `fee(${a}, ${r})`).toBe(computePlatformFee(a, Number(r)));
      }
    }
  });
});

describe("paymentLinkAmounts", () => {
  it("buyer-pays at K100 / 2.5%: buyer 102.50, seller exactly 100.00", () => {
    expect(paymentLinkAmounts(100, "2.5", "buyer")).toEqual({
      price: 100, fee_amount: 2.5, fee_payer: "buyer",
      buyer_total: 102.5, seller_receives: 100,
    });
  });

  it("seller-pays at K100 / 2.5%: buyer 100.00, seller 97.50", () => {
    expect(paymentLinkAmounts(100, "2.5", "seller")).toEqual({
      price: 100, fee_amount: 2.5, fee_payer: "seller",
      buyer_total: 100, seller_receives: 97.5,
    });
  });
});

describe("parseDecimalRational", () => {
  it("parses plain decimals exactly and rejects the rest", () => {
    expect(parseDecimalRational("2.5")).toEqual({ num: 25, den: 10 });
    expect(parseDecimalRational("2.55")).toEqual({ num: 255, den: 100 });
    expect(parseDecimalRational("10")).toEqual({ num: 10, den: 1 });
    expect(parseDecimalRational("2.5%")).toBeNull();
    expect(parseDecimalRational("-2.5")).toBeNull();
    expect(parseDecimalRational("")).toBeNull();
  });
});
