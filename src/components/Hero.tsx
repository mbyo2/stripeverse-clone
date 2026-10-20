import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Zap, CheckCircle2 } from "lucide-react";
import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="pt-28 pb-16 relative overflow-hidden bg-background">
      {/* Background */}
      <div className="absolute inset-0 bg-hero-pattern" />
      <div className="absolute top-0 right-0 w-1/2 h-full opacity-[0.03]">
        <div className="absolute inset-0 bg-gradient-radial from-primary to-transparent" />
      </div>

      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Content */}
          <div className="max-w-xl">
            <FadeIn delay={0.1} duration={0.5} distance={12}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <Zap className="h-3.5 w-3.5" />
                Zambia's Leading Payment Platform
              </div>
            </FadeIn>

            <FadeIn delay={0.2} duration={0.6} distance={16}>
              <h1 className="heading-1 mb-6 text-paypal-dark">
                The easy way to pay and get paid in Zambia
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

          {/* Right - Hero Photo */}
          <FadeIn delay={0.3} duration={0.6} distance={20}>
            <div className="relative">
              <img
                src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=1600&auto=format&fit=crop"
                alt="A smiling customer paying with her smartphone at a shop checkout counter"
                className="w-full aspect-[4/3] object-cover rounded-[1.5rem] shadow-strong"
              />
              <div className="absolute bottom-4 left-4 hidden md:flex items-start gap-4 bg-card border shadow-medium rounded-2xl p-4 max-w-sm">
                <div className="w-12 h-12 shrink-0 rounded-xl paypal-gradient flex items-center justify-center">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Secure Payments</h3>
                  <p className="text-sm text-muted-foreground mb-3">PCI DSS compliant infrastructure</p>
                  <div className="flex flex-wrap gap-2">
                    {['MTN Money', 'Airtel Money', 'Visa', 'Mastercard'].map((m) => (
                      <span key={m} className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground">{m}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
};

export default Hero;
