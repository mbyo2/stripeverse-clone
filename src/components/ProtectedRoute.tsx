
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
      const userRoles = roles.length ? roles.join(', ') : 'user';
      const requiredList = requiredRoles.join(', ');
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full bg-card border rounded-lg p-8 shadow-sm text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0-10a4 4 0 00-4 4v3h8v-3a4 4 0 00-4-4z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2 text-foreground">Access Denied</h1>
            <p className="text-muted-foreground mb-6">
              This page is restricted to authorized roles only.
            </p>
            <div className="bg-muted rounded-md p-4 mb-6 text-sm text-left space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your role:</span>
                <span className="font-medium text-foreground capitalize">{userRoles}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Required:</span>
                <span className="font-medium text-foreground capitalize">{requiredList}</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href="/role-management" className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors font-medium">
                Request Access
              </a>
              <a href="/dashboard" className="flex-1 border border-border px-4 py-2 rounded-md hover:bg-muted transition-colors font-medium">
                Back to Dashboard
              </a>
            </div>
          </div>
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
