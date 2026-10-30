// FeatureRouteGate — the route-level half of the CEO's 2026-10-30
// directive (see src/lib/featureVisibility.ts). Wraps a route whose
// feature is unfinished: the admin tier walks straight in (exactly
// as before), a regular user for whom the feature is live (its
// platform flag is on) walks in too, and everyone else is quietly
// redirected to their dashboard — no error text, no dead page, in
// line with the standing no-denial-walls rule (2026-10-25).
//
// Data-stranding carve-out: a route may pass `dataCheck` — when it
// resolves true (the user already holds records inside the hidden
// feature: a receiving account, their own virtual card), the page
// renders for them so they never lose sight of their own items.
// The pages behind those checks already render the owner's records
// read-only-first while the feature is off.
//
// While roles/flags (or a data check) are still resolving, the gate
// shows the destination route's own skeleton twin — never the page
// itself — so an unfinished surface can't flash for a regular user.

import { type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useFeatureVisibility } from "@/hooks/useFeatureVisibility";
import { shellSkeletonVariant } from "@/lib/sessionHint";
import { SkeletonHeaderBar } from "@/components/ui/skeletons";
import { skeletonForRoute } from "@/lib/routeSkeleton";
import type { FeatureKey } from "@/lib/featureVisibility";

interface FeatureRouteGateProps {
  feature: FeatureKey;
  children: ReactNode;
  /** Where a signed-in user lands when the feature is hidden for
   *  them. Defaults to the user home, /dashboard. */
  redirectTo?: string;
  /**
   * Data-stranding check: resolves true when this user already
   * holds records inside the feature, in which case the page
   * renders for them despite the gate. Receives the user id and the
   * route params (card routes check ownership of the specific card).
   */
  dataCheck?: (
    userId: string,
    params: Record<string, string | undefined>,
  ) => Promise<boolean>;
  /** Public routes (no ProtectedRoute around them): a signed-out
   *  visitor is a guest, never an admin — redirect them to
   *  `guestRedirectTo` instead of the dashboard. */
  publicRoute?: boolean;
  guestRedirectTo?: string;
}

const FeatureRouteGate = ({
  feature,
  children,
  redirectTo = "/dashboard",
  dataCheck,
  publicRoute = false,
  guestRedirectTo = "/",
}: FeatureRouteGateProps) => {
  const { user, isAuthReady, hasStoredSession } = useAuth();
  const visibility = useFeatureVisibility();
  const location = useLocation();
  const params = useParams();

  const allowedByRegistry =
    visibility.adminTier || visibility.canSee(feature);

  // Only run the (billable) data check when the registry alone
  // would turn this signed-in user away.
  const dataQuery = useQuery({
    queryKey: [
      "feature-gate-data",
      feature,
      user?.id,
      JSON.stringify(params),
    ],
    enabled:
      !!dataCheck && !!user?.id && !allowedByRegistry && !visibility.isLoading,
    queryFn: () => dataCheck!(user!.id, params),
    staleTime: 60_000,
  });

  // Guests on a public gated route: no session can make them an
  // admin, so they leave as soon as auth has resolved.
  if (publicRoute && isAuthReady && !user) {
    return <Navigate to={guestRedirectTo} replace />;
  }

  if (allowedByRegistry || dataQuery.data === true) {
    return <>{children}</>;
  }

  const stillResolving =
    visibility.isLoading ||
    (!!dataCheck && !!user?.id && dataQuery.isLoading);
  if (stillResolving) {
    return (
      <div
        className="min-h-screen flex flex-col bg-muted"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <SkeletonHeaderBar
          variant={shellSkeletonVariant({ user, isAuthReady, hasStoredSession })}
        />
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
          {skeletonForRoute(location.pathname)}
        </main>
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return <Navigate to={redirectTo} replace />;
};

export default FeatureRouteGate;
