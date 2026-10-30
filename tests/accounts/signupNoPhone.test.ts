// Regression pins for the 2026-10-30 CEO directive: "Remove phone
// number for the sign up in bmaglasspay.online and just leave it
// for KYC."
//
// Sign-up must not ask for, validate, or transmit a phone number
// anywhere: no field on the register form, no phone in the
// UserData type, no phone in the supabase.auth.signUp metadata
// (handle_new_user stores a metadata phone on the profile — with
// none sent, the profile's phone stays NULL until KYC). The phone
// belongs to the KYC flow: KycVerification collects it on the
// Personal Info step and verifyKyc stores it on profiles.phone.
//
// These are source pins (repo pattern: tests/accounts/
// authBootstrapGate.test.ts reads sources the same way) because
// the behaviour they protect is "this field/payload key does not
// exist" — a runtime test cannot prove an absence.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const registerSrc = read("../../src/pages/Register.tsx");
const authContextSrc = read("../../src/contexts/AuthContext.tsx");
const kycSrc = read("../../src/components/wallet/KycVerification.tsx");

describe("sign-up carries no phone", () => {
  it("the register form has no phone input or label", () => {
    expect(registerSrc).not.toContain('id="phone"');
    expect(registerSrc).not.toContain('htmlFor="phone"');
    expect(registerSrc).not.toContain("Phone Number");
    expect(registerSrc).not.toContain('type="tel"');
  });

  it("the register submit does not pass a phone to signUp", () => {
    expect(registerSrc).not.toContain("phone: phone");
    expect(registerSrc).not.toMatch(/signUp\([^)]*phone/);
  });

  it("the sign-up payload type has no phone field", () => {
    const userDataBlock = authContextSrc.slice(
      authContextSrc.indexOf("type UserData"),
      authContextSrc.indexOf("};", authContextSrc.indexOf("type UserData")),
    );
    expect(userDataBlock).not.toContain("phone");
  });

  it("the auth metadata sent at sign-up contains no phone", () => {
    expect(authContextSrc).not.toContain("phone: userData.phone");
    expect(authContextSrc).not.toContain("userData.phone");
  });
});

describe("KYC holds the phone", () => {
  it("the KYC personal-info step collects a phone number", () => {
    expect(kycSrc).toContain('id="phone"');
    expect(kycSrc).toContain('name="phone"');
    expect(kycSrc).toContain("Phone Number");
  });

  it("the KYC copy states phone is collected at verification, not sign-up", () => {
    expect(kycSrc).toContain("we don't ask for it when you sign up");
  });

  it("the KYC form state carries phone through draft, prefill and submit", () => {
    expect(kycSrc).toContain("phone: string;");
    expect(kycSrc).toContain("'phone'");
    expect(kycSrc).toContain("profileData.phone");
  });
});
