
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, CheckCircle2, Smartphone, ShieldCheck, BarChart3, Globe, Code, Database, Star, Zap, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRoles } from "@/contexts/RoleContext";
import { useAuth } from "@/contexts/AuthContext";

// Define product data to match the tier structure
const productData = [
  {
    id: "free",
    title: "Free Plan",
    description: "Perfect for personal use and getting started",
    price: 0,
    icon: <Star className="h-5 w-5" />,
    features: [
      "Dashboard Access", 
      "Feedback Submission", 
      "Money Transfers",
      "5 free transactions/month",
      "2.9% + K2.50 per transaction after",
      "1 virtual card",
      "Local transfers only"
    ],
    pricing: {
      fixedFee: 2.50,
      percentage: 2.9,
      freeTransactions: 5
    },
    popular: false
  },
  {
    id: "basic",
    title: "Basic Plan",
    description: "For individuals who need more features",
    price: 9.99,
    icon: <Zap className="h-5 w-5" />,
    features: [
      "All Free features", 
      "Virtual Cards",
      "20 free transactions/month",
      "2.4% + K2.00 per transaction after",
      "3 virtual cards",
      "Local & some international transfers",
      "Email support"
    ],
    pricing: {
      fixedFee: 2.00,
      percentage: 2.4,
      freeTransactions: 20
    },
    popular: true
  },
  {
    id: "premium",
    title: "Premium Plan",
    description: "For power users and small businesses",
    price: 19.99,
    icon: <Crown className="h-5 w-5" />,
    features: [
      "All Basic features", 
      "Advanced Analytics", 
      "100 free transactions/month",
      "1.9% + K1.50 per transaction after",
      "10 virtual cards",
      "All transfer types + faster processing",
      "Priority Support"
    ],
    pricing: {
      fixedFee: 1.50,
      percentage: 1.9,
      freeTransactions: 100
    },
    popular: false
  },
  {
    id: "enterprise",
    title: "Enterprise Plan", 
    description: "For businesses that need everything",
    price: 49.99,
    icon: <Crown className="h-5 w-5" />,
    features: [
      "All Premium features", 
      "Business Tools", 
      "500 free transactions/month",
      "1.4% + K1.00 per transaction after",
      "Unlimited virtual cards",
      "API access + instant processing",
      "24/7 phone & dedicated manager"
    ],
    pricing: {
      fixedFee: 1.00,
      percentage: 1.4,
      freeTransactions: 500
    },
    popular: false
  }
];

const Products = () => {
  const productsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { subscriptionTier } = useRoles();
  const { user } = useAuth();
  
  const handleSubscribe = (product: typeof productData[0]) => {
    if (!user) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }
    
    // Navigate to checkout with product information
    navigate(`/checkout/${product.id}`);
  };
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          productsRef.current?.classList.add('animate-fadeIn');
          observer.unobserve(entries[0].target);
        }
      },
      { threshold: 0.1 }
    );
    
    if (productsRef.current) {
      observer.observe(productsRef.current);
    }
    
    return () => {
      if (productsRef.current) {
        observer.unobserve(productsRef.current);
      }
    };
  }, []);

  return (
    <section id="products" className="section">
      <div ref={productsRef} className="opacity-0">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="heading-2 mb-4">
            Payment Solutions for Every Business
          </h2>
          <p className="body-text mx-auto">
            BMaGlass Pay offers flexible and affordable payment processing plans designed specifically for the Zambian market, from small shops to large enterprises.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {productData.map((product) => (
            <Card 
              key={product.id} 
              className={`
                overflow-hidden transition-all duration-300 hover:shadow-lg 
                ${product.popular ? 'border-primary/50 shadow-md relative' : ''}
                ${product.id === subscriptionTier ? 'ring-2 ring-primary shadow-lg' : ''}
              `}
            >
              {product.popular && (
                <Badge className="absolute top-4 right-4 bg-primary">Most Popular</Badge>
              )}
              {product.id === subscriptionTier && (
                <Badge className="absolute top-4 left-4 bg-green-500">Current Plan</Badge>
              )}
              <CardHeader>
                <div className="flex items-center space-x-2 mb-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {product.icon}
                  </div>
                  <CardTitle>{product.title}</CardTitle>
                </div>
                <CardDescription>{product.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="text-3xl font-bold">
                    {product.price === 0 ? 'Free' : formatCurrency(product.price)}
                  </span>
                  {product.price > 0 && <span className="text-muted-foreground"> / month</span>}
                </div>

                {/* Pricing Details */}
                <div className="mb-6 p-3 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-sm mb-2">Transaction Pricing</h4>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>• {product.pricing.freeTransactions} free transactions/month</div>
                    <div>• Then {product.pricing.percentage}% + K{product.pricing.fixedFee} per transaction</div>
                  </div>
                </div>
                
                <ul className="space-y-2 mb-6">
                  {product.features.map((feature, i) => (
                    <li key={i} className="flex items-start">
                      <CheckCircle2 className="h-5 w-5 text-primary mr-2 shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="flex items-center space-x-2 mt-4">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Card payments</span>
                  <Smartphone className="h-4 w-4 text-muted-foreground ml-4" />
                  <span className="text-sm text-muted-foreground">Mobile money</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button 
                  onClick={() => handleSubscribe(product)} 
                  className={`w-full ${product.popular ? 'bg-primary' : ''}`}
                  disabled={product.id === subscriptionTier}
                  variant={product.id === subscriptionTier ? 'outline' : 'default'}
                >
                  {product.id === subscriptionTier ? 'Current Plan' : 'Choose Plan'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        
        {/* Added additional business benefits section */}
        <div className="mt-24 max-w-5xl mx-auto">
          <h3 className="text-2xl font-bold text-center mb-12">Why Businesses Choose BMaGlass Pay</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: <ShieldCheck className="h-8 w-8 text-primary" />,
                title: "Zambian Owned",
                description: "Built by Zambians for Zambian businesses, with full understanding of local market needs."
              },
              {
                icon: <Globe className="h-8 w-8 text-primary" />,
                title: "Local Support",
                description: "Lusaka-based team providing personalized support in your local language."
              },
              {
                icon: <Code className="h-8 w-8 text-primary" />,
                title: "Easy Integration",
                description: "Developer-friendly APIs and plug-ins for quick implementation into your systems."
              },
              {
                icon: <Database className="h-8 w-8 text-primary" />,
                title: "Reliable Infrastructure",
                description: "Built on robust technology with 99.9% uptime guarantee for your business."
              }
            ].map((benefit, i) => (
              <div key={i} className="text-center p-6">
                <div className="flex justify-center mb-4">
                  {benefit.icon}
                </div>
                <h4 className="font-medium text-lg mb-2">{benefit.title}</h4>
                <p className="text-muted-foreground">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Products;
