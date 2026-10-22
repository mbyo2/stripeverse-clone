import { describe, expect, it } from "vitest";
import {
  isUuid,
  parseCheckoutTerms,
  sanitizeCheckoutRedirectUrl,
} from "../../supabase/functions/_shared/checkout-capture";

const PAYER = "11111111-1111-4111-8111-111111111111";
const MERCHANT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

describe("isUuid", () => {
  it("accepts canonical UUIDs", () => {
    expect(isUuid(MERCHANT)).toBe(true);
    expect(isUuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe(true);
  });

  it("rejects non-UUIDs", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("sanitizeCheckoutRedirectUrl", () => {
  it("passes well-formed https URLs through", () => {
    expect(sanitizeCheckoutRedirectUrl("https://bmaglasspay.online/checkout?paypal_return=checkout"))
      .toBe("https://bmaglasspay.online/checkout?paypal_return=checkout");
  });

  it("drops http, dangerous schemes and garbage", () => {
    expect(sanitizeCheckoutRedirectUrl("http://example.com/back")).toBeNull();
    expect(sanitizeCheckoutRedirectUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeCheckoutRedirectUrl("data:text/html,hi")).toBeNull();
    expect(sanitizeCheckoutRedirectUrl("not a url")).toBeNull();
    expect(sanitizeCheckoutRedirectUrl("")).toBeNull();
    expect(sanitizeCheckoutRedirectUrl(null)).toBeNull();
    expect(sanitizeCheckoutRedirectUrl(123)).toBeNull();
  });
});

describe("parseCheckoutTerms", () => {
  it("accepts a minimal valid merchant (Main account settlement)", () => {
    const result = parseCheckoutTerms({ merchant_user_id: MERCHANT }, PAYER);
    expect(result).toEqual({
      ok: true,
      terms: {
        merchantUserId: MERCHANT,
        accountId: null,
        returnUrl: null,
        cancelUrl: null,
      },
    });
  });

  it("accepts an explicit settlement account and https return/cancel URLs", () => {
    const result = parseCheckoutTerms(
      {
        merchant_user_id: MERCHANT,
        account_id: ACCOUNT,
        return_url: "https://shop.example/checkout?paypal_return=checkout",
        cancel_url: "https://shop.example/checkout?paypal_return=cancelled",
      },
      PAYER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.terms.accountId).toBe(ACCOUNT);
      expect(result.terms.returnUrl).toContain("paypal_return=checkout");
      expect(result.terms.cancelUrl).toContain("paypal_return=cancelled");
    }
  });

  it("refuses when no merchant is named — an order that cannot settle must not be created", () => {
    for (const meta of [undefined, null, {}, { merchant_user_id: "" }, { merchant_user_id: "abc" }, "nope"]) {
      const result = parseCheckoutTerms(meta, PAYER);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("merchant");
    }
  });

  it("refuses when the merchant is the payer", () => {
    const result = parseCheckoutTerms({ merchant_user_id: PAYER }, PAYER);
    expect(result.ok).toBe(false);
  });

  it("refuses a malformed account_id", () => {
    const result = parseCheckoutTerms(
      { merchant_user_id: MERCHANT, account_id: "main-please" },
      PAYER,
    );
    expect(result.ok).toBe(false);
  });

  it("drops (does not forward) non-https return URLs instead of failing", () => {
    const result = parseCheckoutTerms(
      { merchant_user_id: MERCHANT, return_url: "http://evil.example/land" },
      PAYER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.terms.returnUrl).toBeNull();
  });
});
