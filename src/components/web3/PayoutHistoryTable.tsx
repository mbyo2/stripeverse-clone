import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHAIN_LABELS } from "@/lib/web3/wagmiConfig";

type Row = {
  id: string;
  chain_id: number;
  token_symbol: string;
  amount: number;
  destination_address: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
};

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "sent") return "default";
  if (s === "rejected" || s === "failed") return "destructive";
  if (s === "approved") return "secondary";
  return "outline";
};

export const PayoutHistoryTable = ({ refreshKey }: { refreshKey?: number }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("crypto_payout_requests")
      .select("id, chain_id, token_symbol, amount, destination_address, status, tx_hash, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [user?.id, refreshKey]);

  return (
    <Card>
      <CardHeader><CardTitle>Payout history</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payout requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Token</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>{CHAIN_LABELS[r.chain_id] ?? r.chain_id}</TableCell>
                  <TableCell>{r.token_symbol}</TableCell>
                  <TableCell className="text-right font-mono">{r.amount}</TableCell>
                  <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.tx_hash ? `${r.tx_hash.slice(0, 8)}…` : "—"}
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