
import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, CheckCircle2, Smartphone } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Define our product data
const productData = [
  {
    id: 1,
    title: "Standard Plan",
    description: "Perfect for small businesses and individuals",
    price: 100,
    features: ["Up to 100 transactions per month", "Email support", "Basic analytics"],
    popular: false
  },
  {
    id: 2,
    title: "Business Plan",
    description: "Built for growing businesses with more needs",
    price: 250,
    features: ["Up to 1,000 transactions per month", "Priority support", "Advanced analytics", "Multiple payment methods"],
    popular: true
  },
  {
    id: 3,
    title: "Enterprise Plan",
    description: "For large businesses with high transaction volumes",
    price: 500,
    features: ["Unlimited transactions", "24/7 dedicated support", "Custom reporting", "API access", "Multiple users"],
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
            Choose Your Plan
          </h2>
          <p className="body-text mx-auto">
            Our simple, transparent pricing plans are designed to fit businesses of all sizes in Zambia.
            All plans come with our secure payment infrastructure.
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
                  Subscribe Now
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Products;
