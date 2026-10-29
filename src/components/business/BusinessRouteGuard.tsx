import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { isAdminTier, roleHomePath } from "@/lib/roleVisibility";
import { BusinessDashboardSkeleton, SkeletonHeaderBar } from "@/components/ui/skeletons";

interface BusinessRouteGuardProps {
  children: React.ReactNode;
}

const BusinessRouteGuard = ({ children }: BusinessRouteGuardProps) => {
  const { user } = useAuth();
  const { hasRole, roles, isLoading } = useRoles();

  // Show loading state while checking role: the business
  // dashboard's own skeleton twin behind the shell header twin —
  // never a bare spinner on a blank screen.
  if (isLoading) {
    return (
      <div
        className="min-h-screen flex flex-col bg-background"
        role="status"
        aria-label="Loading"
        aria-busy="true"
      >
        <SkeletonHeaderBar variant="authed" />
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
          <BusinessDashboardSkeleton />
        </main>
      </div>
    );
  }

  // The business dashboard belongs to the business role; the admin
  // tier is admitted too, matching the sibling mixed gates
  // (/compliance, /fraud-rules, /api-rate-limits all admit
  // business + admin + super_admin) and keeping super_admin's full
  // visibility. Everyone else is quietly redirected to their own
  // role's home (CEO directive 2026-10-25: no walls, no detour to
  // the public landing page) — presentation only; the merchant data
  // itself stays behind the merchant account's own RLS.
  if (!hasRole('business') && !isAdminTier(roles)) {
    return <Navigate to={roleHomePath(roles)} replace />;
  }

  // Render children if user has business role
  return <>{children || <Outlet />}</>;
};

export default BusinessRouteGuard;
