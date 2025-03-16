
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, CheckCircle2, Smartphone, ShieldCheck, BarChart3, Globe, Code, Database } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Define product data specific to payment solutions
const productData = [
  {
    id: 1,
    title: "SME Plan",
    description: "Perfect for small and medium businesses in Zambia",
    price: 250,
    features: [
      "Process up to K50,000 monthly", 
      "2.5% transaction fee", 
      "Email & phone support", 
      "Mobile money integration",
      "Basic reporting"
    ],
    popular: false
  },
  {
    id: 2,
    title: "Business Pro",
    description: "For established businesses with higher transaction volume",
    price: 500,
    features: [
      "Process up to K500,000 monthly", 
      "1.9% transaction fee", 
      "Priority support", 
      "All payment methods", 
      "Advanced analytics",
      "POS integration"
    ],
    popular: true
  },
  {
    id: 3,
    title: "Enterprise",
    description: "Customized solutions for large corporations and institutions",
    price: 1200,
    features: [
      "Unlimited processing volume", 
      "Custom transaction fees", 
      "Dedicated account manager", 
      "Complete payment ecosystem", 
      "Custom reporting & API access",
      "Banking system integration",
      "White-label options"
    ],
    popular: false
  }
];

const Products = () => {
  const productsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  
  const handleSubscribe = (product: typeof productData[0]) => {
    // Navigate to checkout with product information
    navigate('/checkout', { 
      state: { 
        amount: product.price, 
        productName: product.title 
      } 
    });
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
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {productData.map((product) => (
            <Card 
              key={product.id} 
              className={`overflow-hidden transition-all duration-300 hover:shadow-lg ${product.popular ? 'border-primary/50 shadow-md relative' : ''}`}
            >
              {product.popular && (
                <Badge className="absolute top-4 right-4 bg-primary">Most Popular</Badge>
              )}
              <CardHeader>
                <CardTitle>{product.title}</CardTitle>
                <CardDescription>{product.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="text-3xl font-bold">{formatCurrency(product.price)}</span>
                  <span className="text-muted-foreground"> / month</span>
                </div>
                
                <ul className="space-y-2 mb-6">
                  {product.features.map((feature, i) => (
                    <li key={i} className="flex items-start">
                      <CheckCircle2 className="h-5 w-5 text-primary mr-2 shrink-0 mt-0.5" />
                      <span>{feature}</span>
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
                >
                  Choose Plan
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
