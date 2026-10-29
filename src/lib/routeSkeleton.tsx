import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthFormSkeleton,
  BitcoinWalletSkeleton,
  BusinessDashboardSkeleton,
  CardCreateSkeleton,
  CardPageSkeleton,
  CheckoutSkeleton,
  ContentPageSkeleton,
  CurrencyWalletSkeleton,
  DashboardSkeleton,
  DetailPageSkeleton,
  FormPageSkeleton,
  GenericPageSkeleton,
  ListPageSkeleton,
  P2PListSkeleton,
  PaymentLinksSkeleton,
  SavedCardSkeleton,
  SelfCustodyWalletSkeleton,
  SettingsSkeleton,
  SkeletonHeaderBar,
  StatGridPageSkeleton,
  TablePageSkeleton,
  TradeRoomSkeleton,
  TransactionsManagerSkeleton,
  WalletPageSkeleton,
  type SkeletonHeaderVariant,
} from "@/components/ui/skeletons";

/**
 * Route-aware Suspense fallback (2026-10-29 skeleton-fidelity
 * sweep): the chunk-load fallback for a route is that page's OWN
 * skeleton twin — the way YouTube swaps a page-shaped placeholder
 * for the page — instead of one generic shell for every route.
 * Matching is longest-prefix-first; anything unmapped falls back
 * to the generic app-page shape. The twins are content-only (they
 * live in the light ui/skeletons kit); this module adds the shell
 * header twin + the standard page container around them.
 */

const TitleBlock = () => (
  <div aria-hidden="true" className="mb-6">
    <Skeleton className="h-8 w-52" />
    <Skeleton className="h-4 w-72 max-w-full mt-2" />
  </div>
);

const CurrencyGrid = () => (
  <div>
    <TitleBlock />
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <CurrencyWalletSkeleton />
      <CurrencyWalletSkeleton />
      <CurrencyWalletSkeleton />
    </div>
  </div>
);

const SavedCardGrid = () => (
  <div>
    <TitleBlock />
    <div className="grid gap-4 md:grid-cols-2">
      <SavedCardSkeleton />
      <SavedCardSkeleton />
    </div>
  </div>
);

const TransactionsPage = () => (
  <div>
    <TitleBlock />
    <TransactionsManagerSkeleton />
  </div>
);

const PaymentLinksPage = () => (
  <div>
    <TitleBlock />
    <PaymentLinksSkeleton />
  </div>
);

