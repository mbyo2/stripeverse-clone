import { FadeIn } from '@/components/animations';

interface HeroProps {
  isAuthenticated: boolean;
}

/**
 * PayPal-pattern hero: one flat warm cream band, fully centred.
 * A single oversized black headline, then one large white card holding the
 * photograph. Nothing else — conversion lives in the header.
 */
const Hero = ({ isAuthenticated }: HeroProps) => {
  if (isAuthenticated) return null;

  return (
    <section className="bg-[#FEF3E2] dark:bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-32 md:pt-40 pb-16 md:pb-24 text-center">
        <FadeIn delay={0.1} duration={0.6} distance={16}>
          <h1 className="font-display font-extrabold text-black dark:text-white tracking-[-0.03em] leading-[1.05] text-[42px] sm:text-[58px] lg:text-[76px] max-w-4xl mx-auto">
            The easy way to pay and get paid in Zambia
          </h1>
        </FadeIn>

        <FadeIn delay={0.25} duration={0.6} distance={20}>
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
