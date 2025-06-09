
import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "business" | "user" | "beta_tester";
export type Feature =
  | "dashboard_access"
  | "feedback_submission"
  | "virtual_cards"
  | "transfers"
  | "analytics"
  | "business_tools"
  | "feedback_dashboard";

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
  const { user, isLoading: authLoading } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<string>("free");
  const [isLoading, setIsLoading] = useState(true);

  const checkRoleAccess = useCallback(
    (feature: Feature): boolean => {
      if (roles.includes("admin")) return true;

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
  const hasAccess = useCallback((feature: Feature): boolean => {
    if (isLoading) return false;
    
    // Check role-based access first
    const roleAccess = checkRoleAccess(feature);
    if (roleAccess) return true;
    
    // Check subscription-based access
    const tierFeatures: Record<string, Feature[]> = {
      free: ['dashboard_access', 'feedback_submission', 'transfers'],
      basic: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers'],
      premium: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics'],
      enterprise: ['dashboard_access', 'feedback_submission', 'virtual_cards', 'transfers', 'analytics', 'business_tools']
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

  useEffect(() => {
    getRoles();
  }, [getRoles]);

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
    hasAccess,
    hasRole,
    refreshRoles,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
