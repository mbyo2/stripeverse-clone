
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ArrowDownLeft, Wallet, Copy, Check } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { QRCodeSVG } from "qrcode.react";

interface WalletBalanceProps {
  onSendMoney: () => void;
  onReceiveMoney?: () => void;
}

const WalletBalance = ({ onSendMoney }: WalletBalanceProps) => {
  const { wallet, isLoading } = useWallet();
  const { user } = useAuth();
  const { formatAmount } = useCurrency();
  const { toast } = useToast();
  const [showReceive, setShowReceive] = useState(false);
  const [copied, setCopied] = useState(false);

  const walletAddress = user?.id ? `bmaglass:${user.id.slice(0, 8)}` : "";
  const userPhone = user?.user_metadata?.phone || user?.email || "N/A";

  const handleCopy = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    toast({ title: "Copied!", description: "Wallet address copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <Card className="mb-8 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
        <CardContent className="p-6 animate-pulse">
          <div className="h-6 w-32 bg-primary-foreground/20 rounded mb-4"></div>
          <div className="h-10 w-48 bg-primary-foreground/20 rounded mb-4"></div>
          <div className="flex space-x-4">
            <div className="h-10 w-20 bg-primary-foreground/20 rounded"></div>
            <div className="h-10 w-20 bg-primary-foreground/20 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-8 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground transform hover:scale-105 transition-all duration-300">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium opacity-90 flex items-center">
            <Wallet className="mr-2 h-4 w-4" />
            Available Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold mb-4">
            {formatAmount(wallet?.balance || 0)}
          </div>
          <div className="flex space-x-4">
            <Button
              onClick={onSendMoney}
              variant="secondary"
              className="flex-1"
            >
              <ArrowUpRight className="mr-2 h-4 w-4" /> Send
            </Button>
            <Button
              onClick={() => setShowReceive(true)}
              variant="secondary"
              className="flex-1"
            >
              <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receive Money</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-4 py-4">
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={walletAddress} size={180} />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Share this QR code or wallet address to receive payments
            </p>
            <div className="flex items-center gap-2 w-full bg-muted rounded-md px-3 py-2">
              <code className="text-sm flex-1 truncate">{walletAddress}</code>
              <Button variant="ghost" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Account: {userPhone}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WalletBalance;
