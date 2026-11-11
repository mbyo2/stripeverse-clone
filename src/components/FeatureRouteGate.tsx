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
//
// Honest-resolution carve-out (rendered-pass fix, 2026-11-11): a
// route may pass `hiddenFallback` — what a resolved, not-allowed
// viewer sees INSTEAD of the silent dashboard redirect. /card/new
// uses it: virtual cards are "Coming soon" + admin-only by product
// decision, and the create page already renders that coming-soon
// panel for non-admins — but this gate intercepted them first, so
// they sat on the route skeleton until roles AND the platform-flags
// fetch settled and were then silently bounced to /dashboard,
// never seeing the honest state. A feature with no platform flag
// (virtualCards is one) also settles on roles alone: its visibility
// decision never reads the flags (isFeatureVisible returns before
// touching them), so the flags fetch must not hold the skeleton up.

import { type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { useFeatureVisibility } from "@/hooks/useFeatureVisibility";
import { shellSkeletonVariant } from "@/lib/sessionHint";
import { SkeletonHeaderBar } from "@/components/ui/skeletons";
import { skeletonForRoute } from "@/lib/routeSkeleton";
import { FEATURE_REGISTRY, type FeatureKey } from "@/lib/featureVisibility";

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
  /** What a signed-in viewer who is turned away sees once the gate
   *  has fully resolved, instead of the silent redirect to
   *  `redirectTo`: an honest in-app state for a feature that is
   *  simply not available to them yet (e.g. the destination page's
   *  own "Coming soon" treatment). Only for routes whose fallback
   *  itself re-checks roles before rendering anything privileged. */
  hiddenFallback?: ReactNode;
}

const FeatureRouteGate = ({
  feature,
  children,
  redirectTo = "/dashboard",
  dataCheck,
  publicRoute = false,
  guestRedirectTo = "/",
  hiddenFallback,
}: FeatureRouteGateProps) => {
  const { user, isAuthReady, hasStoredSession } = useAuth();
  const { isLoading: rolesLoading } = useRoles();
  const visibility = useFeatureVisibility();
  const location = useLocation();
  const params = useParams();

  const allowedByRegistry =
    visibility.adminTier || visibility.canSee(feature);

  // A flag-less feature's decision never reads the platform flags
  // (isFeatureVisible: no flag → admin tier only), so it settles as
  // soon as roles are known. Waiting on the flags fetch as well
  // held flag-less gates (virtual cards among them) on their
  // skeleton for the full settings round-trip for no reason.
  const flagDriven = !!FEATURE_REGISTRY[feature].flag;
  const decisionSettled = flagDriven ? !visibility.isLoading : !rolesLoading;

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
      !!dataCheck && !!user?.id && !allowedByRegistry && decisionSettled,
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
    !decisionSettled ||
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

  // Resolved and turned away: an honest in-app state when the
  // route declared one, the standing quiet redirect otherwise.
  if (hiddenFallback !== undefined) {
    return <>{hiddenFallback}</>;
  }

  return <Navigate to={redirectTo} replace />;
};

export default FeatureRouteGate;
