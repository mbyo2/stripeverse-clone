import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHAIN_LABELS } from "@/lib/web3/wagmiConfig";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Row = {
  id: string;
  user_id: string;
  chain_id: number;
  token_symbol: string;
  token_address: string | null;
  amount: number;
  destination_address: string;
  status: string;
  tx_hash: string | null;
  admin_notes: string | null;
  created_at: string;
};

export const AdminCryptoPayouts = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "sent">("pending");
  const [txInputs, setTxInputs] = useState<Record<string, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const load = async () => {
    let q = supabase
      .from("crypto_payout_requests")
      .select("id, user_id, chain_id, token_symbol, token_address, amount, destination_address, status, tx_hash, admin_notes, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows((data as Row[]) ?? []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const update = async (id: string, patch: Partial<Row>) => {
    const { error } = await supabase
      .from("crypto_payout_requests")
      .update({ ...patch, processed_by: user?.id ?? null, processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      load();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Crypto payouts</CardTitle>
        <div className="flex gap-1">
          {(["pending", "approved", "sent", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
              {s}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests in this view.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Chain / Token</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">
                    {CHAIN_LABELS[r.chain_id] ?? r.chain_id} · {r.token_symbol}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.amount}</TableCell>
                  <TableCell className="font-mono text-xs">{r.destination_address.slice(0, 10)}…{r.destination_address.slice(-4)}</TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell className="space-y-1">
                    {r.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => update(r.id, { status: "approved" })}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => update(r.id, { status: "rejected", admin_notes: noteInputs[r.id] || null })}>Reject</Button>
                      </div>
                    )}
                    {r.status === "approved" && (
                      <div className="flex gap-1">
                        <Input
                          placeholder="0xtxhash…"
                          value={txInputs[r.id] ?? ""}
                          onChange={(e) => setTxInputs({ ...txInputs, [r.id]: e.target.value })}
                          className="h-8 w-44 font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          disabled={!txInputs[r.id]}
                          onClick={() => update(r.id, { status: "sent", tx_hash: txInputs[r.id] })}
                        >Mark sent</Button>
                      </div>
                    )}
                    {(r.status === "pending" || r.status === "approved") && (
                      <Input
                        placeholder="Admin notes (optional)"
                        value={noteInputs[r.id] ?? r.admin_notes ?? ""}
                        onChange={(e) => setNoteInputs({ ...noteInputs, [r.id]: e.target.value })}
                        onBlur={() => noteInputs[r.id] !== undefined && update(r.id, { admin_notes: noteInputs[r.id] })}
                        className="h-8 text-xs"
                      />
                    )}
                    {r.tx_hash && <div className="font-mono text-xs text-muted-foreground">tx: {r.tx_hash.slice(0, 12)}…</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};