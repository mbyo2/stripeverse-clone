import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import { P2pTransferDialog } from "@/components/p2p/P2pAccountCard";
import { useToast } from "@/hooks/use-toast";
import { p2pAction, P2pActionError } from "@/services/p2pService";
import {
  useInvalidateP2p,
  useP2pAccount,
  useP2pLimits,
  useP2pPrice,
} from "@/hooks/useP2p";
import {
  adEffectivePriceZmw,
  formatSats,
  formatZmw,
  isOffMarket,
  paymentMethodTypeLabel,
  percentVsIndex,
  p2pShortfallSats,
} from "@/utils/p2pUi";

const WINDOW_OPTIONS = [15, 30, 45, 60, 120];

/**
 * /p2p/ads/new — ad creation (§4.4). Live index + margin preview so
 * the advertiser sees the exact price takers will trade at; ads
 * priced >10% off market carry the bait warning here too, before
 * posting. The RPC re-checks every gate (tier, bands, inventory) —
 * this form's job is honesty and clarity, not enforcement.
 */
export default function P2PNewAd() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const limitsQuery = useP2pLimits();
  const priceQuery = useP2pPrice();
  const accountQuery = useP2pAccount();
  const indexZmw = priceQuery.data ? Number(priceQuery.data.index_zmw) : null;

  const [side, setSide] = useState<"sell_crypto" | "buy_crypto">("sell_crypto");
  const [priceType, setPriceType] = useState<"fixed" | "margin">("margin");
  const [fixedPrice, setFixedPrice] = useState("");
  const [margin, setMargin] = useState("1");
  const [totalBtc, setTotalBtc] = useState("");
  const [minOrder, setMinOrder] = useState("100");
  const [maxOrder, setMaxOrder] = useState("5000");
  const [methods, setMethods] = useState<string[]>(["mobile_money"]);
  const [windowMinutes, setWindowMinutes] = useState("30");
  const [settleDelay, setSettleDelay] = useState("0");
  const [terms, setTerms] = useState("");
  const [minTier, setMinTier] = useState("T1");
  const [minTrades, setMinTrades] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const previewPrice = useMemo(
    () =>
      adEffectivePriceZmw(
        {
          price_type: priceType,
          fixed_price_zmw: fixedPrice ? Number(fixedPrice) : null,
          margin_percent: margin ? Number(margin) : null,
        },
        indexZmw,
      ),
    [priceType, fixedPrice, margin, indexZmw],
  );
  const pct = percentVsIndex(previewPrice, indexZmw);
  const offMarket = isOffMarket(previewPrice, indexZmw);
  const canPostAds = limitsQuery.data?.can_post_ads ?? false;
  const sellBlocked = side === "sell_crypto" && limitsQuery.data && !canPostAds;

  // Sell ads settle from the separate P2P account: the ad's total
  // (total_amount_minor, exactly as the create mutation sends it)
  // must be covered by the P2P account's available balance. This is
  // a notice with a one-tap fix, not a form block — the server
  // stays the authority.
  const neededSats =
    side === "sell_crypto" ? Math.round(Number(totalBtc) * 100_000_000) : 0;
  const p2pAvailableSats = accountQuery.data?.p2p.available_sats;
  const sellShortfallSats =
    p2pAvailableSats !== undefined && neededSats > 0
      ? p2pShortfallSats(neededSats, p2pAvailableSats)
      : 0;

  const createAd = useMutation({
    mutationFn: () =>
      p2pAction(
        "create_ad",
        {
          side,
          price_type: priceType,
          fixed_price_zmw: priceType === "fixed" ? Number(fixedPrice) : undefined,
          margin_percent: priceType === "margin" ? Number(margin) : undefined,
          total_amount_minor: Math.round(Number(totalBtc) * 100_000_000),
          min_order_zmw: Number(minOrder),
          max_order_zmw: Number(maxOrder),
          payment_method_types: methods,
          payment_window_minutes: Number(windowMinutes),
          settle_delay_minutes: Number(settleDelay),
          terms: terms.trim() || undefined,
          min_counterparty_tier: minTier,
          min_counterparty_trades: Number(minTrades),
        },
        "We couldn't post this ad. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Ad posted", description: "Your ad is live on the marketplace." });
      invalidate();
      navigate("/p2p/my-ads");
    },
    onError: (e: unknown) =>
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't post this ad. Please try again.",
      ),
  });

  const toggleMethod = (type: string, on: boolean) =>
    setMethods((prev) => (on ? [...new Set([...prev, type])] : prev.filter((t) => t !== type)));

  const submit = () => {
    setFormError(null);
    if (!Number(totalBtc) || Number(totalBtc) <= 0) {
      setFormError("Enter the total amount of Bitcoin this ad covers.");
      return;
    }
    if (priceType === "fixed" && !(Number(fixedPrice) > 0)) {
      setFormError("Enter your fixed price per BTC.");
      return;
    }
    if (priceType === "margin" && margin === "") {
      setFormError("Enter a margin — 0% prices your ad exactly at the market price.");
      return;
    }
    if (!(Number(minOrder) > 0) || !(Number(maxOrder) >= Number(minOrder))) {
      setFormError("Check your order limits — the maximum must be at least the minimum.");
      return;
    }
    if (methods.length === 0) {
      setFormError("Choose at least one payment method you accept.");
      return;
    }
    createAd.mutate();
  };

  return (
    <P2pShell title="Post an Ad" subtitle="Set your price and limits. Your ad shows your nickname and trading record — never your payment details.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ad details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {sellBlocked && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle>Selling ads need full verification</AlertTitle>
              <AlertDescription>
                Posting a <strong>sell</strong> ad requires a fully verified
                (T2+) account. Complete your identity verification — ID
                documents, a live-camera selfie and the checks that come
                with them — and you can post sell ads straight away. You can
                still post a{" "}
                <strong>buy</strong> ad, and trade on other people's ads to
                build your record.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>I want to</Label>
              <Select value={side} onValueChange={(v) => setSide(v as typeof side)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sell_crypto">Sell my Bitcoin</SelectItem>
                  <SelectItem value="buy_crypto">Buy Bitcoin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Pricing</Label>
              <Select value={priceType} onValueChange={(v) => setPriceType(v as typeof priceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="margin">Float with the market (margin)</SelectItem>
                  <SelectItem value="fixed">Fixed price</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {priceType === "margin" ? (
              <div className="space-y-2">
                <Label htmlFor="ad-margin">Margin vs market (%)</Label>
                <Input
                  id="ad-margin"
                  type="number"
                  step="0.1"
                  min={-30}
                  max={30}
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Market is {indexZmw ? formatZmw(indexZmw) : "unavailable"}.
                  Positive margin = above market.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ad-fixed">Fixed price per BTC (ZMW)</Label>
                <Input
                  id="ad-fixed"
                  type="number"
                  step="0.01"
                  min={0}
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Your price right now</Label>
              <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm font-medium">
                {previewPrice
                  ? `${formatZmw(previewPrice)} / BTC${pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs market)` : ""}`
                  : "—"}
              </div>
            </div>
          </div>

          {offMarket && (
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription>
                This price is more than 10% away from the market price. Your ad
                will carry an <strong>off-market warning</strong>, and every
                taker must explicitly accept the price before trading. Ads
                priced far from market are usually mistakes — or bait.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ad-total">Total BTC for this ad</Label>
              <Input
                id="ad-total"
                type="number"
                step="0.00000001"
                min={0}
                value={totalBtc}
                onChange={(e) => setTotalBtc(e.target.value)}
                placeholder="0.01000000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad-min">Min order (ZMW)</Label>
              <Input
                id="ad-min"
                type="number"
                step="0.01"
                min={0}
                value={minOrder}
                onChange={(e) => setMinOrder(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad-max">Max order (ZMW)</Label>
              <Input
                id="ad-max"
                type="number"
                step="0.01"
                min={0}
                value={maxOrder}
                onChange={(e) => setMaxOrder(e.target.value)}
              />
            </div>
          </div>

          {side === "sell_crypto" && sellShortfallSats > 0 && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle>Your P2P account needs more Bitcoin</AlertTitle>
              <AlertDescription>
                <p>
                  Sell ads run from your P2P account. This ad needs{" "}
                  {formatSats(neededSats)} and your P2P account has{" "}
                  {formatSats(p2pAvailableSats ?? 0)} available — you still need{" "}
                  {formatSats(sellShortfallSats)} there.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  onClick={() => setTransferOpen(true)}
                >
                  Move Bitcoin to your P2P account
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Payment methods you accept</Label>
            <div className="flex gap-6">
              {["mobile_money", "bank"].map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={methods.includes(type)}
                    onCheckedChange={(v) => toggleMethod(type, v === true)}
                  />
                  {paymentMethodTypeLabel(type)}
                </label>
              ))}
            </div>
            {side === "sell_crypto" && (
              <p className="text-[11px] text-muted-foreground">
                Buyers pay your primary registered method of the accepted type,
                shown to them only after their order locks escrow.
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Payment window</Label>
              <Select value={windowMinutes} onValueChange={setWindowMinutes}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} minutes to pay
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ad-delay">Settle delay (minutes)</Label>
              <Input
                id="ad-delay"
                type="number"
                min={0}
                max={10080}
                value={settleDelay}
                onChange={(e) => setSettleDelay(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Extra wait before you can release, against reversed payments.
                0 = none.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Counterparty must be</Label>
              <Select value={minTier} onValueChange={setMinTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="T1">T1 or higher (ID verified)</SelectItem>
                  <SelectItem value="T2">T2 or higher (fully verified)</SelectItem>
                  <SelectItem value="T3">T3 (established trader)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ad-min-trades">Minimum completed trades (counterparty)</Label>
              <Input
                id="ad-min-trades"
                type="number"
                min={0}
                value={minTrades}
                onChange={(e) => setMinTrades(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ad-terms">Your terms (optional)</Label>
            <Textarea
              id="ad-terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Please pay within the window and keep the reference from your transaction. I release as soon as the money shows in my account."
            />
            <p className="text-[11px] text-muted-foreground">
              Terms are public. Never include phone numbers, links or
              messaging-app names — ads with contact details are refused.
            </p>
          </div>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <Button onClick={submit} disabled={createAd.isPending} className="w-full sm:w-auto">
            {createAd.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Post this ad
          </Button>
        </CardContent>
      </Card>
      <P2pTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        initialDirection="to_p2p"
      />
    </P2pShell>
  );
}
