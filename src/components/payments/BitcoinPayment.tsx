import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, CheckCircle, ExternalLink, QrCode } from "lucide-react";
import { formatBitcoinAmount, formatCurrency } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import QRCode from 'qrcode.react';
import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";

interface BitcoinPaymentProps {
  amount: number;
  onSuccess: (response: { paymentId: string; method: string; status: string }) => void;
  onCancel: () => void;
}

const BitcoinPayment = ({ amount, onSuccess, onCancel }: BitcoinPaymentProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [bitcoinAmount, setBitcoinAmount] = useState(0);
  const [bitcoinAddress, setBitcoinAddress] = useState("");
  const [lightningInvoice, setLightningInvoice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"bitcoin" | "lightning">("bitcoin");
  const [timeRemaining, setTimeRemaining] = useState(900); // 15 minutes in seconds
  const [copied, setCopied] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [lightningPaymentId, setLightningPaymentId] = useState("");
  const confirmedRef = useRef(false);
  const { toast } = useToast();
  
  useEffect(() => {
    const fetchPaymentDetails = async () => {
      setIsLoading(true);

      try {
        // Use the real btc-onchain function (not the legacy btc-payment one).
        // Generates a fresh address from BTC_XPUB for this checkout.
        const { data, error } = await supabase.functions.invoke('btc-onchain', {
          body: { action: 'receive' }
        });

        if (error) {
          // Rethrow the invoke error untouched: wrapping it in a new
          // Error would discard error.context, which is where the
          // function's own { error } message lives (e.g. the custody
          // refusal) — resolveEdgeFunctionError needs it intact.
          throw error;
        }

        if (!data || !data.address) {
          throw new Error('No address returned from payment server');
        }

        setBitcoinAddress(data.address);
        setInvoiceId(data.record?.id || `btc-${Date.now()}`);
        setTimeRemaining(900); // 15 min invoice window

        // Lightning invoice via Breez. The amount is in ZMW; convert at
        // the real BTC/ZMW rate via btc-trade's quote (the same price
        // path the wallet's Buy flow uses — no fixed-rate conversions).
        try {
          const { data: quote } = await supabase.functions.invoke('btc-trade', {
            body: { action: 'quote', side: 'buy', amount_zmw: amount }
          });
          if (quote?.amount_sats) {
            // The quote is the authoritative BTC amount for this
            // checkout — display it so the payer sends the right sum
            // (previously fetched but never shown: the UI said 0 BTC).
            setBitcoinAmount(quote.amount_sats / 100_000_000);
            const { data: lnData } = await supabase.functions.invoke('breez-lightning', {
              body: { action: 'create_invoice', amount_sats: quote.amount_sats }
            });
            if (lnData?.bolt11) {
              setLightningInvoice(lnData.bolt11);
              // Kept so the status poller below can settle THIS invoice.
              if (lnData.payment_id) setLightningPaymentId(lnData.payment_id);
            }
          }
        } catch {
          // Lightning optional — on-chain still works
        }

        toast({
          title: "Payment details generated",
          description: "You can now pay with Bitcoin or Lightning.",
        });
      } catch (error) {
        console.error("Error fetching payment details:", error);
        toast({
          title: "Error",
          description: await resolveEdgeFunctionError(error, "Failed to generate payment details. Please try again."),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchPaymentDetails();
    
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => {
      clearInterval(timer);
    };
  }, [amount, toast]);
  
  useEffect(() => {
    if ((!bitcoinAddress && !lightningPaymentId) || isLoading) return;

    const checkOnchainStatus = async () => {
      if (confirmedRef.current || !bitcoinAddress) return;
      try {
        // Deposit detection runs server-side: the btc-onchain
        // check_deposits pg_cron scans assigned addresses every
        // 5 minutes and records credited deposits in btc_deposits
        // (credited at 1 confirmation). Poll for this address's row.
        // btc_deposits is not in the generated types — untyped access
        // is the codebase pattern for such tables.
        const { data, error } = await (supabase as any)
          .from('btc_deposits')
          .select('status')
          .eq('address', bitcoinAddress)
          .eq('status', 'credited')
          .limit(1);

        if (error) {
          console.error("Error checking payment status:", error);
          return;
        }

        if (data && data.length > 0) {
          handlePaymentConfirmed("bitcoin");
        }
      } catch (error) {
        console.error("Error checking payment status:", error);
      }
    };

    const checkLightningStatus = async () => {
      if (confirmedRef.current || !lightningPaymentId) return;
      try {
        // Settlement happens inside breez-lightning's check_status
        // (exactly-once RPC); 'paid' here means the wallet was
        // actually credited.
        const { data } = await supabase.functions.invoke('breez-lightning', {
          body: { action: 'check_status', breez_invoice_id: lightningPaymentId }
        });
        if (data?.status === 'paid') {
          handlePaymentConfirmed("lightning");
        }
      } catch (error) {
        console.error("Error checking Lightning status:", error);
      }
    };

    const statusInterval = setInterval(() => {
      checkOnchainStatus();
      checkLightningStatus();
    }, 15000);

    checkOnchainStatus();
    checkLightningStatus();

    return () => clearInterval(statusInterval);
  }, [bitcoinAddress, lightningPaymentId, isLoading]);

  const handlePaymentConfirmed = (method: "bitcoin" | "lightning") => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    toast({
      title: "Payment Received!",
      description: "Your Bitcoin payment has been confirmed.",
    });

    onSuccess({
      paymentId: invoiceId,
      method,
      status: "success",
    });
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    
    toast({
      title: "Copied to clipboard",
      description: paymentMethod === "bitcoin" ? "Bitcoin address copied" : "Lightning invoice copied",
    });
    
    setTimeout(() => setCopied(false), 3000);
  };
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };
  
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="mt-4">Generating payment details...</p>
      </div>
    );
  }
  
  if (timeRemaining <= 0) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertDescription>
            This payment request has expired. Please generate a new one.
          </AlertDescription>
        </Alert>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => window.location.reload()}>
            Generate New Payment
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="text-center mb-2">
        <p className="text-lg font-medium">Pay {formatCurrency(amount)}</p>
        <p className="text-primary font-bold text-xl">
          {formatBitcoinAmount(bitcoinAmount)}
        </p>
        <div className="text-sm text-muted-foreground mt-1">
          Payment expires in <span className="font-medium">{formatTime(timeRemaining)}</span>
        </div>
      </div>
      
      <Tabs defaultValue="bitcoin" onValueChange={(value) => setPaymentMethod(value as "bitcoin" | "lightning")}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="bitcoin">Bitcoin</TabsTrigger>
          <TabsTrigger value="lightning">Lightning</TabsTrigger>
        </TabsList>
        
        <TabsContent value="bitcoin" className="space-y-4 pt-4">
          <div className="bg-muted p-4 rounded-lg flex flex-col items-center">
            <QRCode 
              value={bitcoinAddress}
              size={180}
              level="H"
              includeMargin={true}
              className="mb-4"
            />
            
            <div className="w-full">
              <Label htmlFor="btc-address" className="sr-only">Bitcoin Address</Label>
              <div className="relative">
                <Input
                  id="btc-address"
                  value={bitcoinAddress}
                  readOnly
                  className="pr-24 font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => copyToClipboard(bitcoinAddress)}
                >
                  {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          
          <Alert>
            <AlertDescription>
              Send exactly {formatBitcoinAmount(bitcoinAmount)} to the address above. The transaction will be confirmed after 1 confirmation.
            </AlertDescription>
          </Alert>
        </TabsContent>
        
        <TabsContent value="lightning" className="space-y-4 pt-4">
          <div className="bg-muted p-4 rounded-lg flex flex-col items-center">
            <QRCode 
              value={lightningInvoice}
              size={180}
              level="H"
              includeMargin={true}
              className="mb-4"
            />
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => copyToClipboard(lightningInvoice)}
            >
              {copied ? "Copied!" : "Copy Invoice"}
              {copied ? <CheckCircle className="ml-2 h-4 w-4" /> : <Copy className="ml-2 h-4 w-4" />}
            </Button>
            
            <Button
              variant="link"
              className="mt-2"
              onClick={() => {
                window.open(`lightning:${lightningInvoice}`, '_blank');
              }}
            >
              Open in Lightning Wallet
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>
          
          <Alert>
            <AlertDescription>
              Pay this Lightning invoice using your Lightning wallet. The payment will be confirmed instantly.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
      
      <div className="flex justify-start pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default BitcoinPayment;
