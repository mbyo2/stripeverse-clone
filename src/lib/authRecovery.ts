// Login recovery helpers — the "Email not confirmed" path.
//
// A user who signed up but never tapped the confirmation link used to
// hit a dead end on /login: sign-in failed with "Email not confirmed"
// and the page offered no way forward. These helpers let the login
// page recognise that one failure and offer a resend, and turn the
// resend result into the crafted, plain-language feedback the app
// presents for it (CEO error-presentation rule, 2026-10-22: never raw
// auth/system text).
//
// Everything here is pure and dependency-free so it can be unit
// tested directly; the AuthContext wires it to supabase.auth.resend.

export type ResendConfirmationOutcome =
  | "sent"
  | "already_confirmed"
  | "rate_limited"
  | "failed";

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

/**
 * True when a sign-in failure is GoTrue's "email not confirmed"
 * refusal — the one failure the login page can help with by offering
 * to resend the confirmation email.
 */
export function isEmailNotConfirmedError(error: unknown): boolean {
  const text = errorText(error);
  if (/email_not_confirmed/i.test(text)) return true;
  if (/email not confirmed/i.test(text)) return true;
  return false;
}

const ALREADY_CONFIRMED_CODES = new Set([
  "email_exists",
  "user_already_exists",
  "email_already_confirmed",
]);

/**
 * Classify the result of a supabase.auth.resend({ type: 'signup' })
 * call. Pass the returned error (null when the call succeeded).
 * GoTrue's resend errors are matched by shape, never shown raw.
 */
export function classifyResendConfirmation(
  error: unknown,
): ResendConfirmationOutcome {
  if (!error) return "sent";

  const text = errorText(error);
  const status = errorStatus(error);
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;

  // Rate limits: GoTrue's per-email send cap ("For security purposes,
  // you can only request this after N seconds"), the over_*_rate_limit
  // codes, and plain HTTP 429s.
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
    (typeof code === "string" && ALREADY_CONFIRMED_CODES.has(code)) ||
    /already (confirmed|registered|verified)/i.test(text)
  ) {
    return "already_confirmed";
  }

  return "failed";
}

/** Crafted in-app feedback for each resend outcome. */
export function resendConfirmationMessage(outcome: ResendConfirmationOutcome): {
  title: string;
  description: string;
} {
  switch (outcome) {
    case "sent":
      return {
        title: "Confirmation email sent",
        description:
          "Check your inbox for a fresh confirmation link, tap it, then come back and sign in. If it isn't there in a few minutes, check your spam folder.",
      };
    case "already_confirmed":
      return {
        title: "Email already confirmed",
        description:
          "This email address is already confirmed, so no new link is needed. Try signing in again — if it still doesn't work, use “Forgot password” to set a new password.",
      };
    case "rate_limited":
      return {
        title: "Please wait a moment",
        description:
          "You've asked for several confirmation emails in a short space of time. Wait a little while, then try again — and check your spam folder in the meantime, as an earlier email may already be there.",
      };
    case "failed":
    default:
      return {
        title: "Couldn't send the email",
        description:
          "We couldn't send the confirmation email just now. Check your connection and try again in a moment.",
      };
  }
}