const EXACT: Record<string, ReactNode> = {
  "/": <GenericPageSkeleton />,
  "/login": <AuthFormSkeleton />,
  "/register": <AuthFormSkeleton />,
  "/check-email": <AuthFormSkeleton />,
  "/reset-password": <AuthFormSkeleton />,
  "/update-password": <AuthFormSkeleton />,
  "/dashboard": <DashboardSkeleton />,
  "/user-dashboard": <DashboardSkeleton />,
  "/wallet": <WalletPageSkeleton />,
  "/bitcoin-wallet": <BitcoinWalletSkeleton />,
  "/bitcoin-wallet/self-custody": <SelfCustodyWalletSkeleton />,
  "/wallet/crypto": <ListPageSkeleton />,
  "/wallet-reconciliation": <TablePageSkeleton />,
  "/transactions": <TransactionsPage />,
  "/transaction-list": <TransactionsPage />,
  "/transaction-search": <TransactionsPage />,
  "/payment-links": <PaymentLinksPage />,
  "/card/new": <CardCreateSkeleton />,
  "/settings": <SettingsSkeleton />,
  "/security-settings": <SettingsSkeleton />,
  "/two-factor-auth": <SettingsSkeleton />,
  "/role-management": <SettingsSkeleton />,
  "/business-dashboard": <BusinessDashboardSkeleton />,
  "/admin-dashboard": <StatGridPageSkeleton />,
  "/beta-dashboard": <StatGridPageSkeleton />,
  "/admin/treasury": <StatGridPageSkeleton />,
  "/tier-management": <TablePageSkeleton />,
  "/feedback-dashboard": <StatGridPageSkeleton />,
  "/analytics": <StatGridPageSkeleton />,
  "/spending-insights": <StatGridPageSkeleton />,
  "/payment-processor": <StatGridPageSkeleton />,
  "/p2p": <P2PListSkeleton />,
  "/p2p/my-ads": <P2PListSkeleton />,
  "/p2p/orders": <ListPageSkeleton />,
  "/p2p/profile": <DetailPageSkeleton />,
  "/p2p/ads/new": <FormPageSkeleton />,
  "/transfer": <FormPageSkeleton />,
  "/send-money": <FormPageSkeleton />,
  "/request-money": <FormPageSkeleton />,
  "/ussd-access": <FormPageSkeleton />,
  "/kyc": <FormPageSkeleton />,
  "/verify-identity": <FormPageSkeleton />,
  "/qr-payments": <FormPageSkeleton />,
  "/checkout-widget": <FormPageSkeleton />,
  "/ip-whitelist": <FormPageSkeleton />,
  "/backup-export": <FormPageSkeleton />,
  "/multi-currency": <CurrencyGrid />,
  "/card-vault": <SavedCardGrid />,
  "/pos": <TablePageSkeleton />,
  "/invoices": <ListPageSkeleton />,
  "/contacts": <ListPageSkeleton />,
  "/notifications": <ListPageSkeleton />,
  "/disputes": <ListPageSkeleton />,
  "/refunds": <ListPageSkeleton />,
  "/settlements": <ListPageSkeleton />,
  "/webhook-logs": <TablePageSkeleton />,
  "/collect-payments": <ListPageSkeleton />,
  "/sub-accounts": <ListPageSkeleton />,
  "/split-payments": <ListPageSkeleton />,
  "/bank-transfers": <ListPageSkeleton />,
  "/receiving-accounts": <DetailPageSkeleton />,
  "/payment-services": <ListPageSkeleton />,
  "/statements": <TablePageSkeleton />,
  "/agent-network": <ListPageSkeleton />,
  "/rewards": <ListPageSkeleton />,
  "/bulk-payments": <ListPageSkeleton />,
  "/scheduled-payments": <ListPageSkeleton />,
  "/bill-payments": <ListPageSkeleton />,
  "/payment-plans": <ListPageSkeleton />,
  "/escrow": <ListPageSkeleton />,
  "/savings": <ListPageSkeleton />,
  "/pay-later": <ListPageSkeleton />,
  "/billing": <ListPageSkeleton />,
  "/feedback": <FormPageSkeleton />,
  "/aml-screening": <TablePageSkeleton />,
  "/audit-logs": <TablePageSkeleton />,
  "/compliance": <ListPageSkeleton />,
  "/fraud-rules": <ListPageSkeleton />,
  "/api-rate-limits": <ListPageSkeleton />,
  "/about": <ContentPageSkeleton />,
  "/contact": <ContentPageSkeleton />,
  "/blog": <ContentPageSkeleton />,
  "/faq": <ContentPageSkeleton />,
  "/privacy-policy": <ContentPageSkeleton />,
  "/terms-of-service": <ContentPageSkeleton />,
  "/pricing": <ContentPageSkeleton />,
  "/subscription-tiers": <ContentPageSkeleton />,
  "/business": <ContentPageSkeleton />,
  "/api": <ContentPageSkeleton />,
  "/developers": <ContentPageSkeleton />,
  "/sdk-docs": <ContentPageSkeleton />,
  "/support": <ContentPageSkeleton />,
  "/help": <ContentPageSkeleton />,
  "/payment-success": <ContentPageSkeleton />,
  "/payment-failed": <ContentPageSkeleton />,
};

const PREFIX: Array<[string, ReactNode]> = [
  ["/card/", <CardPageSkeleton />],
  ["/p2p/orders/", <TradeRoomSkeleton />],
  ["/p2p/disputes/", <DetailPageSkeleton />],
  ["/admin/users/", <DetailPageSkeleton />],
  ["/admin/", <TablePageSkeleton />],
  ["/pay/", <CheckoutSkeleton />],
  ["/invoice/", <CheckoutSkeleton />],
  ["/request/", <CheckoutSkeleton />],
  ["/checkout", <CheckoutSkeleton />],
];

export function skeletonForRoute(pathname: string): ReactNode {
  if (pathname in EXACT) return EXACT[pathname];
  // Card fund is a form, not the card-detail twin — check before /card/.
  if (/^\/card\/[^/]+\/fund$/.test(pathname)) return <FormPageSkeleton />;
  for (const [prefix, twin] of PREFIX) {
    if (pathname.startsWith(prefix)) return twin;
  }
  return <GenericPageSkeleton />;
}

/**
 * The full fallback shell: header twin in the caller's variant +
 * the standard page container + the route's own twin.
 */
export const RouteSkeleton = ({
  pathname,
  variant = "authed",
}: {
  pathname: string;
  variant?: SkeletonHeaderVariant;
}) => (
  <div
    className="min-h-screen flex flex-col bg-background"
    role="status"
    aria-label="Loading"
    aria-busy="true"
  >
    <SkeletonHeaderBar variant={variant} />
    <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
      {skeletonForRoute(pathname)}
    </main>
    <span className="sr-only">Loading…</span>
  </div>
);
