import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/**
 * Balance/activity freshness — one shared rule for every money surface.
 *
 * Root cause of the stale-balance defect (live QA, 2026-10-22): the
 * app-wide QueryClient defaults to a 5-minute staleTime with
 * refetchOnWindowFocus off, and several money flows (Send Money,
 * Transfer, QR pay, payment-link pay) executed through direct
 * function invokes that never invalidated the wallet/transaction
 * caches. After a successful send, the Transfer header kept rendering
 * the pre-send balance and the Wallet page kept the pre-transfer
 * balance and activity until the staleTime lapsed; the Dashboard only
 * looked fresh because it has its own 30s staleTime plus a realtime
 * subscription invalidating its own keys.
 *
 * The fix has two halves, both centralised here so flows cannot drift
 * apart again:
 *
 * 1. Every successful money action calls invalidateMoneyState(),
 *    which marks every balance/activity query stale AND forces the
 *    currently-mounted ones to refetch immediately (the pattern the
 *    accounts/savings/payment-links fixes already established:
 *    invalidate + refetchQueries({ type: 'active' })).
 *
 * 2. The core money queries (wallet, multi-wallets, accounts,
 *    transactions) use MONEY_QUERY_STALE_TIME (0), so mounting or
 *    focusing a balance surface always refetches instead of rendering
 *    a value cached by an earlier screen. Cached data still renders
 *    while the refetch runs — no blank flash, never a stale number
 *    presented as current once the refetch lands.
 */

/** Query-key roots that carry balances or money activity. */
export const MONEY_QUERY_KEY_ROOTS: readonly string[] = [
  "wallet",
  "multi-wallets",
  "accounts",
  "transactions",
  "recent-transactions",
  "dashboard-stats",
  "dashboard-recent-transactions",
  "monthly-data",
  "spending-data",
  "user-rewards",
];

/**
 * Roots whose visible queries are force-refetched immediately, not
 * just marked stale: the balance and activity lists a user is most
 * likely looking at right after acting.
 */
const MONEY_ACTIVE_REFETCH_ROOTS: readonly string[] = [
  "wallet",
  "multi-wallets",
  "accounts",
  "transactions",
  "recent-transactions",
  "dashboard-stats",
  "dashboard-recent-transactions",
];

/** Money queries never serve a cached value as fresh on mount/focus. */
export const MONEY_QUERY_STALE_TIME = 0;

export function invalidateMoneyState(queryClient: QueryClient): void {
  for (const root of MONEY_QUERY_KEY_ROOTS) {
    queryClient.invalidateQueries({ queryKey: [root] });
  }
  for (const root of MONEY_ACTIVE_REFETCH_ROOTS) {
    queryClient.refetchQueries({ queryKey: [root], type: "active" });
  }
}

/** Hook form for components: a stable callback that refreshes money state. */
export function useInvalidateMoneyState(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => invalidateMoneyState(queryClient), [queryClient]);
}
