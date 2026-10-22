import { describe, it, expect } from "vitest";
import {
  phoneDigits,
  canonicalZambianPhoneDigits,
  normalizeZambianPhone,
  phonesMatch,
  prepareRecipientQuery,
  INVALID_RECIPIENT_MESSAGE,
} from "../../src/utils/phoneNumber";

// The number used in the live QA defect: stored on the recipient's
// profile as "+260 97 000 0000"; the sender typed "0970000000" and was
// refused with "No account found".
const CANONICAL_DIGITS = "260970000000";
const CANONICAL_PLUS = "+260970000000";

describe("canonicalZambianPhoneDigits — every accepted format of the same number", () => {
  const formats = [
    "0970000000", // local, trunk 0 — the format that failed live
    "097 000 0000", // local, spaced
    "097-000-0000", // local, dashed
    "260970000000", // country code, no plus
    "+260970000000", // full international
    "+260 97 000 0000", // full international, spaced (the stored format)
    "+260 (97) 000-0000", // punctuation mixed in
    "970000000", // bare 9-digit subscriber number
    "  0970000000  ", // surrounding whitespace
  ];
  for (const format of formats) {
    it(`canonicalizes ${JSON.stringify(format)}`, () => {
      expect(canonicalZambianPhoneDigits(format)).toBe(CANONICAL_DIGITS);
      expect(normalizeZambianPhone(format)).toBe(CANONICAL_PLUS);
    });
  }

  it("canonicalizes other Zambian prefixes", () => {
    expect(canonicalZambianPhoneDigits("0761234567")).toBe("260761234567");
    expect(canonicalZambianPhoneDigits("+260 95 555 1234")).toBe("260955551234");
    expect(canonicalZambianPhoneDigits("771234567")).toBe("260771234567");
  });
});

describe("canonicalZambianPhoneDigits — rejects non-Zambian / malformed input", () => {
  const rejected: Array<string | null | undefined> = [
    "", // empty
    "   ", // whitespace only
    null,
    undefined,
    "abc", // letters
    "0970abc000", // letters mixed in
    "123", // far too short
    "09700000", // 8 digits — too short in every form
    "09700000000", // 11 digits starting 0 — no valid form
    "2609700000000", // 13 digits — too long
    "+1 202 555 0123", // US number — not Zambian
    "+44 20 7946 0958", // UK number — not Zambian
    "123456789", // 9 digits not starting 7/9
    "097000000", // 9 digits starting 0 — not a bare subscriber number
  ];
  for (const input of rejected) {
    it(`returns null for ${JSON.stringify(input)}`, () => {
      expect(canonicalZambianPhoneDigits(input)).toBeNull();
      expect(normalizeZambianPhone(input)).toBeNull();
    });
  }
});

describe("phoneDigits", () => {
  it("strips all non-digits", () => {
    expect(phoneDigits("+260 97 000 0000")).toBe(CANONICAL_DIGITS);
    expect(phoneDigits(null)).toBe("");
    expect(phoneDigits(undefined)).toBe("");
  });
});

describe("phonesMatch", () => {
  it("matches the same Zambian number across formats", () => {
    expect(phonesMatch("0970000000", "+260 97 000 0000")).toBe(true);
    expect(phonesMatch("260970000000", "097 000 0000")).toBe(true);
    expect(phonesMatch("970000000", "+260970000000")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("0970000000", "0970000001")).toBe(false);
    expect(phonesMatch("0970000000", "+260 76 123 4567")).toBe(false);
  });

  it("falls back to exact digit equality for non-Zambian numbers", () => {
    expect(phonesMatch("+1 202 555 0123", "12025550123")).toBe(true);
    expect(phonesMatch("+1 202 555 0123", "+1 202 555 0124")).toBe(false);
  });

  it("never matches empty input", () => {
    expect(phonesMatch("", "")).toBe(false);
    expect(phonesMatch(null, "0970000000")).toBe(false);
  });
});

describe("prepareRecipientQuery", () => {
  it("passes email through trimmed", () => {
    expect(prepareRecipientQuery("  qa2@bmaglasspay.online ")).toEqual({
      ok: true,
      query: "qa2@bmaglasspay.online",
    });
  });

  it("canonicalizes every Zambian phone format for the lookup", () => {
    for (const format of ["0970000000", "097 000 0000", "+260 97 000 0000", "260970000000"]) {
      expect(prepareRecipientQuery(format)).toEqual({ ok: true, query: CANONICAL_PLUS });
    }
  });

  it("passes a plausible non-Zambian number through for the exact-match lookup", () => {
    expect(prepareRecipientQuery("+1 202 555 0123")).toEqual({
      ok: true,
      query: "+1 202 555 0123",
    });
  });

  it("refuses garbage with the invalid-format message, not a lookup", () => {
    for (const garbage of ["", "   ", "abc", "call-me", "123", "09700"]) {
      expect(prepareRecipientQuery(garbage)).toEqual({
        ok: false,
        message: INVALID_RECIPIENT_MESSAGE,
      });
    }
  });
});
