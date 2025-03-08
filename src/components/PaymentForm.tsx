
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCardNumber, formatCurrency, isMobileMoneyNumber, validateCardNumber } from "@/lib/utils";
import { CreditCard, Smartphone, Check } from "lucide-react";

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
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
    }
    
    // Process payment
    setIsProcessing(true);
    
    // Simulate API call to payment processor
    setTimeout(() => {
      setIsProcessing(false);
      setIsComplete(true);
      
      // Call success callback with payment details
      if (onSuccess) {
        onSuccess({
          paymentId: "pay_" + Math.random().toString(36).substring(2, 15),
          method: paymentMethod === "card" ? "card" : mobileProvider,
          status: "succeeded"
        });
      }
      
      toast({
        title: "Payment successful",
        description: `Your payment of ${formatCurrency(amount)} has been processed.`,
      });
    }, 2000);
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
            <Tabs defaultValue="card" onValueChange={setPaymentMethod}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="card">
                  <CreditCard className="mr-2 h-4 w-4" /> Card
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone className="mr-2 h-4 w-4" /> Mobile Money
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
                    onChange={(e) => setMobileNumber(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter the mobile number associated with your mobile money account
                  </p>
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
