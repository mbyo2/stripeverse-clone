import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
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
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

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
