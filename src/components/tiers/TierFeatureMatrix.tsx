
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Star, Crown, Zap } from "lucide-react";
import { useRoles } from "@/contexts/RoleContext";
import { useFeatures } from "@/hooks/useFeatures";
import { useSubscription } from "@/hooks/useSubscription";

interface TierData {
  id: string;
  name: string;
  icon: React.ReactNode;
  price: number;
  description: string;
  pricing: {
    fixedFee: number;
    percentage: number;
    transactionLimit: string;
  };
  limits: {
    transactions: string;
    cards: string;
    transfers: string;
    support: string;
    airtime: string;
  };
  color: string;
}

const TierFeatureMatrix = () => {
  const { subscriptionTier } = useRoles();
  const { getTierFeatureMatrix, isLoading, error } = useFeatures();
  const { getCurrentTierLimits } = useSubscription();

  const tiers: TierData[] = [
    {
      id: 'free',
      name: 'Free',
      icon: <Star className="h-5 w-5" />,
      price: 0,
      description: 'Perfect for personal use and getting started',
      pricing: {
        fixedFee: 2.50,
        percentage: 2.9,
        transactionLimit: 'K 1,000',
      },
      limits: {
        transactions: '10 per month',
        cards: '1 virtual card',
        transfers: 'Local transfers only',
        support: 'Community support',
        airtime: 'Free airtime purchase'
      },
      color: 'bg-gray-500'
    },
    {
      id: 'basic',
      name: 'Basic',
      icon: <Zap className="h-5 w-5" />,
      price: 9.99,
      description: 'For individuals who need more features',
      pricing: {
        fixedFee: 2.00,
        percentage: 2.4,
        transactionLimit: 'K 10,000',
      },
      limits: {
        transactions: '100 per month',
        cards: '3 virtual cards',
        transfers: 'Local & some international',
        support: 'Email support',
        airtime: 'Free airtime purchase'
      },
      color: 'bg-blue-500'
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: <Crown className="h-5 w-5" />,
      price: 19.99,
      description: 'For power users and small businesses',
      pricing: {
        fixedFee: 1.50,
        percentage: 1.9,
        transactionLimit: 'K 50,000',
      },
      limits: {
        transactions: '1,000 per month',
        cards: '10 virtual cards',
        transfers: 'All types + faster processing',
        support: 'Priority email & chat',
        airtime: 'Free airtime purchase'
      },
      color: 'bg-purple-500'
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      icon: <Crown className="h-5 w-5" />,
      price: 49.99,
      description: 'For businesses that need everything',
      pricing: {
        fixedFee: 1.00,
        percentage: 1.4,
        transactionLimit: 'Unlimited',
      },
      limits: {
        transactions: 'Unlimited',
        cards: 'Unlimited',
        transfers: 'All types + API access + instant processing',
        support: '24/7 phone & dedicated manager',
        airtime: 'Free airtime purchase'
      },
      color: 'bg-gradient-to-r from-purple-600 to-pink-600'
    }
  ];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="text-center">Loading features...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="text-center text-red-500">Error loading features: {error.message}</div>
      </div>
    );
  }

  const featureMatrix = getTierFeatureMatrix();
  
  if (!featureMatrix) {
    return (
      <div className="space-y-8">
        <div className="text-center">No feature data available</div>
      </div>
    );
  }

  const { features, categories, matrix, tiers: tierIds } = featureMatrix;

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
                    <div>Transactions: {tier.limits.transactions}</div>
                    <div>Cards: {tier.limits.cards}</div>
                    <div>Transfers: {tier.limits.transfers}</div>
                    <div>Airtime: {tier.limits.airtime}</div>
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
          <p className="text-sm text-muted-foreground">
            Compare features across all subscription tiers
          </p>
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
                    {features
                      .filter(feature => feature.category === category)
                      .map((feature) => (
                        <tr key={feature.feature_id} className="border-b">
                          <td className="py-3 px-4">
                            <div>
                              <div className="font-medium">{feature.name}</div>
                              <div className="text-sm text-muted-foreground">{feature.description}</div>
                            </div>
                          </td>
                          {tierIds.map((tierId) => (
                            <td key={tierId} className="text-center py-3 px-4">
                              {matrix[tierId][feature.feature_id] ? (
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
