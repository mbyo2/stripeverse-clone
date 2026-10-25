
import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type Role =
  | "admin"
  | "super_admin"
  | "business"
  | "user"
  | "beta_tester"
  | "moderator"
  | "p2p_admin"
  | "support_admin"
  | "compliance_admin"
  | "finance_admin";
export type Feature =
  | "dashboard_access"
  | "feedback_submission"
  | "virtual_cards"
  | "transfers"
  | "analytics"
  | "business_tools"
  | "feedback_dashboard"
  | "airtime_purchase";

interface RoleContextProps {
  roles: Role[];
  subscriptionTier: string;
  isLoading: boolean;
  hasAccess: (feature: Feature) => boolean;
  hasRole: (role: Role) => boolean;
  refreshRoles: () => Promise<void>;
}

const RoleContext = createContext<RoleContextProps>({
  roles: [],
  subscriptionTier: "free",
  isLoading: true,
  hasAccess: () => false,
  hasRole: () => false,
  refreshRoles: async () => {},
});

export const useRoles = () => useContext(RoleContext);

interface RoleProviderProps {
  children: React.ReactNode;
}

export const RoleProvider = ({ children }: RoleProviderProps) => {
  const { user, isLoading: authLoading, isAuthReady } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<string>("free");
  const [isLoading, setIsLoading] = useState(true);

  const checkRoleAccess = useCallback(
    (feature: Feature): boolean => {
      // super_admin is additive over admin (foundation design): it
      // holds every feature access an admin holds, never less.
      if (roles.includes("admin") || roles.includes("super_admin")) return true;

      const featureRoles: { [key in Feature]?: Role[] } = {
        feedback_dashboard: ["admin"],
        analytics: ["business", "admin"],
        business_tools: ["business", "admin"],
      };

      const allowedRoles = featureRoles[feature] || [];
      return roles.some((role) => allowedRoles.includes(role));
    },
    [roles]
  );

  // Enhanced hasAccess function that considers subscription tier
  const hasAccess = useCallback(async (feature: Feature): Promise<boolean> => {
    if (isLoading) return false;
    
    // Check role-based access first
    const roleAccess = checkRoleAccess(feature);
    if (roleAccess) return true;
    
    // Check subscription-based access using the database function
    if (user?.id) {
      try {
        const { data, error } = await supabase.rpc('user_has_feature_access', {
          p_user_id: user.id,
          p_feature_id: feature
        });
        
        if (error) {
          console.error('Error checking feature access:', error);
          return false;
        }
        
        return data;
      } catch (error) {
        console.error('Error checking feature access:', error);
        return false;
      }
    }
    
    return false;
  }, [isLoading, checkRoleAccess, user?.id]);

  // Synchronous version for immediate checks
  const hasAccessSync = useCallback((feature: Feature): boolean => {
    if (isLoading) return false;
    
    // Check role-based access first
    const roleAccess = checkRoleAccess(feature);
    if (roleAccess) return true;
    
    // Check subscription-based access with local tier data
    const tierFeatures: Record<string, Feature[]> = {
      free: ['dashboard_access', 'feedback_submission', 'transfers', 'airtime_purchase'],
      basic: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'airtime_purchase'],
      premium: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics', 'airtime_purchase'],
      enterprise: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics', 'business_tools', 'airtime_purchase']
    };
    
    const currentTierFeatures = tierFeatures[subscriptionTier] || tierFeatures.free;
    return currentTierFeatures.includes(feature);
  }, [isLoading, checkRoleAccess, subscriptionTier]);

  // Check if user has a specific role
  const hasRole = useCallback((role: Role): boolean => {
    return roles.includes(role);
  }, [roles]);

  const getRoles = useCallback(async () => {
    setIsLoading(true);
    if (user) {
      try {
        let { data: user_roles, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (error) {
          throw error;
        }

        if (user_roles && user_roles.length > 0) {
          const rolesArray = user_roles.map((item) => item.role) as Role[];
          setRoles(rolesArray);
        } else {
          setRoles(["user"]);
        }
      } catch (error: any) {
        console.error("Error fetching roles:", error.message);
        setRoles(["user"]);
      } finally {
        setIsLoading(false);
      }
    } else {
      setRoles([]);
      setIsLoading(false);
    }
  }, [user]);

  const refreshRoles = useCallback(async () => {
    await getRoles();
  }, [getRoles]);

  // Roles are an authenticated read: wait until the stored session
  // has been verified (AuthContext bootstrap) so the fetch never
  // goes out on an unchecked — possibly dead — token.
  useEffect(() => {
    if (!isAuthReady) return;
    void getRoles();
  }, [getRoles, isAuthReady]);

  // Enhanced subscription tier checking
  useEffect(() => {
    const checkSubscription = async () => {
      if (user?.id) {
        try {
          const { data, error } = await supabase.functions.invoke('check-subscription');
          if (data && !error) {
            setSubscriptionTier(data.subscription_tier || 'free');
          }
        } catch (error) {
          console.error('Error checking subscription:', error);
          setSubscriptionTier('free');
        }
      }
    };

    checkSubscription();
  }, [user?.id]);

  const value: RoleContextProps = {
    roles,
    subscriptionTier,
    isLoading: authLoading || isLoading,
    hasAccess: hasAccessSync, // Use sync version for immediate UI updates
    hasRole,
    refreshRoles,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
