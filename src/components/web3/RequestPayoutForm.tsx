import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CHAIN_LABELS, NATIVE_SYMBOLS, SUPPORTED_CHAINS, USDC_ADDRESSES } from "@/lib/web3/wagmiConfig";
import { isAddress } from "viem";
import { Loader2 } from "lucide-react";

export const RequestPayoutForm = ({ onSubmitted }: { onSubmitted?: () => void }) => {
  const { user } = useAuth();
  const [chainId, setChainId] = useState<number>(SUPPORTED_CHAINS[1].id); // Base default
  const [token, setToken] = useState<"USDC" | "NATIVE">("USDC");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user) return;
    if (!isAddress(destination)) return toast.error("Invalid destination address");
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a positive amount");

    setBusy(true);
    const symbol = token === "USDC" ? "USDC" : NATIVE_SYMBOLS[chainId] ?? "ETH";
    const tokenAddress = token === "USDC" ? USDC_ADDRESSES[chainId] : null;

    const { error } = await supabase.from("crypto_payout_requests").insert({
      user_id: user.id,
      chain_id: chainId,
      token_symbol: symbol,
      token_address: tokenAddress,
      amount: amt,
      destination_address: destination.toLowerCase(),
      status: "pending",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Payout request submitted for admin approval");
    setAmount("");
    setDestination("");
    onSubmitted?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request crypto payout</CardTitle>
        <CardDescription>Funds will be sent from the platform treasury after admin approval.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Chain</Label>
            <Select value={String(chainId)} onValueChange={(v) => setChainId(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_CHAINS.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{CHAIN_LABELS[c.id]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Token</Label>
            <Select value={token} onValueChange={(v) => setToken(v as "USDC" | "NATIVE")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USDC">USDC</SelectItem>
                <SelectItem value="NATIVE">{NATIVE_SYMBOLS[chainId] ?? "Native"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dest">Destination address</Label>
          <Input id="dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="0x…" className="font-mono" />
        </div>
        <Button onClick={submit} disabled={busy} className="w-full">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit payout request
        </Button>
      </CardContent>
    </Card>
  );
};