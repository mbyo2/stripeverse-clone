import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * YouTube-style skeleton kit: every placeholder is a structural twin
 * of the content it stands in for — the same containers, padding,
 * circles, bars and buttons in the same places as the loaded UI — so
 * the page's shape is legible while data loads and nothing shifts
 * when the real content lands. Built entirely on the shimmer Skeleton
 * primitive so there is exactly one sweep style.
 *
 * These components are deliberately tiny and dependency-free: the kit
 * is imported by the eager shell (route fallback, auth bootstrap), so
 * it must never pull in page-level components such as Header/Footer.
 */

/** One generic list row: icon circle, title + sub bars, two right bars. */
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

/**
 * One transaction row, twinned on the real activity rows (Dashboard
 * Recent Activity, transaction lists, BTC activity): a 40px icon
 * circle, a 15px title line over a 13px date line, and ONE amount
 * line on the right — the real rows never stack a second right bar.
 */
export const SkeletonTransactionRow = ({ className }: { className?: string }) => (
  <div className={cn("flex items-center justify-between py-4", className)} aria-hidden="true">
    <div className="flex items-center gap-3 min-w-0">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div>
        <Skeleton className="h-4 w-36 max-w-full mb-1.5" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
    <Skeleton className="h-4 w-20 shrink-0 ml-3" />
  </div>
);

/** A divided list of transaction rows, matching the app's activity lists. */
export const SkeletonListRows = ({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) => (
  <div className={cn("divide-y divide-border", className)} role="status" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <SkeletonTransactionRow key={i} />
    ))}
  </div>
);

/**
 * One P2P ad-card row, twinned on AdCard: NO avatar (the real card
 * has none) — trader name + trade-stats on one line, the limits line,
 * a row of payment-method badges; on the right the price, the
 * vs-market badge and the Buy/Sell button at its real size/radius.
 */
export const SkeletonCardRow = ({ className }: { className?: string }) => (
  <div
    className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}
    aria-hidden="true"
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-3 w-80 max-w-full" />
        <div className="flex gap-1 pt-1">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-md mt-0.5" />
      </div>
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

/** One dashboard stat card (label, big value, sub-line, icon circle). */
const SkeletonStatCard = () => (
  <div className="rounded-xl border border-border bg-card px-6 py-5">
    <div className="flex items-center justify-between">
      <div>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-24 mt-1.5" />
        <Skeleton className="h-3 w-20 mt-1.5" />
      </div>
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
    </div>
  </div>
);

/** Card chrome shared by the twins below: header row + padded body. */
const SkeletonCardShell = ({
  titleWidth = "w-36",
  linkWidth,
  children,
  className,
}: {
  titleWidth?: string;
  linkWidth?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("rounded-xl border border-border bg-card", className)}>
    <div className="px-6 pt-6 pb-3 flex items-center justify-between gap-3">
      <Skeleton className={cn("h-5", titleWidth)} />
      {linkWidth && <Skeleton className={cn("h-4 shrink-0", linkWidth)} />}
    </div>
    <div className="px-6 pb-6">{children}</div>
  </div>
);

/**
 * Generic page placeholder for the route Suspense fallback: shell
 * header bar + the standard app-page shape (title block, a balance
 * band with its greeting/amount/action circles inside, stat cards
 * with their lines inside, and an activity card of transaction
 * rows), so a lazy route swaps skeleton → content without a blank
 * flash or a shape change.
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
        <div className="rounded-[24px] border border-border bg-card px-6 py-8 md:px-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <Skeleton className="h-4 w-36 mb-2" />
              <Skeleton className="h-11 w-64 max-w-full mb-2" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <SkeletonCardShell titleWidth="w-36" linkWidth="w-16">
          <SkeletonListRows rows={4} />
        </SkeletonCardShell>
      </div>
    </main>
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Dashboard placeholder (content only, no header), twinned element
 * for element on the loaded Dashboard: the #003087 balance band
 * (greeting line, amount, "Available balance", four quick-action
 * circles with labels), the black Bitcoin panel (orange icon circle,
 * title + sats lines, two pill buttons, four action chips), the
 * "Your everyday money" heading, then the activity column (Recent
 * Activity card + Monthly Activity chart card) beside the stat-card
 * stack, the Your accounts card and the Spending chart card.
 */
