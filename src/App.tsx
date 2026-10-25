import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { notifyAuthFailure } from "@/lib/authFailureHandler";
import { prefetchWalletRoutes, scheduleIdle } from "@/lib/routePrefetch";
import { AccountProvider } from "@/contexts/AccountContext";
import { RoleProvider } from "@/contexts/RoleContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import MobileBottomNav from "@/components/MobileBottomNav";
import AnimatedRoutes from "@/components/AnimatedRoutes";
import ErrorBoundary from "@/components/ErrorBoundary";
import SessionTimeoutWarning from "@/components/SessionTimeoutWarning";

const queryClient = new QueryClient({
  // App-wide auth-failure net: every query error is offered to the
  // handler AuthProvider registers (lib/authFailureHandler). Only
  // AUTH failures (401 / expired JWT / dead session) trigger session
  // recovery there — a silent refresh, or a clean sign-out to
  // /login — so no page can sit on a "check your connection" card
  // for what is really a dead session. Genuine data failures keep
  // their normal per-page error states untouched.
  queryCache: new QueryCache({
    onError: (error) => notifyAuthFailure(error),
  }),
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Once a user is signed in, warm the wallet route chunks during
 * idle time so wallet navigation doesn't pay the chunk fetch on
 * the click path (see lib/routePrefetch.ts).
 */
const WalletRoutePrefetcher = () => {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    return scheduleIdle(prefetchWalletRoutes);
  }, [user]);
  return null;
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* ThemeProvider lives in main.tsx ONLY. A second, nested one
            here raced it on the <html> class — both stamp the theme
            class on mount, so first paint could resolve light while
            the rest of the tree resolved dark (QA Wave 4: a Wallet
            panel header rendered all-white in dark mode until a
            scroll-triggered repaint). One provider, one authority. */}
        <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
                <AccountProvider>
                <RoleProvider>
                  <NotificationProvider>
                    <CurrencyProvider>
                      <LanguageProvider>
                        <SessionTimeoutWarning />
                        <WalletRoutePrefetcher />
                        <MobileBottomNav />
                        <AnimatedRoutes />
                      </LanguageProvider>
                    </CurrencyProvider>
                  </NotificationProvider>
                </RoleProvider>
                </AccountProvider>
              </AuthProvider>
            </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
