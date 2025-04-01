import { useState, useEffect } from "react";
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
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const { toast } = useToast();
  
  // Fetch payment details from BTCPay Server
  useEffect(() => {
    const fetchPaymentDetails = async () => {
      setIsLoading(true);
      
      try {
        // Generate a unique order ID
        const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        
        // Call our BTCPay Server edge function to create an invoice
        const { data, error } = await supabase.functions.invoke('btc-payment', {
          body: {
            amount: amount,
            currency: 'USD',
            orderId: orderId,
            redirectUrl: window.location.origin + '/dashboard'
          }
        });
        
        if (error) {
          throw new Error(error.message || 'Failed to generate Bitcoin payment details');
        }
        
        if (!data) {
          throw new Error('No response from payment server');
        }
        
        // Set the payment details
        setBitcoinAmount(data.amount);
        setBitcoinAddress(data.bitcoinAddress);
        setLightningInvoice(data.lightningInvoice);
        setInvoiceId(data.id);
        setCheckoutUrl(data.checkoutUrl);
        
        // Calculate expiry time
        const expiryTime = new Date(data.expirationTime);
        const secondsRemaining = Math.max(0, Math.floor((expiryTime.getTime() - Date.now()) / 1000));
        setTimeRemaining(secondsRemaining || 900); // Default to 15 minutes if not provided
        
        toast({
          title: "Payment details generated",
          description: "You can now pay with Bitcoin or Lightning.",
        });
      } catch (error) {
        console.error("Error fetching payment details:", error);
        toast({
          title: "Error",
          description: "Failed to generate payment details. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchPaymentDetails();
    
    // Start countdown timer
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
  
  // Check payment status periodically (as a fallback to webhooks)
  useEffect(() => {
    if (!invoiceId || isLoading) return;
    
    const checkPaymentStatus = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('btc-payment', {
          method: 'GET',
          body: { invoiceId }
        });
        
        if (error) {
          console.error("Error checking payment status:", error);
          return;
        }
        
        if (data.status === "paid") {
          handlePaymentConfirmed();
        }
      } catch (error) {
        console.error("Error checking payment status:", error);
      }
    };
    
    // Poll every 30 seconds as a fallback (webhooks are more efficient)
    const statusInterval = setInterval(checkPaymentStatus, 30000);
    
    // Initial check
    checkPaymentStatus();
    
    return () => clearInterval(statusInterval);
  }, [invoiceId, isLoading]);
  
  const handlePaymentConfirmed = () => {
    toast({
      title: "Payment Received!",
      description: "Your Bitcoin payment has been confirmed.",
    });
    
    onSuccess({
      paymentId: invoiceId,
      method: paymentMethod === "bitcoin" ? "bitcoin" : "lightning",
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
      
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (checkoutUrl) {
              window.open(checkoutUrl, "_blank");
            }
          }}
        >
          Open in BTCPay Server
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default BitcoinPayment;
