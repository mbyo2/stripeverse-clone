import { useState } from "react";
import { useAccount, useSignMessage, useChainId } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CHAIN_LABELS } from "@/lib/web3/wagmiConfig";
import { Loader2 } from "lucide-react";

export const LinkAddressCard = ({ onLinked }: { onLinked?: () => void }) => {
  const { user } = useAuth();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const linkAddress = async () => {
    if (!user || !address) return;
    setBusy(true);
    try {
      const nonce = crypto.randomUUID();
      const { error: nonceErr } = await supabase
        .from("crypto_address_nonces")
        .insert({ user_id: user.id, address: address.toLowerCase(), nonce });
      if (nonceErr) throw nonceErr;

      const message = `BMaGlass Pay — link wallet\n\nAddress: ${address}\nUser: ${user.id}\nNonce: ${nonce}`;
      const signature = await signMessageAsync({ account: address, message });

      const { error } = await supabase.from("vendor_crypto_wallets").upsert(
        {
          user_id: user.id,
          chain_id: chainId,
          address: address.toLowerCase(),
          label: label || null,
          signature,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "user_id,chain_id,address" }
      );
      if (error) throw error;

      toast.success("Wallet linked and verified");
      setLabel("");
      onLinked?.();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to link wallet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link a crypto wallet</CardTitle>
        <CardDescription>
          Connect an EVM wallet (MetaMask, Coinbase, WalletConnect) and sign a message to prove ownership.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectButton />
        {isConnected && address && (
          <div className="space-y-3 pt-2">
            <div className="text-sm text-muted-foreground">
              Connected on <span className="font-medium text-foreground">{CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Payout wallet" />
            </div>
            <Button onClick={linkAddress} disabled={busy} className="w-full">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign & link this address
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};