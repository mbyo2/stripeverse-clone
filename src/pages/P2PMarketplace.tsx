import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonCardRow } from "@/components/ui/skeletons";
import EmptyState from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bitcoin, RefreshCw } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import AdCard from "@/components/p2p/AdCard";
import { P2pAccountCard } from "@/components/p2p/P2pAccountCard";
import PageErrorState from "@/components/PageErrorState";
import { useAuth } from "@/contexts/AuthContext";
import {
  useP2pAds,
  useP2pEnabled,
  useP2pLimits,
  useP2pPrice,
  useTraderPublicProfiles,
} from "@/hooks/useP2p";
import { adEffectivePriceZmw, formatZmw, paymentMethodTypeLabel } from "@/utils/p2pUi";
import type { P2pAd } from "@/services/p2pService";
import { formatDistanceToNow } from "date-fns";

/**
 * /p2p — the marketplace (§4.4). Buy/Sell toggle (from the taker's
 * point of view), payment-method filter, live BTC price header from
 * the freshest index snapshot, advertiser reputation from the
 * public trader projection. Ads are read through RLS (active ads
 * are public); all order creation goes through the edge function.
 */
export default function P2PMarketplace() {
  const { user } = useAuth();
  const [intent, setIntent] = useState<"buy" | "sell">("buy");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const adsQuery = useP2pAds();
  const priceQuery = useP2pPrice();
  const enabledQuery = useP2pEnabled();
  const limitsQuery = useP2pLimits();
  const paused = enabledQuery.data === false;

  const indexZmw = priceQuery.data ? Number(priceQuery.data.index_zmw) : null;
  const snapshotStale =
    !!priceQuery.data &&
    (priceQuery.data.is_stale ||
      Date.now() - new Date(priceQuery.data.created_at).getTime() > 5 * 60 * 1000);

  const visibleAds = useMemo(() => {
    const all = (adsQuery.data ?? []).filter((a) => a.owner_id !== user?.id);
    const side: P2pAd["side"] = intent === "buy" ? "sell_crypto" : "buy_crypto";
    const filtered = all.filter(
      (a) =>
        a.side === side &&
        (methodFilter === "all" || a.payment_method_types.includes(methodFilter)),
    );
    // Best price first for the taker: cheapest sell ads when buying,
    // highest buy ads when selling.
    return filtered.sort((a, b) => {
      const pa = adEffectivePriceZmw(a, indexZmw) ?? Number.POSITIVE_INFINITY;
      const pb = adEffectivePriceZmw(b, indexZmw) ?? Number.POSITIVE_INFINITY;
      return intent === "buy" ? pa - pb : pb - pa;
    });
  }, [adsQuery.data, intent, methodFilter, user?.id, indexZmw]);

  const ownerIds = useMemo(
    () => visibleAds.map((a) => a.owner_id),
    [visibleAds],
  );
  const profilesQuery = useTraderPublicProfiles(ownerIds);

  return (
    <P2pShell
      title="P2P Marketplace"
      subtitle="Trade Bitcoin directly with other people. Every trade is protected by escrow — the BTC locks before you pay, and only releases when the seller confirms the money arrived in their own account."
    >
      {/* Price header */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f7931a]/15 text-[#f7931a]">
              <Bitcoin className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm text-muted-foreground">Bitcoin market price</div>
              <div className="text-xl font-semibold">
                {indexZmw ? `${formatZmw(indexZmw)} / BTC` : "Unavailable"}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            {priceQuery.data ? (
              <>
                Updated{" "}
                {formatDistanceToNow(new Date(priceQuery.data.created_at), {
                  addSuffix: true,
                })}
                {snapshotStale && (
                  <div className="text-amber-600 dark:text-amber-400 font-medium">
                    Price feed is delayed — new orders pause until it recovers.
                  </div>
                )}
              </>
            ) : (
              "Price feed unavailable — new orders are paused."
            )}
          </div>
        </CardContent>
      </Card>

      <P2pAccountCard />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <Button
            variant={intent === "buy" ? "default" : "ghost"}
            className="rounded-none"
            onClick={() => setIntent("buy")}
          >
            I want to buy
          </Button>
          <Button
            variant={intent === "sell" ? "default" : "ghost"}
            className="rounded-none"
            onClick={() => setIntent("sell")}
          >
            I want to sell
          </Button>
        </div>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Payment method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment methods</SelectItem>
            <SelectItem value="mobile_money">{paymentMethodTypeLabel("mobile_money")}</SelectItem>
            <SelectItem value="bank">{paymentMethodTypeLabel("bank")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void adsQuery.refetch();
            void priceQuery.refetch();
          }}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Ads */}
      {adsQuery.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading marketplace">
          <SkeletonCardRow />
          <SkeletonCardRow />
          <SkeletonCardRow />
        </div>
      ) : adsQuery.isError ? (
        <PageErrorState
          message={
            adsQuery.error instanceof Error
              ? adsQuery.error.message
              : "We couldn't load the marketplace. Please try again."
          }
          onRetry={() => void adsQuery.refetch()}
        />
      ) : visibleAds.length === 0 ? (
        <EmptyState
          icon={<Bitcoin className="h-8 w-8" />}
          title={intent === "buy" ? "No one is selling right now" : "No one is buying right now"}
          description={
            paused
              ? "P2P trading is paused — ads will appear again when it reopens."
              : "Try a different payment method, or post your own ad and let traders come to you."
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleAds.map((ad) => (
            <AdCard
              key={ad.id}
              ad={ad}
              indexZmw={indexZmw}
              advertiser={profilesQuery.data?.[ad.owner_id]}
              tradingPaused={paused}
              canTrade={limitsQuery.data?.can_trade ?? false}
            />
          ))}
        </div>
      )}
    </P2pShell>
  );
}
