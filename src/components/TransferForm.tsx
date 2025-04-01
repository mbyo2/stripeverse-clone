
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency, validateWalletTransfer, formatPhoneForDisplay } from "@/lib/utils";
import { ArrowRight, CheckCircle2, AlertCircle, User } from "lucide-react";

type TransferFormProps = {
  senderPhone: string;
  walletBalance: number;
  onSuccess?: (response: { 
    transferId: string; 
    amount: number;
    receiverPhone: string;
  }) => void;
  onCancel?: () => void;
};

const TransferForm = ({ senderPhone, walletBalance, onSuccess, onCancel }: TransferFormProps) => {
  const [step, setStep] = useState(1);
  const [receiverPhone, setReceiverPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleContinue = () => {
    setError(null);
    
    if (step === 1) {
      if (!receiverPhone) {
        setError("Please enter the receiver's phone number");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const numAmount = parseFloat(amount);
      if (!amount || isNaN(numAmount) || numAmount <= 0) {
        setError("Please enter a valid amount greater than 0");
        return;
      }
      
      if (numAmount > walletBalance) {
        setError(`Insufficient balance. Your current balance is ${formatCurrency(walletBalance)}`);
        return;
      }
      
      // Validate the transfer
      const validation = validateWalletTransfer(senderPhone, receiverPhone, numAmount);
      if (!validation.valid) {
        setError(validation.message || "Invalid transfer details");
        return;
      }
      
      setStep(3);
    } else if (step === 3) {
      handleTransfer();
    }
  };

  const handleTransfer = () => {
    setIsProcessing(true);
    setError(null);
    
    // Simulate API call for the transfer
    setTimeout(() => {
      setIsProcessing(false);
      
      // Generate a random transfer ID
      const transferId = `TR${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
      
      toast({
        title: "Transfer successful",
        description: `You've sent ${formatCurrency(parseFloat(amount))} to ${formatPhoneForDisplay(receiverPhone)}`,
      });
      
      // Call the success callback with transfer details
      if (onSuccess) {
        onSuccess({
          transferId,
          amount: parseFloat(amount),
          receiverPhone,
        });
      }
    }, 2000);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    } else if (onCancel) {
      onCancel();
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {step === 1 && "Recipient Details"}
          {step === 2 && "Transfer Amount"}
          {step === 3 && "Confirm Transfer"}
        </CardTitle>
        <CardDescription>
          {step === 1 && "Enter the recipient's phone number"}
          {step === 2 && "How much would you like to send?"}
          {step === 3 && "Review and confirm your transfer"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="receiverPhone">Recipient Phone Number</Label>
              <Input 
                id="receiverPhone" 
                placeholder="e.g. 097XXXXXXX" 
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Enter the phone number associated with the recipient's BMaGlass Pay account
              </p>
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
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Available Balance:</span>
                <span className="font-medium">{formatCurrency(walletBalance)}</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="note">Note (Optional)</Label>
              <Input 
                id="note" 
                placeholder="What's this transfer for?" 
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        )}
        
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-secondary/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Recipient</span>
                <span className="font-medium flex items-center">
                  <User className="h-4 w-4 mr-1 text-primary" />
                  {formatPhoneForDisplay(receiverPhone)}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">{formatCurrency(parseFloat(amount))}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Fee</span>
                <span className="font-medium">K 0.00</span>
              </div>
              
              <div className="pt-2 border-t flex items-center justify-between">
                <span className="font-bold">Total</span>
                <span className="font-bold">{formatCurrency(parseFloat(amount))}</span>
              </div>
            </div>
            
            {note && (
              <div className="bg-secondary/10 rounded-lg p-4">
                <span className="text-sm text-muted-foreground">Note:</span>
                <p className="text-sm mt-1">{note}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={handleBack}>
          {step === 1 && onCancel ? "Cancel" : "Back"}
        </Button>
        <Button onClick={handleContinue} disabled={isProcessing}>
          {isProcessing ? (
            "Processing..."
          ) : step === 3 ? (
            "Confirm Transfer"
          ) : (
            <>
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default TransferForm;
