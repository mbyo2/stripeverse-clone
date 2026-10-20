import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FadeIn } from '@/components/animations';

/**
 * Landing sections rebuilt to PayPal's rhythm: one full-bleed photo band,
 * alternating white split sections (photo / headline + short copy + one text
 * link), one deep-blue security band, one light-blue closing band.
 * No icon-card rows, no stat bands, no testimonials, no invented numbers.
 */

const DISPLAY = "font-display font-extrabold text-black dark:text-white tracking-[-0.025em] leading-[1.1] text-[32px] md:text-[44px] lg:text-[52px]";
const BODY = "text-[17px] leading-[1.55] text-[#44464A] dark:text-white/70";
const TEXT_LINK = "inline-flex items-center gap-1.5 font-semibold text-[#003087] dark:text-[#F7931A] hover:underline underline-offset-4";

interface SplitProps {
  image: string;
  imageAlt: string;
  headline: string;
  copy: string;
  linkTo: string;
  linkLabel: string;
  flip?: boolean;
}

const SplitSection = ({ image, imageAlt, headline, copy, linkTo, linkLabel, flip = false }: SplitProps) => (
  <section className="bg-white dark:bg-background">
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-24 grid lg:grid-cols-2 gap-10 lg:gap-20 items-center">
      <FadeIn duration={0.6} distance={20} className={flip ? "lg:order-2" : ""}>
        <img
          src={image}
          alt={imageAlt}
          className="w-full aspect-[4/3] object-cover rounded-[24px]"
          loading="lazy"
        />
      </FadeIn>
      <FadeIn duration={0.6} distance={20} delay={0.1} className={flip ? "lg:order-1" : ""}>
        <div className="max-w-xl">
          <h2 className={`${DISPLAY} mb-5`}>{headline}</h2>
          <p className={`${BODY} mb-7`}>{copy}</p>
          <Link to={linkTo} className={TEXT_LINK}>
            {linkLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </FadeIn>
    </div>
  </section>
);

/** Full-bleed photographic band with one giant factual statement. */
export const PhotoBand = () => {
  return (
    <section className="relative overflow-hidden">
      <img
        src="https://images.unsplash.com/photo-1589156280159-27698a70f29e?q=80&w=2400&auto=format&fit=crop"
        alt="A young woman looking out over a city at dusk"
        className="absolute inset-0 w-full h-full object-cover object-[center_28%]"
      />
      {/* Flat solid scrim — the photo's lower half is bright, so this is essential for legibility. No gradient. */}
      <div className="absolute inset-0 bg-[#001233]/45" />
      <div className="relative max-w-[1200px] mx-auto px-4 sm:px-6 h-[540px] md:h-[620px] flex items-end pb-14 md:pb-20">
        <FadeIn duration={0.6} distance={20}>
          <p className="font-display font-extrabold text-white tracking-[-0.025em] leading-[1.08] text-[36px] md:text-[56px] max-w-2xl">
            Buy and sell Bitcoin in Zambia — in kwacha, from your phone.
          </p>
        </FadeIn>
      </div>
    </section>
  );
};

export const BitcoinSection = () => (
  <SplitSection
    image="https://images.unsplash.com/photo-1518546305927-5a555bb7020d?q=80&w=1600&auto=format&fit=crop"
    imageAlt="A physical Bitcoin coin in front of a live trading chart"
    headline="Bitcoin, right beside your kwacha"
    copy="Buy and sell Bitcoin with kwacha, hold it next to your everyday balance, and send it on-chain or over Lightning. Keep it in your BMaGlass wallet — or hold your own keys with a seed-phrase wallet. The choice is yours."
    linkTo="/bitcoin-wallet"
    linkLabel="Open the Bitcoin wallet"
  />
);

export const MobileMoneySection = () => (
  <SplitSection
    flip
    image="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=1600&auto=format&fit=crop"
    imageAlt="Portrait of a young woman in a colourful Ankara print outfit"
    headline="Send money to anyone, the simple way"
    copy="Send money to any phone number, and pay from your wallet with MTN MoMo and Airtel Money — the way Zambia already moves money, now in one place. No setup fees or monthly charges."
    linkTo="/wallet"
    linkLabel="Explore the wallet"
  />
);

export const CheckoutSection = () => (
  <SplitSection
    image="https://images.unsplash.com/photo-1563013544-824ae1b704d3?q=80&w=1600&auto=format&fit=crop"
    imageAlt="A customer paying online by card on a laptop"
    headline="Accept payments everywhere you sell"
    copy="Take cards, mobile money and USSD online and in person with one checkout — and send payment links and invoices when your customer isn't in front of you."
    linkTo="/business"
    linkLabel="Explore business tools"
  />
);

export const BusinessSection = () => (
  <SplitSection
    flip
    image="https://images.unsplash.com/photo-1573164713988-8665fc963095?q=80&w=1600&auto=format&fit=crop"
    imageAlt="An engineer with a laptop working inside a secure data centre"
    headline="One wallet for your whole business"
    copy="Hold kwacha, dollars and pounds in one wallet, pay staff and suppliers, and see every payment your business takes in one place."
    linkTo="/multi-currency"
    linkLabel="Explore multi-currency"
  />
);

/** Deep-blue security & compliance band. Regulatory wording mirrors the Compliance page exactly. */
export const SecurityBand = () => {
  return (
    <section className="bg-[#003087] text-white">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-24">
        <FadeIn duration={0.6} distance={20}>
          <div className="max-w-3xl">
            <h2 className="font-display font-extrabold text-white tracking-[-0.025em] leading-[1.1] text-[32px] md:text-[44px] lg:text-[52px] mb-5">
              Built to keep your money safe
            </h2>
            <p className="text-[17px] leading-[1.55] text-white/85 mb-6">
              Payments are encrypted in transit, accounts are protected with two-factor
              authentication, and transactions are monitored for fraud.
            </p>
            <p className="text-[15px] leading-[1.6] text-white/70 mb-9">
              BMaGlass Pay's authorisation by the Bank of Zambia is currently pending. We are
              in the approval process to operate as a payment service provider under the
              National Payment Systems Act, and we are building our operations to comply with
              the regulations and directives the Bank of Zambia issues for payment service
              providers.
            </p>
            <Link
              to="/compliance"
              className="inline-flex items-center h-12 rounded-full bg-white px-7 text-[15px] font-semibold text-[#003087] hover:bg-white/90 transition-colors"
            >
              Read our compliance page
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

/** Light cream closing band: centred headline + one orange pill. */
export const FinalCta = () => {
  return (
    <section className="bg-[#FEF3E2] dark:bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-16 md:py-24 text-center">
        <FadeIn duration={0.6} distance={20}>
          <h2 className="font-display font-extrabold text-black dark:text-white tracking-[-0.025em] leading-[1.1] text-[32px] md:text-[44px] lg:text-[52px] mb-5">
            Start getting paid today
          </h2>
          <p className="text-[17px] leading-[1.55] text-[#44464A] dark:text-white/70 mb-9">
            Create your free account in minutes. No setup fees or monthly charges.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center h-12 rounded-full bg-[#F7931A] px-[30px] text-[15px] font-semibold text-black hover:bg-[#DE830A] transition-colors"
          >
            Sign Up
          </Link>
        </FadeIn>
      </div>
    </section>
  );
};
