// Turn any error the app can produce into the message a user should
// actually see.
//
// The CEO's rule (2026-10-22): when something fails, the app must
// NEVER show a raw browser-style / system response — no PostgREST or
// Postgres wording, no "Failed to fetch", no HTTP status text, no
// JSON dumps. Failures are presented like a crafted app: plain
// language, saying what happened and what the user can do next.
//
// This mapper is the single choke point for that rule:
//   - Messages that are already human sentences — our own edge
//     functions' and RPCs' crafted error copy, GoTrue's auth wording,
//     hand-written client strings — pass through UNCHANGED.
//   - Recognisably technical text is replaced with a crafted
//     message for its category (connection, session, rate limit,
//     permission, duplicate) or with the caller's fallback for
//     everything else technical.
//   - Anything unrecognisable that still looks like a plain sentence
//     is shown as-is; anything that looks like a dump (JSON, stack
//     trace, very long) collapses to the fallback.
//
// Callers pass an action-specific fallback wherever they have one
// ("Transfer failed. Please try again.") so the generic case still
// names what failed.

export const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

const NETWORK_MESSAGE =
  "We couldn't reach BMaGlass Pay. Check your internet connection and try again.";
const TIMEOUT_MESSAGE =
  "That took too long to finish. Check your connection and try again.";
const SESSION_MESSAGE =
  "Your session has expired. Please sign in again to continue.";
const RATE_LIMIT_MESSAGE =
  "Too many attempts in a short space of time. Please wait a moment, then try again.";
const PERMISSION_MESSAGE =
  "You don't have permission to do that. If you believe this is a mistake, please contact support.";
const DUPLICATE_MESSAGE =
  "That already exists — it may have been saved already. Check first, and try again if needed.";

/**
 * Crafted message for a send/transfer refused because the SOURCE
 * sub-account is frozen (Workstream C, 2026-10-26). Before this, the
 * internal-transfer RPC's raw "Source account is frozen and cannot
 * send" — or, on the paths that discarded the function's response
 * body, a generic fallback — was all the user got, with no remedy.
 * A frozen sub-account can still RECEIVE; the remedy is the user's
 * own: unfreeze it, or send from a different account.
 */
export const FROZEN_SUB_ACCOUNT_MESSAGE =
  "This account is frozen, so money can't be sent from it right now. " +
  "It can still receive money. To send again, unfreeze it from Sub-accounts — or send from a different account.";

/** Crafted message for a send/transfer involving a closed account. */
export const CLOSED_ACCOUNT_MESSAGE =
  "This account is closed, so it can't be used for this. Closed accounts can't be reopened — please use a different account.";

/**
 * The profile-freeze message the edge functions already craft
 * server-side (supabase/functions/_shared/account-freeze.ts). It
 * carries its own remedy (contact support), so it passes through
 * unchanged — pinned here so the two wordings can't drift apart
 * silently.
 */
export const FROZEN_PROFILE_MESSAGE =
  "Your account is currently frozen, so this can't be completed right now. " +
  "Please contact support and we'll help you get it sorted out.";

function extractMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      error_description?: unknown;
      error?: unknown;
    };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error_description === "string") {
      return candidate.error_description;
    }
    if (typeof candidate.error === "string") return candidate.error;
  }
  return null;
}

/**
 * Returns a crafted replacement when `text` is recognisably
 * technical, or null when it reads as a human sentence that may be
 * shown as-is. `fallback` is returned for technical text that has no
 * more specific category.
 */
