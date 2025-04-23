import { useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Wallet, CreditCard } from "lucide-react";

interface HeroProps {
  isAuthenticated: boolean;
}

const Hero = ({ isAuthenticated }: HeroProps) => {
  const heroRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      
      const { clientX, clientY } = e;
      const { width, height, left, top } = heroRef.current.getBoundingClientRect();
      
      const x = (clientX - left) / width - 0.5;
      const y = (clientY - top) / height - 0.5;
      
      const moveX = x * 20;
      const moveY = y * 10;
      
      const productImage = heroRef.current.querySelector('.product-image') as HTMLElement;
      const bgGradient = heroRef.current.querySelector('.bg-gradient') as HTMLElement;
      
      if (productImage && bgGradient) {
        productImage.style.transform = `translate(${moveX * -1}px, ${moveY * -1}px)`;
        bgGradient.style.transform = `translate(${moveX * 0.5}px, ${moveY * 0.5}px)`;
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <section 
      ref={heroRef}
      className="min-h-screen flex items-center justify-center pt-20 relative overflow-hidden bg-hero-pattern"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-[80%] h-[60%] top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green"></div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-0 items-center z-10">
        <div className="lg:pr-10 max-w-2xl">
          <span className="inline-block px-3 py-1 rounded-full bg-theme-purple/10 text-theme-purple font-medium mb-6 animate-fadeIn animate-delay-1">
            Zambia's Premier Payment Gateway
          </span>
          {isAuthenticated ? (
            <>
              <h1 className="heading-1 mb-6 animate-fadeInUp animate-delay-2 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green bg-clip-text text-transparent">
                Welcome back to<br />BMaGlass Pay
              </h1>
              <p className="body-text mb-8 animate-fadeInUp animate-delay-3">
                Continue managing your payments and transactions seamlessly. Access your dashboard
                to view your latest activity and manage your account.
              </p>
              <div className="flex flex-wrap gap-4 animate-fadeInUp animate-delay-4">
                <Button asChild className="bg-primary text-white">
                  <Link to="/dashboard">
                    Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/wallet">
                    View Wallet
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="heading-1 mb-6 animate-fadeInUp animate-delay-2 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green bg-clip-text text-transparent">
                Empowering Zambian<br />businesses with seamless payments
              </h1>
              <p className="body-text mb-8 animate-fadeInUp animate-delay-3">
                BMaGlass Pay is Lusaka's most reliable payment gateway, designed specifically for Zambian 
                businesses. Our platform makes accepting payments, managing finances, and growing your 
                business easier than ever.
              </p>
              <div className="flex flex-wrap gap-4 animate-fadeInUp animate-delay-4">
                <Button asChild className="bg-primary text-white">
                  <Link to="/register">
                    Start Accepting Payments <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/login">
                    Business Login
                  </Link>
                </Button>
              </div>
            </>
          )}
          
          <div className="mt-10 flex items-center text-sm text-muted-foreground">
            <div className="flex -space-x-1 mr-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-primary/20 flex items-center justify-center text-[10px] font-bold">
                  {String.fromCharCode(65 + i)}
                </div>
              ))}
            </div>
            <span>Trusted by 1,000+ Zambian businesses</span>
          </div>
        </div>
        
        <div className="relative h-[500px] lg:h-[600px] flex items-center justify-center">
          <div className="absolute w-80 h-80 bg-gradient-radial from-theme-purple/20 to-transparent opacity-70 blur-2xl rounded-full animate-float"></div>
          <div className="relative z-10 transition-transform duration-700 ease-apple-ease product-image animate-scaleIn animate-delay-3">
            <div className="bg-white/90 backdrop-blur-sm p-8 rounded-3xl shadow-xl border border-gray-100 w-[320px]">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-bold text-lg">Business Dashboard</h3>
                  <p className="text-sm text-muted-foreground">Transaction Overview</p>
                </div>
                <Wallet className="h-10 w-10 text-primary p-2 bg-primary/10 rounded-full" />
              </div>
              
              <div className="mb-6">
                <p className="text-sm text-muted-foreground mb-1">Today's Transactions</p>
                <h2 className="text-3xl font-bold">K 24,560.00</h2>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-secondary/20 p-3 rounded-xl flex flex-col items-center justify-center">
                  <ArrowRight className="h-6 w-6 mb-2 text-primary" />
                  <span className="text-sm font-medium">Analytics</span>
                </div>
                <div className="bg-secondary/20 p-3 rounded-xl flex flex-col items-center justify-center">
                  <CreditCard className="h-6 w-6 mb-2 text-primary" />
                  <span className="text-sm font-medium">Settlement</span>
                </div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-gray-100">
                <div className="text-sm text-center text-muted-foreground">
                  Secure • Reliable • Local
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 animate-fadeIn animate-delay-5">
        <div className="w-8 h-12 rounded-full border-2 border-foreground/20 flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-foreground/60 rounded-full animate-float"></div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
