import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useMoonpay } from "@/hooks/useMoonpay";
import {
  isMoonpaySandbox,
  moonpayEnvironmentLabel,
  moonpayStatusLabel,
  shortenMoonpayValue,
  type MoonpayTransactionStatus,
} from "@/config/moonpay";
import { Check, Copy, CreditCard, Globe2, RefreshCw } from "lucide-react";

interface MoonpayStatus {
  configured: boolean;
  environment: string | null;
  publishableKeyPresent: boolean;
  secretKeyPresent: boolean;
  webhookKeyPresent: boolean;
  moonpayEnabled: boolean;
  webhookUrl: string;
  counts: { total: number; byStatus: Record<string, number> };
}

interface MoonpayTransaction {
  id: string;
  user_id: string;
  /** The list action resolves the owner's email into `email`. */
  email?: string | null;
  user_email?: string | null;
  external_reference: string | null;
  moonpay_transaction_id: string | null;
  deposit_address: string | null;
  fiat_currency: string | null;
  fiat_amount: number | null;
  crypto_currency: string | null;
  crypto_amount: number | null;
  status: string;
  raw_status: string | null;
  failure_reason: string | null;
  environment: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const statusVariant = (status: string) => {
  switch (status as MoonpayTransactionStatus) {
    case "completed":
      return "default" as const;
    case "failed":
      return "destructive" as const;
    case "waiting_payment":
    case "waiting_authorization":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
};

const keyPresence = (present: boolean) => (
  <Badge variant={present ? "default" : "secondary"}>
    {present ? "Set" : "Not set"}
  </Badge>
);

/**
 * MoonPay console.
 *
 * Admin / super_admin only — the route is role-guarded in
 * AnimatedRoutes and the `moonpay-admin` edge function enforces the
 * same gate server-side. Shows the integration's truthful state
 * from the function's status action (whether each key is present —
 * secret values never reach the browser), the kill-switch state,
 * the webhook URL MoonPay must be given, purchase counts, and the
 * recent purchases list from the function's list action. A small
 * USD purchase card, driven by useMoonpay, mirrors AdminStripe's
 * test-deposit card.
 */
const AdminMoonpay = () => {
  const { toast } = useToast();
  const { startMoonpayBuy, isStartingMoonpayBuy } = useMoonpay();
  const [status, setStatus] = useState<MoonpayStatus | null>(null);
  const [transactions, setTransactions] = useState<MoonpayTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testAmount, setTestAmount] = useState("50.00");
  const [lastTestResult, setLastTestResult] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("moonpay-admin", {
      body: { action: "status" },
    });
    if (error) {
      const message = await resolveEdgeFunctionError(
        error,
        "The MoonPay status could not be loaded. Please try again.",
      );
      setLoadError(message);
      toast({ title: "Could not load MoonPay status", description: message, variant: "destructive" });
      return;
    }
    if (data) {
      const counts = (data.counts ?? {}) as { total?: unknown; byStatus?: unknown };
      setStatus({
        configured: Boolean(data.configured),
        environment:
          typeof data.environment === "string" ? data.environment : null,
        publishableKeyPresent: Boolean(data.publishableKeyPresent),
        secretKeyPresent: Boolean(data.secretKeyPresent),
        webhookKeyPresent: Boolean(data.webhookKeyPresent),
        moonpayEnabled: Boolean(data.moonpayEnabled),
        webhookUrl: String(data.webhookUrl ?? ""),
        counts: {
          total: typeof counts.total === "number" ? counts.total : 0,
          byStatus:
            counts.byStatus && typeof counts.byStatus === "object"
              ? (counts.byStatus as Record<string, number>)
              : {},
        },
      });
    }
  }, [toast]);

  const loadTransactions = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("moonpay-admin", {
      body: { action: "list", limit: 50 },
    });
    if (error) {
      const message = await resolveEdgeFunctionError(
        error,
        "The MoonPay purchases could not be loaded. Please try again.",
      );
      setLoadError(message);
      toast({ title: "Could not load MoonPay purchases", description: message, variant: "destructive" });
      return;
    }
    setTransactions((data?.transactions as MoonpayTransaction[]) ?? []);
  }, [toast]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    await Promise.all([loadStatus(), loadTransactions()]);
  }, [loadStatus, loadTransactions]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const refreshAll = async () => {
    setIsBusy(true);
    try {
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const copyWebhookUrl = async () => {
    if (!status?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(status.webhookUrl);
      setCopied(true);
      toast({ title: "Copied", description: "The webhook URL has been copied." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "The webhook URL could not be copied. Please copy it manually.",
        variant: "destructive",
      });
    }
  };

  const runTestPurchase = async () => {
    const amount = Number(testAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setLastTestResult("Enter an amount greater than zero to start a purchase.");
      return;
    }
    // The hook toasts the function's plain-language result itself
    // (including the truthful not_configured message) and opens
    // MoonPay's hosted checkout in a new tab when a session starts.
    const started = await startMoonpayBuy({ fiatAmount: amount, fiatCurrency: "USD" });
    setLastTestResult(
      started
        ? "Purchase started — MoonPay's hosted checkout has opened in a new tab. The Bitcoin is delivered only after MoonPay confirms the purchase."
        : "The purchase was not started. The message above explains why — no money has moved.",
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const environmentLabel = moonpayEnvironmentLabel(status?.environment);

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">
            MoonPay
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card purchases of Bitcoin through MoonPay. Administrators only.
          </p>
        </div>

        {loadError && (
          <Alert className="mb-6 border-destructive/60 bg-destructive/10">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>Could not load MoonPay</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {status && !configured && (
          <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>MoonPay is not connected yet</AlertTitle>
            <AlertDescription>
              MoonPay is not connected yet — purchases are unavailable until the
              MoonPay keys are added in Supabase. This page is fully ready for
              them — once the keys are added, purchases and status checks will
              work here with no further changes.
            </AlertDescription>
          </Alert>
        )}

        {configured && isMoonpaySandbox(status?.environment) && (
          <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>Sandbox — simulated money</AlertTitle>
            <AlertDescription>
              This panel is connected to the MoonPay sandbox. Purchases are
              simulated by MoonPay and no real money moves.
            </AlertDescription>
          </Alert>
        )}

        {status && !status.moonpayEnabled && (
          <Alert className="mb-6">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>MoonPay purchases are switched off</AlertTitle>
            <AlertDescription>
              The MoonPay rail is switched off in platform settings
              (moonpay_enabled). Users see card purchases as coming soon until
              it is switched back on.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>MoonPay status</CardTitle>
              <Button variant="outline" size="sm" onClick={refreshAll} disabled={isBusy}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Configured</span>
                {status ? (
                  <Badge variant={status.configured ? "default" : "secondary"}>
                    {status.configured ? "Configured" : "Not configured"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Environment</span>
                {environmentLabel ? (
                  <Badge variant="outline">{environmentLabel}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Purchases rail (moonpay_enabled)</span>
                {status ? (
                  <Badge variant={status.moonpayEnabled ? "default" : "destructive"}>
                    {status.moonpayEnabled ? "Enabled" : "Switched off"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Publishable key</span>
                {status ? keyPresence(status.publishableKeyPresent) : <span className="text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Secret key</span>
                {status ? keyPresence(status.secretKeyPresent) : <span className="text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Webhook key</span>
                {status ? keyPresence(status.webhookKeyPresent) : <span className="text-muted-foreground">—</span>}
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground">Webhook URL — give this to MoonPay</p>
                {status?.webhookUrl ? (
                  <div className="flex items-start gap-2">
                    <p className="font-mono text-xs break-all flex-1">{status.webhookUrl}</p>
                    <Button variant="outline" size="sm" onClick={copyWebhookUrl}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Total purchases</span>
                <span className="font-medium">{status?.counts.total ?? 0}</span>
              </div>
              {status && Object.keys(status.counts.byStatus).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(status.counts.byStatus).map(([s, count]) => (
                    <Badge key={s} variant={statusVariant(s)}>
                      {moonpayStatusLabel(s)}: {count}
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Only whether each key is set is shown here — key values live
                only in Supabase function secrets and are never displayed.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Start a purchase</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="moonpay-test-amount">Amount (USD)</Label>
                <Input
                  id="moonpay-test-amount"
                  inputMode="decimal"
                  value={testAmount}
                  onChange={(e) => setTestAmount(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Currency</span>
                <Badge variant="outline">USD</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                MoonPay purchases are in US dollars — MoonPay does not support
                ZMW. The purchase completes on MoonPay and the Bitcoin is
                delivered to your wallet.
              </p>
              <Button
                className="w-full"
                onClick={runTestPurchase}
                disabled={isBusy || isStartingMoonpayBuy}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {isStartingMoonpayBuy ? "Starting…" : "Buy with card"}
              </Button>
              {lastTestResult && (
                <p className="text-sm text-muted-foreground">{lastTestResult}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Purchases</CardTitle>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isBusy}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No MoonPay purchases yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Bitcoin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deposit address</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <span className="text-xs">{t.user_email ?? t.email ?? "—"}</span>
                        {!(t.user_email ?? t.email) && t.user_id ? (
                          <span className="block font-mono text-xs text-muted-foreground mt-1">
                            {shortenMoonpayValue(t.user_id)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {t.fiat_amount != null
                          ? `${t.fiat_currency ?? "USD"} ${Number(t.fiat_amount).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {t.crypto_amount != null
                          ? `${Number(t.crypto_amount)} ${t.crypto_currency ?? "BTC"}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>
                          {moonpayStatusLabel(t.status)}
                        </Badge>
                        {t.raw_status ? (
                          <span className="block text-xs text-muted-foreground mt-1">{t.raw_status}</span>
                        ) : null}
                        {t.failure_reason ? (
                          <span className="block text-xs text-destructive mt-1">{t.failure_reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortenMoonpayValue(t.deposit_address)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortenMoonpayValue(t.external_reference ?? t.moonpay_transaction_id)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(t.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default AdminMoonpay;
