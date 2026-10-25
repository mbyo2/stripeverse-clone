import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * YouTube-style skeleton kit: placeholder shapes that mirror the real
 * layout (circles where avatars/icons go, bars where text goes, blocks
 * where cards go) while data or a route chunk loads. Built entirely on
 * the shimmer Skeleton primitive so there is exactly one sweep style.
 *
 * These components are deliberately tiny and dependency-free: the kit
 * is imported by the eager shell (route fallback, auth bootstrap), so
 * it must never pull in page-level components such as Header/Footer.
 */

/** One transaction/activity row: icon circle, title + sub bars, amount. */
export const SkeletonListRow = ({ className }: { className?: string }) => (
  <div className={cn("flex items-center justify-between py-4", className)} aria-hidden="true">
    <div className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div>
        <Skeleton className="h-4 w-36 mb-1.5" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
    <div className="flex flex-col items-end shrink-0">
      <Skeleton className="h-4 w-20 mb-1.5" />
      <Skeleton className="h-3 w-12" />
    </div>
  </div>
);

/** A divided list of SkeletonListRow, matching the app's activity lists. */
export const SkeletonListRows = ({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) => (
  <div className={cn("divide-y divide-border", className)} role="status" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonListRow key={i} />
    ))}
  </div>
);

/** One P2P-style card row: avatar + name/stats bars, price + action block. */
export const SkeletonCardRow = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4",
      className
    )}
    aria-hidden="true"
  >
    <div className="flex items-center gap-3 min-w-0">
      <Skeleton className="h-11 w-11 rounded-full shrink-0" />
      <div>
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-3 w-44 max-w-full" />
      </div>
    </div>
    <div className="flex flex-col items-end gap-2 shrink-0">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-9 w-24 rounded-full" />
    </div>
  </div>
);

/** Table body placeholder (POS requests, admin tables): header + rows. */
export const SkeletonTableRows = ({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) => (
  <div className={className} role="status" aria-label="Loading">
    <div className="flex items-center gap-3 pb-3 border-b border-border" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="flex items-center gap-3 py-3 border-b border-border/60"
        aria-hidden="true"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-4 w-14" />
      </div>
    ))}
  </div>
);

/**
 * Header placeholder at the real header's exact height (72px) and
 * container width, so the shell is in place before a page (which
 * renders the real Header itself) has loaded its chunk.
 */
export const SkeletonHeaderBar = () => (
  <div
    className="bg-white dark:bg-[#0A0F1A] border-b border-[#CFD3D8]/70 dark:border-white/10"
    aria-hidden="true"
  >
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-3">
      <div className="flex items-center gap-8 min-w-0">
        <Skeleton className="h-9 w-36 rounded-lg shrink-0" />
        <div className="hidden xl:flex items-center gap-8">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Skeleton className="h-10 w-24 rounded-full hidden sm:block" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
    </div>
  </div>
);

/**
 * Generic page placeholder for the route Suspense fallback: shell
 * header bar + title bars + a hero block + stat cards + a list card,
 * so a lazy route swaps skeleton → content without a blank flash.
 */
export const RouteShellSkeleton = () => (
  <div
    className="min-h-screen flex flex-col bg-background"
    role="status"
    aria-label="Loading"
    aria-busy="true"
  >
    <SkeletonHeaderBar />
    <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
      <div aria-hidden="true">
        <Skeleton className="h-8 w-56 mb-2" />
        <Skeleton className="h-4 w-80 max-w-full mb-8" />
        <Skeleton className="h-44 rounded-[24px] mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <div className="rounded-xl border border-border bg-card px-6 py-2">
          <SkeletonListRows rows={4} />
        </div>
      </div>
    </main>
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Dashboard-shaped placeholder (content only, no header): balance
 * band, Bitcoin panel, then the activity column + stat-card stack.
 * Used by the auth bootstrap and the Dashboard's own loading state.
 */
export const DashboardSkeleton = () => (
  <div aria-hidden="true">
    <Skeleton className="h-44 rounded-[24px] mb-6" />
    <Skeleton className="h-[148px] rounded-[24px] mb-6" />
    <Skeleton className="h-5 w-44 mb-4" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-xl border border-border bg-card px-6 py-2">
          <SkeletonListRows rows={5} />
        </div>
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-[104px] rounded-xl" />
        <Skeleton className="h-[104px] rounded-xl" />
        <Skeleton className="h-[104px] rounded-xl" />
        <div className="rounded-xl border border-border bg-card px-6 py-2">
          <SkeletonListRows rows={3} />
        </div>
      </div>
    </div>
  </div>
);

/** Settings placeholder: title, sidebar nav rows, form card. */
export const SettingsSkeleton = () => (
  <div aria-hidden="true">
    <Skeleton className="h-8 w-40 mb-2" />
    <Skeleton className="h-4 w-64 max-w-full mb-8" />
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
      <div className="space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-4 mb-6">
          <Skeleton className="h-16 w-16 rounded-full shrink-0" />
          <div>
            <Skeleton className="h-4 w-40 mb-2" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-36 rounded-full mt-6" />
      </div>
    </div>
  </div>
);

/** Virtual-card page placeholder: title, card-shaped block, detail card. */
export const CardPageSkeleton = () => (
  <div aria-hidden="true">
    <Skeleton className="h-8 w-48 mb-6" />
    <Skeleton className="h-52 rounded-[24px] mb-6" />
    <div className="rounded-xl border border-border bg-card p-6">
      <Skeleton className="h-5 w-40 mb-4" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-full mt-6" />
    </div>
  </div>
);
