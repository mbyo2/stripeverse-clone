
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string, twoFactorCode?: string) => Promise<void>;
  signUp: (email: string, password: string, userData: UserData) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserPassword: (password: string) => Promise<void>;
  resendEmailConfirmation: () => Promise<void>;
  enable2FA: () => Promise<{ qrCode: string; secret: string }>;
  verify2FA: (token: string) => Promise<boolean>;
  disable2FA: (token: string) => Promise<void>;
  checkRateLimit: (action: string) => Promise<boolean>;
  sessionTimeoutWarning: boolean;
  extendSession: () => Promise<void>;
};

type UserData = {
  first_name: string;
  last_name: string;
  phone: string;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionTimeoutWarning, setSessionTimeoutWarning] = useState(false);
  
  const { toast } = useToast();

  // Session timeout management
  useEffect(() => {
    let timeoutWarning: NodeJS.Timeout;
    let sessionTimeout: NodeJS.Timeout;

    if (session) {
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = session.expires_at || 0;
      const timeUntilExpiry = (expiresAt - now) * 1000;
      
      // Show warning 5 minutes before expiry
      if (timeUntilExpiry > 300000) {
        timeoutWarning = setTimeout(() => {
          setSessionTimeoutWarning(true);
        }, timeUntilExpiry - 300000);
      }
      
      // Auto logout at expiry
      sessionTimeout = setTimeout(() => {
        signOut();
      }, timeUntilExpiry);
    }

    return () => {
      if (timeoutWarning) clearTimeout(timeoutWarning);
      if (sessionTimeout) clearTimeout(sessionTimeout);
    };
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
      const identifier = user?.id || 'anonymous';
      const key = `rate_limit_${identifier}_${action}`;
      const now = Date.now();
      
      // Get stored attempts from localStorage
      const stored = localStorage.getItem(key);
      let attempts = 0;
      let windowStart = now;
      
      if (stored) {
        const data = JSON.parse(stored);
        const timeDiff = now - data.windowStart;
        
        // Reset window if more than 15 minutes have passed
        if (timeDiff > 15 * 60 * 1000) {
          attempts = 1;
          windowStart = now;
        } else {
          attempts = data.attempts + 1;
          windowStart = data.windowStart;
        }
      } else {
        attempts = 1;
      }
      
      // Check limits
      const limit = action === 'login' ? 5 : 3;
      if (attempts > limit) {
        toast({
          title: "Rate limit exceeded",
          description: "Too many attempts. Please try again in 15 minutes.",
          variant: "destructive",
        });
        return false;
      }
      
      // Store updated attempts
      localStorage.setItem(key, JSON.stringify({
        attempts,
        windowStart
      }));
      
      return true;
    } catch (error) {
      console.error('Rate limit error:', error);
      // Allow on error to prevent blocking legitimate users
      return true;
    }
  };

  const signIn = async (email: string, password: string, twoFactorCode?: string) => {
    try {
      setIsLoading(true);
      
      if (!(await checkRateLimit('login'))) return;

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
            return;
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
            return;
          }
        }
      }
      
      toast({
        title: "Welcome back!",
        description: "You've successfully signed in.",
      });
      
      // Navigation will be handled by components that use this context
    } catch (error: any) {
      if (error.message === '2FA_REQUIRED') {
        // Handle 2FA requirement in UI
        return;
      }
      
      toast({
        title: "Sign in failed",
        description: error.message,
        variant: "destructive",
      });
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
        description: error.message,
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
      
      const { error } = await supabase.auth.signOut();
      
      if (error) throw error;
      
      toast({
        title: "Signed out",
        description: "You've been successfully signed out.",
      });
      
      // Navigation will be handled by components that use this context
    } catch (error: any) {
      toast({
        title: "Sign out failed",
        description: error.message,
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
        description: error.message,
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
        description: error.message,
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
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
        description: error.message,
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
        description: error.message,
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
        description: error.message,
        variant: "destructive",
      });
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
        description: error.message,
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
      enable2FA,
      verify2FA,
      disable2FA,
      checkRateLimit,
      sessionTimeoutWarning,
      extendSession
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
