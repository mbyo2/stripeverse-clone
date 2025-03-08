
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowRight, CheckCircle2 } from "lucide-react";

const SendMoney = () => {
  const [step, setStep] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleContinue = () => {
    if (step === 1) {
      if (!recipient) {
        toast({
          title: "Error",
          description: "Please enter a recipient phone number.",
          variant: "destructive",
        });
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!amount) {
        toast({
          title: "Error",
          description: "Please enter an amount.",
          variant: "destructive",
        });
        return;
      }
      if (parseFloat(amount) <= 0) {
        toast({
          title: "Error",
          description: "Amount must be greater than 0.",
          variant: "destructive",
        });
        return;
      }
      setStep(3);
    } else if (step === 3) {
      if (!paymentMethod) {
        toast({
          title: "Error",
          description: "Please select a payment method.",
          variant: "destructive",
        });
        return;
      }
      handleSendMoney();
    }
  };

  const handleSendMoney = () => {
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setStep(4);
      
      toast({
        title: "Money sent successfully",
        description: `You've sent K${amount} to ${recipient}`,
      });
    }, 2000);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="max-w-md mx-auto">
          <h1 className="text-3xl font-bold mb-6">Send Money</h1>
          
          <Card>
            <CardHeader>
              <CardTitle>
                {step === 1 && "Recipient Details"}
                {step === 2 && "Enter Amount"}
                {step === 3 && "Payment Method"}
                {step === 4 && "Transaction Complete"}
              </CardTitle>
              <CardDescription>
                {step === 1 && "Enter the recipient's phone number"}
                {step === 2 && "How much would you like to send?"}
                {step === 3 && "Choose how you want to pay"}
                {step === 4 && "Your money has been sent successfully"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {step === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="recipient">Phone Number</Label>
                    <Input 
                      id="recipient" 
                      placeholder="+260 XX XXX XXXX" 
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">Enter a mobile money number</p>
                  </div>
                </div>
              )}
              
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (K)</Label>
                    <Input 
                      id="amount" 
                      type="number"
                      placeholder="0.00" 
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">Sending to: {recipient}</p>
                  </div>
                </div>
              )}
              
              {step === 3 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment-method">Payment Method</Label>
                    <Select onValueChange={setPaymentMethod}>
                      <SelectTrigger id="payment-method">
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wallet">BMaGlass Pay Wallet (K2,450.00)</SelectItem>
                        <SelectItem value="mtn">MTN Mobile Money</SelectItem>
                        <SelectItem value="airtel">Airtel Money</SelectItem>
                        <SelectItem value="zamtel">Zamtel Kwacha</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="mt-4 space-y-3 border rounded-lg p-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount</span>
                      <span>K {amount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fee</span>
                      <span>K 5.00</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>Total</span>
                      <span>K {(parseFloat(amount || "0") + 5).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {step === 4 && (
                <div className="text-center py-6">
                  <div className="flex justify-center mb-4">
                    <CheckCircle2 className="h-16 w-16 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Transaction Complete!</h3>
                  <p className="mb-4">You've sent <strong>K {amount}</strong> to <strong>{recipient}</strong></p>
                  <p className="text-sm text-muted-foreground">Transaction ID: #BP{Math.floor(Math.random() * 1000000)}</p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              {step < 4 ? (
                <>
                  {step > 1 && (
                    <Button variant="outline" onClick={handleBack}>
                      Back
                    </Button>
                  )}
                  {step === 1 && <div></div>}
                  <Button onClick={handleContinue} disabled={isLoading} className="ml-auto">
                    {isLoading ? (
                      "Processing..."
                    ) : step === 3 ? (
                      "Confirm & Send"
                    ) : (
                      <>
                        Continue <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button className="w-full" onClick={() => setStep(1)}>
                  Send Another Payment
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default SendMoney;
