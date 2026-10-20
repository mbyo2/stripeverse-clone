import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="pt-28 pb-16 relative overflow-hidden">
      {/* Background photo */}
      <img
        src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2400&auto=format&fit=crop"
        alt="A smiling customer paying with her smartphone at a shop checkout counter"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-[#001233]/70" />

      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 relative z-10">
        <div className="max-w-xl">
          <FadeIn delay={0.2} duration={0.6} distance={16}>
            <h1 className="heading-1 mb-6 text-white">
              The easy way to pay and get paid in Zambia
            </h1>
          </FadeIn>

          <FadeIn delay={0.3} duration={0.5} distance={12}>
            <p className="body-text mb-8 text-lg text-white/85">
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
                <Button variant="outline" asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12 bg-transparent border-white/80 text-white hover:bg-white/10 hover:text-white">
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
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-white/80">
                  <CheckCircle2 className="h-4 w-4 text-white flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
};

export default Hero;
