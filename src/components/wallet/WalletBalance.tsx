import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ArrowDownLeft, Wallet, Copy, Check, Eye, EyeOff } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { QRCodeSVG } from "qrcode.react";

interface WalletBalanceProps {
  onSendMoney: () => void;
  onReceiveMoney?: () => void;
  /** Scope the balance to a sub-account (null = Main). Omit for legacy behaviour. */
  accountId?: string | null;
}

const WalletBalance = ({ onSendMoney, accountId }: WalletBalanceProps) => {
  const { wallet, isLoading } = useWallet(accountId);
  const { user } = useAuth();
  const { formatAmount } = useCurrency();
  const { toast } = useToast();
  const [showReceive, setShowReceive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showBalance, setShowBalance] = useState(true);

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
      <Card className="mb-8 overflow-hidden rounded-[24px]">
        <div className="bg-primary p-6 md:p-8" role="status" aria-label="Loading balance">
          <div className="flex items-start justify-between mb-6" aria-hidden="true">
            <div>
              <Skeleton className="h-4 w-36 bg-primary-foreground/20 mb-2" />
              <Skeleton className="h-12 w-56 max-w-full bg-primary-foreground/25" />
            </div>
            <Skeleton className="h-8 w-8 rounded-lg bg-primary-foreground/15 shrink-0" />
          </div>
          <div className="flex flex-wrap gap-3" aria-hidden="true">
            <Skeleton className="h-11 w-32 rounded-full bg-primary-foreground/25" />
            <Skeleton className="h-11 w-28 rounded-full bg-primary-foreground/20" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-8 overflow-hidden rounded-[24px]">
        <div className="bg-primary p-6 md:p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="h-4 w-4 text-primary-foreground/70" />
                <span className="text-sm font-medium text-primary-foreground/70">Available Balance</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-4xl md:text-5xl font-display font-semibold text-primary-foreground tracking-tight">
                  {showBalance ? formatAmount(wallet?.balance || 0) : "••••••"}
                </span>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="p-1.5 rounded-lg hover:bg-primary-foreground/10 transition-colors"
                >
                  {showBalance ? (
                    <EyeOff className="h-5 w-5 text-primary-foreground/70" />
                  ) : (
                    <Eye className="h-5 w-5 text-primary-foreground/70" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={onSendMoney}
              variant="secondary"
              className="h-11 px-5 rounded-full font-semibold bg-white text-primary hover:bg-white/90"
            >
              <ArrowUpRight className="mr-2 h-4 w-4" /> Send Money
            </Button>
            <Button
              onClick={() => setShowReceive(true)}
              variant="secondary"
              className="h-11 px-5 rounded-full font-semibold bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/30"
            >
              <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={showReceive} onOpenChange={setShowReceive}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Receive Money</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-5 py-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border">
              <QRCodeSVG value={walletAddress} size={180} />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              Share this QR code or wallet address to receive payments
            </p>
            <div className="flex items-center gap-2 w-full bg-muted rounded-lg px-4 py-3">
              <code className="text-sm flex-1 truncate font-mono">{walletAddress}</code>
              <Button variant="ghost" size="icon" onClick={handleCopy} className="shrink-0">
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
