// Unit tests for supabase/functions/_shared/kyc-write.ts — the
// write-confirmation guard used by verifyKyc in the mobile-money
// edge function. The helper is dependency-free, so it is imported
// directly (repo pattern: tests/payments/kycSubmission.test.ts).

import { describe, it, expect } from "vitest";
import {
  KYC_WRITE_LOST_MESSAGE,
  KycWriteLostError,
  assertKycWriteLanded,
  isKycWriteLostError,
} from "../../supabase/functions/_shared/kyc-write";

describe("assertKycWriteLanded — a write that returned its row", () => {
  it("returns the written row when PostgREST returned one", () => {
    const row = { id: 42 };
    expect(assertKycWriteLanded([row])).toBe(row);
  });

  it("returns the first row when several were returned", () => {
    expect(assertKycWriteLanded([{ id: 1 }, { id: 2 }])).toEqual({ id: 1 });
  });
});

describe("assertKycWriteLanded — a write that landed on 0 rows", () => {
  it.each([
    ["an empty array", []],
    ["null", null],
    ["undefined", undefined],
  ])("throws KycWriteLostError for %s", (_label, rows) => {
    expect(() => assertKycWriteLanded(rows as never)).toThrow(
      KycWriteLostError,
    );
  });

  it("carries the crafted plain-language message, not a raw error", () => {
    let caught: unknown;
    try {
      assertKycWriteLanded([]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KycWriteLostError);
    expect((caught as Error).message).toBe(KYC_WRITE_LOST_MESSAGE);
    expect((caught as Error).name).toBe("KycWriteLostError");
  });
});

describe("KYC_WRITE_LOST_MESSAGE — the user-facing wording", () => {
  it("says plainly that nothing was saved", () => {
    expect(KYC_WRITE_LOST_MESSAGE).toContain("nothing was changed");
    expect(KYC_WRITE_LOST_MESSAGE).toContain("try again");
  });

  it("contains no raw database / transport jargon", () => {
    const jargon = [
      "row-level security",
      "PostgREST",
      "42501",
      "policy",
      "RLS",
      "violates",
    ];
    for (const term of jargon) {
      expect(KYC_WRITE_LOST_MESSAGE).not.toContain(term);
    }
  });

  it("differs from the generic handler failure message", () => {
    expect(KYC_WRITE_LOST_MESSAGE).not.toBe(
      "Failed to process KYC verification",
    );
  });
});

describe("isKycWriteLostError", () => {
  it("recognises the guard's own error", () => {
    expect(isKycWriteLostError(new KycWriteLostError())).toBe(true);
  });

  it("rejects generic errors and non-errors", () => {
    expect(isKycWriteLostError(new Error("boom"))).toBe(false);
    expect(isKycWriteLostError("KycWriteLostError")).toBe(false);
    expect(isKycWriteLostError(null)).toBe(false);
    expect(isKycWriteLostError(undefined)).toBe(false);
  });
});
