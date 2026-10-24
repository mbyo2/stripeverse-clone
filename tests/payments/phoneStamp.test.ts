// Unit tests for supabase/functions/_shared/phone-stamp.ts — the
// pure decision logic for the admin-stamp-phone action in the
// mobile-money edge function (role gate + phone validation /
// normalisation). The helper is dependency-free, so it is imported
// directly. The Deno handler wiring itself (service-role lookup,
// GoTrue stamp, audit insert) is covered by a live proof, not here.

import { describe, it, expect } from "vitest";
import {
  PHONE_STAMP_FORBIDDEN_MESSAGE,
  PHONE_STAMP_INVALID_PHONE_MESSAGE,
  PHONE_STAMP_INVALID_TARGET_MESSAGE,
  PHONE_STAMP_SUCCESS_MESSAGE,
  hasPhoneStampAdmin,
  isPhoneStampAdminRole,
  normalizePhoneForStamp,
  validatePhoneForStamp,
  validatePhoneStampTarget,
} from "../../supabase/functions/_shared/phone-stamp";

describe("phone-stamp role gate", () => {
  it("accepts admin", () => {
    expect(isPhoneStampAdminRole("admin")).toBe(true);
    expect(hasPhoneStampAdmin(["admin"])).toBe(true);
  });

  it("accepts super_admin", () => {
    expect(isPhoneStampAdminRole("super_admin")).toBe(true);
    expect(hasPhoneStampAdmin(["super_admin"])).toBe(true);
  });

  it("accepts a list containing an admin role among others", () => {
    expect(hasPhoneStampAdmin(["user", "admin"])).toBe(true);
    expect(hasPhoneStampAdmin(["user", "super_admin"])).toBe(true);
  });

  it("rejects non-admin roles", () => {
    for (const roles of [
      ["user"],
      ["business"],
      ["p2p_admin"],
      ["beta_tester"],
      [],
      [null],
      [undefined],
    ]) {
      expect(hasPhoneStampAdmin(roles as never)).toBe(false);
    }
    expect(isPhoneStampAdminRole("user")).toBe(false);
    expect(isPhoneStampAdminRole(null)).toBe(false);
    expect(isPhoneStampAdminRole(undefined)).toBe(false);
  });

  it("exposes the crafted plain-language messages", () => {
    expect(PHONE_STAMP_FORBIDDEN_MESSAGE).toBe(
      "Only administrators can confirm a phone number.",
    );
    expect(PHONE_STAMP_SUCCESS_MESSAGE).toBe(
      "Phone number confirmed for this user.",
    );
  });
});

describe("validatePhoneForStamp — validation + light normalisation", () => {
  it("accepts a typical number and keeps its submitted format", () => {
    expect(validatePhoneForStamp("+260 97 123 4567")).toEqual({
      ok: true,
      phone: "+260 97 123 4567",
    });
    expect(validatePhoneForStamp("0971234567")).toEqual({
      ok: true,
      phone: "0971234567",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validatePhoneForStamp("  0971234567  ")).toEqual({
      ok: true,
      phone: "0971234567",
    });
    expect(normalizePhoneForStamp("  +260971234567 ")).toBe("+260971234567");
  });

  it("accepts exactly 9 digits", () => {
    expect(validatePhoneForStamp("971234567")).toEqual({
      ok: true,
      phone: "971234567",
    });
  });

  it("rejects a phone that is too short (fewer than 9 digits)", () => {
    for (const phone of ["", "   ", "12345", "09712345", "+260 12"]) {
      expect(validatePhoneForStamp(phone)).toEqual({
        ok: false,
        error: PHONE_STAMP_INVALID_PHONE_MESSAGE,
      });
    }
  });

  it("rejects non-string / missing phones", () => {
    for (const phone of [null, undefined, 260971234567, {}]) {
      expect(validatePhoneForStamp(phone)).toEqual({
        ok: false,
        error: PHONE_STAMP_INVALID_PHONE_MESSAGE,
      });
    }
    expect(normalizePhoneForStamp(null)).toBeNull();
    expect(normalizePhoneForStamp("   ")).toBeNull();
  });

  it("counts digits, not characters — punctuation does not inflate the count", () => {
    // 8 digits dressed up with punctuation is still too short.
    expect(validatePhoneForStamp("+ (097) 123-45")).toEqual({
      ok: false,
      error: PHONE_STAMP_INVALID_PHONE_MESSAGE,
    });
  });
});

describe("validatePhoneStampTarget", () => {
  it("accepts a non-empty user id (trimmed)", () => {
    expect(validatePhoneStampTarget("  user-123  ")).toEqual({
      ok: true,
      userId: "user-123",
    });
  });

  it("rejects missing / empty / non-string targets", () => {
    for (const target of ["", "   ", null, undefined, 42]) {
      expect(validatePhoneStampTarget(target)).toEqual({
        ok: false,
        error: PHONE_STAMP_INVALID_TARGET_MESSAGE,
      });
    }
  });
});