function mapTechnicalMessage(text: string, fallback: string): string | null {
  const t = text.trim();

  // Frozen / closed account refusals (Workstream C, 2026-10-26).
  // These arrive in several raw shapes — the internal-transfer RPC's
  // "Source account is frozen and cannot send", the new RPC wording,
  // a wallet-status refusal — and must ALWAYS land as the crafted
  // message that says what happened and what to do next, never as a
  // bare refusal or a generic fallback. The server's own profile-
  // freeze wording already says both, so it passes through as-is.
  if (/currently frozen/i.test(t)) return t;
  if (/frozen/i.test(t) && /(account|wallet)/i.test(t)) {
    return FROZEN_SUB_ACCOUNT_MESSAGE;
  }
  if (/(source|destination) account is closed/i.test(t) || /^this account is closed/i.test(t)) {
    return CLOSED_ACCOUNT_MESSAGE;
  }

  // Dumps and machine shapes — never fit for a user.
  if (/^[[{]/.test(t)) return fallback; // JSON / array dump
  if (t.includes("{") || t.includes("}")) return fallback;
  if (t.length > 300) return fallback;
  if (/\n\s*at\s+[\w$.]+\s*\(/.test(t) || /\bstack trace\b/i.test(t)) return fallback;
  if (/^</.test(t)) return fallback; // HTML error page fragment

  // Connection / transport failures.
  if (
    /failed to fetch/i.test(t) ||
    /networkerror/i.test(t) ||
    /network request failed/i.test(t) ||
    /fetch failed/i.test(t) ||
    /load failed/i.test(t) ||
    /failed to send a request/i.test(t) ||
    /functionsfetcherror/i.test(t) ||
    /net::/i.test(t) ||
    /err_(internet|network|name_not_resolved)/i.test(t) ||
    /(econnrefused|enotfound|socket hang up)/i.test(t)
  ) {
    return NETWORK_MESSAGE;
  }

  // Timeouts and aborts.
  if (
    /timed out/i.test(t) ||
    /timeout/i.test(t) ||
    /deadline exceeded/i.test(t) ||
    /aborterror/i.test(t) ||
    /operation was aborted/i.test(t)
  ) {
    return TIMEOUT_MESSAGE;
  }

  // Expired / missing session — the fix is always "sign in again".
  if (
    /jwt expired/i.test(t) ||
    /invalid jwt/i.test(t) ||
    /jwt.*(invalid|malformed)/i.test(t) ||
    /auth session missing/i.test(t) ||
    /session (has )?expired/i.test(t) ||
    /token (has )?expired/i.test(t) ||
    /refresh[ _]?token/i.test(t) ||
    /user not authenticated/i.test(t) ||
    /^not authenticated/i.test(t)
  ) {
    return SESSION_MESSAGE;
  }

  // Rate limits (GoTrue, PostgREST, providers).
  if (
    /rate limit/i.test(t) ||
    /too many requests/i.test(t) ||
    /\b429\b/.test(t) ||
    /over_\w+_rate_limit/i.test(t)
  ) {
    return RATE_LIMIT_MESSAGE;
  }

  // Permission / row-level security refusals.
  if (
    /permission denied/i.test(t) ||
    /violates row-level security/i.test(t) ||
    /row-level security/i.test(t) ||
    /insufficient privilege/i.test(t) ||
    /not authorized to/i.test(t)
  ) {
    return PERMISSION_MESSAGE;
  }

  // Uniqueness conflicts.
  if (/duplicate key/i.test(t) || /violates unique constraint/i.test(t)) {
    return DUPLICATE_MESSAGE;
  }

  // Postgres / PostgREST wording that names internals.
  if (
    /violates (foreign key|check|not-null) constraint/i.test(t) ||
    /null value in column/i.test(t) ||
    /invalid input syntax/i.test(t) ||
    /\b(relation|column|function|table|schema|type|operator)\b.{0,120}?\bdoes not exist\b/i.test(t) ||
    /could not find the (function|table|column|schema)/i.test(t) ||
    /postgrest/i.test(t) ||
    /PGRST\d+/i.test(t) ||
    /sqlstate/i.test(t) ||
    /schema cache/i.test(t) ||
    /invalid api key/i.test(t) ||
    /no api key/i.test(t)
  ) {
    return fallback;
  }

  // Postgres-quoted internal identifiers: "some_table_name".
  if (/"[a-z][a-z0-9]*(?:_[a-z0-9]+)+"/.test(t)) return fallback;

  // JS runtime exceptions and minified/framework dumps.
  if (
    /^(typeerror|referenceerror|syntaxerror|rangeerror|evalerror)\b/i.test(t) ||
    /cannot read propert/i.test(t) ||
    /is not a function/i.test(t) ||
    /is not defined/i.test(t) ||
    /(undefined|null) is not an object/i.test(t) ||
    /unexpected token/i.test(t) ||
    /minified react error/i.test(t)
  ) {
    return fallback;
  }

  // supabase-js invoke generics and HTTP status dumps.
  if (
    /non-2xx/i.test(t) ||
    /functionshttperror|functionsrelayerror/i.test(t) ||
    /request failed with status/i.test(t) ||
    /status code \d{3}/i.test(t) ||
    /^function not found$/i.test(t)
  ) {
    return fallback;
  }

  // Storage service internals.
  if (
    /bucket not found/i.test(t) ||
    /^the resource was not found$/i.test(t) ||
    /invalid object/i.test(t)
  ) {
    return fallback;
  }

  return null;
}

/**
 * The user-facing message for any thrown / returned error value.
 * Crafted messages pass through unchanged; technical text is mapped
 * or replaced by `fallback`.
 */
export function toUserFacingError(
  error: unknown,
  fallback: string = DEFAULT_ERROR_MESSAGE,
): string {
  const raw = extractMessage(error);
  if (!raw || !raw.trim()) return fallback;
  const mapped = mapTechnicalMessage(raw, fallback);
  return mapped ?? raw.trim();
}
