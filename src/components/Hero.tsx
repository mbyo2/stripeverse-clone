import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Wallet, CreditCard } from "lucide-react";
import { useStats } from '@/hooks/useStats';
import { formatCurrency } from '@/utils/formatters';
import { FadeIn, MotionCard } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

const Hero = ({ isAuthenticated }: HeroProps) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { stats } = useStats();
  
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
          <FadeIn delay={0.1} duration={0.6} distance={16}>
            <span className="inline-block px-3 py-1 rounded-full bg-theme-purple/10 text-theme-purple font-medium mb-6">
              Zambia's Premier Payment Gateway
            </span>
          </FadeIn>
          
          {isAuthenticated ? (
            <>
              <FadeIn delay={0.2} duration={0.7} distance={20}>
                <h1 className="heading-1 mb-6 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green bg-clip-text text-transparent">
                  Welcome back to<br />BMaGlass Pay
                </h1>
              </FadeIn>
              <FadeIn delay={0.3} duration={0.6} distance={16}>
                <p className="body-text mb-8">
                  Continue managing your payments and transactions seamlessly. Access your dashboard
                  to view your latest activity and manage your account.
                </p>
              </FadeIn>
              <FadeIn delay={0.4} duration={0.6} distance={12}>
                <div className="flex flex-wrap gap-4">
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                    <Button asChild className="bg-primary text-primary-foreground">
                      <Link to="/dashboard">
                        Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button variant="outline" asChild>
                      <Link to="/wallet">
                        View Wallet
                      </Link>
                    </Button>
                  </motion.div>
                </div>
              </FadeIn>
            </>
          ) : (
            <>
              <FadeIn delay={0.2} duration={0.7} distance={20}>
                <h1 className="heading-1 mb-6 bg-gradient-to-r from-theme-blue via-theme-purple to-theme-green bg-clip-text text-transparent">
                  Empowering Zambian<br />businesses with seamless payments
                </h1>
              </FadeIn>
              <FadeIn delay={0.3} duration={0.6} distance={16}>
                <p className="body-text mb-8">
                  BMaGlass Pay is Lusaka's most reliable payment gateway, designed specifically for Zambian 
                  businesses. Our platform makes accepting payments, managing finances, and growing your 
                  business easier than ever.
                </p>
              </FadeIn>
              <FadeIn delay={0.4} duration={0.6} distance={12}>
                <div className="flex flex-wrap gap-4">
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                    <Button asChild className="bg-primary text-primary-foreground">
                      <Link to="/register">
                        Start Accepting Payments <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button variant="outline" asChild>
                      <Link to="/login">
                        Business Login
                      </Link>
                    </Button>
                  </motion.div>
                </div>
              </FadeIn>
            </>
          )}
          
          <FadeIn delay={0.5} duration={0.6} distance={12}>
            <div className="mt-10 flex items-center text-sm text-muted-foreground">
              <div className="flex -space-x-1 mr-3">
                {[...Array(4)].map((_, i) => (
                  <motion.div 
                    key={i} 
                    className="w-6 h-6 rounded-full border-2 border-background bg-primary/20 flex items-center justify-center text-[10px] font-bold text-foreground"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.1, duration: 0.3 }}
                  >
                    {String.fromCharCode(65 + i)}
                  </motion.div>
                ))}
              </div>
              <span>
                Trusted by {stats?.totalBusinesses || 0}+ Zambian businesses
              </span>
            </div>
          </FadeIn>
          
          {stats && (
            <FadeIn delay={0.6} duration={0.6} distance={16}>
              <div className="mt-6 grid grid-cols-2 gap-4 text-center">
                <MotionCard className="p-4 rounded-lg bg-card/50" hoverScale={1.02} hoverLift={-1}>
                  <p className="text-2xl font-bold text-primary">{stats.totalTransactions.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">Transactions Processed</p>
                </MotionCard>
                <MotionCard className="p-4 rounded-lg bg-card/50" hoverScale={1.02} hoverLift={-1}>
                  <p className="text-2xl font-bold text-primary">{formatCurrency(stats.totalVolume)}</p>
                  <p className="text-sm text-muted-foreground">Total Volume</p>
                </MotionCard>
              </div>
            </FadeIn>
          )}
        </div>
        
        <div className="relative h-[500px] lg:h-[600px] flex items-center justify-center">
          <div className="absolute w-80 h-80 bg-gradient-radial from-theme-purple/20 to-transparent opacity-70 blur-2xl rounded-full animate-float"></div>
          <FadeIn delay={0.3} duration={0.8} direction="none" className="relative z-10 product-image">
            <MotionCard 
              className="bg-card/90 backdrop-blur-sm p-8 rounded-3xl shadow-xl border border-border w-[320px]"
              hoverScale={1.02}
              hoverLift={-4}
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-bold text-lg text-card-foreground">Business Dashboard</h3>
                  <p className="text-sm text-muted-foreground">Transaction Overview</p>
                </div>
                <motion.div
                  whileHover={{ rotate: 10 }}
                  transition={{ type: 'spring', stiffness: 300 }}
                >
                  <Wallet className="h-10 w-10 text-primary p-2 bg-primary/10 rounded-full" />
                </motion.div>
              </div>
              
              <div className="mb-6">
                <p className="text-sm text-muted-foreground mb-1">Today's Activity</p>
                <h2 className="text-3xl font-bold text-card-foreground">View Dashboard</h2>
                <p className="text-sm text-muted-foreground">Real-time transaction monitoring</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <motion.div 
                  className="bg-secondary p-3 rounded-xl flex flex-col items-center justify-center cursor-pointer"
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <ArrowRight className="h-6 w-6 mb-2 text-primary" />
                  <span className="text-sm font-medium text-secondary-foreground">Analytics</span>
                </motion.div>
                <motion.div 
                  className="bg-secondary p-3 rounded-xl flex flex-col items-center justify-center cursor-pointer"
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <CreditCard className="h-6 w-6 mb-2 text-primary" />
                  <span className="text-sm font-medium text-secondary-foreground">Settlement</span>
                </motion.div>
              </div>
              
              <div className="mt-6 pt-4 border-t border-border">
                <div className="text-sm text-center text-muted-foreground">
                  Secure • Reliable • Local
                </div>
              </div>
            </MotionCard>
          </FadeIn>
        </div>
      </div>
      
      <motion.div 
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.6 }}
      >
        <div className="w-8 h-12 rounded-full border-2 border-foreground/20 flex items-start justify-center p-2">
          <motion.div 
            className="w-1 h-2 bg-foreground/60 rounded-full"
            animate={{ y: [0, 6, 0] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          />
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
