
import React from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { hasFeatureAccess, checkUsageLimit } = useSubscription();
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
    return <Skeleton className="h-8" />;
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
                This feature isn't included on your account.
              </span>
            ) : (
              <span>
                You've reached your monthly limit for this feature.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Link to="/pricing">
              <Button size="sm" variant="outline">
                See Fees
              </Button>
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return <>{children}</>;
};

export default FeatureLimitChecker;
