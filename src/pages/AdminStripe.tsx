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
import { useStripeGatewayDeposit } from "@/hooks/useStripeGatewayDeposit";
import { Copy, CreditCard, RefreshCw, RotateCcw } from "lucide-react";

interface GatewayStatus {
  configured: boolean;
  mode: "test" | "live" | null;
  kill_switch_enabled: boolean;
  webhook_configured: boolean;
  webhook_url: string;
}

interface StripeDeposit {
  uuid_id: string;
  user_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

function metadataString(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * Stripe Gateway console.
 *
 * Admin / super_admin only — the route is role-guarded in
 * AnimatedRoutes and the `stripe-gateway-admin` edge function
 * enforces the same gate server-side. Shows the rail's truthful
 * configuration state (from the function's status action — secret
 * values never reach the browser), recent gateway deposits read
 * directly from the ledger, a refund action per completed deposit,
 * and a USD test-deposit card driven by useStripeGatewayDeposit.
 */
const AdminStripe = () => {
  const { toast } = useToast();
  const { startStripeTopUp, isStartingStripeTopUp } = useStripeGatewayDeposit();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [deposits, setDeposits] = useState<StripeDeposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [testAmount, setTestAmount] = useState("10.00");
  const [lastTestResult, setLastTestResult] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("stripe-gateway-admin", {
      body: { action: "status" },
    });
    if (error) {
      toast({
        title: "Could not load Stripe status",
        description: await resolveEdgeFunctionError(
          error,
          "The gateway status could not be loaded. Please try again.",
        ),
        variant: "destructive",
      });
      return;
    }
    if (data?.success) {
      setStatus({
        configured: Boolean(data.configured),
        mode: (data.mode as GatewayStatus["mode"]) ?? null,
        kill_switch_enabled: Boolean(data.kill_switch_enabled),
        webhook_configured: Boolean(data.webhook_configured),
        webhook_url: String(data.webhook_url ?? ""),
      });
    }
  }, [toast]);

  const loadDeposits = useCallback(async () => {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "uuid_id, user_id, amount, currency, status, reference, external_reference, metadata, created_at",
      )
      .eq("payment_method", "stripe")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      toast({
        title: "Could not load deposits",
        description: "The recent Stripe deposits could not be loaded. Please try again.",
        variant: "destructive",
      });
      return;
    }
    setDeposits((data as StripeDeposit[]) ?? []);
  }, [toast]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadDeposits()]);
  }, [loadStatus, loadDeposits]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const copyWebhookUrl = async () => {
    if (!status?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      toast({ title: "Webhook URL copied", description: status.webhook_url });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the webhook URL and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const runRefund = async (deposit: StripeDeposit) => {
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-gateway-admin", {
        body: { action: "refund", transaction_id: deposit.uuid_id },
      });
      if (error) {
        toast({
          title: "Refund not created",
          description: await resolveEdgeFunctionError(
            error,
            "The refund could not be created. No money has moved.",
          ),
          variant: "destructive",
        });
        return;
      }
      if (!data?.success) {
        toast({
          title:
            data?.status === "not_configured"
              ? "Stripe is not connected yet"
              : "Refund not created",
          description:
            data?.error || "The refund could not be created. No money has moved.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Refund created",
        description:
          data.message ||
          `Refund ${data.refund_id ?? ""} created in Stripe with status ${data.refund_status ?? "pending"}.`,
      });
      await loadDeposits();
    } catch (error) {
      toast({
        title: "Refund failed",
        description: await resolveEdgeFunctionError(
          error,
          "The refund could not be created. No money has moved.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const runTestDeposit = async () => {
    const amount = Number(testAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setLastTestResult("Enter an amount greater than zero to start a test deposit.");
      return;
    }
    // The hook toasts the function's plain-language result itself
    // (including the truthful not_configured message) and redirects
    // to Stripe-hosted Checkout when a session is created.
    const started = await startStripeTopUp({ amount, currency: "USD" });
    setLastTestResult(
      started
        ? "Top-up started — you are being redirected to Stripe's hosted checkout. Your wallet is credited only after Stripe confirms the payment."
        : "The top-up was not started. The message above explains why — no money has moved.",
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

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">
            Stripe Gateway
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card top-ups through Stripe Checkout. Administrators only.
          </p>
        </div>

        {!configured && (
          <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
            <CreditCard className="h-4 w-4" />
            <AlertTitle>Stripe is not connected yet</AlertTitle>
            <AlertDescription>
              Stripe is not connected yet — no card payments can be taken. This page is
              ready for the day the keys are added.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Gateway status</CardTitle>
              <Button variant="outline" size="sm" onClick={refresh} disabled={isBusy}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Connection</span>
                {configured ? (
                  <span className="flex items-center gap-2">
                    <Badge variant="default">Configured</Badge>
                    {status?.mode && (
                      <Badge variant="secondary">
                        {status.mode === "live" ? "Live" : "Test"}
                      </Badge>
                    )}
                  </span>
                ) : (
                  <Badge variant="secondary">Not configured</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Rail enabled (stripe_gateway_enabled)</span>
                <Badge variant={status?.kill_switch_enabled ? "default" : "secondary"}>
                  {status?.kill_switch_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Webhook secret</span>
                <Badge variant={status?.webhook_configured ? "default" : "secondary"}>
                  {status?.webhook_configured ? "Configured" : "Not configured"}
                </Badge>
              </div>
              <div className="space-y-2">
                <Label>Webhook URL — register this in Stripe</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={status?.webhook_url ?? ""}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyWebhookUrl}
                    disabled={!status?.webhook_url}
                    aria-label="Copy webhook URL"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The publishable key lives in the Vercel environment
                (VITE_STRIPE_PUBLISHABLE_KEY) — it is the only Stripe key the browser may
                hold. The secret and webhook keys live only in Supabase function secrets
                and are never shown here.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Test deposit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="stripe-test-amount">Amount (USD)</Label>
                <Input
                  id="stripe-test-amount"
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
                Card top-ups settle in USD while ZMW presentment is unavailable.
              </p>
              <Button
                className="w-full"
                onClick={runTestDeposit}
                disabled={isBusy || isStartingStripeTopUp}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {isStartingStripeTopUp ? "Starting…" : "Start test deposit"}
              </Button>
              {lastTestResult && (
                <p className="text-sm text-muted-foreground">{lastTestResult}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent gateway deposits</CardTitle>
            <Button variant="outline" size="sm" onClick={loadDeposits} disabled={isBusy}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {deposits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Stripe gateway deposits yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Session / reference</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deposits.map((d) => {
                    const refundId = metadataString(d.metadata, "refund_id");
                    const refundStatus = metadataString(d.metadata, "refund_status");
                    const sessionRef =
                      metadataString(d.metadata, "session_id") ??
                      metadataString(d.metadata, "stripe_session_id") ??
                      d.reference ??
                      d.external_reference ??
                      "—";
                    return (
                      <TableRow key={d.uuid_id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {d.created_at
                            ? new Date(d.created_at).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {d.currency} {Number(d.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{d.status}</Badge>
                          {refundId && (
                            <Badge variant="outline" className="ml-2">
                              refund {refundStatus ?? "requested"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{sessionRef}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.user_id ?? "—"}
                        </TableCell>
                        <TableCell>
                          {d.status === "completed" && !refundId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => runRefund(d)}
                              disabled={isBusy}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Refund
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

export default AdminStripe;
