
import { useState, useRef, useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useRoles } from "@/contexts/RoleContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, CreditCard, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils";

interface PlanFeature {
  name: string;
  included: boolean;
}

interface PlanDetails {
  id: string;
  name: string;
  price: number;
  description: string;
  features: PlanFeature[];
  highlight?: boolean;
}

const plans: PlanDetails[] = [
  {
    id: "free",
    name: "Free Tier",
    price: 0,
    description: "Basic features for personal use",
    features: [
      { name: "Dashboard Access", included: true },
      { name: "Feedback Submission", included: true },
      { name: "Transaction History", included: true },
      { name: "Virtual Cards", included: false },
      { name: "Money Transfers", included: false },
      { name: "Business Tools", included: false },
      { name: "Analytics", included: false }
    ]
  },
  {
    id: "basic",
    name: "Basic",
    price: 9.99,
    description: "Everything in Free plus more features",
    features: [
      { name: "Dashboard Access", included: true },
      { name: "Feedback Submission", included: true },
      { name: "Transaction History", included: true },
      { name: "Virtual Cards", included: true },
      { name: "Money Transfers", included: false },
      { name: "Business Tools", included: false },
      { name: "Analytics", included: false }
    ]
  },
  {
    id: "premium",
    name: "Premium",
    price: 19.99,
    description: "Advanced features for power users",
    highlight: true,
    features: [
      { name: "Dashboard Access", included: true },
      { name: "Feedback Submission", included: true },
      { name: "Transaction History", included: true },
      { name: "Virtual Cards", included: true },
      { name: "Money Transfers", included: true },
      { name: "Business Tools", included: false },
      { name: "Analytics", included: true }
    ]
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 49.99,
    description: "Complete package for businesses",
    features: [
      { name: "Dashboard Access", included: true },
      { name: "Feedback Submission", included: true },
      { name: "Transaction History", included: true },
      { name: "Virtual Cards", included: true },
      { name: "Money Transfers", included: true },
      { name: "Business Tools", included: true },
      { name: "Analytics", included: true }
    ]
  }
];

const SubscriptionTiers = () => {
  const { subscriptionTier } = useRoles();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const tiersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Animation for the subscription tiers section
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          tiersRef.current?.classList.add('animate-fadeIn');
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (tiersRef.current) {
      observer.observe(tiersRef.current);
    }
    
    return () => {
      if (tiersRef.current) {
        observer.unobserve(tiersRef.current);
      }
    };
  }, []);

  // Set selected plan based on current subscription
  useEffect(() => {
    setSelectedPlan(subscriptionTier);
  }, [subscriptionTier]);

  const handleUpgrade = (planId: string) => {
    if (!user) {
      navigate("/login", { state: { from: "/pricing" } });
      return;
    }

    // Navigate to checkout with the selected plan
    navigate(`/checkout/${planId}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 py-24">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-3">Choose Your Plan</h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Select the perfect plan that suits your needs. Upgrade anytime to unlock more features.
            </p>
          </div>

          <div 
            ref={tiersRef}
            className="opacity-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto"
          >
            {plans.map((plan) => (
              <Card 
                key={plan.id} 
                className={`
                  overflow-hidden transition-all duration-300 hover:shadow-lg
                  ${plan.highlight ? 'border-primary/50 shadow-md relative' : ''}
                  ${plan.id === selectedPlan ? 'ring-2 ring-primary shadow-lg' : ''}
                `}
              >
                {plan.highlight && (
                  <Badge className="absolute top-4 right-4 bg-primary">Most Popular</Badge>
                )}
                {plan.id === selectedPlan && (
                  <Badge className="absolute top-4 left-4 bg-green-500">Current Plan</Badge>
                )}
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <span className="text-3xl font-bold">{formatCurrency(plan.price)}</span>
                    <span className="text-muted-foreground"> / month</span>
                  </div>
                  
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start">
                        {feature.included ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500 mr-2 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-400 mr-2 shrink-0 mt-0.5" />
                        )}
                        <span className={!feature.included ? 'text-muted-foreground' : ''}>
                          {feature.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                  
                  <div className="flex items-center space-x-2 mt-4">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Secure payment</span>
                    <Shield className="h-4 w-4 text-muted-foreground ml-4" />
                    <span className="text-sm text-muted-foreground">Cancel anytime</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    onClick={() => handleUpgrade(plan.id)} 
                    className={`w-full ${plan.highlight ? 'bg-primary' : ''}`}
                    disabled={plan.id === selectedPlan}
                    variant={plan.id === selectedPlan ? 'outline' : 'default'}
                  >
                    {plan.id === selectedPlan ? 'Current Plan' : 
                     plan.id === 'free' ? 'Current Free Tier' : 'Upgrade'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default SubscriptionTiers;
