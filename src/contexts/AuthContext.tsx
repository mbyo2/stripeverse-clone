import { toUserFacingError } from "@/utils/userFacingError";
import {
  classifyResendConfirmation,
  isEmailNotConfirmedError,
  type ResendConfirmationOutcome,
} from "@/lib/authRecovery";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { expirySchedule, shouldSignOutAfterVerify } from "@/lib/sessionLifecycle";

// What a sign-in attempt came to. `emailNotConfirmed` is the one
// failure the login page can act on itself (offer a resend), so it
// travels back to the caller instead of only reaching a toast.
export type SignInResult = {
  ok: boolean;
  emailNotConfirmed: boolean;
};

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string, twoFactorCode?: string) => Promise<SignInResult>;
  signUp: (email: string, password: string, userData: UserData) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserPassword: (password: string) => Promise<void>;
  resendEmailConfirmation: () => Promise<void>;
  resendConfirmationEmail: (email: string) => Promise<ResendConfirmationOutcome>;
  enable2FA: () => Promise<{ qrCode: string; secret: string }>;
  verify2FA: (token: string) => Promise<boolean>;
  disable2FA: (token: string) => Promise<void>;
  checkRateLimit: (action: string) => Promise<boolean>;
  sessionTimeoutWarning: boolean;
  extendSession: () => Promise<void>;
  verifySession: () => Promise<void>;
};

