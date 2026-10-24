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
import { Landmark, RefreshCw } from "lucide-react";

interface PaypalFloatState {
  currency: string;
  allowance_usd: number;
  used_usd: number;
  remaining_usd: number;
  paid_out_usd?: number;
}

interface PaypalWithdrawalRow {
  id: string;
  user_id: string;
  email?: string | null;
  amount: number;
  currency: string;
  fee_amount: number;
  recipient_email: string;
  status: string;
  provider_status: string | null;
  failure_reason: string | null;
  provenance_amount: number;
  float_amount: number;
  created_at: string;
  completed_at: string | null;
}

const statusVariant = (status: string) => {
  switch (status) {
    case "completed":
      return "default" as const;
    case "failed":
      return "destructive" as const;
    case "pending":
    case "processing":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
};

const money = (value: number, currency = "USD") =>
  `${Number(value ?? 0).toFixed(2)} ${currency}`;

/**
 * PayPal admin console — withdrawals and the PLATFORM FLOAT.
 *
 * A USD withdrawal is funded provenance-first (the user's own
 * PayPal-sourced mark) and then, if the owner has set a float
 * allowance, from the platform's own PayPal money. This page shows
 * the allowance, how much of it is committed (derived from the
 * withdrawal ledger — pending, processing and completed float parts
 * all count; failed ones release automatically), and every recent
 * withdrawal with its funding split. Setting the allowance is a
 * super_admin action (the paypal-admin function enforces it and
 * audit-logs every change); plain admins see the state read-only.
 */
const AdminPaypal = () => {
  const { toast } = useToast();
  const [float, setFloat] = useState<PaypalFloatState | null>(null);
  const [canSetAllowance, setCanSetAllowance] = useState(false);
  const [counts, setCounts] = useState<{ total: number; byStatus: Record<string, number> }>({
    total: 0,
    byStatus: {},
  });
  const [withdrawals, setWithdrawals] = useState<PaypalWithdrawalRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allowanceInput, setAllowanceInput] = useState("");

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("paypal-admin", {
      body: { action: "status", limit: 50 },
    });
    if (error) {
      const message = await resolveEdgeFunctionError(
        error,
        "The PayPal status could not be loaded. Please try again.",
      );
      setLoadError(message);
      toast({ title: "Could not load PayPal status", description: message, variant: "destructive" });
      return;
    }
    if (data) {
      const f = (data.float ?? {}) as PaypalFloatState;
      setFloat({
        currency: String(f.currency ?? "USD"),
        allowance_usd: Number(f.allowance_usd ?? 0),
        used_usd: Number(f.used_usd ?? 0),
        remaining_usd: Number(f.remaining_usd ?? 0),
        paid_out_usd: Number(f.paid_out_usd ?? 0),
      });
      setCanSetAllowance(Boolean(data.canSetAllowance));
      const c = (data.counts ?? {}) as { total?: unknown; byStatus?: unknown };
      setCounts({
        total: typeof c.total === "number" ? c.total : 0,
        byStatus:
          c.byStatus && typeof c.byStatus === "object"
            ? (c.byStatus as Record<string, number>)
            : {},
      });
      setWithdrawals((data.withdrawals as PaypalWithdrawalRow[]) ?? []);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadStatus();
      setIsLoading(false);
    })();
  }, [loadStatus]);

  const refreshAll = async () => {
    setIsBusy(true);
    setLoadError(null);
    await loadStatus();
    setIsBusy(false);
  };

  const saveAllowance = async () => {
    const parsed = parseFloat(allowanceInput);
    if (isNaN(parsed) || parsed < 0) {
      toast({
        title: "Check the allowance",
        description: "Enter an allowance of 0 or more, in US dollars.",
        variant: "destructive",
      });
      return;
    }
    setIsBusy(true);
    const { data, error } = await supabase.functions.invoke("paypal-admin", {
      body: { action: "set_allowance", allowance_usd: parsed },
    });
    if (error) {
      const message = await resolveEdgeFunctionError(
        error,
        "The allowance could not be saved. Please try again.",
      );
      toast({ title: "Allowance not saved", description: message, variant: "destructive" });
      setIsBusy(false);
      return;
    }
    if (data?.float) {
      const f = data.float as PaypalFloatState;
      setFloat((prev) => ({
        currency: String(f.currency ?? "USD"),
        allowance_usd: Number(f.allowance_usd ?? 0),
        used_usd: Number(f.used_usd ?? 0),
        remaining_usd: Number(f.remaining_usd ?? 0),
        paid_out_usd: prev?.paid_out_usd ?? 0,
      }));
    }
    setAllowanceInput("");
    toast({
      title: "Float allowance saved",
      description: `The PayPal float allowance is now ${money(parsed)}. This change has been recorded in the audit log.`,
    });
    await loadStatus();
    setIsBusy(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Landmark className="h-6 w-6" /> PayPal Withdrawals &amp; Float
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              How users take money out to PayPal — and the platform float that can
              cover withdrawals beyond a user&apos;s own PayPal deposits.
            </p>
          </div>
          <Button variant="outline" onClick={refreshAll} disabled={isBusy || isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isBusy ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Platform float (USD)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : float ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Allowance set</p>
                    <p className="text-xl font-semibold">{money(float.allowance_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Committed (pending + paid)</p>
                    <p className="text-xl font-semibold">{money(float.used_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p className="text-xl font-semibold">{money(float.remaining_usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid out so far</p>
                    <p className="text-xl font-semibold">{money(float.paid_out_usd ?? 0)}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  A withdrawal is paid first from the user&apos;s own PayPal-sourced
                  balance; the float covers only the rest, and only in USD. Float
                  payouts are sent from the platform&apos;s real PayPal account — set
                  an allowance only up to what that account actually holds. If PayPal
                  cannot cover a payout, the withdrawal fails safely and the
                  user&apos;s money returns to their wallet in full; the float it
                  reserved is released automatically.
                </p>
                {canSetAllowance ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="float-allowance">New allowance (USD)</Label>
                      <Input
                        id="float-allowance"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={allowanceInput}
                        onChange={(e) => setAllowanceInput(e.target.value)}
                        className="w-48"
                      />
                    </div>
                    <Button onClick={saveAllowance} disabled={isBusy || allowanceInput === ""}>
                      Save allowance
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Setting 0 turns float-backed withdrawals off. Every change is
                      written to the audit log.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Only the platform owner (super admin) can change the allowance.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Float state unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent withdrawals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {counts.total} withdrawal{counts.total === 1 ? "" : "s"} in total
              {Object.entries(counts.byStatus).map(([status, n]) => (
                <span key={status}>
                  {" · "}
                  {n} {status}
                </span>
              ))}
            </p>
            {withdrawals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No withdrawals yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>From their PayPal money</TableHead>
                      <TableHead>From the float</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawals.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>{row.email ?? "—"}</TableCell>
                        <TableCell>{row.recipient_email}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {money(Number(row.amount), row.currency)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {money(Number(row.provenance_amount ?? 0), row.currency)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {money(Number(row.float_amount ?? 0), row.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                          {row.status === "failed" && row.failure_reason && (
                            <p className="text-xs text-destructive mt-1">{row.failure_reason}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default AdminPaypal;
