import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Zap, Crown, Building, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { usePricing } from "@/hooks/usePricing";
import { FadeIn, StaggerChildren, StaggerItem } from '@/components/animations';

const Products = () => {
  const { data: pricingTiers, isLoading } = usePricing();

  const getIcon = (tierName: string) => {
    switch (tierName) {
      case 'free': return <Zap className="h-5 w-5" />;
      case 'basic': return <Sparkles className="h-5 w-5" />;
      case 'premium': return <Crown className="h-5 w-5" />;
      case 'business': return <Building className="h-5 w-5" />;
      default: return <Zap className="h-5 w-5" />;
    }
  };

  if (isLoading) {
    return (
      <section id="pricing" className="py-20 bg-secondary/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Loading Pricing...</h2>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="pricing" className="py-20 bg-secondary/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <FadeIn duration={0.6} distance={20}>
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 px-3 py-1">
              Pricing Plans
            </Badge>
            <h2 className="text-3xl font-bold mb-4">
              Choose the perfect plan for your business
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              From startups to enterprises, we have a payment solution that scales with your business needs
            </p>
          </div>
        </FadeIn>

        <StaggerChildren 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
          staggerDelay={0.08}
          initialDelay={0.2}
        >
          {pricingTiers?.map((tier) => (
            <StaggerItem key={tier.id}>
              <motion.div
                whileHover={{ 
                  scale: tier.is_popular ? 1.02 : 1.03,
                  y: -4,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="h-full"
              >
                <Card 
                  className={`relative overflow-hidden h-full ${
                    tier.is_popular 
                      ? 'border-primary shadow-lg' 
                      : ''
                  }`}
                >
                  {tier.is_popular && (
                    <div className="absolute top-0 left-0 right-0 bg-primary text-primary-foreground text-center py-2 text-sm font-medium">
                      Most Popular
                    </div>
                  )}
                  
                  <CardHeader className={tier.is_popular ? "pt-12" : ""}>
                    <div className="flex items-center gap-2 mb-2">
                      <motion.div
                        whileHover={{ rotate: 15 }}
                        transition={{ type: 'spring', stiffness: 300 }}
                      >
                        {getIcon(tier.tier_name)}
                      </motion.div>
                      <CardTitle className="text-lg">{tier.display_name}</CardTitle>
                    </div>
                    <div className="text-3xl font-bold">
                      {tier.price === 0 ? 'Free' : `$${tier.price}`}
                      {tier.price > 0 && <span className="text-sm font-normal text-muted-foreground">/month</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">{tier.description}</p>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      {tier.features.map((feature, featureIndex) => (
                        <motion.div 
                          key={featureIndex} 
                          className="flex items-start gap-2"
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          transition={{ delay: featureIndex * 0.05, duration: 0.3 }}
                          viewport={{ once: true }}
                        >
                          <CheckCircle2 className="h-5 w-5 text-primary mr-2 shrink-0 mt-0.5" />
                          <span className="text-sm">{feature}</span>
                        </motion.div>
                      ))}
                    </div>

                    <div className="pt-4 space-y-2 text-xs text-muted-foreground">
                      <div>Transaction Fee: {tier.transaction_fee_percentage}% + K{tier.transaction_fee_fixed}</div>
                      {tier.max_transaction_amount && tier.max_transaction_amount > 0 && (
                        <div>Max Transaction: K{tier.max_transaction_amount.toLocaleString()}</div>
                      )}
                      {tier.virtual_cards_limit && tier.virtual_cards_limit > 0 && (
                        <div>Virtual Cards: {tier.virtual_cards_limit}</div>
                      )}
                    </div>

                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button 
                        className="w-full" 
                        variant={tier.is_popular ? "default" : "outline"}
                        asChild
                      >
                        <Link to={tier.price === 0 ? "/register" : "/checkout"}>
                          {tier.price === 0 ? 'Get Started Free' : 'Start Free Trial'}
                        </Link>
                      </Button>
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </StaggerItem>
          ))}
        </StaggerChildren>

        <FadeIn delay={0.4} duration={0.6} distance={16}>
          <div className="text-center mt-16">
            <p className="text-muted-foreground mb-4">
              All plans include our core features and 24/7 customer support
            </p>
            <div className="flex flex-wrap justify-center gap-8 text-sm text-muted-foreground">
              {[
                { label: '99.9% uptime SLA' },
                { label: 'Bank-level security' },
                { label: 'Local Zambian support' },
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
                  viewport={{ once: true }}
                >
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>{item.label}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
};

export default Products;
