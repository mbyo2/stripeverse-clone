
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "./AuthContext";

export type UserRole = "user" | "business" | "admin" | "beta_tester";
export type SubscriptionTier = "free" | "basic" | "premium" | "enterprise";

type RoleContextType = {
  roles: UserRole[];
  subscriptionTier: SubscriptionTier;
  isLoading: boolean;
  hasRole: (role: UserRole) => boolean;
  hasAccess: (feature: Feature) => boolean;
  refreshRoles: () => Promise<void>;
};

export type Feature = 
  | "dashboard_access" 
  | "feedback_submission" 
  | "feedback_dashboard" 
  | "virtual_cards" 
  | "transfers" 
  | "business_tools" 
  | "analytics";

// Define which features are available to which subscription tiers
const tierFeatures: Record<SubscriptionTier, Feature[]> = {
  free: ["dashboard_access", "feedback_submission"],
  basic: ["dashboard_access", "feedback_submission", "virtual_cards"],
  premium: ["dashboard_access", "feedback_submission", "virtual_cards", "transfers", "analytics"],
  enterprise: ["dashboard_access", "feedback_submission", "virtual_cards", "transfers", "analytics", "business_tools"],
};

// Define which features are available to which roles (overrides tier restrictions)
const roleFeatures: Record<UserRole, Feature[]> = {
  user: [],
  business: ["business_tools"],
  admin: ["feedback_dashboard", "business_tools", "analytics"],
  beta_tester: ["feedback_dashboard", "feedback_submission"],
};

// Create context with default undefined value
const RoleContext = createContext<RoleContextType | undefined>(undefined);

export const RoleProvider = ({ children }: { children: ReactNode }) => {
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>("free");
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  // Function to check if user has a specific role
  const hasRole = (role: UserRole) => {
    return roles.includes(role);
  };

  // Function to check if user has access to a specific feature
  const hasAccess = (feature: Feature) => {
    // Check if any of the user's roles grants access to the feature
    const hasRoleAccess = roles.some(role => roleFeatures[role].includes(feature));
    
    // Check if the user's subscription tier grants access to the feature
    const hasTierAccess = tierFeatures[subscriptionTier].includes(feature);
    
    // User has access if either their role or subscription tier grants it
    return hasRoleAccess || hasTierAccess;
  };

  // Fetch the user's roles and subscription tier
  const refreshRoles = async () => {
    try {
      setIsLoading(true);
      
      if (!user) {
        setRoles([]);
        setSubscriptionTier("free");
        return;
      }

      // Fetch user roles
      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (roleError) {
        console.error("Error fetching user roles:", roleError);
        toast({
          title: "Error",
          description: "Failed to load user roles. Some features may be unavailable.",
          variant: "destructive",
        });
        return;
      }

      // Extract roles from response
      const userRoles = roleData.map(r => r.role) as UserRole[];
      
      // If no explicit roles assigned, set default role to "user"
      if (userRoles.length === 0) {
        userRoles.push("user");
      }
      
      setRoles(userRoles);

      // TODO: In a real app, fetch subscription tier from a subscribers table
      // For now, simulate subscription tier based on roles
      if (userRoles.includes("admin")) {
        setSubscriptionTier("enterprise");
      } else if (userRoles.includes("business")) {
        setSubscriptionTier("premium");
      } else if (userRoles.includes("beta_tester")) {
        setSubscriptionTier("basic");
      } else {
        setSubscriptionTier("free");
      }

    } catch (error) {
      console.error("Unexpected error fetching user roles:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch roles when user changes
  useEffect(() => {
    refreshRoles();
  }, [user]);

  return (
    <RoleContext.Provider value={{ 
      roles, 
      subscriptionTier, 
      isLoading, 
      hasRole, 
      hasAccess,
      refreshRoles
    }}>
      {children}
    </RoleContext.Provider>
  );
};

// Custom hook to use role context
export const useRoles = () => {
  const context = useContext(RoleContext);
  if (context === undefined) {
    throw new Error("useRoles must be used within a RoleProvider");
  }
  return context;
};
