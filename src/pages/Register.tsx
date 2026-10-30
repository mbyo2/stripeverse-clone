
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthPending } from "@/lib/sessionHint";
import { RouteShellSkeleton } from "@/components/ui/skeletons";
import { useToast } from "@/hooks/use-toast";
import { createSubmitGuard } from "@/lib/submitGuard";
import { UserPlus, Mail, Lock, User, CheckCircle2, XCircle, MailCheck, CircleAlert } from "lucide-react";

const Register = () => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { signUp, isLoading, user, isAuthReady, hasStoredSession } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  // Set when sign-up reports the email is already registered: the
  // page swaps the form for a dedicated "you already have an
  // account" state (no check-email claim — no email was sent).
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  // Crafted failure copy shown on the form itself, so a failed
  // sign-up never reads as "nothing happened".
  const [formError, setFormError] = useState<string | null>(null);
  // Double-submit guard: the ref-held guard refuses a second attempt
  // instantly (before React re-renders the disabled button), and the
  // state mirror keeps the button disabled for the whole flight.
  const submitGuardRef = useRef(createSubmitGuard());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordChecks = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "One uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "One number", valid: /[0-9]/.test(password) },
  ];

  const allPasswordValid = passwordChecks.every((c) => c.valid);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!submitGuardRef.current.begin()) return;
    setIsSubmitting(true);
    try {
      if (!allPasswordValid) {
        toast({ title: "Weak password", description: "Please meet all password requirements.", variant: "destructive" });
        return;
      }

      if (password !== confirmPassword) {
        toast({ title: "Passwords don't match", description: "Please make sure both passwords are the same.", variant: "destructive" });
        return;
      }

      setFormError(null);
      // No phone number at sign-up (CEO directive, 2026-10-30):
      // phone is collected later, during identity verification
      // (KYC) — the only place it is asked for.
      const result = await signUp(email, password, {
        first_name: firstName,
        last_name: lastName,
      });

      // Every outcome lands somewhere deliberate — the pre-fix flow
      // awaited a void and stayed on the form for all of them.
      if (result.ok) {
        if (result.confirmationPending) {
          navigate("/check-email", { state: { email }, replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
        return;
      }

      if (result.reason === "email_taken") {
        setTakenEmail(email);
        return;
      }

      setFormError(
        result.reason === "rate_limited"
          ? "You've tried to sign up several times in a short space of time. Please wait a little while, then try again."
          : (result.message ??
            "We couldn't create your account just now. Check your connection and try again."),
      );
    } finally {
      submitGuardRef.current.end();
      setIsSubmitting(false);
    }
  };

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // A stored session is still resolving: hold the shell skeleton
  // instead of painting the sign-up form the session is about to
  // redirect away from. Signed-out visitors have no stored session
  // and see the form immediately, as before.
  if (isAuthPending({ user, isAuthReady, hasStoredSession })) {
    return <RouteShellSkeleton variant="authed" />;
  }

  // Duplicate-email state: the address already has an account, so
  // no account was created and NO confirmation email was sent —
  // the copy must never claim otherwise. The way forward is log in
  // (with the address carried over and prefilled) or reset the
  // password; "use a different email" returns to the form.
  if (takenEmail) {
    return (
      <div className="min-h-screen flex flex-col bg-muted">
        <Header />
        <main className="flex-1 flex items-center justify-center p-4 pt-6 pb-16">
          <div className="w-full max-w-[480px]">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary mb-4">
                <MailCheck className="h-7 w-7 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">You already have an account</h1>
              <p className="text-muted-foreground mt-1 text-sm">No new account was created</p>
            </div>

            <Card className="shadow-medium">
              <CardContent className="pt-8 pb-6 px-8">
                <p className="text-sm text-foreground">
                  There's already a BMaGlass Pay account with{" "}
                  <strong>{takenEmail}</strong>, so we didn't create a new
                  one — and no confirmation email was sent. If this is your
                  account, log in below. If you've forgotten your password,
                  you can reset it instead.
                </p>
              </CardContent>
              <CardFooter className="flex flex-col space-y-3 px-8 pb-8 pt-0">
                <Button
                  className="w-full h-12 text-base font-semibold"
                  onClick={() =>
                    navigate("/login", { state: { prefillEmail: takenEmail } })
                  }
                >
                  Log in
                </Button>
                <Link
                  to="/reset-password"
                  className="text-sm text-primary hover:underline font-medium"
                >
                  Forgot your password?
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setTakenEmail(null)}
                >
                  Use a different email
                </Button>
              </CardFooter>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 pt-6 pb-16">
        <div className="w-full max-w-[480px]">
          {/* Brand header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary mb-4">
              <UserPlus className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">Create your account</h1>
            <p className="text-muted-foreground mt-1 text-sm">Start sending and receiving money today</p>
          </div>

          <Card className="shadow-medium">
            <CardContent className="pt-8 pb-6 px-8">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm font-medium">First Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="firstName"
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        className="pl-10 h-12 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-sm font-medium">Last Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="lastName"
                        placeholder="Doe"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                        className="pl-10 h-12 rounded-lg"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10 h-12 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Create a strong password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-10 h-12 rounded-lg"
                    />
                  </div>
                  {password.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {passwordChecks.map((check, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {check.valid ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          )}
                          <span className={check.valid ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                            {check.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pl-10 h-12 rounded-lg"
                    />
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Passwords don't match
                    </p>
                  )}
                </div>

                {formError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
                  >
                    <CircleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <p className="text-sm text-destructive">{formError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold mt-2"
                  disabled={isLoading || isSubmitting || !allPasswordValid || (confirmPassword !== "" && password !== confirmPassword)}
                >
                  {isLoading || isSubmitting ? "Creating account..." : "Sign Up"}
                </Button>
              </form>
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
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline font-semibold">
                  Log in
                </Link>
              </div>
            </CardFooter>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            By signing up, you agree to our{" "}
            <Link to="/terms-of-service" className="underline hover:text-primary">Terms</Link>{" "}
            and{" "}
            <Link to="/privacy-policy" className="underline hover:text-primary">Privacy Policy</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Register;
