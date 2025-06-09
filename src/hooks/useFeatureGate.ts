
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';

export const useFeatureGate = () => {
  const { hasFeatureAccess, checkUsageLimit } = useSubscription();
  const { toast } = useToast();

  const checkFeatureAccess = async (
    feature: string, 
    limitType?: string, 
    amount: number = 1
  ): Promise<boolean> => {
    // Check feature access first
    if (!hasFeatureAccess(feature)) {
      toast({
        title: "Feature Not Available",
        description: `This feature requires a higher subscription tier.`,
        variant: "destructive",
      });
      return false;
    }

    // Check usage limits if specified
    if (limitType) {
      const hasCapacity = await checkUsageLimit(limitType, amount);
      if (!hasCapacity) {
        toast({
          title: "Usage Limit Reached",
          description: `You've reached your monthly limit for this feature. Upgrade to continue.`,
          variant: "destructive",
        });
        return false;
      }
    }

    return true;
  };

  const enforceLimit = async (
    feature: string,
    limitType?: string,
    amount: number = 1,
    action?: () => Promise<void>
  ): Promise<boolean> => {
    const canProceed = await checkFeatureAccess(feature, limitType, amount);
    
    if (canProceed && action) {
      try {
        await action();
        return true;
      } catch (error) {
        console.error('Action failed:', error);
        return false;
      }
    }
    
    return canProceed;
  };

  return {
    checkFeatureAccess,
    enforceLimit,
    hasFeatureAccess,
    checkUsageLimit,
  };
};