export const DashboardSkeleton = () => (
  <div role="status" aria-label="Loading dashboard">
    {/* Balance band */}
    <div className="bg-[#003087] rounded-[24px] px-6 py-8 md:px-8 mb-6" aria-hidden="true">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <Skeleton className="h-4 w-36 bg-white/25 mb-1.5" />
          <Skeleton className="h-11 w-64 max-w-full bg-white/30 mb-2" />
          <Skeleton className="h-4 w-28 bg-white/20" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="w-12 h-12 rounded-full bg-white/20" />
              <Skeleton className="h-3 w-10 bg-white/20" />
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Bitcoin panel */}
    <div
      className="bg-black dark:bg-[#0A0F1A] rounded-[24px] px-6 py-6 md:px-8 mb-6 border border-black/10 dark:border-white/10"
      aria-hidden="true"
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <Skeleton className="w-12 h-12 rounded-full bg-[#F7931A]/40 shrink-0" />
          <div className="min-w-0">
            <Skeleton className="h-6 w-40 bg-white/25" />
            <Skeleton className="h-4 w-72 max-w-full bg-white/15 mt-1.5" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5 shrink-0">
          <Skeleton className="h-10 w-28 rounded-full bg-white/20" />
          <Skeleton className="h-10 w-32 rounded-full bg-white/10" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-5">
        <Skeleton className="h-7 w-20 rounded-full bg-white/10" />
        <Skeleton className="h-7 w-14 rounded-full bg-white/10" />
        <Skeleton className="h-7 w-14 rounded-full bg-white/10" />
        <Skeleton className="h-7 w-24 rounded-full bg-white/10" />
      </div>
    </div>

    {/* Section heading */}
    <Skeleton className="h-5 w-44 mb-4" aria-hidden="true" />

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 space-y-6" aria-hidden="true">
        <SkeletonCardShell titleWidth="w-36" linkWidth="w-16">
          <SkeletonListRows rows={5} />
        </SkeletonCardShell>
        <SkeletonCardShell titleWidth="w-40">
          <Skeleton className="h-[280px] w-full rounded-lg" />
        </SkeletonCardShell>
      </div>
      <div className="space-y-6">
        <div aria-hidden="true" className="space-y-6">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <SkeletonCardShell titleWidth="w-32" linkWidth="w-16">
          <div className="divide-y divide-border" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </SkeletonCardShell>
        <div aria-hidden="true">
          <SkeletonCardShell titleWidth="w-24">
            <Skeleton className="h-[280px] w-full rounded-lg" />
          </SkeletonCardShell>
        </div>
      </div>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Wallet page placeholder (content only), twinned on Wallet.tsx:
 * page header (title + subtitle, Add Money / Withdraw pills), the
 * primary balance hero (label, amount, Send/Receive pills), the
 * quick-actions circle row, the Virtual Cards + Payment Methods
 * grid, and the Recent Activity card.
 */
