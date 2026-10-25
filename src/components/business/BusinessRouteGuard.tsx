import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { isAdminTier, roleHomePath } from "@/lib/roleVisibility";

interface BusinessRouteGuardProps {
  children: React.ReactNode;
}

const BusinessRouteGuard = ({ children }: BusinessRouteGuardProps) => {
  const { user } = useAuth();
  const { hasRole, roles, isLoading } = useRoles();

  // Show loading state while checking role
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
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
