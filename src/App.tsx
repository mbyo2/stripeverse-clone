import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
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
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
