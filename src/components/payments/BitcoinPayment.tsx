
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
  const { toast } = useToast();
  
  // Simulate fetching payment details from BTCPay Server
  useEffect(() => {
    const fetchPaymentDetails = async () => {
      setIsLoading(true);
      
      try {
        // In a real implementation, you would call your backend which would then
        // create an invoice via BTCPay Server API
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Mock exchange rate: 1 BTC = $50,000 USD
        const exchangeRate = 50000;
        // Convert to BTC
        const btcAmount = amount / exchangeRate;
        
        setBitcoinAmount(btcAmount);
        setBitcoinAddress("bc1q84x0yrztvcjgp6n3k4edwv02k8wsh75d5xqmmx"); // Example address
        setLightningInvoice("lnbc10u1p3hkhmtpp5dzywf4pqn9mf0y9ypsncn2ww2dskvkpjg3yzawsu2deh5gyafqdqqcqzzsxqyz5vqsp5hwmcps58070p0k9enz9rp8296nkur5rgwff2ne2whq0hh37nvhs9qyyssqxmxs8whfnnf7l7ftsw0dlw7tan4q4z0vxa4j3qx7s3dkhazjrx32y56wd4kxm4r08vg3hprn2uvpnxhkgxmy36wnfyv3q0j68qc5hpgpv328ak");
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
    
    // Simulate checking for payment confirmation
    const checkInterval = setInterval(() => {
      // In a real app, you would poll your backend to check if the payment was received
      
      // Randomly succeed after some time for demo purposes
      if (Math.random() < 0.1 && !isLoading) {
        clearInterval(checkInterval);
        handlePaymentConfirmed();
      }
    }, 5000);
    
    return () => {
      clearInterval(timer);
      clearInterval(checkInterval);
    };
  }, [amount, toast]);
  
  const handlePaymentConfirmed = () => {
    toast({
      title: "Payment Received!",
      description: "Your Bitcoin payment has been confirmed.",
    });
    
    onSuccess({
      paymentId: `BTC-${Date.now()}`,
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
            // In a real app, this would open a direct link to the BTCPay server checkout page
            window.open("https://btcpay.example.com/checkout", "_blank");
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
