
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles, Feature, Role } from "@/contexts/RoleContext";
import { roleHomePath } from "@/lib/roleVisibility";
import { shellSkeletonVariant } from "@/lib/sessionHint";
import { DashboardSkeleton, SkeletonHeaderBar } from "@/components/ui/skeletons";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredFeature?: Feature;
  requiredRoles?: Role[];
}

const ProtectedRoute = ({ children, requiredFeature, requiredRoles }: ProtectedRouteProps) => {
  const { user, isAuthReady, hasStoredSession } = useAuth();
  const { hasAccess, hasRole, roles, isLoading: rolesLoading } = useRoles();
  const location = useLocation();

  // Wait for the session to be VERIFIED + roles to fully resolve
  // before any access decision — and before any child renders, so no
  // protected page fires an authenticated query on an unchecked
  // session. isAuthReady (AuthContext bootstrap) means the stored
  // session was validated with GoTrue: refreshed if its access token
  // was refused, cleared if the refresh token was refused too. A
  // session that cannot be verified therefore never reaches this
  // point as a `user` — it arrives as no user and routes to /login.
  // For authenticated users, also wait until roles array is populated to prevent
  // a brief flash of "Your role: user" before the real role loads.
  const rolesNotReady = !!user && roles.length === 0;
  if (!isAuthReady || rolesLoading || rolesNotReady) {
    // While access resolves, show the shape of what's coming — most
    // users land on the dashboard, so the bootstrap is a dashboard
    // skeleton behind the shell header bar, not a spinner on a blank
    // screen. The verifying copy stays for screen readers only.
    return (
      <div
        className="min-h-screen flex flex-col bg-muted"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <SkeletonHeaderBar variant={shellSkeletonVariant({ user, isAuthReady, hasStoredSession })} />
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
          <DashboardSkeleton />
        </main>
        <span className="sr-only">Verifying your access — loading authentication and permissions</span>
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Role-based authorization — presentation only (the database and
  // edge functions enforce the real access rules). CEO directive
  // (2026-10-25): no denial walls. A signed-in user who
  // lands on a route outside their role is quietly redirected to
  // their own role's home; role surfaces simply never appear in
  // their navigation in the first place.
  if (requiredRoles && requiredRoles.length > 0) {
    const allowed = requiredRoles.some((r) => hasRole(r));
    if (!allowed) {
      return <Navigate to={roleHomePath(roles)} replace />;
    }
  }

  // Check if user has access to the required feature
  if (requiredFeature && !hasAccess(requiredFeature)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold mb-4">Access Restricted</h1>
        <p className="text-muted-foreground mb-8 text-center max-w-md">
          This feature isn't included on your account.
        </p>
        <div className="flex gap-4">
          <a href="/pricing" className="inline-flex items-center bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-full hover:bg-[#DE830A] transition-colors">
            View Pricing
          </a>
          <a href="/dashboard" className="inline-flex items-center bg-secondary text-secondary-foreground font-semibold px-6 py-2.5 rounded-full hover:bg-accent transition-colors">
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
