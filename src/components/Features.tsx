
import { useEffect, useRef } from 'react';
import { Shield, CreditCard, RefreshCw, Globe } from 'lucide-react';

const features = [
  {
    title: "Secure Transactions",
    description: "Bank-grade encryption and security protocols ensure your money and data are always protected across all transactions.",
    icon: (
      <Shield className="h-6 w-6" />
    )
  },
  {
    title: "Multiple Payment Methods",
    description: "From mobile money to bank transfers, cards, and USSD, we offer a variety of ways to send and receive money across Zambia.",
    icon: (
      <CreditCard className="h-6 w-6" />
    )
  },
  {
    title: "Real-time Processing",
    description: "Experience instant transfers with our advanced payment gateway. Your money moves quickly and securely when you need it.",
    icon: (
      <RefreshCw className="h-6 w-6" />
    )
  },
  {
    title: "Nationwide Coverage",
    description: "Our payment solutions reach all corners of Zambia, connecting businesses and individuals across the country.",
    icon: (
      <Globe className="h-6 w-6" />
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
          Payment Solutions
        </span>
        <h2 className="heading-2 mb-4">
          Powering Digital Payments in Zambia
        </h2>
        <p className="body-text max-w-2xl mx-auto">
          Our Lusaka-based payment gateway provides reliable, secure, and fast financial services for businesses and individuals across the nation.
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
