/**
 * Auth-failure classification + session recovery decisions (pure —
 * unit-tested). The data-layer counterpart to lib/sessionLifecycle.ts.
 *
 * Why this module exists (CEO report, 2026-10-25 22:52 CAT): after
 * clearing his browser cache, the dashboard showed "We couldn't load
 * your dashboard — check your connection" while the header menu still
 * offered Sign Out. The app was in a SPLIT state:
 *
 *   - AuthContext set `user` from the STORED session object
 *     (supabase.auth.getSession() performs no server validation), so
 *     the shell rendered the signed-in UI;
 *   - the stored session's tokens were no longer accepted (access
 *     token dead, refresh token not usable), so every dashboard
 *     query failed — with 401/JWT errors that the UI presented as a
 *     CONNECTION failure;
 *   - "Try Again" was a bare refetch — it re-ran the same queries
 *     with the same dead token and could never recover. Only a manual
 *     sign-out/sign-in (which the CEO eventually did) cleared it.
 *
 * The rules this module encodes:
 *   - An auth failure (401 / JWT expired / dead refresh token) is
 *     NOT a network failure and must never be presented as one.
 *   - On an auth failure, the session is RECOVERED, not the query:
 *     validate with GoTrue; refresh if the access token is refused;
 *     only a genuine refresh refusal ends the session (the same
 *     "expiry is a verify point" rule as sessionLifecycle).
 *   - A network failure proves nothing about the session: recovery
 *     reports "unverifiable" and the session is left untouched —
 *     connectivity problems must never sign anyone out.
 */

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const candidate = error as {
    message?: unknown;
    error_description?: unknown;
    name?: unknown;
  };
  const parts: string[] = [];
  if (typeof candidate.message === "string") parts.push(candidate.message);
  if (typeof candidate.error_description === "string") {
    parts.push(candidate.error_description);
  }
  if (typeof candidate.name === "string") parts.push(candidate.name);
  return parts.join(" ");
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Error codes that mean "the session itself is not accepted", across
 * the three services whose errors reach the data layer:
 *   - PostgREST: PGRST301 (JWT expired), PGRST302 is NOT auth (it is
 *     a role-claims issue) and is deliberately absent; 42501 (RLS) is
 *     a permission refusal WITH a valid token and is also absent.
 *   - GoTrue: the session/refresh-token refusal codes.
 */
const AUTH_ERROR_CODES = new Set([
  "PGRST301",
  "bad_jwt",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "invalid_grant",
  "user_not_found",
]);

const AUTH_MESSAGE_PATTERNS = [
  /jwt expired/i,
  /invalid jwt/i,
  /invalid token/i,
  /token (has )?expired/i,
  /auth session missing/i,
  /user not authenticated/i,
];

/**
 * True when an error means the SESSION was refused — as opposed to a
 * network failure, a server 5xx, a rate limit, or a permission (RLS)
 * refusal, none of which say anything about the session's validity.
 * Only errors this returns true for may trigger session recovery.
 */
