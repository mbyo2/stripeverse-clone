import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  newIdempotencyKey,
  p2pAction,
  P2pActionError,
  type P2pAd,
  type P2pPaymentMethod,
  type P2pTraderPublic,
} from "@/services/p2pService";
import { useP2pPaymentMethods } from "@/hooks/useP2p";
import {
  adEffectivePriceZmw,
  cryptoFromFiat,
  formatBtcFromSats,
  formatZmw,
  isOffMarket,
  percentVsIndex,
  paymentMethodTypeLabel,
  traderDisplayName,
} from "@/utils/p2pUi";

/**
 * One marketplace ad + its inline order panel (§4.4). The order
 * panel mirrors p2p_create_order's maths exactly (fiat XOR crypto,
 * floor to the sat) so the numbers shown are the numbers the server
 * settles on; the RPC remains the authority and its crafted
 * refusals surface verbatim. An ad more than 10% off the index
 * carries the bait warning and requires the taker's explicit
 * acknowledgement before the create is even attempted (§3.8).
 */
export default function AdCard({
  ad,
  indexZmw,
  advertiser,
  tradingPaused,
  canTrade,
}: {
  ad: P2pAd;
  indexZmw: number | null;
  advertiser?: P2pTraderPublic;
  tradingPaused: boolean;
  canTrade: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fiatInput, setFiatInput] = useState("");
  const [ackOffMarket, setAckOffMarket] = useState(false);
  const [sellerMethodId, setSellerMethodId] = useState("");
  const [idemKey, setIdemKey] = useState<string>(() => newIdempotencyKey());
  const [formError, setFormError] = useState<string | null>(null);

  const isOwn = user?.id === ad.owner_id;
  // Ad side semantics: a sell_crypto ad means the ADVERTISER sells
  // and the taker BUYS; a buy_crypto ad is the reverse.
  const takerBuys = ad.side === "sell_crypto";
  const price = adEffectivePriceZmw(ad, indexZmw);
  const pct = percentVsIndex(price, indexZmw);
  const offMarket = isOffMarket(price, indexZmw);

  const myMethods = useP2pPaymentMethods();
  const eligibleSellerMethods = useMemo(
    () =>
      (myMethods.data ?? []).filter(
        (m: P2pPaymentMethod) =>
          m.status === "active" && ad.payment_method_types.includes(m.type),
      ),
    [myMethods.data, ad.payment_method_types],
  );

  const fiat = Number(fiatInput);
  const sats = price && Number.isFinite(fiat) && fiat > 0 ? cryptoFromFiat(fiat, price) : 0;

  const createOrder = useMutation({
    mutationFn: async () => {
      const res = await p2pAction<{ order?: { id: string } }>(
        "create_order",
        {
          ad_id: ad.id,
          fiat_amount_zmw: fiat,
          seller_payment_method_id: takerBuys ? undefined : sellerMethodId,
          idempotency_key: idemKey,
          taker_ack_offmarket: offMarket ? ackOffMarket : undefined,
        },
        "We couldn't open this order. Please try again.",
      );
      return res.order?.id;
    },
    onSuccess: (orderId) => {
      toast({ title: "Order opened", description: "The Bitcoin is locked in escrow." });
      if (orderId) navigate(`/p2p/orders/${orderId}`);
    },
    onError: (e: unknown) => {
      // A failed attempt must not replay the same key on the next
      // try — the intent changed, so the key does too.
      setIdemKey(newIdempotencyKey());
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't open this order. Please try again.",
      );
    },
  });

  const submit = () => {
    setFormError(null);
    if (!price) {
      setFormError("The market price is unavailable right now — orders reopen when the price feed recovers.");
      return;
    }
    if (!Number.isFinite(fiat) || fiat <= 0) {
      setFormError("Enter the amount in kwacha you want to trade.");
      return;
    }
    if (fiat < Number(ad.min_order_zmw) || fiat > Number(ad.max_order_zmw)) {
      setFormError(
        `Orders on this ad are between ${formatZmw(Number(ad.min_order_zmw))} and ${formatZmw(Number(ad.max_order_zmw))}.`,
      );
      return;
    }
    if (offMarket && !ackOffMarket) {
      setFormError("This ad is priced far from the market price. Read the warning and tick the box to continue.");
      return;
    }
    if (!takerBuys && !sellerMethodId) {
      setFormError("Choose the registered payment method you want to receive the money on.");
      return;
    }
    createOrder.mutate();
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">
                {traderDisplayName(advertiser?.nickname, ad.owner_id)}
              </span>
              {isOwn && <Badge variant="outline">Your ad</Badge>}
              {advertiser && (
                <span className="text-xs text-muted-foreground">
                  {advertiser.trades_completed} completed trades
                  {advertiser.median_release_minutes
                    ? ` · releases in ~${Math.round(advertiser.median_release_minutes)} min`
                    : ""}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Limits {formatZmw(Number(ad.min_order_zmw))} – {formatZmw(Number(ad.max_order_zmw))} ·
              Total {formatBtcFromSats(ad.total_amount_minor)} BTC · Pays within{" "}
              {ad.payment_window_minutes} min
              {ad.settle_delay_minutes > 0 &&
                ` · ${ad.settle_delay_minutes} min settle delay`}
            </div>
            <div className="flex gap-1 flex-wrap pt-1">
              {ad.payment_method_types.map((t) => (
                <Badge key={t} variant="secondary" className="text-[11px]">
                  {paymentMethodTypeLabel(t)}
                </Badge>
              ))}
              {ad.min_counterparty_trades > 0 && (
                <Badge variant="outline" className="text-[11px]">
                  Needs {ad.min_counterparty_trades}+ trades
                </Badge>
              )}
              <Badge variant="outline" className="text-[11px]">
                {ad.min_counterparty_tier}+ only
              </Badge>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-lg font-semibold">
              {price ? formatZmw(price) : "—"}
              <span className="text-xs font-normal text-muted-foreground"> /BTC</span>
            </div>
            {pct !== null && (
              <Badge
                variant={offMarket ? "destructive" : "secondary"}
                className="text-[11px]"
              >
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(1)}% vs market
              </Badge>
            )}
            {!isOwn && (
              <div>
                <Button
                  size="sm"
                  onClick={() => setOpen((v) => !v)}
                  disabled={tradingPaused}
                  className="mt-1"
                >
                  {takerBuys ? "Buy BTC" : "Sell BTC"}
                  {open ? (
                    <ChevronUp className="h-4 w-4 ml-1" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-1" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>

        {ad.terms && (
          <p className="text-xs text-muted-foreground mt-3 whitespace-pre-wrap border-t border-border pt-3">
            {ad.terms}
          </p>
        )}

        {open && !isOwn && (
          <div className="mt-4 border-t border-border pt-4 space-y-4">
            {offMarket && (
              <Alert className="border-destructive/50 bg-destructive/5">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <AlertDescription>
                  <strong>Warning:</strong> this ad is priced more than 10% away
                  from the market price ({price ? formatZmw(price) : ""} vs{" "}
                  {indexZmw ? formatZmw(indexZmw) : ""}). Ads priced far from
                  market are a common bait pattern. Only continue if you
                  understand you are trading at this price.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`fiat-${ad.id}`}>
                  {takerBuys ? "You pay (ZMW)" : "You receive (ZMW)"}
                </Label>
                <Input
                  id={`fiat-${ad.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={`${ad.min_order_zmw} – ${ad.max_order_zmw}`}
                  value={fiatInput}
                  onChange={(e) => setFiatInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{takerBuys ? "You receive" : "You sell"}</Label>
                <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm font-mono">
                  {sats > 0 ? `${formatBtcFromSats(sats)} BTC` : "—"}
                </div>
              </div>
            </div>

            {!takerBuys && (
              <div className="space-y-2">
                <Label>Receive payment on</Label>
                {myMethods.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading your payment methods…</p>
                ) : eligibleSellerMethods.length === 0 ? (
                  <Alert>
                    <AlertDescription>
                      You need an active registered payment method this ad
                      accepts before you can sell.{" "}
                      <a href="/p2p/profile" className="underline font-medium">
                        Add one on your P2P profile
                      </a>
                      .
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={sellerMethodId} onValueChange={setSellerMethodId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose your payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleSellerMethods.map((m: P2pPaymentMethod) => (
                        <SelectItem key={m.id} value={m.id}>
                          {paymentMethodTypeLabel(m.type)} · {m.account_number} · {m.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {offMarket && (
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={ackOffMarket}
                  onCheckedChange={(v) => setAckOffMarket(v === true)}
                  className="mt-0.5"
                />
                <span>
                  I understand this price is far from the market price and I
                  want to trade at it anyway.
                </span>
              </label>
            )}

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={submit}
              disabled={createOrder.isPending || tradingPaused || !canTrade}
              className="w-full sm:w-auto"
            >
              {createOrder.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Open order — BTC locks in escrow first
            </Button>
            {!canTrade && (
              <p className="text-xs text-muted-foreground">
                Your account can't trade right now — see the notice at the top of
                this page.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
