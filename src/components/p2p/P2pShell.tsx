import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PauseCircle, ShieldAlert } from "lucide-react";
import { useP2pEnabled, useP2pLimits } from "@/hooks/useP2p";
import { formatZmw, limitsReasonText } from "@/utils/p2pUi";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/p2p", label: "Marketplace", exact: true },
  { to: "/p2p/orders", label: "My Orders", exact: false },
  { to: "/p2p/my-ads", label: "My Ads", exact: false },
  { to: "/p2p/ads/new", label: "Post an Ad", exact: false },
  { to: "/p2p/profile", label: "P2P Profile", exact: false },
];

/**
 * Shared chrome for every /p2p screen: app header, section tabs,
 * the marketplace-paused banner and the my-limits strip. The paused
 * state mirrors the server kill switch (platform_settings.
 * p2p_enabled) — entry actions are refused server-side too; this
 * banner is the honest user-facing half of that switch (§4.4).
 */
export default function P2pShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const location = useLocation();
  const enabledQuery = useP2pEnabled();
  const limitsQuery = useP2pLimits();
  const paused = enabledQuery.data === false;
  const limits = limitsQuery.data;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto pb-1 mb-6 border-b border-border">
          {TABS.map((tab) => {
            const active = tab.exact
              ? location.pathname === tab.to
              : location.pathname.startsWith(tab.to);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-t-md whitespace-nowrap transition-colors",
                  active
                    ? "text-primary border-b-2 border-primary -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {enabledQuery.isLoading ? (
          <Skeleton className="h-10 w-full mb-6" />
        ) : paused ? (
          <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
            <PauseCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>P2P trading is paused</AlertTitle>
            <AlertDescription>
              New ads and orders are on hold right now. Existing trades can
              still be finished — escrow is never stranded by a pause.
            </AlertDescription>
          </Alert>
        ) : null}

        {!limitsQuery.isLoading && limits && !limits.can_trade && (
          <Alert className="mb-6 border-destructive/40 bg-destructive/5">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <AlertTitle>You can't trade right now</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 space-y-0.5">
                {(limits.reasons.length > 0 ? limits.reasons : ["requirements_not_met"]).map(
                  (code) => (
                    <li key={code}>{limitsReasonText(code)}</li>
                  ),
                )}
              </ul>
              {limits.tier === "T0" && (
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link to="/kyc" className="underline font-medium">
                    Step 1: Verify your identity (KYC documents)
                  </Link>
                  <Link to="/verify-identity" className="underline font-medium">
                    Step 2: Complete face verification
                  </Link>
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {!limitsQuery.isLoading && limits && limits.can_trade && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Tier {limits.tier}</Badge>
            <span>
              Per-order limit {formatZmw(limits.max_order_zmw)} · Daily{" "}
              {formatZmw(limits.daily_used_zmw)} of {formatZmw(limits.daily_cap_zmw)} used ·{" "}
              {limits.open_orders} of {limits.max_open_orders} orders open
            </span>
          </div>
        )}

        {children}
      </main>
      <Footer />
    </div>
  );
}
