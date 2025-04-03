
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Pricing = () => {
  const [billingPeriod, setBillingPeriod] = useState("monthly");

  const plans = [
    {
      name: "Starter",
      description: "Perfect for small businesses just getting started with digital payments.",
      monthlyPrice: 200,
      yearlyPrice: 2000,
      features: [
        "Up to 500 transactions per month",
        "Mobile Money Integration",
        "USSD Payments",
        "Basic reporting",
        "Email support",
        "1 team member"
      ]
    },
    {
      name: "Business",
      description: "For growing businesses that need more capacity and features.",
      monthlyPrice: 500,
      yearlyPrice: 5000,
      popular: true,
      features: [
        "Up to 2,000 transactions per month",
        "Mobile Money Integration",
        "USSD Payments",
        "Card Processing",
        "Advanced reporting",
        "Priority email support",
        "5 team members",
        "API access"
      ]
    },
    {
      name: "Enterprise",
      description: "Custom solutions for large businesses with high transaction volumes.",
      custom: true,
      features: [
        "Unlimited transactions",
        "All payment methods",
        "Custom integration support",
        "Dedicated account manager",
        "24/7 phone support",
        "Unlimited team members",
        "Advanced API access",
        "Custom reporting",
        "Fraud detection tools"
      ]
    }
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-2">Transparent Pricing for Every Business</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that works best for your business. All plans include access to our secure payment platform.
          </p>
          
          <div className="mt-6">
            <Tabs defaultValue="monthly" className="w-[400px] mx-auto" value={billingPeriod} onValueChange={setBillingPeriod}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="yearly">Yearly (10% off)</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <Card key={plan.name} className={`flex flex-col ${plan.popular ? 'border-primary shadow-lg' : ''}`}>
              {plan.popular && (
                <div className="bg-primary text-primary-foreground text-center py-1 text-sm font-medium">
                  Most Popular
                </div>
              )}
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="mb-6">
                  {plan.custom ? (
                    <div>
                      <span className="text-3xl font-bold">Custom</span>
                      <span className="text-muted-foreground block mt-1">Contact sales for pricing</span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-3xl font-bold">K{billingPeriod === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}</span>
                      <span className="text-muted-foreground">/{billingPeriod === "monthly" ? "month" : "year"}</span>
                    </div>
                  )}
                </div>
                
                <ul className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant={plan.custom ? "outline" : "default"} className="w-full">
                  {plan.custom ? "Contact Sales" : "Get Started"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        
        <div className="mt-16 bg-secondary/10 rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-4 text-center">Transaction Fees</h2>
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
      </main>
      <Footer />
    </div>
  );
};

export default Pricing;
