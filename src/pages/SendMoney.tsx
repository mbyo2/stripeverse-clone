
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/hooks/useWallet";
import { useCurrency } from "@/contexts/CurrencyContext";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

const SendMoney = () => {
  const [step, setStep] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [transactionRef, setTransactionRef] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const { wallet } = useWallet();
  const { formatAmount } = useCurrency();
  const navigate = useNavigate();

  const fee = 5;
  const total = parseFloat(amount || "0") + fee;

  const handleContinue = () => {
    if (step === 1) {
      if (!recipient) {
        toast({ title: "Error", description: "Please enter a recipient phone number.", variant: "destructive" });
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!amount || parseFloat(amount) <= 0) {
        toast({ title: "Error", description: "Please enter a valid amount.", variant: "destructive" });
        return;
      }
      if (wallet && total > wallet.balance) {
        toast({ title: "Insufficient funds", description: `Your wallet balance is ${formatAmount(wallet.balance)}. You need ${formatAmount(total)}.`, variant: "destructive" });
        return;
      }
      setStep(3);
    } else if (step === 3) {
      if (!paymentMethod) {
        toast({ title: "Error", description: "Please select a payment method.", variant: "destructive" });
        return;
      }
      handleSendMoney();
    }
  };

  const handleSendMoney = async () => {
    if (!user?.id || !wallet?.id) return;
    setIsLoading(true);

    try {
      const parsedAmount = parseFloat(amount);
      const ref = `BP${Date.now().toString(36).toUpperCase()}`;

      // 1. Create the transaction record
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: user.id,
        wallet_id: wallet.id,
        amount: parsedAmount,
        fee_amount: fee,
        currency: wallet.currency,
        direction: "outgoing",
        payment_method: paymentMethod === "wallet" ? "wallet" : "mobile_money",
        provider: paymentMethod === "wallet" ? "bmaglass" : paymentMethod,
        status: "completed",
        recipient_name: recipientName || recipient,
        recipient_account: recipient,
        description: `Send money to ${recipientName || recipient}`,
        reference: ref,
        category: "Transfer",
      });

      if (txError) throw txError;

      // 2. Deduct from wallet balance (amount + fee)
      const { error: walletError } = await supabase
        .from("wallets")
        .update({ balance: wallet.balance - total, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);

      if (walletError) throw walletError;

      setTransactionRef(ref);
      setStep(4);

      toast({ title: "Money sent successfully", description: `You've sent ${formatAmount(parsedAmount)} to ${recipientName || recipient}` });
    } catch (error: any) {
      console.error("Send money error:", error);
      toast({ title: "Transaction failed", description: error.message || "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleNewTransfer = () => {
    setStep(1);
    setRecipient("");
    setRecipientName("");
    setAmount("");
    setPaymentMethod("");
    setTransactionRef("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="max-w-md mx-auto">
          <h1 className="text-3xl font-bold mb-6">Send Money</h1>

          <Card>
            <CardHeader>
              <CardTitle>
                {step === 1 && "Recipient Details"}
                {step === 2 && "Enter Amount"}
                {step === 3 && "Confirm Payment"}
                {step === 4 && "Transaction Complete"}
              </CardTitle>
              <CardDescription>
                {step === 1 && "Enter the recipient's details"}
                {step === 2 && "How much would you like to send?"}
                {step === 3 && "Review and confirm your transfer"}
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
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recipientName">Recipient Name (optional)</Label>
                    <Input
                      id="recipientName"
                      placeholder="Enter name"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min="1"
                    />
                    <p className="text-sm text-muted-foreground">
                      Sending to: {recipientName || recipient}
                    </p>
                    {wallet && (
                      <p className="text-sm text-muted-foreground">
                        Available balance: {formatAmount(wallet.balance)}
                      </p>
                    )}
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
                        <SelectItem value="wallet">
                          BMaGlass Wallet ({formatAmount(wallet?.balance || 0)})
                        </SelectItem>
                        <SelectItem value="mtn">MTN Mobile Money</SelectItem>
                        <SelectItem value="airtel">Airtel Money</SelectItem>
                        <SelectItem value="zamtel">Zamtel Kwacha</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="mt-4 space-y-3 border rounded-lg p-4 bg-muted/50">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Recipient</span>
                      <span className="font-medium">{recipientName || recipient}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount</span>
                      <span>{formatAmount(parseFloat(amount || "0"))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Fee</span>
                      <span>{formatAmount(fee)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold">
                      <span>Total</span>
                      <span>{formatAmount(total)}</span>
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
                  <p className="mb-2">
                    You've sent <strong>{formatAmount(parseFloat(amount))}</strong> to{" "}
                    <strong>{recipientName || recipient}</strong>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reference: #{transactionRef}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              {step < 4 ? (
                <>
                  {step > 1 && (
                    <Button variant="outline" onClick={handleBack} disabled={isLoading}>
                      Back
                    </Button>
                  )}
                  {step === 1 && <div />}
                  <Button onClick={handleContinue} disabled={isLoading} className="ml-auto">
                    {isLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                    ) : step === 3 ? (
                      "Confirm & Send"
                    ) : (
                      <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                </>
              ) : (
                <div className="w-full space-y-2">
                  <Button className="w-full" onClick={handleNewTransfer}>
                    Send Another Payment
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => navigate("/wallet")}>
                    Back to Wallet
                  </Button>
                </div>
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