export const WalletPageSkeleton = () => (
  <div role="status" aria-label="Loading wallet">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8" aria-hidden="true">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-52 max-w-full mt-1.5" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-32 rounded-full" />
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
    </div>

    <div className="rounded-[24px] overflow-hidden bg-primary mb-8" aria-hidden="true">
      <div className="p-6 md:p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <Skeleton className="h-4 w-36 bg-white/25 mb-2" />
            <Skeleton className="h-12 w-56 max-w-full bg-white/30" />
          </div>
          <Skeleton className="h-8 w-8 rounded-lg bg-white/20 shrink-0" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-32 rounded-full bg-white/30" />
          <Skeleton className="h-11 w-28 rounded-full bg-white/20" />
        </div>
      </div>
    </div>

    <div className="mb-8 flex flex-wrap items-start justify-center sm:justify-between gap-x-2 gap-y-6 px-1" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center w-[76px] sm:w-24">
          <Skeleton className="w-12 h-12 rounded-full mb-2" />
          <Skeleton className="h-4 w-14 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <div className="lg:col-span-2" aria-hidden="true">
        <SkeletonCardShell titleWidth="w-36" linkWidth="w-20" className="h-full">
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-[#003087] rounded-2xl p-4">
                <div className="flex justify-between items-start mb-4">
                  <Skeleton className="h-4 w-20 bg-white/25" />
                  <Skeleton className="h-5 w-14 rounded-full bg-white/20" />
                </div>
                <Skeleton className="h-5 w-44 max-w-full bg-white/30 mb-4" />
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16 bg-white/20" />
                  <Skeleton className="h-3 w-12 bg-white/20" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCardShell>
      </div>
      <div aria-hidden="true">
        <SkeletonCardShell titleWidth="w-40" className="h-full">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div>
                  <Skeleton className="h-4 w-28 mb-1.5" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCardShell>
      </div>
    </div>

    <div aria-hidden="true">
      <SkeletonCardShell titleWidth="w-36" linkWidth="w-20">
        <SkeletonListRows rows={4} />
      </SkeletonCardShell>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Transactions-manager placeholder, twinned on
 * EnhancedTransactionManager: the search field + Filters/Export/
 * sort/Refresh button row, then the Transaction History card with
 * its title/count header and transaction rows. Used as the
 * Transactions page Suspense fallback (the page header and filter
 * pills above it render for real).
 */
export const TransactionsManagerSkeleton = () => (
  <div role="status" aria-label="Loading transactions">
    <div className="flex flex-col md:flex-row gap-4 mb-4" aria-hidden="true">
      <Skeleton className="h-10 flex-1 rounded-md" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-24 rounded-md" />
        <Skeleton className="h-10 w-32 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
    </div>
    <div className="rounded-xl border border-border bg-card" aria-hidden="true">
      <div className="px-6 pt-6 pb-0 flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-24 shrink-0" />
      </div>
      <div className="px-6 pb-6 pt-2">
        <SkeletonListRows rows={6} />
      </div>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Payment Links placeholder, twinned on the loaded page below its
 * header: the Total Collected card (label, big amount, sub-line),
 * the stats card (two icon-circle rows), and the links list card —
 * each link row with title + status badge, description, the meta
 * line, the settles-to line, the mono URL block and its icon
 * buttons.
 */
export const PaymentLinksSkeleton = () => (
  <div role="status" aria-label="Loading payment links">
    <div className="space-y-6 mb-8" aria-hidden="true">
      <div className="rounded-xl border border-border bg-card p-6 md:p-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-11 w-52 max-w-full mt-2" />
        <Skeleton className="h-4 w-56 max-w-full mt-1.5" />
      </div>
      <div className="rounded-xl border border-border bg-card px-6 py-2">
        <div className="divide-y divide-border">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-5 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
    <div className="rounded-xl border border-border bg-card px-6 py-2" aria-hidden="true">
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start justify-between py-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-5 w-16 rounded-full shrink-0" />
              </div>
              <Skeleton className="h-4 w-72 max-w-full mb-2" />
              <div className="flex flex-wrap items-center gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-3 w-40 mt-1.5" />
              <Skeleton className="h-8 w-full max-w-md mt-2 rounded" />
            </div>
            <div className="flex gap-2 ml-4 shrink-0">
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
    <span className="sr-only">Loading…</span>
  </div>
);

/** One multi-currency wallet card (flag, code + name, balance, status badge). */
export const CurrencyWalletSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("rounded-xl border border-border bg-card", className)} aria-hidden="true">
    <div className="p-6 pb-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
        <div>
          <Skeleton className="h-5 w-16 mb-1.5" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
    <div className="p-6 pt-0">
      <Skeleton className="h-9 w-36 max-w-full mb-2" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  </div>
);

/**
 * One saved-card tile for the Card Vault, twinned on the real token
 * card: brand row + Default badge over the number line and the
 * holder/expiry row on the card face, then the token line and
 * action buttons in the footer.
 */
export const SavedCardSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)} aria-hidden="true">
    <div className="bg-muted p-6">
      <div className="flex items-center justify-between mb-8">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-5 w-60 max-w-full mb-4" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-12" />
      </div>
    </div>
    <div className="px-6 pt-4 pb-6 flex items-center justify-between gap-3">
      <Skeleton className="h-3 w-36" />
      <div className="flex gap-1 shrink-0">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-9 rounded-md" />
      </div>
    </div>
  </div>
);

/**
 * Virtual-card page placeholder, twinned on VirtualCardDetails:
 * name + subtitle with the Freeze/Delete buttons, the dark card
 * preview (brand mark, chip, number line, the four label/value
 * columns), the three detail stat cards, and the Fund card.
 */
export const CardPageSkeleton = () => (
  <div role="status" aria-label="Loading card">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4" aria-hidden="true">
      <div>
        <Skeleton className="h-9 w-52 max-w-full" />
        <Skeleton className="h-4 w-36 mt-2" />
      </div>
      <div className="flex space-x-2 shrink-0">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>

    <div className="rounded-xl bg-[#44464A] p-6 mb-6" aria-hidden="true">
      <div className="flex justify-end">
        <Skeleton className="h-4 w-28 bg-white/25" />
      </div>
      <div className="pt-8">
        <div className="flex items-center mb-4">
          <Skeleton className="w-10 h-6 rounded bg-white/25 mr-2" />
          <Skeleton className="w-6 h-6 rounded-full bg-white/20" />
        </div>
        <Skeleton className="h-6 w-72 max-w-full mt-8 mb-6 bg-white/25" />
        <div className="flex justify-between gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-12 bg-white/15 mb-1.5" />
              <Skeleton className="h-4 w-14 bg-white/25" />
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="grid gap-6 mb-6 md:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>

    <div className="rounded-xl border border-border bg-card p-6" aria-hidden="true">
      <Skeleton className="h-6 w-36 mb-4" />
      <div className="flex flex-col sm:flex-row gap-4">
        <Skeleton className="h-11 flex-1 rounded-md" />
        <Skeleton className="h-11 w-full sm:w-32 rounded-md" />
      </div>
    </div>
    <span className="sr-only">Loading…</span>
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
