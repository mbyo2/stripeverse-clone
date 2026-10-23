// Unit tests for the small-fix batch (2026-10-23):
//   1. /login "Email not confirmed" resend path — src/lib/authRecovery.ts
//      + its wiring in AuthContext and Login.
//   2. Register double-submit guard — src/lib/submitGuard.ts + its
//      wiring in Register.
//   3. KYC just-in-time copy pins — no surface may claim verification
//      "unlocks all features" or is required to use the platform
//      (CEO rule: KYC is just-in-time, never upfront).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyResendConfirmation,
  isEmailNotConfirmedError,
  resendConfirmationMessage,
} from "../../src/lib/authRecovery";
import { createSubmitGuard } from "../../src/lib/submitGuard";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("isEmailNotConfirmedError", () => {
  it("recognises GoTrue's message shape", () => {
    expect(isEmailNotConfirmedError(new Error("Email not confirmed"))).toBe(true);
    expect(isEmailNotConfirmedError({ message: "Email not confirmed" })).toBe(true);
  });

  it("recognises the email_not_confirmed code shape", () => {
    expect(
      isEmailNotConfirmedError({ code: "email_not_confirmed", message: "anything" }),
    ).toBe(true);
  });

  it("does not fire for other sign-in failures", () => {
    expect(isEmailNotConfirmedError(new Error("Invalid login credentials"))).toBe(false);
    expect(isEmailNotConfirmedError({ message: "User not found" })).toBe(false);
    expect(isEmailNotConfirmedError(null)).toBe(false);
    expect(isEmailNotConfirmedError(undefined)).toBe(false);
    expect(isEmailNotConfirmedError({})).toBe(false);
  });
});

describe("classifyResendConfirmation", () => {
  it("a clean resend is 'sent'", () => {
    expect(classifyResendConfirmation(null)).toBe("sent");
    expect(classifyResendConfirmation(undefined)).toBe("sent");
  });

  it("an already-confirmed address is its own state", () => {
    expect(
      classifyResendConfirmation({ message: "User already registered" }),
    ).toBe("already_confirmed");
    expect(
      classifyResendConfirmation({ code: "email_exists", message: "x" }),
    ).toBe("already_confirmed");
  });

  it("GoTrue's send-rate-limit shapes are 'rate_limited'", () => {
    expect(
      classifyResendConfirmation({
        message:
          "For security purposes, you can only request this after 36 seconds.",
        status: 429,
      }),
    ).toBe("rate_limited");
    expect(
      classifyResendConfirmation({ code: "over_email_send_rate_limit", message: "x" }),
    ).toBe("rate_limited");
    expect(classifyResendConfirmation({ message: "Too many requests", status: 429 })).toBe(
      "rate_limited",
    );
  });

  it("anything else is a plain 'failed'", () => {
    expect(classifyResendConfirmation(new Error("Failed to fetch"))).toBe("failed");
    expect(classifyResendConfirmation({ message: "Something unexpected" })).toBe("failed");
  });
});

describe("resendConfirmationMessage", () => {
  it("every outcome has crafted, plain-language feedback", () => {
    for (const outcome of ["sent", "already_confirmed", "rate_limited", "failed"] as const) {
      const msg = resendConfirmationMessage(outcome);
      expect(msg.title.length).toBeGreaterThan(0);
      expect(msg.description.length).toBeGreaterThan(0);
      // Never raw auth/system text.
      expect(msg.description).not.toMatch(/429|rate limit exceeded|email_not_confirmed/i);
    }
  });

  it("the sent message tells the user where to look", () => {
    expect(resendConfirmationMessage("sent").description).toMatch(/inbox/i);
  });

  it("the rate-limited message tells the user to wait", () => {
    expect(resendConfirmationMessage("rate_limited").description).toMatch(/wait/i);
  });
});

describe("createSubmitGuard", () => {
  it("the first begin() wins and later ones are refused while in flight", () => {
    const guard = createSubmitGuard();
    expect(guard.active).toBe(false);
    expect(guard.begin()).toBe(true);
    expect(guard.active).toBe(true);
    expect(guard.begin()).toBe(false);
    expect(guard.begin()).toBe(false);
  });

  it("end() releases the slot for the next submission", () => {
    const guard = createSubmitGuard();
    guard.begin();
    guard.end();
    expect(guard.active).toBe(false);
    expect(guard.begin()).toBe(true);
  });

  it("end() is safe to call when nothing is in flight", () => {
    const guard = createSubmitGuard();
    expect(() => guard.end()).not.toThrow();
    expect(guard.active).toBe(false);
  });
});

describe("wiring pins", () => {
  it("Login offers the resend when sign-in reports an unconfirmed email", () => {
    const login = read("../../src/pages/Login.tsx");
    expect(login).toContain("emailNotConfirmed");
    expect(login).toContain("resendConfirmationEmail");
    expect(login).toContain("Resend confirmation email");
  });

  it("AuthContext returns the unconfirmed flag and resends by address", () => {
    const ctx = read("../../src/contexts/AuthContext.tsx");
    expect(ctx).toContain("isEmailNotConfirmedError");
    expect(ctx).toContain("resendConfirmationEmail");
    expect(ctx).toContain("classifyResendConfirmation");
    expect(ctx).toContain("type: 'signup'");
  });

  it("Register guards its submit with the submit guard", () => {
    const register = read("../../src/pages/Register.tsx");
    expect(register).toContain("createSubmitGuard");
    expect(register).toContain("submitGuardRef.current.begin()");
    expect(register).toContain("isSubmitting");
  });
});

describe("KYC just-in-time copy pins", () => {
  const FORBIDDEN =
    /unlock all features|unlock full features|unlock the full experience|access to all features|required to access full platform features/i;

  it("no fixed surface still claims verification unlocks everything", () => {
    const files = [
      "../../src/components/onboarding/OnboardingWizard.tsx",
      "../../src/pages/Faq.tsx",
      "../../src/pages/Help.tsx",
      "../../src/pages/TermsOfService.tsx",
      "../../src/pages/KycPage.tsx",
      "../../src/components/wallet/KycVerification.tsx",
      "../../src/components/wallet/KycVerificationStatus.tsx",
    ];
    for (const file of files) {
      expect(read(file), file).not.toMatch(FORBIDDEN);
    }
  });

  it("the replacement wording names the specific features instead", () => {
    expect(read("../../src/components/onboarding/OnboardingWizard.tsx")).toMatch(
      /higher P2P tiers/i,
    );
    expect(read("../../src/pages/Faq.tsx")).toMatch(/including your wallet and Bitcoin/i);
  });
});
