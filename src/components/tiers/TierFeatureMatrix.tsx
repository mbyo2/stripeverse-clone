import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Star, Crown, Zap } from "lucide-react";
import { useRoles } from "@/contexts/RoleContext";

interface Feature {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface TierData {
  id: string;
  name: string;
  icon: React.ReactNode;
  price: number;
  description: string;
  features: string[];
  pricing: {
    fixedFee: number;
    percentage: number;
    transactionLimit: string;
    freeTransactions: number;
  };
  limits: {
    transactions: string;
    cards: string;
    transfers: string;
    support: string;
  };
  color: string;
}

const TierFeatureMatrix = () => {
  const { subscriptionTier, hasAccess } = useRoles();

  const tiers: TierData[] = [
    {
      id: 'free',
      name: 'Free',
      icon: <Star className="h-5 w-5" />,
      price: 0,
      description: 'Perfect for personal use and getting started',
      features: ['dashboard_access', 'feedback_submission', 'transfers'],
      pricing: {
        fixedFee: 2.50,
        percentage: 2.9,
        transactionLimit: 'K 1,000',
        freeTransactions: 0
      },
      limits: {
        transactions: '2.9% + K2.50 per transaction',
        cards: '1 virtual card',
        transfers: 'Local transfers only',
        support: 'Community support'
      },
      color: 'bg-gray-500'
    },
    {
      id: 'basic',
      name: 'Basic',
      icon: <Zap className="h-5 w-5" />,
      price: 9.99,
      description: 'For individuals who need more features',
      features: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers'],
      pricing: {
        fixedFee: 2.00,
        percentage: 2.4,
        transactionLimit: 'K 10,000',
        freeTransactions: 0
      },
      limits: {
        transactions: '2.4% + K2.00 per transaction',
        cards: '3 virtual cards',
        transfers: 'Local & some international',
        support: 'Email support'
      },
      color: 'bg-blue-500'
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: <Crown className="h-5 w-5" />,
      price: 19.99,
      description: 'For power users and small businesses',
      features: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics'],
      pricing: {
        fixedFee: 1.50,
        percentage: 1.9,
        transactionLimit: 'K 50,000',
        freeTransactions: 0
      },
      limits: {
        transactions: '1.9% + K1.50 per transaction',
        cards: '10 virtual cards',
        transfers: 'All types + faster processing',
        support: 'Priority email & chat'
      },
      color: 'bg-purple-500'
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: <Crown className="h-5 w-5" />,
      price: 49.99,
      description: 'For businesses that need everything',
      features: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics', 'business_tools'],
      pricing: {
        fixedFee: 1.00,
        percentage: 1.4,
        transactionLimit: 'Unlimited',
        freeTransactions: 0
      },
      limits: {
        transactions: '1.4% + K1.00 per transaction',
        cards: 'Unlimited',
        transfers: 'All types + API access + instant processing',
        support: '24/7 phone & dedicated manager'
      },
      color: 'bg-gradient-to-r from-purple-600 to-pink-600'
    }
  ];

  const allFeatures: Feature[] = [
    { id: 'dashboard_access', name: 'Dashboard Access', description: 'Access to main dashboard', category: 'Core' },
    { id: 'feedback_submission', name: 'Feedback Submission', description: 'Submit feedback and suggestions', category: 'Core' },
    { id: 'transfers', name: 'Money Transfers', description: 'Send money with competitive rates', category: 'Payment' },
    { id: 'virtual_cards', name: 'Virtual Cards', description: 'Create and manage virtual debit cards', category: 'Payment' },
    { id: 'analytics', name: 'Analytics', description: 'Transaction analytics and reports', category: 'Business' },
    { id: 'business_tools', name: 'Business Tools', description: 'Advanced tools for businesses', category: 'Business' },
    { id: 'feedback_dashboard', name: 'Feedback Management', description: 'Manage customer feedback', category: 'Admin' }
  ];

  const categories = [...new Set(allFeatures.map(f => f.category))];

  return (
    <div className="space-y-8">
      {/* Tier Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiers.map((tier) => (
          <Card key={tier.id} className={`relative ${tier.id === subscriptionTier ? 'ring-2 ring-primary' : ''}`}>
            {tier.id === subscriptionTier && (
              <Badge className="absolute -top-2 left-4 bg-green-500">Current Plan</Badge>
            )}
            <CardHeader className="text-center">
              <div className={`w-12 h-12 rounded-full ${tier.color} flex items-center justify-center text-white mx-auto mb-2`}>
                {tier.icon}
              </div>
              <CardTitle>{tier.name}</CardTitle>
              <div className="text-2xl font-bold">
                {tier.price === 0 ? 'Free' : `K${tier.price}`}
                {tier.price > 0 && <span className="text-sm font-normal text-muted-foreground">/month</span>}
              </div>
              <p className="text-sm text-muted-foreground">{tier.description}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm mb-2">Transaction Pricing</h4>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>{tier.pricing.percentage}% + K{tier.pricing.fixedFee} per transaction</div>
                    <div>Max: {tier.pricing.transactionLimit} per transaction</div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-sm mb-2">Features & Limits</h4>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>Cards: {tier.limits.cards}</div>
                    <div>Transfers: {tier.limits.transfers}</div>
                    <div>Support: {tier.limits.support}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Feature Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Comparison Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left py-3 px-4 font-medium">Feature</th>
                  {tiers.map((tier) => (
                    <th key={tier.id} className="text-center py-3 px-4 font-medium">
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <React.Fragment key={category}>
                    <tr>
                      <td colSpan={5} className="py-2 px-4 bg-gray-50 font-medium text-sm">
                        {category} Features
                      </td>
                    </tr>
                    {allFeatures
                      .filter(feature => feature.category === category)
                      .map((feature) => (
                        <tr key={feature.id} className="border-b">
                          <td className="py-3 px-4">
                            <div>
                              <div className="font-medium">{feature.name}</div>
                              <div className="text-sm text-muted-foreground">{feature.description}</div>
                            </div>
                          </td>
                          {tiers.map((tier) => (
                            <td key={tier.id} className="text-center py-3 px-4">
                              {tier.features.includes(feature.id) ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />
                              ) : (
                                <XCircle className="h-5 w-5 text-red-400 mx-auto" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TierFeatureMatrix;
