// phone-stamp: pure decision logic for the admin phone-stamp action
// (paymentMethod === "admin-stamp-phone" in the mobile-money edge
// function).
//
// Why this exists: P2P tier T1 requires auth.users.phone_confirmed_at,
// but no user flow can write that column — only the GoTrue admin API
// (auth.admin.updateUserById with phone_confirm: true) stamps it.
// This interim mechanism lets a vetted admin confirm a phone number
// for an early user from the Admin Users KYC surface.
//
// This module is dependency-free (no imports, no Deno APIs) so the
// vitest suite can load it directly:
// tests/payments/phoneStamp.test.ts. The Deno handler wiring
// (service-role role lookup, GoTrue stamp, audit insert) lives in
// the edge function and is covered by a live proof, not here.

export const PHONE_STAMP_FORBIDDEN_MESSAGE =
  "Only administrators can confirm a phone number.";

export const PHONE_STAMP_INVALID_PHONE_MESSAGE =
  "Please enter a valid phone number with at least 9 digits.";

export const PHONE_STAMP_INVALID_TARGET_MESSAGE =
  "Choose the user whose phone number you want to confirm, then try again.";

export const PHONE_STAMP_SUCCESS_MESSAGE =
  "Phone number confirmed for this user.";

export const PHONE_STAMP_FAILED_MESSAGE =
  "We couldn't confirm that phone number just now. Please try again.";

export const PHONE_STAMP_AUDIT_FAILED_MESSAGE =
  "The phone number was confirmed, but we couldn't record that action in the audit log. Please let a super administrator know.";

/** Roles allowed to stamp a phone number. */
export function isPhoneStampAdminRole(
  role: string | null | undefined,
): boolean {
  return role === "admin" || role === "super_admin";
}

export function hasPhoneStampAdmin(
  roles: Array<string | null | undefined>,
): boolean {
  return (roles ?? []).some((r) => isPhoneStampAdminRole(r));
}

/**
 * Light normalisation only: trim surrounding whitespace and keep the
 * submitted format otherwise — do not invent a country format.
 * Returns null for non-string / empty input.
 */
export function normalizePhoneForStamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function phoneDigitCount(phone: string): number {
  return (phone.match(/\d/g) ?? []).length;
}

export type PhoneStampPhoneValidation =
  | { ok: true; phone: string }
  | { ok: false; error: string };

/** Validate + normalise the phone for a stamp: trimmed, >= 9 digits. */
export function validatePhoneForStamp(raw: unknown): PhoneStampPhoneValidation {
  const phone = normalizePhoneForStamp(raw);
  if (!phone || phoneDigitCount(phone) < 9) {
    return { ok: false, error: PHONE_STAMP_INVALID_PHONE_MESSAGE };
  }
  return { ok: true, phone };
}

export type PhoneStampTargetValidation =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/** Validate the target user id for a stamp: a non-empty string. */
export function validatePhoneStampTarget(raw: unknown): PhoneStampTargetValidation {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: PHONE_STAMP_INVALID_TARGET_MESSAGE };
  }
  return { ok: true, userId: raw.trim() };
}
