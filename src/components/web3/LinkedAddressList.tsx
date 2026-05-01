import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Star } from "lucide-react";
import { toast } from "sonner";
import { CHAIN_LABELS } from "@/lib/web3/wagmiConfig";

type Wallet = {
  id: string;
  chain_id: number;
  address: string;
  label: string | null;
  is_primary: boolean;
  verified_at: string | null;
};

export const LinkedAddressList = ({ refreshKey }: { refreshKey?: number }) => {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vendor_crypto_wallets")
      .select("id, chain_id, address, label, is_primary, verified_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setWallets(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshKey]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("vendor_crypto_wallets").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Removed");
      load();
    }
  };

  const setPrimary = async (id: string) => {
    if (!user) return;
    await supabase.from("vendor_crypto_wallets").update({ is_primary: false }).eq("user_id", user.id);
    const { error } = await supabase.from("vendor_crypto_wallets").update({ is_primary: true }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Primary updated");
      load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked addresses</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No addresses linked yet.</p>
        ) : (
          <ul className="space-y-3">
            {wallets.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{w.label || "Unnamed"}</span>
                    {w.is_primary && <Badge variant="default">Primary</Badge>}
                    <Badge variant="secondary">{CHAIN_LABELS[w.chain_id] ?? `Chain ${w.chain_id}`}</Badge>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground truncate">{w.address}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!w.is_primary && (
                    <Button size="icon" variant="ghost" onClick={() => setPrimary(w.id)} title="Make primary">
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => remove(w.id)} title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};