import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Footer from "@/components/Footer";
import {
  PhotoBand,
  BitcoinSection,
  MobileMoneySection,
  CheckoutSection,
  BusinessSection,
  SecurityBand,
  FinalCta,
} from "@/components/LandingSections";

const Index = () => {
  const { user } = useAuth();

  // Redirect authenticated users to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-white dark:bg-background text-foreground">
      <Header />
      <main>
        <Hero isAuthenticated={false} />
        <PhotoBand />
        <BitcoinSection />
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
