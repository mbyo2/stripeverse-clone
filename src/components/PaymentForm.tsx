import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCardNumber, formatCurrency, isMobileMoneyNumber, validateCardNumber } from "@/lib/utils";
import { CreditCard, Smartphone, Check, AlertCircle, Building } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type PaymentFormProps = {
  amount: number;
  onSuccess?: (response: { 
    paymentId: string; 
    method: string; 
    status: string;
  }) => void;
  onCancel?: () => void;
};

const PaymentForm = ({ amount, onSuccess, onCancel }: PaymentFormProps) => {
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  
  const [mobileProvider, setMobileProvider] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCardNumber(e.target.value);
    setCardNumber(formatted);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    
    // Format as MM/YY
    if (value.length > 2) {
      value = value.substring(0, 2) + '/' + value.substring(2, 4);
    }
    
    setCardExpiry(value);
  };

  const processMobileMoneyPayment = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      
      // Call our Supabase Edge Function for mobile money
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'mobile-money',
          phoneNumber: mobileNumber,
          amount: amount,
          provider: mobileProvider
        }
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to process mobile money payment');
      }
      
      if (data.status === 'failed') {
        throw new Error(data.message || 'Transaction failed');
      }
      
      // Payment successful or pending
      setIsComplete(true);
      
      toast({
        title: "Payment successful",
        description: `Your ${mobileProvider} payment of ${formatCurrency(amount)} has been processed.`,
      });
      
      // Call success callback with payment details
      if (onSuccess) {
        onSuccess({
          paymentId: data.transactionId,
          method: mobileProvider,
          status: data.status
        });
      }
      
    } catch (err) {
      console.error('Mobile money payment error:', err);
      setError(err instanceof Error ? err.message : 'Payment processing failed');
      
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : 'Please try again or use another payment method.',
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  const processCardPayment = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      
      // Call our Supabase Edge Function for card payment
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'card',
          cardNumber: cardNumber.replace(/\s/g, ''),
          expiryDate: cardExpiry,
          cvv: cardCvc,
          amount: amount
        }
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to process card payment');
      }
      
      if (data.status === 'failed') {
        throw new Error(data.message || 'Transaction failed');
      }
      
      // Payment successful
      setIsComplete(true);
      
      toast({
        title: "Payment successful",
        description: `Your card payment of ${formatCurrency(amount)} has been processed.`,
      });
      
      // Call success callback with payment details
      if (onSuccess) {
        onSuccess({
          paymentId: data.transactionId,
          method: `card_${data.cardType}`,
          status: data.status
        });
      }
      
    } catch (err) {
      console.error('Card payment error:', err);
      setError(err instanceof Error ? err.message : 'Payment processing failed');
      
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : 'Please try again or use another payment method.',
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  const processBankTransfer = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      
      // Call our Supabase Edge Function for bank transfer
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'bank-transfer',
          accountNumber: accountNumber,
          bankName: bankName,
          accountName: accountName,
          branchCode: branchCode,
          amount: amount
        }
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to process bank transfer');
      }
      
      // Bank transfers are typically pending initially
      setIsComplete(true);
      
      toast({
        title: "Transfer initiated",
        description: `Your bank transfer of ${formatCurrency(amount)} has been initiated. Reference: ${data.reference}`,
      });
      
      // Call success callback with payment details
      if (onSuccess) {
        onSuccess({
          paymentId: data.transactionId,
          method: `bank_${bankName.toLowerCase()}`,
          status: data.status
        });
      }
      
    } catch (err) {
      console.error('Bank transfer error:', err);
      setError(err instanceof Error ? err.message : 'Transfer initiation failed');
      
      toast({
        title: "Transfer failed",
        description: err instanceof Error ? err.message : 'Please try again or use another payment method.',
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset any previous errors
    setError(null);
    
    // Validate based on payment method
    if (paymentMethod === "card") {
      if (!validateCardNumber(cardNumber)) {
        toast({
          title: "Invalid card number",
          description: "Please check your card details and try again.",
          variant: "destructive",
        });
        return;
      }
      
      if (!cardName || !cardExpiry || !cardCvc) {
        toast({
          title: "Missing information",
          description: "Please fill in all card details.",
          variant: "destructive",
        });
        return;
      }
      
      await processCardPayment();
      
    } else if (paymentMethod === "mobile") {
      if (!mobileProvider) {
        toast({
          title: "Select a provider",
          description: "Please select a mobile money provider.",
          variant: "destructive",
        });
        return;
      }
      
      if (!isMobileMoneyNumber(mobileNumber, mobileProvider)) {
        toast({
          title: "Invalid mobile number",
          description: "Please enter a valid number for the selected provider.",
          variant: "destructive",
        });
        return;
      }
      
      await processMobileMoneyPayment();
      
    } else if (paymentMethod === "bank") {
      if (!bankName) {
        toast({
          title: "Select a bank",
          description: "Please select a bank for the transfer.",
          variant: "destructive",
        });
        return;
      }
      
      if (!accountNumber || accountNumber.length < 8) {
        toast({
          title: "Invalid account number",
          description: "Please enter a valid account number.",
          variant: "destructive",
        });
        return;
      }
      
      if (!accountName) {
        toast({
          title: "Missing account name",
          description: "Please enter the account holder's name.",
          variant: "destructive",
        });
        return;
      }
      
      await processBankTransfer();
    }
  };

  const formatMobileNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only numbers, limit to 10-12 digits
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 12) {
      value = value.substring(0, 12);
    }
    
    // Format display of phone number
    if (value.startsWith('26') && value.length > 5) {
      // Format as +26 XX XXX XXXX
      value = value.replace(/(\d{2})(\d{2})(\d{3})(\d{4})/, '$1 $2 $3 $4').trim();
    } else if (value.length > 3) {
      // Format as 0XX XXX XXXX
      value = value.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3').trim();
    }
    
    setMobileNumber(value);
  };

  const formatAccountNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keep only numbers
    let value = e.target.value.replace(/\D/g, '');
    
    // Format with spaces every 4 digits for readability
    if (value.length > 4) {
      value = value.match(/.{1,4}/g)?.join(' ') || value;
    }
    
    setAccountNumber(value);
  };

  const getMobileProviderHelpText = () => {
    if (!mobileProvider) return null;
    
    const prefixes: Record<string, string[]> = {
      mtn: ['076', '077', '078'],
      airtel: ['095', '096', '097'],
      zamtel: ['050', '051', '052'],
    };
    
    const providerPrefixes = prefixes[mobileProvider.toLowerCase()];
    if (!providerPrefixes) return null;
    
    return `Valid prefixes: ${providerPrefixes.join(', ')}`;
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>
          {isComplete ? "Payment Complete" : "Payment Details"}
        </CardTitle>
        <CardDescription>
          {isComplete 
            ? "Your payment has been processed successfully." 
            : `Amount to pay: ${formatCurrency(amount)}`}
        </CardDescription>
      </CardHeader>
      
      {!isComplete ? (
        <form onSubmit={handleSubmit}>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <Tabs defaultValue="card" onValueChange={setPaymentMethod}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="card">
                  <CreditCard className="mr-2 h-4 w-4" /> Card
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone className="mr-2 h-4 w-4" /> Mobile Money
                </TabsTrigger>
                <TabsTrigger value="bank">
                  <Building className="mr-2 h-4 w-4" /> Bank Transfer
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="card" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cardNumber">Card Number</Label>
                  <Input 
                    id="cardNumber" 
                    placeholder="4242 4242 4242 4242" 
                    value={cardNumber}
                    onChange={handleCardNumberChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="cardName">Cardholder Name</Label>
                  <Input 
                    id="cardName" 
                    placeholder="John Doe" 
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardExpiry">Expiry Date</Label>
                    <Input 
                      id="cardExpiry" 
                      placeholder="MM/YY" 
                      value={cardExpiry}
                      onChange={handleExpiryChange}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cardCvc">CVC</Label>
                    <Input 
                      id="cardCvc" 
                      placeholder="123" 
                      value={cardCvc}
                      onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, '').substring(0, 3))}
                    />
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="mobile" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mobileProvider">Mobile Money Provider</Label>
                  <Select value={mobileProvider} onValueChange={setMobileProvider}>
                    <SelectTrigger id="mobileProvider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mtn">MTN Mobile Money</SelectItem>
                      <SelectItem value="airtel">Airtel Money</SelectItem>
                      <SelectItem value="zamtel">Zamtel Kwacha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="mobileNumber">Mobile Number</Label>
                  <Input 
                    id="mobileNumber" 
                    placeholder="e.g. 097XXXXXXX" 
                    value={mobileNumber}
                    onChange={formatMobileNumber}
                  />
                  <p className="text-sm text-muted-foreground">
                    {mobileProvider ? getMobileProviderHelpText() : 
                      "Enter the mobile number associated with your mobile money account"}
                  </p>
                </div>
              </TabsContent>
              
              <TabsContent value="bank" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bankName">Bank</Label>
                  <Select value={bankName} onValueChange={setBankName}>
                    <SelectTrigger id="bankName">
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zanaco">Zambia National Commercial Bank</SelectItem>
                      <SelectItem value="stanbic">Stanbic Bank</SelectItem>
                      <SelectItem value="absa">ABSA Bank Zambia</SelectItem>
                      <SelectItem value="fnb">First National Bank</SelectItem>
                      <SelectItem value="indo-zambia">Indo-Zambia Bank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="accountNumber">Account Number</Label>
                  <Input 
                    id="accountNumber" 
                    placeholder="Enter account number" 
                    value={accountNumber}
                    onChange={formatAccountNumber}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="accountName">Account Holder Name</Label>
                  <Input 
                    id="accountName" 
                    placeholder="Enter account holder name" 
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="branchCode">Branch Code (Optional)</Label>
                  <Input 
                    id="branchCode" 
                    placeholder="Enter branch code" 
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
          
          <CardFooter className="flex justify-between">
            {onCancel && (
              <Button variant="outline" type="button" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={isProcessing} className={onCancel ? "" : "w-full"}>
              {isProcessing ? "Processing..." : `Pay ${formatCurrency(amount)}`}
            </Button>
          </CardFooter>
        </form>
      ) : (
        <CardContent className="text-center pt-4 pb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <p className="mb-4 text-lg font-medium">Thank you for your payment!</p>
          <p className="text-muted-foreground">
            A confirmation has been sent to your email address.
          </p>
        </CardContent>
      )}
    </Card>
  );
};

export default PaymentForm;
