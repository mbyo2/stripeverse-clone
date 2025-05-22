
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";

interface BusinessRouteGuardProps {
  children: React.ReactNode;
}

const BusinessRouteGuard = ({ children }: BusinessRouteGuardProps) => {
  const { user } = useAuth();
  const { hasRole, isLoading } = useRoles();
  
  // Show loading state while checking role
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to home if not a business user
  if (!hasRole('business')) {
    return <Navigate to="/" replace />;
  }

  // Render children if user has business role
  return <>{children || <Outlet />}</>;
};

export default BusinessRouteGuard;
