import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import PaymentSolutions from "@/components/Features";
import Products from "@/components/Products";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";
import {
  FeatureCards,
  PersonalSection,
  CheckoutSection,
  BitcoinSection,
  BusinessBand,
  FinalCta,
} from "@/components/LandingSections";

const Index = () => {
  const { user } = useAuth();

  // Redirect authenticated users to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Header />
      <main>
        <Hero isAuthenticated={false} />
        <FeatureCards />
        <PersonalSection />
        <PaymentSolutions />
        <CheckoutSection />
        <BitcoinSection />
        <Products />
        <BusinessBand />
        <FinalCta />
        <Contact />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
