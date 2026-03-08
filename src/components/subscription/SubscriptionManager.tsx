
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNativeBilling } from "@/hooks/useNativeBilling";
import { Crown, CreditCard, AlertTriangle, RefreshCw, XCircle, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const SubscriptionManager = () => {
  const { 
    subscription, 
    pricingTiers,
    isLoading,
    changeTier,
    cancelSubscription,
    reactivateSubscription,
    isChangingTier,
    isCancelling,
  } = useNativeBilling();

  const [cancelDialog, setCancelDialog] = useState(false);

  if (isLoading || !subscription) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-8 bg-muted rounded"></div>
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
      default: return <Crown className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = () => {
    if (subscription.dunning_status === 'suspended') {
      return <Badge variant="destructive">Suspended</Badge>;
    }
    if (subscription.dunning_status === 'grace_period') {
      return <Badge variant="destructive" className="bg-orange-500">Grace Period</Badge>;
    }
    if (subscription.dunning_status === 'warning') {
      return <Badge variant="secondary" className="bg-yellow-500 text-black">Payment Issue</Badge>;
    }
    if (!subscription.auto_renewal && subscription.subscription_tier !== 'free') {
      return <Badge variant="secondary">Cancelling</Badge>;
    }
    return <Badge variant="default">Active</Badge>;
  };

  const currentTier = pricingTiers?.find(t => t.tier_name === subscription.subscription_tier);
  const availableUpgrades = pricingTiers?.filter(t => 
    t.tier_name !== subscription.subscription_tier && 
    t.price > (currentTier?.price || 0)
  ) || [];
  const availableDowngrades = pricingTiers?.filter(t => 
    t.tier_name !== subscription.subscription_tier && 
    t.tier_name !== 'free' &&
    t.price < (currentTier?.price || 0)
  ) || [];

  return (
    <div className="space-y-6">
      {/* Dunning Alert */}
      {subscription.dunning_status !== 'none' && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div className="flex-1">
              <p className="font-medium text-destructive">
                {subscription.dunning_status === 'suspended' 
                  ? 'Your subscription is suspended due to payment failures.'
                  : subscription.dunning_status === 'grace_period'
                  ? 'Your payment has failed multiple times. Please update your payment method.'
                  : 'We had trouble processing your payment.'}
              </p>
            </div>
            {subscription.dunning_status === 'suspended' && (
              <Button size="sm" onClick={() => reactivateSubscription()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reactivate
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Current Subscription */}
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
                {getStatusBadge()}
              </div>
              {currentTier && currentTier.price > 0 && (
                <p className="text-2xl font-bold">
                  ${currentTier.price}<span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
              )}
              {subscription.subscription_end && (
                <p className="text-sm text-muted-foreground">
                  {subscription.auto_renewal ? 'Renews' : 'Expires'} on{' '}
                  {new Date(subscription.subscription_end).toLocaleDateString()}
                </p>
              )}
              {subscription.next_billing_date && subscription.auto_renewal && (
                <p className="text-sm text-muted-foreground">
                  Next billing: {new Date(subscription.next_billing_date).toLocaleDateString()}
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
                
                {subscription.auto_renewal ? (
                  <Button variant="outline" onClick={() => setCancelDialog(true)}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={() => reactivateSubscription()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reactivate
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Current tier features */}
          {currentTier && currentTier.features.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">Included features:</p>
              <div className="grid grid-cols-2 gap-1">
                {currentTier.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    {feature}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upgrade Options */}
      {availableUpgrades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade Your Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {availableUpgrades.map((tier) => (
                <div key={tier.id} className={`border rounded-lg p-4 relative ${tier.is_popular ? 'border-primary ring-2 ring-primary/20' : ''}`}>
                  {tier.is_popular && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2">Popular</Badge>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    {getTierIcon(tier.tier_name)}
                    <span className="font-medium">{tier.display_name}</span>
                  </div>
                  <div className="text-2xl font-bold mb-1">
                    ${tier.price}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{tier.description}</p>
                  <div className="space-y-1 mb-4">
                    {tier.features.slice(0, 4).map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        {f}
                      </div>
                    ))}
                  </div>
                  <Button 
                    className="w-full"
                    onClick={() => changeTier({ tier: tier.tier_name, action: 'upgrade' })}
                    disabled={isChangingTier}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Upgrade
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Downgrade Options */}
      {availableDowngrades.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Downgrade Options</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {availableDowngrades.map((tier) => (
                <div key={tier.id} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {getTierIcon(tier.tier_name)}
                    <span className="font-medium">{tier.display_name}</span>
                  </div>
                  <div className="text-lg font-bold mb-2">
                    ${tier.price}/mo
                  </div>
                  <Button 
                    variant="outline"
                    className="w-full"
                    onClick={() => changeTier({ tier: tier.tier_name, action: 'downgrade' })}
                    disabled={isChangingTier}
                  >
                    Downgrade
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Free tier downgrade */}
      {subscription.subscription_tier !== 'free' && (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => changeTier({ tier: 'free', action: 'downgrade' })}
            disabled={isChangingTier}
          >
            Switch to Free plan
          </Button>
        </div>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Subscription</DialogTitle>
            <DialogDescription>
              Your subscription will remain active until the end of your current billing period
              {subscription.subscription_end && (
                <> ({new Date(subscription.subscription_end).toLocaleDateString()})</>
              )}. After that, you'll be moved to the free plan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)}>Keep Subscription</Button>
            <Button 
              variant="destructive" 
              onClick={() => { cancelSubscription(); setCancelDialog(false); }}
              disabled={isCancelling}
            >
              Cancel Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubscriptionManager;
