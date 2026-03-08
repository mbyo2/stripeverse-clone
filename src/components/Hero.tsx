import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Zap, Globe, CheckCircle2 } from "lucide-react";
import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="pt-28 pb-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-hero-pattern" />
      <div className="absolute top-0 right-0 w-1/2 h-full opacity-[0.03]">
        <div className="absolute inset-0 bg-gradient-radial from-primary to-transparent" />
      </div>

      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left Content */}
          <div className="max-w-xl">
            <FadeIn delay={0.1} duration={0.5} distance={12}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <Zap className="h-3.5 w-3.5" />
                Zambia's Leading Payment Platform
              </div>
            </FadeIn>

            <FadeIn delay={0.2} duration={0.6} distance={16}>
              <h1 className="heading-1 mb-6 text-foreground">
                The simpler, safer way to pay and get paid
              </h1>
            </FadeIn>

            <FadeIn delay={0.3} duration={0.5} distance={12}>
              <p className="body-text mb-8 text-lg">
                Accept payments online, send money to anyone, and manage your business finances — all in one place. Built for Zambian businesses.
              </p>
            </FadeIn>

            <FadeIn delay={0.4} duration={0.5} distance={10}>
              <div className="flex flex-wrap gap-3 mb-10">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
                    <Link to="/register">
                      Sign Up for Free <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </motion.div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button variant="outline" asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
                    <Link to="/developers">
                      Developer Docs
                    </Link>
                  </Button>
                </motion.div>
              </div>
            </FadeIn>

            <FadeIn delay={0.5} duration={0.5} distance={8}>
              <div className="flex flex-col gap-3">
                {[
                  'No setup fees or monthly charges',
                  'Accept Mobile Money, Cards & USSD',
                  'Bank of Zambia Approved',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>

          {/* Right - Feature Cards */}
          <div className="hidden lg:block relative">
            <div className="space-y-4">
              <FadeIn delay={0.3} duration={0.6} distance={20}>
                <motion.div 
                  className="bg-card rounded-xl border border-border p-6 shadow-medium"
                  whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl paypal-gradient flex items-center justify-center">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Secure Payments</h3>
                      <p className="text-sm text-muted-foreground">PCI DSS compliant infrastructure</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {['MTN Money', 'Airtel Money', 'Visa', 'Mastercard'].map((m) => (
                      <span key={m} className="px-2.5 py-1 bg-muted rounded-md text-xs font-medium text-muted-foreground">{m}</span>
                    ))}
                  </div>
                </motion.div>
              </FadeIn>

              <div className="grid grid-cols-2 gap-4">
                <FadeIn delay={0.4} duration={0.6} distance={20}>
                  <motion.div 
                    className="bg-card rounded-xl border border-border p-6 shadow-subtle"
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Globe className="h-8 w-8 text-primary mb-3" />
                    <h4 className="font-semibold text-foreground mb-1">Multi-Currency</h4>
                    <p className="text-sm text-muted-foreground">ZMW, USD, GBP & more</p>
                  </motion.div>
                </FadeIn>

                <FadeIn delay={0.5} duration={0.6} distance={20}>
                  <motion.div 
                    className="bg-card rounded-xl border border-border p-6 shadow-subtle"
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Zap className="h-8 w-8 text-warning mb-3" />
                    <h4 className="font-semibold text-foreground mb-1">Instant Settlement</h4>
                    <p className="text-sm text-muted-foreground">Same-day payouts</p>
                  </motion.div>
                </FadeIn>
              </div>

              <FadeIn delay={0.6} duration={0.6} distance={20}>
                <motion.div 
                  className="bg-card rounded-xl border border-border p-5 shadow-subtle flex items-center justify-between"
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {[0,1,2,3].map((i) => (
                        <div key={i} className="w-8 h-8 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center text-xs font-bold text-primary">
                          {String.fromCharCode(65 + i)}
                        </div>
                      ))}
                    </div>
                    <span className="text-sm text-muted-foreground">Trusted by 500+ businesses</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, i) => (
                      <svg key={i} className="w-4 h-4 text-warning fill-current" viewBox="0 0 20 20">
                        <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                      </svg>
                    ))}
                  </div>
                </motion.div>
              </FadeIn>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
