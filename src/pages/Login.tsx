
import { useState } from "react";
import { Link, Navigate, useLocation, type Location } from "react-router-dom";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Hash, Lock, Mail, MailCheck, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  authLinkErrorMessage,
  parseAuthLinkError,
  resendConfirmationMessage,
  type ResendConfirmationOutcome,
} from "@/lib/authRecovery";
import {
  consumeSessionEndedNotice,
  SESSION_ENDED_MESSAGE,
} from "@/lib/authFailure";
import { isAuthPending } from "@/lib/sessionHint";
import { useFeatureVisibility } from "@/hooks/useFeatureVisibility";
import { RouteShellSkeleton } from "@/components/ui/skeletons";

type ResendState = "idle" | "sending" | ResendConfirmationOutcome;

const Login = () => {
  const location = useLocation();
  // Router state this page honours: `from` (the protected page the
  // route guard bounced the user away from — sign-in returns them
  // there instead of always dropping them on the dashboard) and
  // `prefillEmail` (carried from sign-up's "you already have an
  // account" state and from the check-email page, so nobody retypes
  // an address the app already knows).
  const navState = (location.state ?? {}) as {
    from?: Location;
    prefillEmail?: string;
  };
  const [email, setEmail] = useState(() => navState.prefillEmail ?? "");
  const [password, setPassword] = useState("");
  // A confirmation/resend link that expired in transit lands here
  // with error parameters in the URL (the auth flows redirect email
  // links to /login for exactly this reason): explain it in plain
  // language and open the resend panel — never a bare form.
  const [linkError] = useState(() =>
    parseAuthLinkError(location.search, location.hash),
  );
  const [showResend, setShowResend] = useState(() => linkError !== null);
  const [resendState, setResendState] = useState<ResendState>("idle");
  // Set by AuthContext when a stored session turned out to be dead
  // (e.g. after a cache/site-data clear) and was ended cleanly: the
  // user lands here instead of on a dashboard error wall, and this
  // notice — consumed once — explains why in plain language.
  const [sessionEndedNotice] = useState(() => consumeSessionEndedNotice());
  const { signIn, resendConfirmationEmail, isLoading, user, isAuthReady, hasStoredSession } = useAuth();
  const { canSee } = useFeatureVisibility();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await signIn(email, password);
    // The one failure this page can fix itself: the account exists
    // but its email was never confirmed. Offer the resend in place
    // instead of leaving the user at a dead end.
    if (!result.ok && result.emailNotConfirmed) {
      setShowResend(true);
      setResendState("idle");
    }
  };

  const handleResend = async () => {
    if (resendState === "sending") return;
    setResendState("sending");
    const outcome = await resendConfirmationEmail(email);
    setResendState(outcome);
  };

  const resendFeedback =
    resendState !== "idle" && resendState !== "sending"
      ? resendConfirmationMessage(resendState)
      : null;

  if (user) {
    // Return to the page the guard stored, when there is one —
    // anything else (including this page itself, which would loop)
    // falls back to the dashboard.
    const from = navState.from;
    const destination =
      from && from.pathname && from.pathname !== "/login"
        ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`
        : "/dashboard";
    return <Navigate to={destination} replace />;
  }

  // A stored session is still resolving (this page is where email
  // confirmation links land, often WITH a live session): hold the
  // shell skeleton instead of painting the login form the session
  // is about to forward past. Signed-out visitors have no stored
  // session and see the form immediately, as before.
  if (isAuthPending({ user, isAuthReady, hasStoredSession })) {
    return <RouteShellSkeleton variant="authed" />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 pt-6 pb-16">
        <div className="w-full max-w-[440px]">
          {/* Logo / Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary mb-4">
              <Lock className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">Log in to your account</h1>
          </div>

          {sessionEndedNotice && (
            <div
              role="status"
              className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-center text-sm font-medium text-foreground"
            >
              {SESSION_ENDED_MESSAGE}
            </div>
          )}

          {linkError && (
            <div
              role="status"
              className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-center"
            >
              <p className="text-sm font-semibold text-foreground">
                {authLinkErrorMessage(linkError).title}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {authLinkErrorMessage(linkError).description}
              </p>
            </div>
          )}

          <Card className="shadow-medium">
            <CardContent className="pt-8 pb-6 px-8">
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10 h-12 rounded-lg border-border bg-background"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-foreground">Password</Label>
                    <Link to="/reset-password" className="text-sm text-primary hover:underline font-medium">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-10 h-12 rounded-lg border-border bg-background"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Log In"}
                </Button>
              </form>

              {showResend && (
                <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <MailCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-foreground">
                        Your email isn't confirmed yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        We sent a confirmation link to your email when you signed up. Tap that
                        link, then sign in. If you can't find it, we can send a fresh one.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        onClick={handleResend}
                        disabled={resendState === "sending" || isLoading}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {resendState === "sending" ? "Sending..." : "Resend confirmation email"}
                      </Button>
                      {resendFeedback && (
                        <div role="status" className="pt-1">
                          <p className="text-sm font-medium text-foreground">{resendFeedback.title}</p>
                          <p className="text-sm text-muted-foreground">{resendFeedback.description}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col space-y-4 px-8 pb-8 pt-0">
              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <div className="text-center text-sm text-muted-foreground">
                New to BMaGlass Pay?{" "}
                <Link to="/register" className="text-primary hover:underline font-semibold">
                  Sign up
                </Link>
              </div>
            </CardFooter>
          </Card>

          {/* USSD access is not live; the link follows the feature
              registry (CEO directive 2026-10-30) and renders only
              for the admin tier. */}
          {canSee('ussdAccess') && (
          <div className="text-center mt-6">
            <Link to="/ussd-access" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
              <Hash className="h-3.5 w-3.5" />
              No smartphone? Access via USSD
            </Link>
          </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Login;
