
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatCardNumber, formatCurrency, isMobileMoneyNumber, validateCardNumber } from "@/lib/utils";
import { CreditCard, Smartphone, Check, AlertCircle, Building, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import UssdPayment from "./payments/UssdPayment";
import MobileMoneyPayment from "./payments/MobileMoneyPayment";

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
    }
  };

  const handlePaymentSuccess = (response: { paymentId: string; method: string; status: string }) => {
    setIsComplete(true);
    
    toast({
      title: "Payment successful",
      description: `Your payment of ${formatCurrency(amount)} has been processed.`,
    });
    
    if (onSuccess) {
      onSuccess(response);
    }
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
        <>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <Tabs defaultValue="card" onValueChange={setPaymentMethod}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="card">
                  <CreditCard className="mr-2 h-4 w-4" /> Card
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone className="mr-2 h-4 w-4" /> Mobile Money
                </TabsTrigger>
                <TabsTrigger value="ussd">
                  <Phone className="mr-2 h-4 w-4" /> USSD
                </TabsTrigger>
                <TabsTrigger value="bank">
                  <Building className="mr-2 h-4 w-4" /> Bank
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="card" className="mt-4 space-y-4">
                <form onSubmit={handleSubmit}>
                  <div className="space-y-4">
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
                    
                    <div className="pt-4 flex justify-between">
                      {onCancel && (
                        <Button type="button" variant="outline" onClick={onCancel}>
                          Cancel
                        </Button>
                      )}
                      <Button type="submit" disabled={isProcessing} className={onCancel ? "" : "w-full"}>
                        {isProcessing ? "Processing..." : `Pay ${formatCurrency(amount)}`}
                      </Button>
                    </div>
                  </div>
                </form>
              </TabsContent>
              
              <TabsContent value="mobile" className="mt-4">
                <MobileMoneyPayment 
                  amount={amount} 
                  onSuccess={handlePaymentSuccess}
                  onCancel={onCancel || (() => {})}
                />
              </TabsContent>
              
              <TabsContent value="ussd" className="mt-4">
                <UssdPayment 
                  amount={amount} 
                  onSuccess={handlePaymentSuccess}
                  onCancel={onCancel || (() => {})}
                />
              </TabsContent>
              
              <TabsContent value="bank" className="mt-4 space-y-4">
                <p className="text-center text-muted-foreground py-8">
                  Bank transfer functionality coming soon. Please select another payment method.
                </p>
                
                {onCancel && (
                  <Button variant="outline" onClick={onCancel} className="w-full">
                    Cancel
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </>
      ) : (
        <CardContent className="text-center pt-4 pb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <p className="mb-4 text-lg font-medium">Thank you for your payment!</p>
          <p className="text-muted-foreground">
            A confirmation has been sent to your email address.
          </p>
          
          {onCancel && (
            <Button 
              variant="outline" 
              onClick={onCancel} 
              className="mt-6"
            >
              Return
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
};

export default PaymentForm;
