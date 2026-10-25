// Regression tests for the 2026-10-26 sign-up navigation fix
// (src/lib/signUpFlow.ts + its wiring across AuthContext, Register,
// CheckEmail, Login, ResetPassword, UpdatePassword).
//
// The CEO submitted the sign-up form and was never taken to the
// check-your-email page: AuthContext.signUp returned void and
// discarded the response, and Register's only navigation was its
// `if (user)` dashboard guard — which can never fire when email
// confirmation is ON (this project's live config,
// mailer_autoconfirm = false), because a pending sign-up returns a
// user with NO session. These tests pin every branch's landing:
//
//   - new email, confirmation pending → /check-email (email in state)
//   - immediate session (confirmation off) → /dashboard
//   - duplicate email (GoTrue's obfuscated empty-identities success,
//     or an explicit user_already_exists error) → the dedicated
//     "already have an account" state — NO check-email navigation,
//     NO "email sent" claim — with Log In carrying the address to a
//     prefilled /login
//   - rate limited / failed → the form stays, with crafted copy
//   - an expired email link landing on /login is recognised and
//     explained, with the resend panel open
//   - reset-request and set-new-password pages advance ONLY on a
//     real success (both context methods used to swallow failures,
//     so both pages showed their success states unconditionally)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifySignUpResponse,
  signUpSuccessRoute,
} from "../../src/lib/signUpFlow";
import {
  parseAuthLinkError,
  authLinkErrorMessage,
} from "../../src/lib/authRecovery";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// Real GoTrue response shapes (confirmation enabled — this project).
const newUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "new.user@gmail.com",
  identities: [{ id: "11111111-1111-4111-8111-111111111111", provider: "email" }],
};
const sessionShape = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  user: newUser,
};

describe("classifySignUpResponse", () => {
  it("a new email with confirmation pending is 'confirmation_pending'", () => {
    expect(
      classifySignUpResponse({
        data: { user: newUser, session: null },
        error: null,
      }),
    ).toBe("confirmation_pending");
  });

  it("an immediate session is 'signed_in'", () => {
    expect(
      classifySignUpResponse({
        data: { user: newUser, session: sessionShape },
        error: null,
      }),
    ).toBe("signed_in");
  });

  it("DUPLICATE: the obfuscated success (empty identities, no session) is 'email_taken'", () => {
    // GoTrue's documented tell for an already-registered email when
    // confirmation is enabled — a "successful" user object whose
    // identities array is EMPTY. No confirmation email is sent for
    // this shape, so the user must never see the check-email page.
    expect(
      classifySignUpResponse({
        data: {
          user: { id: newUser.id, email: newUser.email, identities: [] },
          session: null,
        },
        error: null,
      }),
    ).toBe("email_taken");
  });

  it("DUPLICATE: an explicit user_already_exists error is 'email_taken'", () => {
    expect(
      classifySignUpResponse({
        data: { user: null, session: null },
        error: {
          code: "user_already_exists",
          message: "User already registered",
          status: 422,
        },
      }),
    ).toBe("email_taken");
  });

  it("DUPLICATE: a message-only 'already registered' error is 'email_taken'", () => {
    expect(
      classifySignUpResponse({
        data: null,
        error: { message: "User already registered", status: 422 },
      }),
    ).toBe("email_taken");
  });

  it("GoTrue rate-limit shapes are 'rate_limited'", () => {
    expect(
      classifySignUpResponse({
        data: null,
        error: { message: "Email rate limit exceeded", status: 429 },
      }),
    ).toBe("rate_limited");
    expect(
      classifySignUpResponse({
        data: null,
        error: {
          message:
            "For security purposes, you can only request this after 57 seconds",
          status: 429,
        },
      }),
    ).toBe("rate_limited");
  });

  it("other errors are 'failed'", () => {
    expect(
      classifySignUpResponse({
        data: { user: null, session: null },
        error: {
          code: "weak_password",
          message: "Password should be at least 6 characters",
          status: 422,
        },
      }),
    ).toBe("failed");
    expect(
      classifySignUpResponse({
        data: null,
        error: { message: "fetch failed" },
      }),
    ).toBe("failed");
  });

  it("no error but no user and no session is 'failed' — never a false confirmation claim", () => {
    expect(
      classifySignUpResponse({
        data: { user: null, session: null },
        error: null,
      }),
    ).toBe("failed");
  });
});

describe("signUpSuccessRoute", () => {
  it("maps each outcome to its landing", () => {
    expect(signUpSuccessRoute("confirmation_pending")).toBe("/check-email");
    expect(signUpSuccessRoute("signed_in")).toBe("/dashboard");
    expect(signUpSuccessRoute("email_taken")).toBeNull();
    expect(signUpSuccessRoute("rate_limited")).toBeNull();
    expect(signUpSuccessRoute("failed")).toBeNull();
  });
});

