
import React from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Lock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { Link } from "react-router-dom";

interface FeatureLimitCheckerProps {
  feature: string;
  limitType?: string;
  amount?: number;
  children: React.ReactNode;
}

const FeatureLimitChecker = ({ 
  feature, 
  limitType, 
  amount = 1, 
  children 
}: FeatureLimitCheckerProps) => {
  const { hasFeatureAccess, checkUsageLimit, subscription } = useSubscription();
  const [canProceed, setCanProceed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const checkLimits = async () => {
      // First check feature access
      if (!hasFeatureAccess(feature)) {
        setCanProceed(false);
        return;
      }

      // Then check usage limits if specified
      if (limitType) {
        const hasCapacity = await checkUsageLimit(limitType, amount);
        setCanProceed(hasCapacity);
      } else {
        setCanProceed(true);
      }
    };

    checkLimits();
  }, [feature, limitType, amount, hasFeatureAccess, checkUsageLimit]);

  if (canProceed === null) {
    return <div className="animate-pulse h-8 bg-gray-200 rounded"></div>;
  }

  if (!canProceed) {
    const isFeatureRestriction = !hasFeatureAccess(feature);
    
    return (
      <Alert className="border-amber-200 bg-amber-50">
        <Lock className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <div>
            {isFeatureRestriction ? (
              <span>
                This feature requires a {feature === 'virtual_cards' ? 'Basic' : 'Premium'} plan or higher.
              </span>
            ) : (
              <span>
                You've reached your monthly limit for this feature. Upgrade to continue.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Link to="/pricing">
              <Button size="sm" variant="outline">
                View Plans
              </Button>
            </Link>
            {subscription?.subscription_tier !== 'free' && (
              <Link to="/billing">
                <Button size="sm">
                  Upgrade
                </Button>
              </Link>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
};

export default FeatureLimitChecker;
