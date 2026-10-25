// Sign-up outcome classification — the post-submit navigation fix.
//
// Until 2026-10-26 the sign-up flow had NO landing: AuthContext.signUp
// returned void, discarded the response's `data`, and only toasted
// "Account created". Register's one navigation hook was its
// `if (user)` dashboard guard — and with email confirmation ON (this
// project's live config: mailer_autoconfirm = false), a successful
// sign-up returns a user with NO session, so `user` never gets set
// and the guard never fires. The user was left sitting on the form
// with a fading toast instead of the check-your-email page.
//
// This module classifies the raw supabase.auth.signUp response into
// the outcome the page must act on. It is pure and dependency-free
// (same style as lib/authRecovery) so every branch is unit-testable
// against the real GoTrue response shapes:
//
//   - confirmation ON + new email → { user, session: null } with the
//     user's `identities` populated → "confirmation_pending".
//   - confirmation ON + ALREADY-REGISTERED email → GoTrue answers an
//     obfuscated SUCCESS (it will not confirm the account exists via
//     an error): a user whose `identities` array is EMPTY and no
//     session. That empty-identities shape is Supabase's documented
//     tell for a duplicate, and it is what this project produces.
//     → "email_taken". (Some configurations instead return an
//     explicit user_already_exists / email_exists error — handled
//     too, so the branch holds either way.)
//   - confirmation OFF → { user, session } → "signed_in".
//   - GoTrue / client rate limiting → "rate_limited".
//   - anything else → "failed" (the caller maps the error through
//     toUserFacingError for the crafted copy — raw text never shows).

export type SignUpOutcome =
  | "confirmation_pending"
  | "signed_in"
  | "email_taken"
  | "rate_limited"
  | "failed";

type SignUpResponseShape = {
  data: {
    user?: unknown;
    session?: unknown;
  } | null;
  error?: unknown;
};

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as {
    message?: unknown;
    error_description?: unknown;
    code?: unknown;
  };
  const parts: string[] = [];
  if (typeof candidate.message === "string") parts.push(candidate.message);
  if (typeof candidate.error_description === "string") {
    parts.push(candidate.error_description);
  }
  if (typeof candidate.code === "string") parts.push(candidate.code);
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

const EMAIL_TAKEN_CODES = new Set(["user_already_exists", "email_exists"]);

export function classifySignUpResponse(
  response: SignUpResponseShape,
): SignUpOutcome {
  const { data, error } = response;

  if (error) {
    const text = errorText(error);
    const status = errorStatus(error);
    const code = errorCode(error);

    if (
      status === 429 ||
      /rate limit/i.test(text) ||
      /over_\w+_rate_limit/i.test(text) ||
      /only request this after/i.test(text) ||
      /for security purposes/i.test(text)
    ) {
      return "rate_limited";
    }

    if (
      (code !== null && EMAIL_TAKEN_CODES.has(code)) ||
      /user already registered/i.test(text) ||
      /already (registered|exists)/i.test(text)
    ) {
      return "email_taken";
    }

    return "failed";
  }

  const session = data?.session ?? null;
  if (session) return "signed_in";

  const user = data?.user;
  if (user && typeof user === "object") {
    const identities = (user as { identities?: unknown }).identities;
    // The duplicate tell: a "successful" sign-up whose user has an
    // EMPTY identities array is GoTrue's obfuscated answer for an
    // email that is already registered (confirmation enabled). A
    // genuine new sign-up always carries at least one identity.
    if (Array.isArray(identities) && identities.length === 0) {
      return "email_taken";
    }
    return "confirmation_pending";
  }

  // No error, but no user either — nothing was created that we can
  // point to. Treat as a failure so the page stays put with a crafted
  // message instead of claiming an email was sent.
  return "failed";
}

/** Route the Register page navigates to for each successful outcome. */
export function signUpSuccessRoute(
  outcome: SignUpOutcome,
): "/check-email" | "/dashboard" | null {
  switch (outcome) {
    case "confirmation_pending":
      return "/check-email";
    case "signed_in":
      return "/dashboard";
    default:
      return null;
  }
}
