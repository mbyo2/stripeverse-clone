// React-query hooks for the P2P marketplace (Phase 1c).
//
// Money-adjacent reads (orders, limits, holds, price) use
// MONEY_QUERY_STALE_TIME (0) per the platform freshness rule
// (§4.4: "all money queries at zero stale-time") — mounting or
// focusing a P2P surface always refetches rather than rendering a
// cached number as current. The trade room additionally polls: the
// counterparty's actions (mark-paid, release, dispute) must appear
// without a manual refresh.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { MONEY_QUERY_STALE_TIME } from "@/utils/moneyFreshness";
import { pollUntil } from "@/lib/polling";
import {
  isTerminalP2pDisputeStatus,
  isTerminalP2pOrderStatus,
} from "@/utils/p2pUi";
import type { P2pDispute, P2pOrder } from "@/services/p2pService";
import {
  fetchActiveAds,
  fetchDispute,
  fetchDisputeByOrder,
  fetchDisputeEvidence,
  fetchLatestPriceSnapshot,
  fetchMyAds,
  fetchMyBlocks,
  fetchMyKycState,
  fetchMyLimits,
  fetchMyOrders,
  fetchMyP2pAccount,
  fetchMyPaymentMethods,
  fetchMySanctions,
  fetchMyTier,
  fetchMyTraderProfile,
  fetchMyUnmaturedHoldsSats,
  fetchOrder,
  fetchOrderClaim,
  fetchOrderMessages,
  fetchP2pEnabled,
  fetchTraderPublicProfiles,
} from "@/services/p2pService";

export const p2pKeys = {
  enabled: ["p2p", "enabled"] as const,
  account: ["p2p", "account"] as const,
  limits: ["p2p", "limits"] as const,
  tier: ["p2p", "tier"] as const,
  holds: ["p2p", "unmatured-holds"] as const,
  price: ["p2p", "price"] as const,
  ads: ["p2p", "ads"] as const,
  myAds: ["p2p", "my-ads"] as const,
  orders: ["p2p", "orders"] as const,
  order: (id: string) => ["p2p", "order", id] as const,
  claim: (orderId: string) => ["p2p", "claim", orderId] as const,
  messages: (orderId: string) => ["p2p", "messages", orderId] as const,
  disputeByOrder: (orderId: string) => ["p2p", "dispute-by-order", orderId] as const,
  dispute: (id: string) => ["p2p", "dispute", id] as const,
  evidence: (disputeId: string) => ["p2p", "evidence", disputeId] as const,
  paymentMethods: ["p2p", "payment-methods"] as const,
  traderProfile: ["p2p", "trader-profile"] as const,
  traderPublic: (ids: string) => ["p2p", "trader-public", ids] as const,
  blocks: ["p2p", "blocks"] as const,
  sanctions: ["p2p", "my-sanctions"] as const,
  kyc: ["p2p", "kyc-state"] as const,
};

export function useInvalidateP2p() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["p2p"] });
    // The account query lives under ["p2p"] too, so the broad
    // invalidation above already covers it — named explicitly so a
    // future key reshuffle can't silently leave balances stale.
    void qc.invalidateQueries({ queryKey: p2pKeys.account });
    void qc.refetchQueries({ queryKey: ["p2p"], type: "active" });
  };
}

export function useP2pEnabled() {
  return useQuery({
    queryKey: p2pKeys.enabled,
    queryFn: fetchP2pEnabled,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useP2pLimits(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.limits,
    queryFn: fetchMyLimits,
    enabled: enabled && !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
    retry: 1,
  });
}

export function useP2pAccount(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.account,
    queryFn: fetchMyP2pAccount,
    enabled: enabled && !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
    retry: 1,
  });
}

export function useP2pTier(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.tier,
    queryFn: fetchMyTier,
    enabled: enabled && !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
    retry: 1,
  });
}

export function useP2pUnmaturedHolds(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.holds,
    queryFn: fetchMyUnmaturedHoldsSats,
    enabled: enabled && !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
    retry: 1,
  });
}

export function useP2pPrice() {
  return useQuery({
    queryKey: p2pKeys.price,
    queryFn: fetchLatestPriceSnapshot,
    staleTime: MONEY_QUERY_STALE_TIME,
    refetchInterval: 60_000,
  });
}

