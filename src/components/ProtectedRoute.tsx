
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles, Feature, Role } from "@/contexts/RoleContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredFeature?: Feature;
  requiredRoles?: Role[];
}

const ProtectedRoute = ({ children, requiredFeature, requiredRoles }: ProtectedRouteProps) => {
  const { user, isLoading: authLoading } = useAuth();
  const { hasAccess, hasRole, isLoading: rolesLoading } = useRoles();
  const location = useLocation();
  
  // Show loading state while checking authentication and roles
  if (authLoading || rolesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role-based authorization
  if (requiredRoles && requiredRoles.length > 0) {
    const allowed = requiredRoles.some((r) => hasRole(r));
    if (!allowed) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
          <h1 className="text-3xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-8 text-center max-w-md">
            You don't have permission to access this page. This area is restricted to authorized roles only.
          </p>
          <a href="/dashboard" className="bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/80">
            Back to Dashboard
          </a>
        </div>
      );
    }
  }

  // Check if user has access to the required feature
  if (requiredFeature && !hasAccess(requiredFeature)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold mb-4">Access Restricted</h1>
        <p className="text-muted-foreground mb-8 text-center max-w-md">
          You need to upgrade your subscription to access this feature.
        </p>
        <div className="flex gap-4">
          <a href="/pricing" className="bg-primary text-white px-4 py-2 rounded hover:bg-primary/80">
            View Pricing
          </a>
          <a href="/dashboard" className="border border-primary px-4 py-2 rounded hover:bg-primary/5">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Render children if authenticated and has access
  return <>{children || <Outlet />}</>;
};

export default ProtectedRoute;
