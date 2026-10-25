import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Eye, ReceiptText, X } from "lucide-react";
import { listDirectoryUsers, type DirectoryUser } from "@/lib/adminConsole";
import { toUserFacingError } from "@/utils/userFacingError";
import type { Tables } from "@/integrations/supabase/types";

type RefundRow = Tables<"refunds"> & { settlement_transaction_id?: string | null };

const STATUS_FILTERS = ["all", "pending", "completed", "approved", "rejected"] as const;

const statusVariant = (status: string) =>
  status === "completed" || status === "approved"
    ? "default"
    : status === "rejected"
      ? "destructive"
      : "secondary";

const fmtMoney = (currency: string, amount: number) =>
  `${currency} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const AdminRefunds = () => {
  const { toast } = useToast();
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [directoryById, setDirectoryById] = useState<Map<string, DirectoryUser>>(new Map());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RefundRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [refundsRes, directory] = await Promise.all([
        supabase
          .from("refunds")
          .select("*")
          .order("created_at", { ascending: false }),
        listDirectoryUsers(supabase as never).catch(() => []),
      ]);
      if (refundsRes.error) throw refundsRes.error;
      setRefunds((refundsRes.data || []) as RefundRow[]);

      const dirMap = new Map<string, DirectoryUser>();
      directory.forEach((d) =>
        dirMap.set(d.user_id, {
          id: d.user_id,
          email: d.email,
          first_name: d.first_name,
          last_name: d.last_name,
          phone: d.phone,
          created_at: d.created_at,
          roles: [],
          is_frozen: false,
        }),
      );
      setDirectoryById(dirMap);
    } catch (err) {
      setLoadError(
        toUserFacingError(err, "We couldn't load refund requests. Please try again."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    fetchData();
  }, [fetchData]);

  const userName = (userId: string) => {
    const d = directoryById.get(userId);
    const name = [d?.first_name, d?.last_name].filter(Boolean).join(" ");
    return name || d?.email || userId;
  };

  const handleReject = async (refund: RefundRow) => {
    setBusyId(refund.id);
    try {
      // Mirrors useRejectRefund: a status decision only — no money
      // moves when a request is rejected.
      const { error } = await (supabase as any)
        .from("refunds")
        .update({
          status: "rejected",
          rejected_at: new Date().toISOString(),
          approved_by: currentUserId,
        })
        .eq("id", refund.id)
        .eq("status", "pending");
      if (error) throw error;
      toast({
        title: "Refund rejected",
        description: "The refund request has been marked rejected. No money was moved.",
      });
      setSelected(null);
      setConfirmReject(false);
      fetchData();
    } catch (err) {
      toast({
        title: "Couldn't reject that refund",
        description: toUserFacingError(err, "We couldn't reject that refund. Please try again."),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const filtered = refunds.filter(
    (r) => statusFilter === "all" || r.status === statusFilter,
  );
  const pendingCount = refunds.filter((r) => r.status === "pending").length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <ReceiptText className="h-8 w-8" /> Refunds Console
        </h1>
        <p className="text-muted-foreground mb-6">
          Every refund request on the platform ({refunds.length} total, {pendingCount} pending).
        </p>

        <Card className="mb-6">
          <CardContent className="py-4 text-sm text-muted-foreground space-y-2">
            <p>
              <span className="font-medium text-foreground">How refunds settle:</span>{" "}
              a refund is paid by the person who received the original payment — they
              approve the request from their own Refunds page and the money moves from
              their wallet back to the requester through the platform's audited transfer
              path. This console tracks every request platform-wide; it does not move
              money itself.
            </p>
            <p>
              Rejecting a pending request here closes it without moving any money —
              for example when a request is a duplicate or was sent by mistake.
            </p>
          </CardContent>
        </Card>

        {loadError ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-destructive mb-4">{loadError}</p>
              <Button variant="outline" onClick={fetchData}>Try again</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    onClick={() => setStatusFilter(s)}
                    className="capitalize"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {/* Phone: stacked rows (the 7-column table is wider than a
                  phone screen). Tablet and up keep the full table. */}
              <div className="divide-y md:hidden">
                {filtered.map((r) => (
                  <div key={r.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{userName(r.user_id)}</div>
                        {directoryById.get(r.user_id)?.email && (
                          <div className="truncate text-xs text-muted-foreground">
                            {directoryById.get(r.user_id)?.email}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 font-medium">
                        {fmtMoney(r.currency, r.amount)}
                      </div>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {r.reason}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {r.refund_type} ·{" "}
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto shrink-0"
                        onClick={() => {
                          setSelected(r);
                          setConfirmReject(false);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <p className="py-8 text-center text-muted-foreground">
                    No refund requests found
                  </p>
                )}
              </div>
              <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead>Requester</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium">
                        {userName(r.user_id)}
                        {directoryById.get(r.user_id)?.email && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {directoryById.get(r.user_id)?.email}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{fmtMoney(r.currency, r.amount)}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{r.reason}</TableCell>
                      <TableCell>{r.refund_type}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelected(r);
                            setConfirmReject(false);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No refund requests found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
              setConfirmReject(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Refund request</DialogTitle>
              <DialogDescription>
                {selected ? fmtMoney(selected.currency, selected.amount) : ""} —{" "}
                {selected?.reason}
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Requester</span>
                  <span>{userName(selected.user_id)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Type</span>
                  <span>{selected.refund_type}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Original transaction</span>
                  <span className="font-mono text-xs break-all text-right">
                    {selected.transaction_id}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Requested</span>
                  <span>{new Date(selected.created_at).toLocaleString()}</span>
                </div>
                {selected.approved_by && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Decided by</span>
                    <span>{userName(selected.approved_by)}</span>
                  </div>
                )}
                {selected.approved_at && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Decided at</span>
                    <span>{new Date(selected.approved_at).toLocaleString()}</span>
                  </div>
                )}
                {selected.settlement_transaction_id && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Settlement transaction</span>
                    <span className="font-mono text-xs break-all text-right">
                      {selected.settlement_transaction_id}
                    </span>
                  </div>
                )}
                {selected.notes && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Notes</span>
                    <span className="text-right">{selected.notes}</span>
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              {selected?.status === "pending" &&
                (confirmReject ? (
                  <>
                    <Button variant="outline" disabled={busyId === selected.id} onClick={() => setConfirmReject(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busyId === selected.id}
                      onClick={() => handleReject(selected)}
                    >
                      Confirm reject — no money moves
                    </Button>
                  </>
                ) : (
                  <Button variant="destructive" onClick={() => setConfirmReject(true)}>
                    <X className="h-4 w-4 mr-1" />
                    Reject request
                  </Button>
                ))}
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
      <Footer />
    </div>
  );
};

export default AdminRefunds;