export function useP2pAds() {
  return useQuery({
    queryKey: p2pKeys.ads,
    queryFn: fetchActiveAds,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useP2pMyAds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.myAds,
    queryFn: () => fetchMyAds(user!.id),
    enabled: !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useTraderPublicProfiles(userIds: string[]) {
  const key = [...new Set(userIds)].sort().join(",");
  return useQuery({
    queryKey: p2pKeys.traderPublic(key),
    queryFn: () => fetchTraderPublicProfiles(userIds),
    enabled: key.length > 0,
    staleTime: 30_000,
  });
}

export function useP2pMyOrders() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.orders,
    queryFn: () => fetchMyOrders(user!.id),
    enabled: !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useP2pOrder(orderId: string | undefined, poll = false) {
  return useQuery({
    queryKey: p2pKeys.order(orderId ?? ""),
    queryFn: () => fetchOrder(orderId!),
    enabled: !!orderId,
    staleTime: MONEY_QUERY_STALE_TIME,
    // Poll while the trade is live; stop for good once it settles
    // (scalability fix #5 — pollUntil, src/lib/polling.ts).
    refetchInterval: poll
      ? pollUntil<P2pOrder | null>(10_000, (o) =>
          isTerminalP2pOrderStatus(o?.status),
        )
      : undefined,
  });
}

export function useP2pOrderClaim(orderId: string | undefined, poll = true) {
  return useQuery({
    queryKey: p2pKeys.claim(orderId ?? ""),
    queryFn: () => fetchOrderClaim(orderId!),
    enabled: !!orderId,
    staleTime: MONEY_QUERY_STALE_TIME,
    // The claim row carries no status of its own, so the CALLER gates
    // polling on the order/dispute state it already has (fix #5).
    refetchInterval: poll ? pollUntil(15_000) : undefined,
  });
}

export function useP2pMessages(orderId: string | undefined, poll = false) {
  return useQuery({
    queryKey: p2pKeys.messages(orderId ?? ""),
    queryFn: () => fetchOrderMessages(orderId!),
    enabled: !!orderId,
    staleTime: MONEY_QUERY_STALE_TIME,
    // Caller gates `poll` on the trade still being live (TradeChat
    // passes its own read-only rule — fix #5).
    refetchInterval: poll ? pollUntil(8_000) : undefined,
  });
}

export function useP2pDisputeByOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: p2pKeys.disputeByOrder(orderId ?? ""),
    queryFn: () => fetchDisputeByOrder(orderId!),
    enabled: !!orderId,
    staleTime: MONEY_QUERY_STALE_TIME,
    // Keep polling while no dispute exists (one may open) or while
    // it is open; stop once it is ruled/settled (fix #5).
    refetchInterval: pollUntil<P2pDispute | null>(15_000, (d) =>
      d != null ? isTerminalP2pDisputeStatus(d.status) : false,
    ),
  });
}

export function useP2pDispute(disputeId: string | undefined) {
  return useQuery({
    queryKey: p2pKeys.dispute(disputeId ?? ""),
    queryFn: () => fetchDispute(disputeId!),
    enabled: !!disputeId,
    staleTime: MONEY_QUERY_STALE_TIME,
    refetchInterval: pollUntil<P2pDispute | null>(15_000, (d) =>
      d != null ? isTerminalP2pDisputeStatus(d.status) : false,
    ),
  });
}

export function useP2pEvidence(disputeId: string | undefined) {
  return useQuery({
    queryKey: p2pKeys.evidence(disputeId ?? ""),
    queryFn: () => fetchDisputeEvidence(disputeId!),
    enabled: !!disputeId,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useP2pPaymentMethods() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.paymentMethods,
    queryFn: () => fetchMyPaymentMethods(user!.id),
    enabled: !!user,
    staleTime: MONEY_QUERY_STALE_TIME,
  });
}

export function useP2pTraderProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.traderProfile,
    queryFn: () => fetchMyTraderProfile(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useP2pBlocks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.blocks,
    queryFn: () => fetchMyBlocks(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useP2pMySanctions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.sanctions,
    queryFn: () => fetchMySanctions(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useP2pKycState() {
  const { user } = useAuth();
  return useQuery({
    queryKey: p2pKeys.kyc,
    queryFn: () => fetchMyKycState(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}
