import { Link } from "react-router-dom";
import { Bitcoin } from "lucide-react";
import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

/**
 * PayPal-pattern hero: one flat warm cream band, fully centred.
 * The Bitcoin wallet is the product, so the hero leads with it: one
 * oversized black headline, a plain-language sub-headline covering
 * deposit / buy / sell / withdraw and the custody choice, the wallet
 * CTAs, then one large white card holding the photograph.
 * (Top padding is spacing only — the fixed-header offset is owned by
 * the spacer in Header.tsx.)
 */
const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="bg-[#FEF3E2] dark:bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-14 md:pt-[88px] pb-16 md:pb-24 text-center">
        <FadeIn delay={0.05} duration={0.6} distance={12}>
          <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.06] dark:bg-white/10 px-4 py-1.5 text-[13px] font-semibold text-black dark:text-white">
            <Bitcoin className="h-4 w-4 text-[#F7931A]" />
            The Bitcoin wallet for Zambia
          </span>
        </FadeIn>

        <FadeIn delay={0.1} duration={0.6} distance={16}>
          <h1 className="mt-6 font-display font-extrabold text-black dark:text-white tracking-[-0.03em] leading-[1.05] text-[42px] sm:text-[58px] lg:text-[76px] max-w-4xl mx-auto">
            Your Bitcoin wallet, built for Zambia
          </h1>
        </FadeIn>

        <FadeIn delay={0.18} duration={0.6} distance={16}>
          <p className="mt-6 text-[17px] md:text-[19px] leading-[1.55] text-[#44464A] dark:text-white/70 max-w-2xl mx-auto">
            Deposit kwacha, buy and sell Bitcoin, and withdraw whenever you
            like. Keep your Bitcoin in a wallet we secure for you — or hold
            your own keys with a seed-phrase wallet. The choice is yours.
          </p>
        </FadeIn>

        <FadeIn delay={0.25} duration={0.6} distance={16}>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center h-12 rounded-full bg-[#F7931A] px-[30px] text-[15px] font-semibold text-black hover:bg-[#DE830A] transition-colors"
            >
              Open your Bitcoin wallet
            </Link>
            <a
              href="#bitcoin"
              className="inline-flex items-center h-12 rounded-full bg-white dark:bg-white/10 px-[30px] text-[15px] font-semibold text-[#003087] dark:text-white hover:bg-[#E9EEF5] dark:hover:bg-white/15 transition-colors"
            >
              See how the wallet works
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.35} duration={0.6} distance={20}>
          <div className="mt-12 md:mt-16 max-w-5xl mx-auto bg-white rounded-[32px] p-2.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.12)]">
            <img
              src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2400&auto=format&fit=crop"
              alt="A smiling customer paying with her smartphone at a shop checkout counter"
              className="w-full aspect-[16/9] object-cover rounded-[24px]"
            />
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default Hero;
