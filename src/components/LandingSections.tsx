import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Globe, Zap } from "lucide-react";
import { FadeIn, StaggerChildren, StaggerItem } from '@/components/animations';

const PAYMENT_METHODS = ['MTN Money', 'Airtel Money', 'Visa', 'Mastercard'];

export const FeatureCards = () => {
  return (
    <section className="section">
      <StaggerChildren
        className="grid md:grid-cols-3 gap-6"
        staggerDelay={0.08}
        initialDelay={0.1}
      >
        <StaggerItem>
          <div className="bg-card border rounded-2xl shadow-subtle p-6 h-full">
            <div className="feature-icon">
              <Shield className="h-6 w-6" />
            </div>
            <h3 className="font-display text-xl font-semibold text-foreground mb-2">Secure Payments</h3>
            <p className="text-muted-foreground mb-4">PCI DSS compliant infrastructure</p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <span key={m} className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground">{m}</span>
              ))}
            </div>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="bg-card border rounded-2xl shadow-subtle p-6 h-full">
            <div className="feature-icon">
              <Globe className="h-6 w-6" />
            </div>
            <h3 className="font-display text-xl font-semibold text-foreground mb-2">Multi-Currency</h3>
            <p className="text-muted-foreground">ZMW, USD, GBP &amp; more</p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="bg-card border rounded-2xl shadow-subtle p-6 h-full">
            <div className="feature-icon">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="font-display text-xl font-semibold text-foreground mb-2">Instant Settlement</h3>
            <p className="text-muted-foreground">Same-day payouts</p>
          </div>
        </StaggerItem>
      </StaggerChildren>
    </section>
  );
};

export const PersonalSection = () => {
  return (
    <section className="bg-muted">
      <div className="section grid lg:grid-cols-2 gap-12 items-center">
        <FadeIn duration={0.6} distance={20}>
          <img
            src="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=1600&auto=format&fit=crop"
            alt="Portrait of a young woman in a colourful Ankara print outfit"
            className="w-full aspect-[4/5] max-h-[600px] object-cover rounded-[1.5rem] shadow-strong"
          />
        </FadeIn>
        <FadeIn duration={0.6} distance={20} delay={0.1}>
          <div className="max-w-xl">
            <p className="text-sm text-primary font-semibold mb-3">For you</p>
            <h2 className="heading-2 text-paypal-dark mb-4">Send money to anyone, the simple way</h2>
            <p className="body-text mb-8">
              Send money to anyone, pay with Mobile Money, cards or USSD, and keep everything in one wallet — no setup fees or monthly charges.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
                <Link to="/register">
                  Create your free account <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Link to="/wallet" className="text-primary font-semibold">
                Explore the wallet
              </Link>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export const CheckoutSection = () => {
  return (
    <section className="section">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <FadeIn duration={0.6} distance={20}>
          <div className="max-w-xl">
            <p className="text-sm text-primary font-semibold mb-3">For business</p>
            <h2 className="heading-2 text-paypal-dark mb-4">Accept payments everywhere you sell</h2>
            <p className="body-text mb-8">
              Take Mobile Money, Cards &amp; USSD online and in person, send payment links and invoices, and get settled the same day.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
                <Link to="/business">
                  Explore business tools <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Link to="/pricing" className="text-primary font-semibold">
                See pricing
              </Link>
            </div>
          </div>
        </FadeIn>
        <FadeIn duration={0.6} distance={20} delay={0.1}>
          <img
            src="https://images.unsplash.com/photo-1563013544-824ae1b704d3?q=80&w=1600&auto=format&fit=crop"
            alt="A customer paying online by card on a laptop"
            className="w-full aspect-[4/3] object-cover rounded-[1.5rem] shadow-strong"
          />
        </FadeIn>
      </div>
    </section>
  );
};

export const BitcoinSection = () => {
  return (
    <section className="bg-muted">
      <div className="section grid lg:grid-cols-2 gap-12 items-center">
        <FadeIn duration={0.6} distance={20}>
          <img
            src="https://images.unsplash.com/photo-1518546305927-5a555bb7020d?q=80&w=1600&auto=format&fit=crop"
            alt="A physical Bitcoin coin in front of a live trading chart"
            className="w-full aspect-[4/3] object-cover rounded-[1.5rem] shadow-strong"
          />
        </FadeIn>
        <FadeIn duration={0.6} distance={20} delay={0.1}>
          <div className="max-w-xl">
            <p className="text-sm text-primary font-semibold mb-3">Bitcoin wallet</p>
            <h2 className="heading-2 text-paypal-dark mb-4">Bitcoin, right beside your kwacha</h2>
            <p className="body-text mb-8">
              Hold, send and track Bitcoin in the same app as your everyday balance — one wallet for your kwacha and your crypto.
            </p>
            <Button asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
              <Link to="/bitcoin-wallet">
                Open the Bitcoin wallet <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export const BusinessBand = () => {
  const stats = [
    { value: 'ZMW · USD · GBP', label: 'multi-currency' },
    { value: '24/7', label: 'customer support' },
    { value: 'Bitcoin + Lightning', label: 'built into your wallet' },
    { value: 'Mobile money & cards', label: 'local payment methods' },
  ];

  return (
    <section className="bg-paypal-dark text-white">
      <div className="section grid lg:grid-cols-2 gap-12 items-center">
        <FadeIn duration={0.6} distance={20}>
          <div>
            <h2 className="heading-2 text-white mb-4">Built for businesses that are going places</h2>
            <p className="text-white/70 text-base md:text-lg leading-relaxed mb-8">
              BMaGlass Pay is built from the ground up to serve Zambian businesses with payment technology that understands local market needs and challenges.
            </p>
            <div className="grid grid-cols-2 gap-6 mb-10">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <div className="font-display text-3xl text-white font-bold">{stat.value}</div>
                  <div className="text-white/60 text-sm mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-white text-paypal-dark hover:bg-white/90 rounded-full px-8 text-base font-semibold h-12">
                <Link to="/business">
                  Start for business <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild size="lg" className="border border-white/40 text-white bg-transparent hover:bg-white/10 rounded-full px-8 text-base font-semibold h-12">
                <Link to="/contact">
                  Talk to sales
                </Link>
              </Button>
            </div>
          </div>
        </FadeIn>
        <FadeIn duration={0.6} distance={20} delay={0.1}>
          <img
            src="https://images.unsplash.com/photo-1573164713988-8665fc963095?q=80&w=1600&auto=format&fit=crop"
            alt="An engineer with a laptop working inside a secure data centre"
            className="w-full aspect-[4/3] object-cover rounded-[1.5rem] shadow-strong"
          />
        </FadeIn>
      </div>
    </section>
  );
};

export const FinalCta = () => {
  return (
    <section className="section">
      <FadeIn duration={0.6} distance={20}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="heading-2 text-paypal-dark mb-4">Start getting paid today</h2>
          <p className="body-text mb-8">
            Create your free account in minutes. No setup fees or monthly charges.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
              <Link to="/register">
                Sign Up for Free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild size="lg" className="rounded-full px-8 text-base font-semibold h-12">
              <Link to="/contact">
                Talk to us
              </Link>
            </Button>
          </div>
        </div>
      </FadeIn>
    </section>
  );
};
