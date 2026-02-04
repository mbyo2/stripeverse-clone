import { Shield, CreditCard, RefreshCw, Globe, Smartphone, BanknoteIcon, BarChart3, HeadphonesIcon } from 'lucide-react';
import { useFeatures } from '@/hooks/useFeatures';
import { FadeIn, StaggerChildren, StaggerItem, MotionCard } from '@/components/animations';

const getFeatureIcon = (category: string) => {
  const iconMap: Record<string, JSX.Element> = {
    'Security': <Shield className="h-6 w-6" />,
    'Payment': <CreditCard className="h-6 w-6" />,
    'Speed': <RefreshCw className="h-6 w-6" />,
    'Integration': <Globe className="h-6 w-6" />,
    'Mobile': <Smartphone className="h-6 w-6" />,
    'Pricing': <BanknoteIcon className="h-6 w-6" />,
    'Analytics': <BarChart3 className="h-6 w-6" />,
    'Support': <HeadphonesIcon className="h-6 w-6" />
  };
  return iconMap[category] || <Shield className="h-6 w-6" />;
};

const PaymentSolutions = () => {
  const { features, isLoading } = useFeatures();

  return (
    <section id="features" className="section">
      <FadeIn duration={0.6} distance={20}>
        <div className="text-center mb-16">
          <span className="inline-block px-3 py-1 rounded-full bg-secondary text-sm font-medium text-secondary-foreground mb-4">
            Zambia's Premier Payment Gateway
          </span>
          <h2 className="heading-2 mb-4">
            The Heartbeat of Zambian Digital Commerce
          </h2>
          <p className="body-text max-w-2xl mx-auto">
            Founded by Mabvuto Banda, BMaGlass Pay is built from the ground up to serve Zambian businesses with payment technology that understands local market needs and challenges.
          </p>
        </div>
      </FadeIn>
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {Array.from({ length: 8 }).map((_, index) => (
            <div 
              key={index} 
              className="p-6 rounded-xl border border-border bg-card animate-pulse"
            >
              <div className="w-8 h-8 bg-muted rounded mb-4"></div>
              <div className="h-6 bg-muted rounded mb-2"></div>
              <div className="h-4 bg-muted rounded"></div>
            </div>
          ))}
        </div>
      ) : (
        <StaggerChildren 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
          staggerDelay={0.06}
          initialDelay={0.1}
        >
          {features.map((feature) => (
            <StaggerItem key={feature.feature_id}>
              <MotionCard 
                className="p-6 rounded-xl border border-border bg-card hover:shadow-medium h-full"
                hoverScale={1.02}
                hoverLift={-3}
              >
                <div className="feature-icon text-primary mb-4">
                  {getFeatureIcon(feature.category)}
                </div>
                <h3 className="text-xl font-medium mb-2 text-card-foreground">{feature.name}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </MotionCard>
            </StaggerItem>
          ))}
        </StaggerChildren>
      )}
    </section>
  );
};

export default PaymentSolutions;
