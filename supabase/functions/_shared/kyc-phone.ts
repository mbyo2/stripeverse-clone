// kyc-phone: phone-number handling for KYC submissions.
//
// Why this exists: sign-up no longer collects a phone number (CEO
// directive, 2026-10-30 — "Remove phone number for the sign up in
// bmaglasspay.online and just leave it for KYC"). The phone number
// is collected as part of identity verification instead: the KYC
// form (KycVerification.tsx) asks for it on the Personal Info step,
// verifyKyc in the mobile-money edge function validates it here
// and stores it on public.profiles.phone — the platform's phone of
// record — once the submission lands.
//
// Validation mirrors the platform's existing phone rules: the
// admin phone-stamp requires "at least 9 digits" (phone-stamp.ts),
// and find_transfer_recipient normalises Zambian numbers written
// as 260XXXXXXXXX, 0XXXXXXXXX or XXXXXXXXX. We accept the same
// shapes: after removing spaces, dashes and parentheses, the value
// must be an optional leading "+" followed by 9–15 digits.
//
// This module is dependency-free (no imports, no Deno APIs) so the
// vitest suite can load it directly: tests/payments/kycPhone.test.ts.

export const KYC_PHONE_REQUIRED_MESSAGE =
  "Add your phone number to submit your verification — we collect it here, during identity verification, not when you sign up.";

type Payload = Record<string, unknown> | null | undefined;

/**
 * True when the value is a plausible phone number: optional leading
 * "+", 9–15 digits once spaces, dashes and parentheses are removed.
 */
export function isValidKycPhone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const compact = value.replace(/[\s()-]/g, "");
  return /^\+?\d{9,15}$/.test(compact);
}

/**
 * Extract the validated phone number from a KYC submission payload
 * (the frontend sends `phone`). Returns the trimmed number as
 * entered, or null when it is missing or invalid — callers must
 * treat null as "submission incomplete", never store it.
 */
export function extractKycPhone(payload: Payload): string | null {
  if (!payload) return null;
  const value = payload.phone;
  if (!isValidKycPhone(value)) return null;
  return (value as string).trim();
}
