// Unit tests for supabase/functions/_shared/kyc-phone.ts — the
// phone validation/extraction used by verifyKyc in the
// mobile-money edge function. Phone is collected at KYC only
// (CEO directive, 2026-10-30: no phone at sign-up), so this is
// the single gate that decides whether a submitted number may
// become the profile's phone of record. The helper is
// dependency-free, so it is imported directly (repo pattern:
// tests/payments/kycSubmission.test.ts).

import { describe, it, expect } from "vitest";
import {
  KYC_PHONE_REQUIRED_MESSAGE,
  extractKycPhone,
  isValidKycPhone,
} from "../../supabase/functions/_shared/kyc-phone";

describe("isValidKycPhone — accepted shapes", () => {
  it("accepts international format with +", () => {
    expect(isValidKycPhone("+260971234567")).toBe(true);
  });

  it("accepts the 260-prefixed form without +", () => {
    expect(isValidKycPhone("260971234567")).toBe(true);
  });

  it("accepts the local 0-prefixed form", () => {
    expect(isValidKycPhone("0971234567")).toBe(true);
  });

  it("accepts the bare 9-digit form", () => {
    expect(isValidKycPhone("971234567")).toBe(true);
  });

  it("ignores spaces, dashes and parentheses", () => {
    expect(isValidKycPhone("+260 97 123-4567")).toBe(true);
    expect(isValidKycPhone("(097) 123 4567")).toBe(true);
  });
});

describe("isValidKycPhone — rejected shapes", () => {
  it("rejects fewer than 9 digits", () => {
    expect(isValidKycPhone("09712345")).toBe(false);
    expect(isValidKycPhone("123")).toBe(false);
  });

  it("rejects more than 15 digits", () => {
    expect(isValidKycPhone("+2609712345678901")).toBe(false);
  });

  it("rejects letters and empty values", () => {
    expect(isValidKycPhone("call me")).toBe(false);
    expect(isValidKycPhone("")).toBe(false);
    expect(isValidKycPhone("   ")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidKycPhone(undefined)).toBe(false);
    expect(isValidKycPhone(null)).toBe(false);
    expect(isValidKycPhone(260971234567)).toBe(false);
  });
});

describe("extractKycPhone", () => {
  it("returns the trimmed number the frontend sent", () => {
    expect(extractKycPhone({ phone: "  +260971234567 " })).toBe("+260971234567");
  });

  it("returns null when phone is missing or invalid", () => {
    expect(extractKycPhone({})).toBe(null);
    expect(extractKycPhone({ phone: "" })).toBe(null);
    expect(extractKycPhone({ phone: "123" })).toBe(null);
    expect(extractKycPhone(null)).toBe(null);
    expect(extractKycPhone(undefined)).toBe(null);
  });

  it("carries a plain-language refusal naming where phone belongs", () => {
    expect(KYC_PHONE_REQUIRED_MESSAGE).toContain("identity verification");
    expect(KYC_PHONE_REQUIRED_MESSAGE).toContain("not when you sign up");
  });
});
