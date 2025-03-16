
import { useEffect, useRef } from 'react';
import { Shield, CreditCard, RefreshCw, Globe, Smartphone, BanknoteIcon, BarChart3 } from 'lucide-react';

const features = [
  {
    title: "Secure Payment Gateway",
    description: "Bank-grade encryption and compliance with international security standards protect every transaction processed through BMaGlass Pay.",
    icon: (
      <Shield className="h-6 w-6" />
    )
  },
  {
    title: "Multiple Payment Methods",
    description: "Accept payments via mobile money (MTN, Airtel, Zamtel), bank transfers, credit cards, and USSD codes - all through one unified platform.",
    icon: (
      <CreditCard className="h-6 w-6" />
    )
  },
  {
    title: "Real-time Settlement",
    description: "Receive funds in your account within 24 hours with our rapid settlement system, improving your business cash flow and financial planning.",
    icon: (
      <RefreshCw className="h-6 w-6" />
    )
  },
  {
    title: "Nationwide Integration",
    description: "Connect with all major Zambian banks and mobile money providers through our comprehensive API and payment infrastructure.",
    icon: (
      <Globe className="h-6 w-6" />
    )
  },
  {
    title: "Mobile Money Specialist",
    description: "Purpose-built for the Zambian market with deep integration into all local mobile money platforms for maximum reliability.",
    icon: (
      <Smartphone className="h-6 w-6" />
    )
  },
  {
    title: "Low Transaction Fees",
    description: "Competitive pricing structure designed specifically for Zambian businesses, with volume-based discounts for growing enterprises.",
    icon: (
      <BanknoteIcon className="h-6 w-6" />
    )
  },
  {
    title: "Business Analytics",
    description: "Track transaction patterns, customer behavior, and business performance with our comprehensive reporting dashboard.",
    icon: (
      <BarChart3 className="h-6 w-6" />
    )
  },
  {
    title: "Local Support Team",
    description: "Our Lusaka-based customer support team is available to assist you with any payment issues or integration questions.",
    icon: (
      <Smartphone className="h-6 w-6" />
    )
  }
];

const PaymentSolutions = () => {
  const featuresRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fadeInUp');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    const featureElements = featuresRef.current?.querySelectorAll('.feature-card');
    featureElements?.forEach((el) => {
      observer.observe(el);
    });
    
    return () => {
      featureElements?.forEach((el) => {
        observer.unobserve(el);
      });
    };
  }, []);

  return (
    <section id="features" className="section">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full bg-secondary text-sm font-medium text-secondary-foreground mb-4">
          Payment Gateway Solutions
        </span>
        <h2 className="heading-2 mb-4">
          The Heartbeat of Zambian Digital Commerce
        </h2>
        <p className="body-text max-w-2xl mx-auto">
          BMaGlass Pay is built from the ground up to serve Zambian businesses with payment technology that understands local market needs and challenges.
        </p>
      </div>
      
      <div 
        ref={featuresRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
      >
        {features.map((feature, index) => (
          <div 
            key={index} 
            className="feature-card opacity-0 p-6 rounded-xl border border-border bg-white hover:shadow-medium transition-all duration-500 ease-apple-ease"
            style={{ animationDelay: `${0.1 + index * 0.1}s` }}
          >
            <div className="feature-icon text-primary mb-4">
              {feature.icon}
            </div>
            <h3 className="text-xl font-medium mb-2">{feature.title}</h3>
            <p className="text-foreground/70">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default PaymentSolutions;
