// Frozen-profile dashboard banner (parent rendered pass, 2026-10-26):
// a user whose profile is frozen saw a completely normal dashboard
// and only learned about the freeze when a send was refused. The
// dashboard now tells them up front, in the same crafted copy family
// as the send-refusal message (FROZEN_PROFILE_MESSAGE in
// userFacingError.ts — "Your account is currently frozen…" + the
// support remedy).

export const FROZEN_BANNER_TITLE = "Your account is currently frozen";

export const FROZEN_BANNER_MESSAGE =
  "While your account is frozen, you can't send money or make payments from it. " +
  "You can still sign in and receive money. Please contact support and we'll help you get it sorted out.";

interface FreezableProfile {
  is_frozen?: boolean | null;
}

/** True only for the signed-in user's OWN frozen profile. */
export function shouldShowFrozenBanner(
  profile: FreezableProfile | null | undefined,
): boolean {
  return profile?.is_frozen === true;
}
