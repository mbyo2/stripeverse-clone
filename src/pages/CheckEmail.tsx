import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MailCheck, Send } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import {
  resendConfirmationMessage,
  type ResendConfirmationOutcome,
} from "@/lib/authRecovery";

type ResendState = "idle" | "sending" | ResendConfirmationOutcome;

// The landing a successful sign-up was always supposed to reach
// (CEO report, 2026-10-26: submitting the sign-up form left the
// user on the form — the confirmation-pending branch never
// navigated). Register navigates here with the address in router
// state; the page states plainly what was sent and where, offers a
// resend whose outcome is presented in place, and links onward to
// log in — no dead end even if the state is missing (e.g. a refresh
// or a bookmarked URL), in which case the copy stays generic.
const CheckEmail = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { resendConfirmationEmail } = useAuth();
  const email = (location.state as { email?: string } | null)?.email ?? "";
  const [resendState, setResendState] = useState<ResendState>("idle");

  const handleResend = async () => {
    if (resendState === "sending" || !email) return;
    setResendState("sending");
    const outcome = await resendConfirmationEmail(email);
    setResendState(outcome);
  };

  const resendFeedback =
    resendState !== "idle" && resendState !== "sending"
      ? resendConfirmationMessage(resendState)
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 pt-6 pb-16">
        <div className="w-full max-w-[480px]">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary mb-4">
              <MailCheck className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">
              Check your email
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              One more step to activate your account
            </p>
          </div>

          <Card className="shadow-medium">
            <CardContent className="pt-8 pb-6 px-8 space-y-4">
              <p className="text-sm text-foreground">
                {email ? (
                  <>
                    We've sent a confirmation link to <strong>{email}</strong>.
                    Tap the link in that email to confirm your account, then
                    come back and sign in.
                  </>
                ) : (
                  <>
                    We've sent a confirmation link to your email address. Tap
                    the link in that email to confirm your account, then come
                    back and sign in.
                  </>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                If it isn't there in a few minutes, check your spam folder —
                or send a fresh link below.
              </p>

              {email && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    onClick={handleResend}
                    disabled={resendState === "sending"}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {resendState === "sending"
                      ? "Sending..."
                      : "Resend confirmation email"}
                  </Button>
                  {resendFeedback && (
                    <div role="status">
                      <p className="text-sm font-medium text-foreground">
                        {resendFeedback.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {resendFeedback.description}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col space-y-3 px-8 pb-8 pt-0">
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={() =>
                  navigate("/login", {
                    state: email ? { prefillEmail: email } : undefined,
                  })
                }
              >
                Go to log in
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                Used the wrong email?{" "}
                <Link to="/register" className="text-primary hover:underline font-semibold">
                  Sign up again
                </Link>
              </div>
            </CardFooter>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default CheckEmail;
