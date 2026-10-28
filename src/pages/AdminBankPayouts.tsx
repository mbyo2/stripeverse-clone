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
import { bankAccountNameMatches, bankWithdrawalStatusLabel } from "@/utils/bankPayout";
import { AlertTriangle, Landmark, RefreshCw } from "lucide-react";

interface BankQueueRow {
  id: string;
  user_id: string;
  owner_email: string | null;
  holder_name: string | null;
  amount: number;
  currency: string;
  fee_amount: number;
  bank_name: string;
  bank_code: string | null;
  account_name: string;
  account_number: string;
  status: string;
  failure_reason: string | null;
  external_reference: string | null;
  created_at: string;
}

interface QueueTotals {
  pending_review_count: number;
  pending_review_zmw: number;
  approved_count: number;
  approved_zmw: number;
}

const statusVariant = (status: string) => {
  switch (status) {
    case "paid_out":
      return "default" as const;
    case "rejected":
    case "failed":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
};

const money = (value: number) => `K${Number(value ?? 0).toFixed(2)}`;

/**
 * Bank payout queue — the operator side of bank withdrawals
 * (migration 20261245). A withdrawal arrives here already RESERVED
 * (the money has left the user's wallet and is held): approve it
 * and an operator pays it from the platform's bank account, then
 * mark it paid with the bank's reference. Reject or fail refunds
 * the full reservation to the user's wallet in the same action.
 * Every transition runs through the transition RPC (which owns
 * the lifecycle and re-checks the admin role) via the bank-payout
 * function, and is audit-logged.
 */
const AdminBankPayouts = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<BankQueueRow[]>([]);
  const [totals, setTotals] = useState<QueueTotals | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { reason: string; reference: string }>>({});

  const loadQueue = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("bank-payout", {
      body: { action: "admin_list" },
    });
    if (error) {
      const message = await resolveEdgeFunctionError(
        error,
        "The bank payout queue could not be loaded. Please try again.",
      );
      setLoadError(message);
      return;
    }
    setLoadError(null);
    setRows((data?.withdrawals ?? []) as BankQueueRow[]);
    setTotals((data?.totals ?? null) as QueueTotals | null);
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadQueue();
      setIsLoading(false);
    })();
  }, [loadQueue]);

  const draftFor = (id: string) => drafts[id] ?? { reason: "", reference: "" };
  const setDraft = (id: string, patch: Partial<{ reason: string; reference: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  const transition = async (
    row: BankQueueRow,
    action: "approve" | "reject" | "mark_paid" | "fail",
  ) => {
    const draft = draftFor(row.id);
    setBusyId(row.id);
    const { data, error } = await supabase.functions.invoke("bank-payout", {
      body: {
        action: "admin_transition",
        withdrawal_id: row.id,
        transition: action,
        reason: draft.reason.trim() || undefined,
        external_reference: draft.reference.trim() || undefined,
      },
    });
    setBusyId(null);
    if (error || !data?.success) {
      const message = error
        ? await resolveEdgeFunctionError(error, "The action could not be completed.")
        : data?.error ?? "The action could not be completed.";
      toast({ title: "Action not completed", description: message, variant: "destructive" });
      await loadQueue();
      return;
    }
    toast({
      title:
        action === "approve"
          ? "Withdrawal approved"
          : action === "mark_paid"
            ? "Marked as paid"
            : "Withdrawal closed and refunded",
      description:
        action === "approve"
          ? "Pay it from the platform bank account, then mark it paid with the bank reference."
          : undefined,
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[row.id];
      return next;
    });
    await loadQueue();
  };

  const actionable = rows.filter(
    (r) => r.status === "pending_review" || r.status === "approved",
  );
  const settled = rows.filter(
    (r) => r.status !== "pending_review" && r.status !== "approved",
  );

  const renderRow = (row: BankQueueRow) => {
    const draft = draftFor(row.id);
    const busy = busyId === row.id;
    const isOpen = row.status === "pending_review" || row.status === "approved";
    const nameMismatch =
      !!row.holder_name && !bankAccountNameMatches(row.account_name, row.holder_name);
    return (
      <TableRow key={row.id}>
        <TableCell className="align-top">
          <div className="font-medium">{row.owner_email ?? row.user_id}</div>
          {row.holder_name && (
            <div className="text-xs text-muted-foreground">{row.holder_name}</div>
          )}
          <div className="text-xs text-muted-foreground">
            {new Date(row.created_at).toLocaleString()}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <div className="font-medium">{money(row.amount)}</div>
          {row.fee_amount > 0 && (
            <div className="text-xs text-muted-foreground">
              + {money(row.fee_amount)} fee
            </div>
          )}
        </TableCell>
        <TableCell className="align-top">
          <div className="font-medium">
            {row.bank_name} · {row.account_number}
          </div>
          <div className="text-xs text-muted-foreground">
            Account name: {row.account_name}
          </div>
          {nameMismatch && (
            <div className="flex items-center gap-1 text-xs text-destructive mt-1">
              <AlertTriangle className="h-3 w-3" />
              Name differs from the account holder's — review carefully.
            </div>
          )}
          {row.external_reference && (
            <div className="text-xs text-muted-foreground">
              Bank ref: {row.external_reference}
            </div>
          )}
          {row.failure_reason && (
            <div className="text-xs text-destructive">{row.failure_reason}</div>
          )}
        </TableCell>
        <TableCell className="align-top">
          <Badge variant={statusVariant(row.status)}>
            {bankWithdrawalStatusLabel(row.status)}
          </Badge>
        </TableCell>
        {isOpen && (
          <TableCell className="align-top min-w-[240px]">
            <div className="space-y-2">
              {row.status === "approved" && (
                <div className="space-y-1">
                  <Label className="text-xs">Bank reference (required to mark paid)</Label>
                  <Input
                    value={draft.reference}
                    onChange={(e) => setDraft(row.id, { reference: e.target.value })}
                    placeholder="e.g. the bank's transfer reference"
                    className="h-9"
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">
                  Reason (required to reject or fail — the user sees it)
                </Label>
                <Input
                  value={draft.reason}
                  onChange={(e) => setDraft(row.id, { reason: e.target.value })}
                  placeholder="Why this can't be paid"
                  className="h-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status === "pending_review" && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void transition(row, "approve")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || !draft.reason.trim()}
                      onClick={() => void transition(row, "reject")}
                    >
                      Reject & refund
                    </Button>
                  </>
                )}
                {row.status === "approved" && (
                  <Button
                    size="sm"
                    disabled={busy || !draft.reference.trim()}
                    onClick={() => void transition(row, "mark_paid")}
                  >
                    Mark paid
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !draft.reason.trim()}
                  onClick={() => void transition(row, "fail")}
                >
                  Fail & refund
                </Button>
              </div>
            </div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold flex items-center gap-2">
              <Landmark className="h-7 w-7" /> Bank Payouts
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Withdrawals to Zambian bank accounts. The money is reserved when
              the user requests — approve, pay from the platform bank account,
              then mark paid with the bank's reference.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadQueue()}
            disabled={isLoading}
            className="rounded-full"
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {loadError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Couldn't load the queue</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {totals && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Waiting for review</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{totals.pending_review_count}</p>
                <p className="text-sm text-muted-foreground">
                  {money(totals.pending_review_zmw)} reserved
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Approved — to pay</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{totals.approved_count}</p>
                <p className="text-sm text-muted-foreground">
                  {money(totals.approved_zmw)} to send to banks
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Needs action</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : actionable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bank withdrawals are waiting. New requests appear here as
                users make them.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{actionable.map(renderRow)}</TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {settled.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Settled</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{settled.map(renderRow)}</TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AdminBankPayouts;
