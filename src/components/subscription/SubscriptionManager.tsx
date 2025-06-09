
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSubscription } from "@/hooks/useSubscription";
import { Crown, CreditCard, Settings } from "lucide-react";

const SubscriptionManager = () => {
  const { 
    subscription, 
    openCustomerPortal, 
    createCheckout,
    isOpeningPortal,
    isCreatingCheckout
  } = useSubscription();

  if (!subscription) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            <div className="h-8 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'enterprise': return <Crown className="h-5 w-5 text-purple-500" />;
      case 'premium': return <Crown className="h-5 w-5 text-blue-500" />;
      case 'basic': return <Crown className="h-5 w-5 text-green-500" />;
      default: return <Crown className="h-5 w-5 text-gray-500" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'enterprise': return 'bg-purple-500';
      case 'premium': return 'bg-blue-500';
      case 'basic': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const availableUpgrades = subscription.subscription_tier === 'free' ? 
    ['basic', 'premium', 'enterprise'] :
    subscription.subscription_tier === 'basic' ?
    ['premium', 'enterprise'] :
    subscription.subscription_tier === 'premium' ?
    ['enterprise'] : [];

  return (
    <div className="space-y-6">
      {/* Current Subscription Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getTierIcon(subscription.subscription_tier)}
            Current Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-medium capitalize">
                  {subscription.subscription_tier} Plan
                </span>
                <Badge 
                  className={`text-white ${getTierColor(subscription.subscription_tier)}`}
                >
                  Active
                </Badge>
              </div>
              {subscription.subscription_end && (
                <p className="text-sm text-muted-foreground">
                  Renews on {new Date(subscription.subscription_end).toLocaleDateString()}
                </p>
              )}
            </div>
            
            {subscription.subscription_tier !== 'free' && (
              <div className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="auto-renewal" 
                    checked={subscription.auto_renewal}
                    disabled
                  />
                  <Label htmlFor="auto-renewal" className="text-sm">
                    Auto-renewal
                  </Label>
                </div>
                
                <Button 
                  variant="outline"
                  onClick={() => openCustomerPortal()}
                  disabled={isOpeningPortal}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Manage
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Options */}
      {availableUpgrades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Available Upgrades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {availableUpgrades.map((tier) => (
                <div key={tier} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {getTierIcon(tier)}
                    <span className="font-medium capitalize">{tier} Plan</span>
                  </div>
                  <div className="text-2xl font-bold mb-1">
                    {tier === 'basic' ? '$9.99' : 
                     tier === 'premium' ? '$19.99' : 
                     '$49.99'} / month
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {tier === 'basic' ? 'For individuals who need more features' :
                     tier === 'premium' ? 'For power users and small businesses' :
                     'For businesses that need everything'}
                  </p>
                  <Button 
                    className="w-full"
                    onClick={() => createCheckout(tier)}
                    disabled={isCreatingCheckout}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Upgrade to {tier}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SubscriptionManager;
