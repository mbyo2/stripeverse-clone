// Writing saved card limits straight into the react-query cache.
//
// The card page's limits mutation used to ONLY invalidate the
// ['virtualCard', id] query. The settings display kept rendering the
// cached pre-save card until the background refetch landed — with
// the app-wide 5-minute staleTime that window was clearly visible
// (parent rendered pass, 2026-10-26: the OLD daily limit showed
// until a full page reload). The saved values are known-good the
// moment the server confirms, so they are merged into the cache
// synchronously on success; invalidation still runs afterwards to
// reconcile with the server.

import type { QueryClient } from "@tanstack/react-query";

export interface CardLimits {
  daily: number;
  monthly: number;
  transaction: number;
}

interface CachedCard {
  daily_limit?: number;
  monthly_limit?: number;
  transaction_limit?: number;
  limits?: CardLimits;
  [key: string]: unknown;
}

export function applyCardLimitsToCache(
  queryClient: QueryClient,
  cardId: string,
  limits: CardLimits,
): void {
  queryClient.setQueryData<CachedCard>(["virtualCard", cardId], (old) => {
    if (!old) return old;
    return {
      ...old,
      daily_limit: limits.daily,
      monthly_limit: limits.monthly,
      transaction_limit: limits.transaction,
      limits: {
        daily: limits.daily,
        monthly: limits.monthly,
        transaction: limits.transaction,
      },
    };
  });
}