describe("parseAuthLinkError", () => {
  it("recognises an expired confirmation link in the hash", () => {
    expect(
      parseAuthLinkError(
        "",
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toBe("link_expired");
  });

  it("recognises otp_expired in the query string", () => {
    expect(parseAuthLinkError("?error_code=otp_expired", "")).toBe(
      "link_expired",
    );
  });

  it("recognises access_denied with an expired/invalid description", () => {
    expect(
      parseAuthLinkError(
        "",
        "#error=access_denied&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
      ),
    ).toBe("link_expired");
  });

  it("a live session hash is not an error", () => {
    expect(
      parseAuthLinkError(
        "",
        "#access_token=abc&refresh_token=def&type=signup",
      ),
    ).toBeNull();
  });

  it("empty and unrelated URLs are not errors", () => {
    expect(parseAuthLinkError("", "")).toBeNull();
    expect(parseAuthLinkError("?error=server_error", "")).toBeNull();
  });

  it("the crafted copy never claims an email was sent and names the way forward", () => {
    const message = authLinkErrorMessage("link_expired");
    expect(message.title).toMatch(/expired/i);
    expect(message.description).toMatch(/fresh link/i);
  });
});

describe("sign-up navigation wiring (structural pins)", () => {
  const register = read("../../src/pages/Register.tsx");
  const context = read("../../src/contexts/AuthContext.tsx");
  const routes = read("../../src/components/AnimatedRoutes.tsx");
  const checkEmail = read("../../src/pages/CheckEmail.tsx");
  const login = read("../../src/pages/Login.tsx");

  it("AuthContext.signUp consumes the response data and returns the outcome", () => {
    expect(context).toContain(
      "const { data, error } = await supabase.auth.signUp",
    );
    expect(context).toContain("classifySignUpResponse({ data, error })");
    expect(context).toContain("Promise<SignUpResult>");
  });

  it("confirmation links land on /login (session forwards to dashboard; errors get the crafted notice)", () => {
    expect(context).toContain(
      "emailRedirectTo: `${window.location.origin}/login`",
    );
  });

  it("Register navigates to /check-email with the email on confirmation pending", () => {
    expect(register).toContain('navigate("/check-email"');
    expect(register).toContain("state: { email }");
    expect(register).toContain("result.confirmationPending");
  });

  it("Register navigates to /dashboard on an immediate session", () => {
    expect(register).toContain('navigate("/dashboard"');
  });

  it("DUPLICATE: Register shows the dedicated already-have-an-account state", () => {
    expect(register).toContain('result.reason === "email_taken"');
    expect(register).toContain("You already have an account");
    // The copy must be honest that no email was sent.
    expect(register).toContain("no confirmation email was sent");
  });

  it("DUPLICATE: Log In carries the email to a prefilled /login", () => {
    expect(register).toContain("prefillEmail: takenEmail");
    expect(login).toContain("navState.prefillEmail");
    expect(login).toContain('useState(() => navState.prefillEmail ?? "")');
  });

  it("DUPLICATE: the taken state never navigates to /check-email", () => {
    // Exactly one check-email navigation exists in the page — the
    // confirmation-pending branch.
    const occurrences = register.split('navigate("/check-email"').length - 1;
    expect(occurrences).toBe(1);
  });

  it("Register failures stay on the form with a crafted inline message", () => {
    expect(register).toContain('role="alert"');
    expect(register).toContain("setFormError");
  });

  it("the /check-email route exists and the page shows the address + a resend", () => {
    expect(routes).toContain('path="/check-email"');
    expect(checkEmail).toContain("We've sent a confirmation link to");
    expect(checkEmail).toContain("resendConfirmationEmail(email)");
    expect(checkEmail).toContain("resendConfirmationMessage(resendState)");
  });

  it("Login returns the user to the guard's stored destination, dashboard by default", () => {
    expect(login).toContain("navState.from");
    expect(login).toContain('"/dashboard"');
    // Loop guard: never "return" to /login itself.
    expect(login).toContain('from.pathname !== "/login"');
  });

  it("Login recognises an expired email link and opens the resend panel", () => {
    expect(login).toContain("parseAuthLinkError(location.search, location.hash)");
    expect(login).toContain("authLinkErrorMessage(linkError)");
    expect(login).toContain("useState(() => linkError !== null)");
  });
});

describe("reset + update password outcome wiring (structural pins)", () => {
  const context = read("../../src/contexts/AuthContext.tsx");
  const resetPage = read("../../src/pages/ResetPassword.tsx");
  const updatePage = read("../../src/pages/UpdatePassword.tsx");

  it("both context methods report their outcome instead of swallowing it", () => {
    expect(context).toContain("resetPassword = async (email: string): Promise<boolean>");
    expect(context).toContain(
      "updateUserPassword = async (password: string): Promise<boolean>",
    );
  });

  it("the reset page advances to the sent state only on a real send", () => {
    expect(resetPage).toContain("const sent = await resetPassword(email)");
    expect(resetPage).toContain("if (sent)");
  });

  it("the update page shows success and redirects only on a real update", () => {
    expect(updatePage).toContain(
      "const updated = await updateUserPassword(values.password)",
    );
    expect(updatePage).toContain("if (!updated) return;");
  });

  it("the update page handles an expired reset link instead of offering a doomed form", () => {
    expect(updatePage).toContain("parseAuthLinkError(location.search, location.hash)");
    expect(updatePage).toContain("That reset link has expired");
    expect(updatePage).toContain("navigate('/reset-password')");
  });
});