type UserData = {
  first_name: string;
  last_name: string;
  phone: string;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Enforced per-action attempt limits applied by checkRateLimit via the
// check_advanced_rate_limit RPC. Exported so the API Rate Limits page can
// show the same numbers the app actually enforces — not invented ones.
export const AUTH_RATE_LIMIT_ATTEMPTS: Record<string, number> = {
  login: 5,
  signup: 3,
  password_reset: 3,
  email_confirmation: 3,
};
export const AUTH_RATE_LIMIT_WINDOW_MINUTES = 15;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionTimeoutWarning, setSessionTimeoutWarning] = useState(false);
  
  const { toast } = useToast();

  // Session expiry management. Reaching the access token's expiry
  // is NOT a sign-out (see lib/sessionLifecycle.ts for the forensic
  // background): supabase-js auto-refreshes the token, and this
  // effect merely schedules a warning beforehand and a VERIFY point
  // at expiry. The verify asks GoTrue to refresh; only a genuine
  // refresh failure ends the session. In the healthy path the
  // refresh lands first, the session state changes, and this effect
  // re-arms with the new expiry — the verify never fires.
  useEffect(() => {
    if (!session) return;

    const { warnDelayMs, verifyDelayMs } = expirySchedule(session.expires_at, Date.now());

    const timeoutWarning =
      warnDelayMs !== null
        ? setTimeout(() => setSessionTimeoutWarning(true), warnDelayMs)
        : undefined;
    const verifyTimer =
      verifyDelayMs !== null
        ? setTimeout(() => {
            void verifySession();
          }, verifyDelayMs)
        : undefined;

    return () => {
      if (timeoutWarning) clearTimeout(timeoutWarning);
      if (verifyTimer) clearTimeout(verifyTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Setup auth state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
        setSessionTimeoutWarning(false);

        // Track session in database
        if (session?.user) {
          setTimeout(async () => {
            try {
              await supabase.from('user_sessions').insert({
                user_id: session.user.id,
                session_token: session.access_token,
                expires_at: new Date(session.expires_at! * 1000).toISOString(),
                device_info: {
                  userAgent: navigator.userAgent,
                  platform: navigator.platform,
                  language: navigator.language
                }
              });
            } catch (error) {
              console.error('Error tracking session:', error);
            }
          }, 0);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkRateLimit = async (action: string): Promise<boolean> => {
    try {
      // Server-side rate limiting using database function
      const identifier = user?.id || 'anonymous_' + Math.random().toString(36).substring(7);

      const { data, error } = await supabase.rpc('check_advanced_rate_limit', {
        p_identifier: identifier,
        p_action: action,
        p_max_attempts: AUTH_RATE_LIMIT_ATTEMPTS[action] ?? 3,
        p_window_minutes: AUTH_RATE_LIMIT_WINDOW_MINUTES,
        p_ip_address: null // IP would be captured server-side in production
      });
      
      if (error) {
        console.error('Rate limit check error:', error);
        // Allow on error to prevent blocking legitimate users
        return true;
      }
      
      if (!data) {
        toast({
          title: "Rate limit exceeded",
          description: "Too many attempts. Please try again in 15 minutes.",
          variant: "destructive",
        });
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Rate limit error:', error);
      // Allow on error to prevent blocking legitimate users
      return true;
    }
  };

  const signIn = async (email: string, password: string, twoFactorCode?: string): Promise<SignInResult> => {
    try {
      setIsLoading(true);

      if (!(await checkRateLimit('login'))) return { ok: false, emailNotConfirmed: false };

      const { error } = await supabase.auth.signInWithPassword({ 
        email, 
        password 
      });
      
      if (error) throw error;
      
      // Check if 2FA is enabled for this user
      if (user) {
        const { data: twoFactorData } = await supabase
          .from('two_factor_auth')
          .select('enabled')
          .eq('user_id', user.id)
          .single();

        if (twoFactorData?.enabled && !twoFactorCode) {
          throw new Error('2FA_REQUIRED');
        }

        // Enhanced 2FA validation - must be done BEFORE setting auth state
        if (twoFactorData?.enabled && twoFactorCode) {
          if (twoFactorCode.length !== 6 || !/^\d{6}$/.test(twoFactorCode)) {
            toast({
              title: "Invalid 2FA code format",
              description: "2FA code must be exactly 6 digits.",
              variant: "destructive",
            });
            return { ok: false, emailNotConfirmed: false };
          }
          
          const isValid = await verify2FA(twoFactorCode);
          if (!isValid) {
            // Log security event for failed 2FA
            await supabase.rpc('log_security_event', {
              p_user_id: user?.id,
              p_event_type: '2fa_verification_failed',
              p_event_data: { email },
              p_risk_score: 6
            });
            
            toast({
              title: "Invalid 2FA code",
              description: "Please check your authenticator app and try again.",
              variant: "destructive",
            });
            return { ok: false, emailNotConfirmed: false };
          }
        }
      }
      
      toast({
        title: "Welcome back!",
        description: "You've successfully signed in.",
      });

      return { ok: true, emailNotConfirmed: false };
      // Navigation will be handled by components that use this context
    } catch (error: any) {
      if (error.message === '2FA_REQUIRED') {
        // Handle 2FA requirement in UI
        return { ok: false, emailNotConfirmed: false };
      }

      toast({
        title: "Sign in failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
      return { ok: false, emailNotConfirmed: isEmailNotConfirmedError(error) };
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, userData: UserData) => {
    try {
      setIsLoading(true);
      
      if (!(await checkRateLimit('signup'))) return;

      const { error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          data: {
            first_name: userData.first_name,
            last_name: userData.last_name,
            phone: userData.phone,
          },
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
      
      if (error) throw error;
      
      toast({
        title: "Account created",
        description: "Please check your email to confirm your account.",
      });
      
      // Navigation will be handled by components that use this context
    } catch (error: any) {
      toast({
        title: "Registration failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      
      // Clean up session from database
      if (session) {
        await supabase
          .from('user_sessions')
          .delete()
          .eq('session_token', session.access_token);
      }
      
      // Scope "local": signing out ends THIS device's session only.
      // supabase-js defaults to "global", which revokes every session
      // on every device — so an automatic or stray sign-out anywhere
      // used to sign the user out everywhere (2026-10-25 incident).
      const { error } = await supabase.auth.signOut({ scope: "local" });

      if (error) throw error;
      
      toast({
        title: "Signed out",
        description: "You've been successfully signed out.",
      });
      
      // Navigation will be handled by components that use this context
    } catch (error: any) {
      toast({
        title: "Sign out failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const resetPassword = async (email: string) => {
    try {
      setIsLoading(true);
      
      if (!(await checkRateLimit('password_reset'))) return;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      
      if (error) throw error;
      
      toast({
        title: "Password reset email sent",
        description: "Check your email for a password reset link.",
      });
    } catch (error: any) {
      toast({
        title: "Password reset failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const updateUserPassword = async (password: string) => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) throw error;
      
      toast({
        title: "Password updated",
        description: "Your password has been successfully changed.",
      });
    } catch (error: any) {
      toast({
        title: "Password update failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const resendEmailConfirmation = async () => {
    try {
      setIsLoading(true);
      
      if (!(await checkRateLimit('email_confirmation'))) return;

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user?.email,
      });
      
      if (error) throw error;
      
      toast({
        title: "Verification email sent",
        description: "Please check your inbox for the verification link.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to send verification email",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Resend a signup confirmation email to an address typed on the
  // login page, where there is no signed-in user yet (the existing
  // resendEmailConfirmation above works off the session user). The
  // outcome is returned, not toasted, so the page can present the
  // crafted feedback for each state in place.
  const resendConfirmationEmail = async (email: string): Promise<ResendConfirmationOutcome> => {
    try {
      if (!(await checkRateLimit('email_confirmation'))) return 'rate_limited';

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      return classifyResendConfirmation(error);
    } catch (error: any) {
      return classifyResendConfirmation(error);
    }
  };

  const enable2FA = async (): Promise<{ qrCode: string; secret: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-totp-secret', {
        body: { userId: user?.id }
      });
      
      if (error) throw error;
      
      return data;
    } catch (error: any) {
      toast({
        title: "2FA setup failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
      throw error;
    }
  };

  const verify2FA = async (token: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-totp', {
        body: { userId: user?.id, token }
      });
      
      if (error) throw error;
      
      return data.valid;
    } catch (error: any) {
      toast({
        title: "2FA verification failed",
        description: toUserFacingError(error),
        variant: "destructive",
      });
      return false;
    }
  };

  const disable2FA = async (token: string) => {
    try {
      const isValid = await verify2FA(token);
      if (!isValid) {
        throw new Error('Invalid 2FA code');
      }

      await supabase
        .from('two_factor_auth')
        .update({ enabled: false, secret: null })
        .eq('user_id', user?.id);

      toast({
        title: "2FA disabled",
        description: "Two-factor authentication has been disabled.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to disable 2FA",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    }
  };

  /**
   * The ONLY automatic path that can end a session: ask GoTrue to
   * refresh, and sign out solely when the refresh genuinely fails
   * (see shouldSignOutAfterVerify). Wallet, SDK, chain and
   * edge-function errors never reach this function and can never
   * clear the session.
   */
  const verifySession = async () => {
    let refreshFailed = false;
    try {
      const { error } = await supabase.auth.refreshSession();
      refreshFailed = !!error;
    } catch {
      refreshFailed = true;
    }
    if (!refreshFailed) {
      setSessionTimeoutWarning(false);
      return;
    }
    // The refresh raced a successful background refresh? Re-read the
    // stored session before deciding — if it is valid again, the
    // failure was transient and the session survives.
    let expiresAtAfter: number | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      expiresAtAfter = data.session?.expires_at;
    } catch {
      expiresAtAfter = undefined;
    }
    if (
      shouldSignOutAfterVerify({
        refreshFailed,
        expiresAtSecondsAfter: expiresAtAfter,
        nowMs: Date.now(),
      })
    ) {
      await signOut();
    }
  };

  const extendSession = async () => {
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;
      
      setSessionTimeoutWarning(false);
      toast({
        title: "Session extended",
        description: "Your session has been extended.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to extend session",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      isLoading, 
      signIn, 
      signUp, 
      signOut,
      resetPassword,
      updateUserPassword,
      resendEmailConfirmation,
      resendConfirmationEmail,
      enable2FA,
      verify2FA,
      disable2FA,
      checkRateLimit,
      sessionTimeoutWarning,
      extendSession,
      verifySession
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
