import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Ban, CheckCircle2, Clock, Plus, ScanFace, ShieldCheck, Trash2 } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  p2pAction,
  P2pActionError,
  type P2pPaymentMethod,
} from "@/services/p2pService";
import {
  useInvalidateP2p,
  useP2pBlocks,
  useP2pKycState,
  useP2pLimits,
  useP2pMySanctions,
  useP2pPaymentMethods,
  useP2pPrice,
  useP2pTier,
  useP2pTraderProfile,
  useP2pUnmaturedHolds,
  useTraderPublicProfiles,
} from "@/hooks/useP2p";
import {
  completionSummary,
  formatBtcFromSats,
  formatSats,
  formatZmw,
  limitsReasonText,
  paymentMethodTypeLabel,
  SANCTION_LEVEL_LABELS,
  traderDisplayName,
} from "@/utils/p2pUi";
import { useMyIdentityStatus } from "@/hooks/useIdentity";
import { identityStatusMeta } from "@/utils/identityUi";
import { format } from "date-fns";

const KYC_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  verified: { label: "Identity verified", tone: "default" },
  pending: { label: "Verification in review", tone: "secondary" },
  rejected: { label: "Verification rejected", tone: "destructive" },
  not_started: { label: "Not verified yet", tone: "outline" },
};

/**
 * /p2p/profile — own trust surface (§4.4): tier + limits with the
 * reasons in plain language, KYC state, reputation counters, the
 * payment-method registry, blocks, sanctions, and the T+1 safety
 * hold balance with its explanation.
 */
