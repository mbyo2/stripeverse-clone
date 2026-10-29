/**
 * First-paint session hint (fix for the 2026-10-29 wrong-page flash:
 * "it is trying to show another page and then it realizes that I'm
 * logged in").
 *
 * supabase-js persists the session in localStorage (default storage,
 * key `sb-<project-ref>-auth-token`) but only hands it back
 * asynchronously — getSession() resolves inside an effect, and until
 * it does the app renders with `user === null`. Every surface that
 * branches on `user` at first paint therefore painted the signed-out
 * version first — the landing page at `/`, the login/register forms,
 * the guest header chrome — and flipped once the stored session
 * landed a few frames later.
 *
 * The persisted blob is readable SYNCHRONOUSLY, so the app can know
 * at first paint whether a session is probably about to resolve.
 * This module is that read, plus the gate arithmetic built on it.
 *
 * The hint is NOT an auth decision. It never grants access, never
 * feeds a query, and its only power is choosing a skeleton over
 * guest content while AuthContext's verified bootstrap (isAuthReady)
 * completes. A stale or dead stored session costs a brief skeleton;
 * a live one costs no wrong-page flash. Guests — no stored session —
 * are never gated: their pages paint immediately, exactly as before.
 */

/** The slice of the Web Storage API the hint read needs. */
export interface SessionStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

/** supabase-js default storage key: `sb-<project-ref>-auth-token`. */
const AUTH_TOKEN_KEY_PATTERN = /^sb-.+-auth-token$/;

function hasTokens(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const access = record.access_token;
  const refresh = record.refresh_token;
  return (
    (typeof access === "string" && access.length > 0) ||
    (typeof refresh === "string" && refresh.length > 0)
  );
}

function blobLooksLikeSession(blob: unknown): boolean {
  if (hasTokens(blob)) return true;
  // Wrapped storage shape used by older auth-js versions:
  // { currentSession: { access_token, ... } }.
  if (blob && typeof blob === "object") {
    return hasTokens((blob as Record<string, unknown>).currentSession);
  }
  return false;
}

function defaultStorage(): SessionStorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Accessing localStorage itself can throw (privacy modes).
    return null;
  }
}

/**
 * True when a persisted Supabase session blob exists in storage —
 * i.e. a signed-in session is likely about to resolve. Synchronous
 * and total: any storage or parse failure reads as "no hint", which
 * leaves first paint exactly as it was for guests.
 */
export function hasPersistedSession(
  storage?: SessionStorageLike | null,
): boolean {
  try {
    const store = storage === undefined ? defaultStorage() : storage;
    if (!store) return false;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !AUTH_TOKEN_KEY_PATTERN.test(key)) continue;
      const raw = store.getItem(key);
      if (!raw) continue;
      try {
        if (blobLooksLikeSession(JSON.parse(raw))) return true;
      } catch {
        // A corrupt blob is not a hint — keep scanning / fall through.
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** The three auth facts the first-paint gate arithmetic reads. */
export interface AuthGateInputs {
  user: unknown | null;
  isAuthReady: boolean;
  hasStoredSession: boolean;
}

/**
 * True during the bootstrap window when a stored session exists but
 * auth has not resolved yet: no user is known, verification has not
 * finished, and the stored-session hint says one is probably coming.
 * Surfaces must render skeletons in this window — never guest
 * content the session is about to contradict.
 */
export function isAuthPending({
  user,
  isAuthReady,
  hasStoredSession,
}: AuthGateInputs): boolean {
  return user == null && !isAuthReady && hasStoredSession;
}

/**
 * Which skeleton header twin a shell should show: the signed-in
 * shape when a user is known OR one is probably resolving, the
 * guest shape only when the visitor is resolved-signed-out or has
 * no stored session at all.
 */
export function shellSkeletonVariant(
  inputs: AuthGateInputs,
): "authed" | "guest" {
  return inputs.user != null || isAuthPending(inputs) ? "authed" : "guest";
}
