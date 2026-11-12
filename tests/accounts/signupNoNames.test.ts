// Regression pins for the 2026-11-12 CEO directive: remove first
// name and last name from sign-up on bmaglasspay.online and push
// them to KYC — mirroring the 2026-10-30 no-phone-at-sign-up
// directive (tests/accounts/signupNoPhone.test.ts).
//
// Sign-up must not ask for, validate, or transmit a name anywhere:
// no fields on the register form, no name in the signUp payload,
// no first_name/last_name in the supabase.auth.signUp metadata
// (handle_new_user copies metadata names onto the profile — with
// none sent, the profile's names stay empty until KYC). Names
// belong to the KYC flow: KycVerification collects them on the
// Personal Info step, requires a first name before submit, and
// verifyKyc stores them on profiles.first_name / last_name — the
// profile is what greetings, onboarding and admin views read.
//
// These are source pins (repo pattern: tests/accounts/
// signupNoPhone.test.ts reads sources the same way) because the
// behaviour they protect is "this field/payload key does not
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
const mobileMoneySrc = read("../../supabase/functions/mobile-money/index.ts");

describe("sign-up carries no names", () => {
  it("the register form has no first/last name inputs or labels", () => {
    expect(registerSrc).not.toContain('id="firstName"');
    expect(registerSrc).not.toContain('id="lastName"');
    expect(registerSrc).not.toContain('htmlFor="firstName"');
    expect(registerSrc).not.toContain('htmlFor="lastName"');
    expect(registerSrc).not.toContain("First Name");
    expect(registerSrc).not.toContain("Last Name");
  });

  it("the register form keeps no first/last name state", () => {
    expect(registerSrc).not.toContain("firstName");
    expect(registerSrc).not.toContain("lastName");
  });

  it("the register submit passes no names to signUp", () => {
    expect(registerSrc).toContain("signUp(email, password)");
    expect(registerSrc).not.toContain("first_name");
    expect(registerSrc).not.toContain("last_name");
  });

  it("signUp takes no user-data payload at all", () => {
    expect(authContextSrc).not.toContain("type UserData");
    expect(authContextSrc).not.toContain("userData");
    expect(authContextSrc).toContain(
      "signUp: (email: string, password: string) => Promise<SignUpResult>",
    );
  });

  it("the auth metadata sent at sign-up contains no names", () => {
    expect(authContextSrc).not.toContain("first_name");
    expect(authContextSrc).not.toContain("last_name");
  });
});

describe("KYC holds the names", () => {
  it("the KYC personal-info step collects first and last name", () => {
    expect(kycSrc).toContain('id="firstName"');
    expect(kycSrc).toContain('id="lastName"');
    expect(kycSrc).toContain("First Name");
    expect(kycSrc).toContain("Last Name");
  });

  it("the KYC form requires a first name before submit", () => {
    expect(kycSrc).toContain('if (!formData.firstName)');
  });

  it("the KYC form pre-fills names from the profile when present", () => {
    expect(kycSrc).toContain("profileData.first_name");
    expect(kycSrc).toContain("profileData.last_name");
  });

  it("verifyKyc writes the submitted names onto the profile", () => {
    expect(mobileMoneySrc).toContain(
      ".update({ phone, first_name: firstName, last_name: lastName })",
    );
  });

  it("verifyKyc still records the names on the KYC submission row", () => {
    expect(mobileMoneySrc).toContain("first_name: firstName,");
    expect(mobileMoneySrc).toContain("last_name: lastName,");
  });
});
