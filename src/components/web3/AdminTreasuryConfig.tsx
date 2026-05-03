import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAIN_LABELS, SUPPORTED_CHAINS } from "@/lib/web3/wagmiConfig";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";

type Row = {
  id: string;
  chain_id: number;
  safe_address: string;
  label: string | null;
  active: boolean;
};

export const AdminTreasuryConfig = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [chainId, setChainId] = useState<string>(String(SUPPORTED_CHAINS[0].id));
  const [safeAddress, setSafeAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crypto_treasury_config")
      .select("id, chain_id, safe_address, label, active")
      .order("chain_id");
    if (error) toast.error(error.message);
    else setRows((data as Row[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(safeAddress)) {
      toast.error("Invalid address");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("crypto_treasury_config").upsert(
      {
        chain_id: Number(chainId),
        safe_address: safeAddress.toLowerCase(),
        label: label || null,
        active: true,
      },
      { onConflict: "chain_id" }
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Treasury saved");
    setSafeAddress("");
    setLabel("");
    load();
  };

  const toggleActive = async (r: Row) => {
    const { error } = await supabase
      .from("crypto_treasury_config")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("crypto_treasury_config").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removed"); load(); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add / update treasury safe</CardTitle>
          <CardDescription>Configure the on-chain Safe (multisig) used to send payouts per chain.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Chain</Label>
              <Select value={chainId} onValueChange={setChainId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CHAINS.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {CHAIN_LABELS[c.id] ?? c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Safe address (0x…)</Label>
              <Input value={safeAddress} onChange={(e) => setSafeAddress(e.target.value)} placeholder="0x..." />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main treasury" />
            </div>
          </div>
          <Button onClick={add} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save treasury
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configured treasuries</CardTitle>
          <CardDescription>One Safe per chain. Toggle active to enable/disable for payouts.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No treasuries configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chain</TableHead>
                  <TableHead>Safe</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{CHAIN_LABELS[r.chain_id] ?? r.chain_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.safe_address}</TableCell>
                    <TableCell>{r.label ?? "—"}</TableCell>
                    <TableCell>
                      <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};