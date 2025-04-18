
import React from 'react';
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import PaymentSolutions from "@/components/Features";
import Products from "@/components/Products";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

const Home = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen overflow-x-hidden">
      <Header />
      <main>
        <Hero isAuthenticated={!!user} />
        <PaymentSolutions />
        <Products />
        {!user && <Contact />} {/* Only show contact form for non-authenticated users */}
      </main>
      <Footer />
    </div>
  );
};

export default Home;