export function isAuthFailure(error: unknown): boolean {
  if (!error) return false;
  if (errorStatus(error) === 401) return true;
  const code = errorCode(error);
  if (code && AUTH_ERROR_CODES.has(code)) return true;
  const text = errorText(error);
  return AUTH_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------
// Session recovery orchestration
// ---------------------------------------------------------------------

export interface RecoveryDeps {
  /** The locally stored session, if any (no server validation). */
  getSession: () => Promise<{ expires_at?: number } | null>;
  /** Server-side validation of the access token. */
  getUser: () => Promise<{ user: unknown | null; error: unknown }>;
  /** Ask GoTrue for a fresh access token using the refresh token. */
  refreshSession: () => Promise<{ error: unknown }>;
  /** Guaranteed LOCAL session clear (state + storage), used only
   *  after GoTrue has genuinely refused the refresh token. */
  endSession: () => Promise<void>;
  nowMs?: number;
}

/**
 * - `valid`       — the access token is accepted (or was recovered
 *                   by a background refresh); nothing changed.
 * - `refreshed`   — the access token was refused and a NEW one was
 *                   issued via the refresh token. Queries should be
 *                   retried — they will now go out with a live token.
 * - `signed-out`  — there is no usable session: either none was
 *                   stored, or GoTrue refused both the access token
 *                   AND the refresh token. The local session has
 *                   been cleared; the app belongs on /login.
 * - `unverifiable`— the server could not be reached (or answered
 *                   inconclusively). The session is left exactly as
 *                   it was: a connectivity problem is never proof
 *                   that a session died.
 */
export type RecoveryOutcome =
  | "valid"
  | "refreshed"
  | "signed-out"
  | "unverifiable";

export async function recoverAuthSession(
  deps: RecoveryDeps,
): Promise<RecoveryOutcome> {
  const nowMs = deps.nowMs ?? Date.now();

  let session: { expires_at?: number } | null;
  try {
    session = await deps.getSession();
  } catch {
    return "unverifiable";
  }
  if (!session) return "signed-out";

  // 1. Is the access token actually accepted?
  let userError: unknown = null;
  let user: unknown = null;
  try {
    const result = await deps.getUser();
    user = result.user;
    userError = result.error;
  } catch (thrown) {
    if (!isAuthFailure(thrown)) return "unverifiable";
    userError = thrown;
  }
  if (user) return "valid";
  // A non-auth error (network, 5xx) proves nothing about the session.
  if (userError && !isAuthFailure(userError)) return "unverifiable";

  // 2. The access token was refused — try the refresh token.
  let refreshError: unknown = null;
  try {
    const result = await deps.refreshSession();
    refreshError = result.error;
  } catch (thrown) {
    refreshError = thrown;
  }
  if (!refreshError) return "refreshed";

  if (!isAuthFailure(refreshError)) {
    // The refresh attempt itself was inconclusive (e.g. network).
    // A background auto-refresh may have landed meanwhile — if the
    // stored session is valid again, the failure was transient and
    // the session survives (mirrors shouldSignOutAfterVerify).
    try {
      const after = await deps.getSession();
      if (after?.expires_at && after.expires_at * 1000 > nowMs) {
        return "valid";
      }
    } catch {
      // Fall through — still inconclusive, still not a sign-out.
    }
    return "unverifiable";
  }

  // 3. GoTrue refused the refresh token itself: the session is
  // genuinely over. Clear it locally so the shell, the data layer
  // and the router all agree there is no signed-in user. Even if
  // the local clear itself throws, the verdict stands.
  try {
    await deps.endSession();
  } catch {
    // The session is over either way; the caller's state clear is
    // best-effort by design (see AuthContext.endSessionLocally).
  }
  return "signed-out";
}

// ---------------------------------------------------------------------
// "You've been signed out" notice for the login page
// ---------------------------------------------------------------------

export const SESSION_ENDED_NOTICE_KEY = "bmaglass.sessionEndedNotice";
export const SESSION_ENDED_MESSAGE =
  "You've been signed out. Please sign in again.";

/** Flag that the next /login render should explain the sign-out. */
export function markSessionEndedNotice(): void {
  try {
    sessionStorage.setItem(SESSION_ENDED_NOTICE_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quotas) — the notice is a
    // courtesy, never a blocker.
  }
}

/** Read-and-clear the flag: the notice shows exactly once. */
export function consumeSessionEndedNotice(): boolean {
  try {
    const flagged = sessionStorage.getItem(SESSION_ENDED_NOTICE_KEY);
    if (flagged) sessionStorage.removeItem(SESSION_ENDED_NOTICE_KEY);
    return !!flagged;
  } catch {
    return false;
  }
}

/** Drop any pending notice (e.g. after a fresh manual sign-in). */
export function clearSessionEndedNotice(): void {
  try {
    sessionStorage.removeItem(SESSION_ENDED_NOTICE_KEY);
  } catch {
    // Non-fatal, as above.
  }
}
