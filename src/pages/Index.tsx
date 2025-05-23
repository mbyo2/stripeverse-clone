
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import PaymentSolutions from "@/components/Features";
import Products from "@/components/Products";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

const Index = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Header />
      <main>
        <Hero isAuthenticated={!!user} />
        <PaymentSolutions />
        <Products />
        {!user && <Contact />}
      </main>
      <Footer />
    </div>
  );
};

export default Index;
