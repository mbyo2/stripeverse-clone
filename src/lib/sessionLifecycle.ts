/**
 * Session-expiry lifecycle decisions (pure — unit-tested).
 *
 * Why this module exists (CEO report + forensic audit trail,
 * 2026-10-25): the user was signed out mid-interaction in the wallet
 * at 18:05 CAT. The auth audit log shows a client-side `logout`
 * (an explicit supabase.auth.signOut() call) — NOT a token revocation
 * or a server-side expiry. The app carried two AUTOMATIC sign-out
 * triggers that could fire without the user choosing to sign out:
 *
 *   1. AuthContext armed a bare timer at the access token's
 *      `expires_at` that called signOut(). That races supabase-js's
 *      own auto-refresh: on a throttled/backgrounded mobile tab the
 *      timer can fire in the gap before the refresh lands, and an
 *      already-expired session object made the delay negative, so the
 *      "timer" fired immediately on mount.
 *   2. SessionTimeoutWarning ran its own 300-second countdown,
 *      decoupled from the real session state, and called signOut()
 *      when it reached zero — even if the session had already been
 *      refreshed underneath it.
 *
 * And supabase-js's signOut() defaults to scope "global", so a
 * sign-out fired by ANY client holding a session revoked EVERY
 * session on every device.
 *
 * The rules now:
 *   - NOTHING in the wallet, the SDK, or any data path can clear the
 *     app session. Wallet/SDK/data errors are presented as errors,
 *     never treated as session expiry.
 *   - Reaching `expires_at` is not a sign-out. It is a VERIFY point:
 *     ask GoTrue to refresh; only a genuine refresh FAILURE (refresh
 *     token revoked/expired/invalid) ends the session, deliberately.
 *   - An explicit user sign-out is scoped to THIS device ("local"),
 *     so signing out here never revokes the user's other devices.
 */

/** Warn the user this long before the access token expires. */
export const SESSION_WARN_BEFORE_MS = 5 * 60 * 1000;

export interface ExpirySchedule {
  /** Delay after which the "session expiring" warning shows, or null when no warning is due. */
  warnDelayMs: number | null;
  /**
   * Delay after which the session must be VERIFIED (refresh attempt).
   * Always set for a live session — including 0 for an already-expired
   * token, where verification happens immediately instead of the old
   * behaviour (instant sign-out on a negative timer delay).
   */
  verifyDelayMs: number | null;
}

/**
 * The schedule for a session, from its expiry (unix seconds) and the
 * current time (ms). No session → no timers at all.
 */
export function expirySchedule(
  expiresAtSeconds: number | undefined,
  nowMs: number,
): ExpirySchedule {
  if (!expiresAtSeconds || !Number.isFinite(expiresAtSeconds)) {
    return { warnDelayMs: null, verifyDelayMs: null };
  }
  const msUntilExpiry = expiresAtSeconds * 1000 - nowMs;
  return {
    warnDelayMs:
      msUntilExpiry > SESSION_WARN_BEFORE_MS
        ? msUntilExpiry - SESSION_WARN_BEFORE_MS
        : null,
    verifyDelayMs: Math.max(0, msUntilExpiry),
  };
}

/**
 * The decision at a verify point: sign out ONLY when GoTrue itself
 * refused the refresh. A successful refresh (or a session that turns
 * out to have been refreshed already — expiry now in the future)
 * keeps the user signed in.
 */
export function shouldSignOutAfterVerify(input: {
  refreshFailed: boolean;
  /** The session expiry (unix seconds) re-read after the verify attempt, when available. */
  expiresAtSecondsAfter?: number;
  nowMs: number;
}): boolean {
  if (!input.refreshFailed) return false;
  // The refresh call raced a successful background refresh: the
  // stored session is already valid again, so a transient refresh
  // error must not end it.
  if (
    input.expiresAtSecondsAfter !== undefined &&
    input.expiresAtSecondsAfter * 1000 > input.nowMs
  ) {
    return false;
  }
  return true;
}

/**
 * Whether an arbitrary application error may be treated as a session
 * failure. It may NOT — ever. Only the GoTrue refresh path in
 * AuthContext decides session end (see shouldSignOutAfterVerify);
 * wallet, SDK, chain, edge-function and rendering errors are data
 * errors and leave the session untouched. This function exists so
 * the rule has a name the tests can pin.
 */
export function isSessionEndingError(_error: unknown): boolean {
  return false;
}
