import { Link } from "react-router-dom";
import { ArrowDown } from "lucide-react";
import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

/**
 * Hero rebuilt to PayPal.com's actual composition, per the live visual
 * capture of paypal.com taken 2026-10-24: plain WHITE background (no
 * colour band, no gradient), a centred stack — one huge extra-bold
 * black headline, ONE short black supporting line, ONE solid black
 * pill button — then a FULL-BLEED photograph, edge-to-edge across the
 * viewport with square corners: no frame, no shadow, no inset margins.
 * The Bitcoin wallet is the product, so the headline leads with it;
 * the custody choice is covered in the #bitcoin section below.
 * (Top padding is spacing only — the fixed-header offset is owned by
 * the spacer in Header.tsx.)
 */
const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="bg-white dark:bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-14 md:pt-[88px] pb-14 md:pb-[72px] text-center">
        <FadeIn delay={0.1} duration={0.6} distance={16}>
          <h1 className="font-display font-extrabold text-black dark:text-white tracking-[-0.03em] leading-[1.05] text-[42px] sm:text-[58px] lg:text-[76px] max-w-6xl mx-auto">
            Your Bitcoin wallet, built for Zambia
          </h1>
        </FadeIn>

        <FadeIn delay={0.18} duration={0.6} distance={16}>
          <p className="mt-6 text-[17px] md:text-[19px] leading-[1.55] text-black dark:text-white/80 max-w-2xl mx-auto">
            Deposit kwacha, buy and sell Bitcoin, and withdraw whenever you
            like.
          </p>
        </FadeIn>

        <FadeIn delay={0.25} duration={0.6} distance={16}>
          <div className="mt-9 flex flex-col items-center justify-center">
            <Link
              to="/register"
              className="inline-flex items-center h-12 rounded-full bg-black px-[30px] text-[15px] font-semibold text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85 transition-colors"
            >
              Open your Bitcoin wallet
            </Link>
            <a
              href="#bitcoin"
              className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#003087] dark:text-white hover:underline underline-offset-4"
            >
              See how the wallet works
              <ArrowDown className="h-4 w-4" />
            </a>
          </div>
        </FadeIn>
      </div>

      <FadeIn delay={0.35} duration={0.6} distance={20}>
        <img
          src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2400&auto=format&fit=crop"
          alt="A smiling customer paying with her smartphone at a shop checkout counter"
          className="block w-full aspect-[16/9] md:aspect-[21/9] object-cover rounded-none"
        />
      </FadeIn>
    </section>
  );
};

export default Hero;
