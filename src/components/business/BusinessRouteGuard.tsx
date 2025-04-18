
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface BusinessRouteGuardProps {
  children: React.ReactNode;
}

const BusinessRouteGuard = ({ children }: BusinessRouteGuardProps) => {
  const { user } = useAuth();
  
  const { data: hasBusinessRole, isLoading } = useQuery({
    queryKey: ['hasBusinessRole', user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase.rpc('has_role', {
        user_id: user.id,
        required_role: 'business'
      });
      return data || false;
    },
    enabled: !!user,
  });

  // Show loading state while checking role
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to home if not a business user
  if (!hasBusinessRole) {
    return <Navigate to="/" replace />;
  }

  // Render children if user has business role
  return <>{children}</>;
};

export default BusinessRouteGuard;