export default function P2PProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const tierQuery = useP2pTier();
  const limitsQuery = useP2pLimits();
  const kycQuery = useP2pKycState();
  const identityQuery = useMyIdentityStatus();
  const profileQuery = useP2pTraderProfile();
  const methodsQuery = useP2pPaymentMethods();
  const blocksQuery = useP2pBlocks();
  const sanctionsQuery = useP2pMySanctions();
  const holdsQuery = useP2pUnmaturedHolds();
  const priceQuery = useP2pPrice();

  const [methodType, setMethodType] = useState<"mobile_money" | "bank">("mobile_money");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [methodError, setMethodError] = useState<string | null>(null);

  const limits = limitsQuery.data;
  const profile = profileQuery.data;
  const holdsSats = holdsQuery.data ?? 0;
  const indexZmw = priceQuery.data ? Number(priceQuery.data.index_zmw) : null;
  const blockedIds = (blocksQuery.data ?? []).map((b) => b.blocked_id);
  const blockedProfiles = useTraderPublicProfiles(blockedIds);

  const addMethod = useMutation({
    mutationFn: () =>
      p2pAction(
        "create_payment_method",
        {
          type: methodType,
          account_number: accountNumber.trim(),
          account_name: accountName.trim(),
          bank_name: methodType === "bank" ? bankName.trim() || undefined : undefined,
        },
        "We couldn't add this payment method. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Payment method added" });
      setAccountNumber("");
      setAccountName("");
      setBankName("");
      setMethodError(null);
      invalidate();
    },
    onError: (e: unknown) =>
      setMethodError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't add this payment method. Please try again.",
      ),
  });

  const setMethodStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      p2pAction(
        "set_payment_method_status",
        { method_id: input.id, status: input.status },
        "We couldn't update this payment method. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Payment method updated" });
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Update failed",
        description:
          e instanceof P2pActionError || e instanceof Error
            ? e.message
            : "We couldn't update this payment method.",
        variant: "destructive",
      }),
  });

  const unblock = useMutation({
    mutationFn: (blockedId: string) =>
      p2pAction("unblock_user", { blocked_id: blockedId }, "We couldn't unblock this trader."),
    onSuccess: () => {
      toast({ title: "Trader unblocked" });
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Unblock failed",
        description: e instanceof Error ? e.message : "We couldn't unblock this trader.",
        variant: "destructive",
      }),
  });

  const submitMethod = () => {
    if (!accountNumber.trim() || !accountName.trim()) {
      setMethodError("Enter the account number and the name on the account.");
      return;
    }
    setMethodError(null);
    addMethod.mutate();
  };

  return (
    <P2pShell
      title="P2P Profile"
      subtitle="Your trading identity: verification tier, limits, reputation, payment methods and standing."
    >
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Tier + limits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Verification & limits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {limitsQuery.isLoading || tierQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : limits ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-sm px-3 py-1">Tier {tierQuery.data ?? limits.tier}</Badge>
                  {kycQuery.data && (
                    <Badge variant={KYC_LABELS[kycQuery.data.status].tone}>
                      {KYC_LABELS[kycQuery.data.status].label}
                    </Badge>
                  )}
                  <span className="text-sm font-medium">
                    {profile
                      ? traderDisplayName(profile.nickname, user?.id ?? "")
                      : "Trader"}
                  </span>
                </div>
                {kycQuery.data?.status !== "verified" && (
                  <Alert>
                    <AlertDescription>
                      {kycQuery.data?.status === "rejected"
                        ? `Your last verification was rejected${kycQuery.data.rejectionReason ? `: ${kycQuery.data.rejectionReason}` : ""}. `
                        : kycQuery.data?.status === "pending"
                          ? "Your documents are being reviewed. "
                          : "P2P trading needs a verified identity. "}
                      <Link to="/kyc" className="underline font-medium">
                        {kycQuery.data?.status === "not_started" ? "Verify your identity" : "Open verification"}
                      </Link>
                    </AlertDescription>
                  </Alert>
                )}
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Per-order limit</dt>
                    <dd className="font-medium">{formatZmw(limits.max_order_zmw)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Daily limit</dt>
                    <dd className="font-medium">
                      {formatZmw(limits.daily_used_zmw)} of {formatZmw(limits.daily_cap_zmw)} used
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Open orders</dt>
                    <dd className="font-medium">
                      {limits.open_orders} of {limits.max_open_orders}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Orders today</dt>
                    <dd className="font-medium">
                      {limits.orders_today} of {limits.orders_day_cap}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Can post sell ads</dt>
                    <dd className="font-medium">{limits.can_post_ads ? "Yes" : "Not yet"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Can trade</dt>
                    <dd className="font-medium">{limits.can_trade ? "Yes" : "No"}</dd>
                  </div>
                </dl>
                {!limits.can_trade && limits.reasons.length > 0 && (
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {limits.reasons.map((code) => (
                      <li key={code}>{limitsReasonText(code)}</li>
                    ))}
                  </ul>
                )}
                {limits.trade_hold && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Trading is on hold on this account
                      {limits.hold_reason ? `: ${limits.hold_reason}` : ""}.
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-xs text-muted-foreground">
                  Limits grow with verified identity and completed trades.
                  New traders start small on purpose — it's how the marketplace
                  stays safe for everyone.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                We couldn't load your limits. Refresh the page to try again.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Reputation + holds */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trading record</CardTitle>
            </CardHeader>
            <CardContent>
              {profileQuery.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : profile ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Completed trades</dt>
                    <dd className="font-medium">{profile.trades_completed}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Completion</dt>
                    <dd className="font-medium">{completionSummary(profile)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">As buyer / seller</dt>
                    <dd className="font-medium">
                      {profile.trades_as_buyer} / {profile.trades_as_seller}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Volume completed</dt>
                    <dd className="font-medium">{formatZmw(Number(profile.volume_zmw_completed))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Disputes won / lost</dt>
                    <dd className="font-medium">
                      {profile.disputes_won} / {profile.disputes_lost}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Typical release time</dt>
                    <dd className="font-medium">
                      {profile.median_release_minutes
                        ? `~${Math.round(profile.median_release_minutes)} min`
                        : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No trades yet — your record starts with your first completed
                  trade.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanFace className="h-5 w-5 text-primary" /> Face verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {identityQuery.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : identityQuery.isError ? (
                <p className="text-sm text-muted-foreground">
                  We couldn't load your face verification status. Refresh
                  the page to try again.
                </p>
              ) : (
                (() => {
                  const meta = identityStatusMeta(
                    identityQuery.data?.verification?.status ?? null,
                  );
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge variant={meta.tone}>{meta.label}</Badge>
                        {identityQuery.data?.face_verified && (
                          <span className="text-xs text-muted-foreground">
                            Face on record for this account
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{meta.body}</p>
                      <Button asChild variant={meta.verified ? "outline" : "default"}>
                        <Link to="/verify-identity">
                          {meta.verified
                            ? "View face verification"
                            : meta.canRetry
                              ? "Verify my face"
                              : "Open face verification"}
                        </Link>
                      </Button>
                    </>
                  );
                })()
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-5 w-5" /> 24-hour safety hold
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {holdsQuery.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <>
                  <p className="text-lg font-semibold">
                    {formatSats(holdsSats)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({formatBtcFromSats(holdsSats)} BTC
                      {indexZmw && holdsSats > 0
                        ? ` · ≈ ${formatZmw((holdsSats / 100_000_000) * indexZmw)}`
                        : ""})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Bitcoin you receive from a P2P trade sits in a 24-hour
                    safety hold before it can be withdrawn on-chain. You can
                    still trade it, transfer it inside BMaGlass, or sell it on
                    P2P immediately — the hold only delays sending it out of
                    the platform, which gives reversed or stolen payments time
                    to surface.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payment methods */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Payment methods — where buyers pay you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            These are your registered accounts. An account number can only be
            registered to one BMaGlass user, and the name on the account is
            checked against your verified identity. Buyers only ever see the
            method on an order after the Bitcoin has locked in escrow.
          </p>
          {methodsQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (methodsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment methods yet. Add the account you want buyers to pay below.</p>
          ) : (
            <div className="space-y-2">
              {(methodsQuery.data ?? []).map((m: P2pPaymentMethod) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-md p-3"
                >
                  <div className="text-sm">
                    <span className="font-medium">{paymentMethodTypeLabel(m.type)}</span>{" "}
                    · <span className="font-mono">{m.account_number}</span> · {m.account_name}
                    {m.bank_name ? ` · ${m.bank_name}` : ""}
                    <span className="block text-xs text-muted-foreground">
                      {m.is_primary ? "Primary · " : ""}
                      {m.verified_name_match ? "Name matches your ID · " : ""}
                      Added {format(new Date(m.created_at), "d MMM yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={m.status === "active" ? "default" : "secondary"}>
                      {m.status}
                    </Badge>
                    {m.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setMethodStatus.isPending}
                        onClick={() => setMethodStatus.mutate({ id: m.id, status: "disabled" })}
                      >
                        Disable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setMethodStatus.isPending}
                        onClick={() => setMethodStatus.mutate({ id: m.id, status: "active" })}
                      >
                        Reactivate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={setMethodStatus.isPending}
                      onClick={() => setMethodStatus.mutate({ id: m.id, status: "removed" })}
                      aria-label="Remove payment method"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border pt-4 space-y-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add a payment method
            </h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={methodType} onValueChange={(v) => setMethodType(v as typeof methodType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mobile_money">Mobile Money (MTN / Airtel / Zamtel)</SelectItem>
                    <SelectItem value="bank">Bank account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-number">Account / phone number</Label>
                <Input
                  id="pm-number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  maxLength={64}
                  placeholder={methodType === "mobile_money" ? "0977 123 456" : "Account number"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-name">Name on the account</Label>
                <Input
                  id="pm-name"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  maxLength={120}
                  placeholder="Exactly as it appears on the account"
                />
              </div>
              {methodType === "bank" && (
                <div className="space-y-2">
                  <Label htmlFor="pm-bank">Bank name</Label>
                  <Input
                    id="pm-bank"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    maxLength={120}
                  />
                </div>
              )}
            </div>
            {methodError && (
              <Alert variant="destructive">
                <AlertDescription>{methodError}</AlertDescription>
              </Alert>
            )}
            <Button onClick={submitMethod} disabled={addMethod.isPending}>
              Add payment method
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        {/* Blocks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="h-5 w-5" /> Blocked traders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {blocksQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (blocksQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven't blocked anyone. Blocking stops all future orders
                between you and that trader.
              </p>
            ) : (
              <div className="space-y-2">
                {(blocksQuery.data ?? []).map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-2 border border-border rounded-md p-3 text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {traderDisplayName(blockedProfiles.data?.[b.blocked_id]?.nickname, b.blocked_id)}
                      </span>
                      {b.reason && (
                        <span className="block text-xs text-muted-foreground">{b.reason}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        Blocked {format(new Date(b.created_at), "d MMM yyyy")}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unblock.isPending}
                      onClick={() => unblock.mutate(b.blocked_id)}
                    >
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sanctions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Sanctions & standing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sanctionsQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (sanctionsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your account is in good standing — no sanctions on record.
              </p>
            ) : (
              <div className="space-y-2">
                {(sanctionsQuery.data ?? []).map((s) => (
                  <div key={s.id} className="border border-border rounded-md p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.status === "active" ? "destructive" : "secondary"}>
                        {s.status}
                      </Badge>
                      <span className="font-medium">
                        Level {s.level} — {SANCTION_LEVEL_LABELS[s.level] ?? "Sanction"}
                      </span>
                    </div>
                    {s.detail && <p className="text-muted-foreground">{s.detail}</p>}
                    <p className="text-xs text-muted-foreground">
                      Applied {format(new Date(s.created_at), "d MMM yyyy")}
                      {s.expires_at
                        ? ` · Ends ${format(new Date(s.expires_at), "d MMM yyyy")}`
                        : ""}
                      {" · "}Scope: {s.scope === "p2p" ? "P2P only" : "Whole platform"}
                    </p>
                  </div>
                ))}
                <Alert>
                  <AlertTitle className="text-sm">Think a sanction is wrong?</AlertTitle>
                  <AlertDescription className="text-xs">
                    You can appeal through{" "}
                    <Link to="/support" className="underline font-medium">
                      Support
                    </Link>{" "}
                    — quote the sanction date and level above. Automatic
                    sanctions (levels 0–1) come from countable events like
                    sharing contact details in chat; levels 2 and above are
                    always decided by a person.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </P2pShell>
  );
}
