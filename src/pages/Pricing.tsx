import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Star, Zap, Crown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";

const Pricing = () => {
  const [billingPeriod, setBillingPeriod] = useState("monthly");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscriptionTier } = useRoles();

  const handleSubscribe = (planId: string) => {
    if (!user) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }
    navigate(`/checkout/${planId}`);
  };

  const plans = [
    {
      id: "free",
      name: "Free Plan",
      description: "Perfect for personal use and getting started",
      monthlyPrice: 0,
      yearlyPrice: 0,
      icon: <Star className="h-5 w-5" />,
      features: [
        "Dashboard Access",
        "Feedback Submission", 
        "Money Transfers",
        "2.9% + K2.50 per transaction",
        "K 1,000 max per transaction",
        "1 virtual card",
        "Local transfers only",
        "Community support"
      ],
      pricing: {
        fixedFee: 2.50,
        percentage: 2.9
      }
    },
    {
      id: "basic",
      name: "Basic Plan",
      description: "For individuals who need more features",
      monthlyPrice: 9.99,
      yearlyPrice: 99.99,
      icon: <Zap className="h-5 w-5" />,
      popular: true,
      features: [
        "All Free features",
        "Virtual Cards",
        "2.4% + K2.00 per transaction",
        "K 10,000 max per transaction",
        "3 virtual cards",
        "Local & some international transfers",
        "Email support"
      ],
      pricing: {
        fixedFee: 2.00,
        percentage: 2.4
      }
    },
    {
      id: "premium",
      name: "Premium Plan",
      description: "For power users and small businesses",
      monthlyPrice: 19.99,
      yearlyPrice: 199.99,
      icon: <Crown className="h-5 w-5" />,
      features: [
        "All Basic features",
        "Advanced Analytics",
        "1.9% + K1.50 per transaction",
        "K 50,000 max per transaction",
        "10 virtual cards",
        "All transfer types + faster processing",
        "Priority Support"
      ],
      pricing: {
        fixedFee: 1.50,
        percentage: 1.9
      }
    },
    {
      id: "enterprise",
      name: "Enterprise Plan",
      description: "For businesses that need everything",
      monthlyPrice: 49.99,
      yearlyPrice: 499.99,
      icon: <Crown className="h-5 w-5" />,
      features: [
        "All Premium features",
        "Business Tools",
        "1.4% + K1.00 per transaction",
        "Unlimited transaction amount",
        "Unlimited virtual cards",
        "API access + instant processing",
        "24/7 phone & dedicated manager"
      ],
      pricing: {
        fixedFee: 1.00,
        percentage: 1.4
      }
    }
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-2">Payment Solutions for Every Business</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            BMaGlass Pay offers flexible and affordable payment processing plans designed specifically for the Zambian market, from small shops to large enterprises.
          </p>
          
          <div className="mt-6">
            <Tabs defaultValue="monthly" className="w-[400px] mx-auto" value={billingPeriod} onValueChange={setBillingPeriod}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="yearly">Yearly (Save 10%)</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <Card key={plan.id} className={`
              flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg
              ${plan.popular ? 'border-primary/50 shadow-md relative' : ''}
              ${plan.id === subscriptionTier ? 'ring-2 ring-primary shadow-lg' : ''}
            `}>
              {plan.popular && (
                <div className="bg-primary text-primary-foreground text-center py-1 text-sm font-medium">
                  Most Popular
                </div>
              )}
              {plan.id === subscriptionTier && (
                <div className="bg-green-500 text-white text-center py-1 text-sm font-medium">
                  Current Plan
                </div>
              )}
              <CardHeader>
                <div className="flex items-center space-x-2 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {plan.icon}
                  </div>
                  <CardTitle>{plan.name}</CardTitle>
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="mb-6">
                  <span className="text-3xl font-bold">
                    {plan.monthlyPrice === 0 ? 'Free' : `K${billingPeriod === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}`}
                  </span>
                  {plan.monthlyPrice > 0 && <span className="text-muted-foreground">/{billingPeriod === "monthly" ? "month" : "year"}</span>}
                </div>

                {/* Transaction Pricing */}
                <div className="mb-6 p-3 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-sm mb-2">Transaction Pricing</h4>
                  <div className="text-xs text-muted-foreground">
                    <div>{plan.pricing.percentage}% + K{plan.pricing.fixedFee} per transaction</div>
                  </div>
                </div>
                
                <ul className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  onClick={() => handleSubscribe(plan.id)} 
                  className={`w-full ${plan.popular ? 'bg-primary' : ''}`}
                  disabled={plan.id === subscriptionTier}
                  variant={plan.id === subscriptionTier ? 'outline' : 'default'}
                >
                  {plan.id === subscriptionTier ? 'Current Plan' : plan.monthlyPrice === 0 ? 'Get Started Free' : 'Choose Plan'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        
        {/* Transaction Fees Section */}
        <div className="mt-16 bg-secondary/10 rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-4 text-center">Transaction Fees by Payment Method</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div>
              <h3 className="text-lg font-medium mb-3">Mobile Money</h3>
              <ul className="space-y-2">
                <li className="flex justify-between">
                  <span>Deposits</span>
                  <span>1.5%</span>
                </li>
                <li className="flex justify-between">
                  <span>Withdrawals</span>
                  <span>2.0%</span>
                </li>
                <li className="flex justify-between">
                  <span>Person-to-Person</span>
                  <span>1.0%</span>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-3">Card Payments</h3>
              <ul className="space-y-2">
                <li className="flex justify-between">
                  <span>Domestic Cards</span>
                  <span>2.5% + K2</span>
                </li>
                <li className="flex justify-between">
                  <span>International Cards</span>
                  <span>3.5% + K5</span>
                </li>
                <li className="flex justify-between">
                  <span>Refunds</span>
                  <span>Free</span>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-3">USSD Payments</h3>
              <ul className="space-y-2">
                <li className="flex justify-between">
                  <span>Basic Transaction</span>
                  <span>1.0%</span>
                </li>
                <li className="flex justify-between">
                  <span>Bill Payments</span>
                  <span>1.2%</span>
                </li>
                <li className="flex justify-between">
                  <span>Airtime Purchase</span>
                  <span>0.5%</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Why Choose BMaGlass Pay */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center mb-8">Why Businesses Choose BMaGlass Pay</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Zambian Owned</h4>
              <p className="text-sm text-muted-foreground">Built by Zambians for Zambian businesses, with full understanding of local market needs.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Local Support</h4>
              <p className="text-sm text-muted-foreground">Lusaka-based team providing personalized support in your local language.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Easy Integration</h4>
              <p className="text-sm text-muted-foreground">Developer-friendly APIs and plug-ins for quick implementation into your systems.</p>
            </div>
            <div className="text-center p-4">
              <h4 className="font-medium mb-2">Reliable Infrastructure</h4>
              <p className="text-sm text-muted-foreground">Built on robust technology with 99.9% uptime guarantee for your business.</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
