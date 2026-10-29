import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonCardRow } from "@/components/ui/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import EmptyState from "@/components/ui/empty-state";
import { Megaphone, Pause, Play, Plus, XCircle } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import PageErrorState from "@/components/PageErrorState";
import { useRecoveringRetry } from "@/hooks/useRecoveringRetry";
import { useToast } from "@/hooks/use-toast";
import { p2pAction, P2pActionError, type P2pAd } from "@/services/p2pService";
import { useInvalidateP2p, useP2pMyAds, useP2pPrice } from "@/hooks/useP2p";
import {
  adEffectivePriceZmw,
  formatBtcFromSats,
  formatZmw,
  paymentMethodTypeLabel,
} from "@/utils/p2pUi";
import { format } from "date-fns";

const AD_STATUS_META: Record<P2pAd["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "Active", variant: "default" },
  paused: { label: "Paused", variant: "secondary" },
  exhausted: { label: "Fully traded", variant: "outline" },
  closed: { label: "Closed", variant: "destructive" },
};

/** /p2p/my-ads — manage my ads (pause / reactivate / close via the
 *  edge action; the RPC enforces the gates again server-side). */
export default function P2PMyAds() {
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const adsQuery = useP2pMyAds();
  const retryWithRecovery = useRecoveringRetry();
  const priceQuery = useP2pPrice();
  const indexZmw = priceQuery.data ? Number(priceQuery.data.index_zmw) : null;
  const [error, setError] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: (input: { adId: string; status: string }) =>
      p2pAction(
        "set_ad_status",
        { ad_id: input.adId, status: input.status },
        "We couldn't update this ad. Please try again.",
      ),
    onSuccess: () => {
      setError(null);
      toast({ title: "Ad updated" });
      invalidate();
    },
    onError: (e: unknown) =>
      setError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't update this ad. Please try again.",
      ),
  });

  const ads = useMemo(() => adsQuery.data ?? [], [adsQuery.data]);

  return (
    <P2pShell
      title="My Ads"
      subtitle="Your marketplace listings. Pausing an ad stops new orders — orders already open finish normally."
    >
      <div className="mb-4 flex justify-end">
        <Button asChild className="gap-2">
          <Link to="/p2p/ads/new">
            <Plus className="h-4 w-4" /> Post a new ad
          </Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {adsQuery.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading your ads">
          <SkeletonCardRow />
          <SkeletonCardRow />
        </div>
      ) : adsQuery.isError ? (
        <PageErrorState
          message={
            adsQuery.error instanceof Error
              ? adsQuery.error.message
              : "We couldn't load your ads. Please try again."
          }
          onRetry={() => void retryWithRecovery(() => adsQuery.refetch())}
        />
      ) : ads.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-8 w-8" />}
          title="You have no ads yet"
          description="Post an ad to start trading at your own price. Selling ads need a fully verified (T2+) account with some trading history."
        />
      ) : (
        <div className="space-y-3">
          {ads.map((ad) => {
            const meta = AD_STATUS_META[ad.status] ?? { label: ad.status.replace(/_/g, " "), variant: "outline" as const };
            const price = adEffectivePriceZmw(ad, indexZmw);
            return (
              <Card key={ad.id}>
                <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {ad.side === "sell_crypto" ? "Selling BTC" : "Buying BTC"}
                      </span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-sm font-mono">
                        {price ? `${formatZmw(price)}/BTC` : "—"}
                      </span>
                      {ad.price_type === "margin" && (
                        <span className="text-xs text-muted-foreground">
                          (market {ad.margin_percent && ad.margin_percent >= 0 ? "+" : ""}
                          {ad.margin_percent}%)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total {formatBtcFromSats(ad.total_amount_minor)} BTC · Limits{" "}
                      {formatZmw(Number(ad.min_order_zmw))} – {formatZmw(Number(ad.max_order_zmw))} ·{" "}
                      {ad.payment_method_types.map(paymentMethodTypeLabel).join(", ")} ·
                      Posted {format(new Date(ad.created_at), "d MMM yyyy")}
                    </p>
                    {ad.terms && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ad.terms}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {ad.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ adId: ad.id, status: "paused" })}
                      >
                        <Pause className="h-4 w-4" /> Pause
                      </Button>
                    )}
                    {ad.status === "paused" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ adId: ad.id, status: "active" })}
                      >
                        <Play className="h-4 w-4" /> Reactivate
                      </Button>
                    )}
                    {ad.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-destructive hover:text-destructive"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ adId: ad.id, status: "closed" })}
                      >
                        <XCircle className="h-4 w-4" /> Close
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </P2pShell>
  );
}
