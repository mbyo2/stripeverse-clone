import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthPending } from "@/lib/sessionHint";
import { RouteShellSkeleton } from "@/components/ui/skeletons";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Footer from "@/components/Footer";
import {
  PhotoBand,
  BitcoinSection,
  SupportingIntro,
  MobileMoneySection,
  CheckoutSection,
  BusinessSection,
  SecurityBand,
  FinalCta,
} from "@/components/LandingSections";

const Index = () => {
  const { user, isAuthReady, hasStoredSession } = useAuth();

  // Redirect authenticated users to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // A stored session is still resolving: hold the signed-in shell
  // skeleton instead of painting the landing page the session is
  // about to redirect away from (the 2026-10-29 flash — "trying to
  // show another page, then it realizes I'm logged in"). Guests
  // have no stored session, so they are never held here: the
  // landing paints immediately for them, exactly as before.
  if (isAuthPending({ user, isAuthReady, hasStoredSession })) {
    return <RouteShellSkeleton variant="authed" />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-white dark:bg-background text-foreground">
      <Header />
      <main>
        <Hero isAuthenticated={false} />
        <PhotoBand />
        <div id="bitcoin" className="scroll-mt-[72px]">
          <BitcoinSection />
        </div>
        <SupportingIntro />
        <MobileMoneySection />
        <CheckoutSection />
        <BusinessSection />
        <SecurityBand />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
