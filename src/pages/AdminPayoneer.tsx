import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Check, Copy, Globe2, Link2, RefreshCw, Send } from "lucide-react";

interface PayoutRow {
  id: string;
  uuid_id: string | null;
  payee_id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: "pending" | "submitted" | "completed" | "failed" | "reversed";
  provider_payout_id: string | null;
  provider_status: string | null;
  debit_state: string | null;
  error: string | null;
  created_at: string;
}

interface PayoneerStatus {
  configured: boolean;
  env: "sandbox" | "production" | null;
  enabled: boolean;
  webhook_url: string;
  registration_link_configured: boolean;
}

const CURRENCIES = ["USD", "EUR", "GBP", "ZMW", "ZAR", "KES", "NGN", "GHS"];

const statusVariant = (status: PayoutRow["status"]) => {
  switch (status) {
    case "completed":
      return "default" as const;
    case "failed":
    case "reversed":
      return "destructive" as const;
    case "submitted":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
};

/**
 * Payoneer Payouts.
 *
 * Admin / super_admin only — the route is role-guarded in
 * AnimatedRoutes and the `payoneer-payouts` edge function enforces
 * the same gate server-side. This panel drives Payoneer partner
 * payouts: the status / kill-switch panel, the payee registration
 * link, creating a payout, and refreshing a payout's status from
 * Payoneer. The payouts table is read directly through the
 * supabase client (admins have SELECT via RLS); every action goes
 * through the edge function.
 */
const AdminPayoneer = () => {
  const { toast } = useToast();
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [status, setStatus] = useState<PayoneerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
  const [registrationNote, setRegistrationNote] = useState<string | null>(null);

  const [payeeId, setPayeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");

  const loadPayouts = useCallback(async () => {
    // payoneer_payouts is not in the generated types yet (the table
    // ships with the payoneer-payouts backend), so read it through
    // the same untyped-client pattern other admin pages use for
    // tables the generated types have not caught up with.
    const { data, error } = await (supabase as any)
      .from("payoneer_payouts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({
        title: "Could not load payouts",
        description: "The payout list could not be loaded. Please try again.",
        variant: "destructive",
      });
      return;
    }
    setPayouts((data as PayoutRow[]) ?? []);
  }, [toast]);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("payoneer-payouts", {
      body: { action: "status" },
    });
    if (error) {
      toast({
        title: "Could not load Payoneer status",
        description: await resolveEdgeFunctionError(error, "The Payoneer status could not be loaded. Please try again."),
        variant: "destructive",
      });
      return;
    }
    if (data) {
      setStatus({
        configured: Boolean((data as { configured?: unknown }).configured),
        env: ((data as { env?: PayoneerStatus["env"] }).env ?? null) as PayoneerStatus["env"],
        enabled: Boolean((data as { enabled?: unknown }).enabled),
        webhook_url: String((data as { webhook_url?: unknown }).webhook_url ?? ""),
        registration_link_configured: Boolean(
          (data as { registration_link_configured?: unknown }).registration_link_configured,
        ),
      });
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await Promise.all([loadStatus(), loadPayouts()]);
      setIsLoading(false);
    })();
  }, [loadPayouts, loadStatus]);

  const copyWebhookUrl = async () => {
    if (!status?.webhook_url) return;
    try {
      await navigator.clipboard.writeText(status.webhook_url);
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

  const runRegistrationLink = async () => {
    setIsBusy(true);
    setRegistrationNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("payoneer-payouts", {
        body: { action: "registration_link" },
      });
      if (error) throw error;
      const result = data as { success?: boolean; url?: string; error?: string } | null;
      if (!result?.success) {
        const message = result?.error ?? "The registration link is not available yet.";
        setRegistrationUrl(null);
        setRegistrationNote(message);
        toast({ title: "Registration link not available", description: message, variant: "destructive" });
        return;
      }
      setRegistrationUrl(result.url ?? null);
      setRegistrationNote(null);
      toast({
        title: "Registration link ready",
        description: "Share this link with the payee so they can register with Payoneer.",
      });
    } catch (error) {
      const message = await resolveEdgeFunctionError(error, "The registration link could not be loaded. Please try again.");
      setRegistrationNote(message);
      toast({ title: "Registration link failed", description: message, variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  };

  const runCreatePayout = async () => {
    if (!payeeId.trim()) {
      toast({ title: "Payee ID required", description: "Enter the Payoneer payee ID for this payout.", variant: "destructive" });
      return;
    }
    const parsedAmount = Number(amount);
    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({ title: "Invalid amount", description: "Enter an amount greater than zero.", variant: "destructive" });
      return;
    }
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("payoneer-payouts", {
        body: {
          action: "create_payout",
          payee_id: payeeId.trim(),
          amount: parsedAmount,
          currency,
          description: description.trim() || undefined,
        },
      });
      if (error) {
        toast({
          title: "Payout not sent",
          description: await resolveEdgeFunctionError(error, "The payout could not be sent. Please try again."),
          variant: "destructive",
        });
        await loadPayouts();
        return;
      }
      const result = data as { success?: boolean; payout?: PayoutRow; error?: string } | null;
      if (!result?.success) {
        toast({
          title: "Payout not sent",
          description: result?.error ?? "The payout could not be sent. Please try again.",
          variant: "destructive",
        });
        await loadPayouts();
        return;
      }
      toast({
        title: "Payout submitted",
        description: `A payout of ${currency} ${parsedAmount.toFixed(2)} was submitted for payee ${payeeId.trim()}.`,
      });
      setDescription("");
      await loadPayouts();
    } catch (error) {
      toast({
        title: "Payout failed",
        description: await resolveEdgeFunctionError(error, "The payout could not be sent. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const runRefreshStatus = async (payout: PayoutRow) => {
    setRefreshingId(payout.id);
    try {
      const { data, error } = await supabase.functions.invoke("payoneer-payouts", {
        body: { action: "refresh_status", payout_id: payout.id },
      });
      if (error) {
        toast({
          title: "Status check failed",
          description: await resolveEdgeFunctionError(error, "The status could not be checked. Please try again."),
          variant: "destructive",
        });
        return;
      }
      const result = data as { success?: boolean; payout?: PayoutRow; error?: string } | null;
      if (!result?.success) {
        toast({
          title: "Status check failed",
          description: result?.error ?? "The status could not be checked. Please try again.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Status updated",
        description: `Latest status: ${result.payout?.status ?? payout.status}`,
      });
      await loadPayouts();
    } catch (error) {
      toast({
        title: "Status check failed",
        description: await resolveEdgeFunctionError(error, "The status could not be checked. Please try again."),
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const refreshAll = async () => {
    setIsBusy(true);
    try {
      await Promise.all([loadStatus(), loadPayouts()]);
    } finally {
      setIsBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">
            Payoneer Payouts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Payoneer partner payouts. Administrators only.
          </p>
        </div>

        {status && !status.configured && (
          <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>Payoneer payouts — awaiting partner credentials</AlertTitle>
            <AlertDescription>
              Payouts cannot be sent until Payoneer issues partner credentials for
              BMaGlass Pay. This page is fully ready for them — once the credentials
              are added, payouts, status checks and the payee registration link will
              work here with no further changes.
            </AlertDescription>
          </Alert>
        )}

        {status?.configured && status.env === "sandbox" && (
          <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>Sandbox — simulated money</AlertTitle>
            <AlertDescription>
              This panel is connected to the Payoneer sandbox. Responses are
              simulated by Payoneer and no real money moves.
            </AlertDescription>
          </Alert>
        )}

        {status && !status.enabled && (
          <Alert className="mb-6">
            <Globe2 className="h-4 w-4" />
            <AlertTitle>Payoneer payouts are switched off</AlertTitle>
            <AlertDescription>
              This rail is switched off in platform settings. Payouts will not be
              sent until it is switched back on.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>New Payoneer payout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payoneer-payee-id">Payee ID</Label>
                  <Input
                    id="payoneer-payee-id"
                    value={payeeId}
                    onChange={(e) => setPayeeId(e.target.value)}
                    placeholder="Payoneer payee ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payoneer-amount">Amount</Label>
                  <Input
                    id="payoneer-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payoneer-description">Description (optional)</Label>
                <Input
                  id="payoneer-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this payout is for"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={runCreatePayout} disabled={isBusy || refreshingId !== null}>
                  <Send className="h-4 w-4 mr-2" /> Create payout
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payoneer status</CardTitle>
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
                {status?.env ? (
                  <Badge variant="outline">{status.env}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Payouts rail</span>
                {status ? (
                  <Badge variant={status.enabled ? "default" : "destructive"}>
                    {status.enabled ? "Enabled" : "Switched off"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Registration link</span>
                <Badge variant="outline">
                  {status?.registration_link_configured ? "Configured" : "Not configured"}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground">Webhook URL</p>
                {status?.webhook_url ? (
                  <div className="flex items-start gap-2">
                    <p className="font-mono text-xs break-all flex-1">{status.webhook_url}</p>
                    <Button variant="outline" size="sm" onClick={copyWebhookUrl}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>

              <div className="space-y-2">
                <Button variant="outline" onClick={runRegistrationLink} disabled={isBusy || refreshingId !== null} className="w-full">
                  <Link2 className="h-4 w-4 mr-2" /> Get registration link
                </Button>
                {registrationUrl && (
                  <p className="font-mono text-xs break-all">
                    <a href={registrationUrl} target="_blank" rel="noreferrer" className="underline">
                      {registrationUrl}
                    </a>
                  </p>
                )}
                {registrationNote && (
                  <p className="text-sm text-muted-foreground">{registrationNote}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Payouts</CardTitle>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isBusy || refreshingId !== null}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Payoneer payouts yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider ID</TableHead>
                    <TableHead>Debit state</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(p.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{p.payee_id}</span>
                        {p.description ? (
                          <span className="block text-xs text-muted-foreground mt-1">{p.description}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {p.currency} {Number(p.amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                        {p.provider_status ? (
                          <span className="block text-xs text-muted-foreground mt-1">{p.provider_status}</span>
                        ) : null}
                        {p.error ? (
                          <span className="block text-xs text-destructive mt-1">{p.error}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.provider_payout_id ?? "—"}</TableCell>
                      <TableCell>{p.debit_state ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runRefreshStatus(p)}
                          disabled={isBusy || refreshingId !== null}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                        </Button>
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

export default AdminPayoneer;
