import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, Smartphone, Check, AlertCircle, Building, Phone, Bitcoin } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import UssdPayment from "./payments/UssdPayment";
import MobileMoneyPayment from "./payments/MobileMoneyPayment";
import BitcoinPayment from "./payments/BitcoinPayment";

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

  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

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
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
                <TabsTrigger value="card">
                  <CreditCard className="mr-2 h-4 w-4" /> Card
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone className="mr-2 h-4 w-4" /> Mobile
                </TabsTrigger>
                <TabsTrigger value="ussd">
                  <Phone className="mr-2 h-4 w-4" /> USSD
                </TabsTrigger>
                <TabsTrigger value="bitcoin">
                  <Bitcoin className="mr-2 h-4 w-4" /> Crypto
                </TabsTrigger>
                <TabsTrigger value="bank">
                  <Building className="mr-2 h-4 w-4" /> Bank
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="card" className="mt-4 space-y-4">
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                  <p className="text-sm font-medium text-amber-700">Card payments are not available yet</p>
                  <p className="text-sm text-amber-700/80 mt-1">
                    Direct card processing is coming soon. Please use mobile money, USSD, or Bitcoin for now.
                  </p>
                </div>

                {onCancel && (
                  <Button variant="outline" onClick={onCancel} className="w-full">
                    Cancel
                  </Button>
                )}
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
              
              <TabsContent value="bitcoin" className="mt-4">
                <BitcoinPayment 
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
