import { toUserFacingError } from "@/utils/userFacingError";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency, validateWalletTransfer, formatPhoneForDisplay } from "@/lib/utils";
import { ArrowRight, CheckCircle2, AlertCircle, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { prepareRecipientQuery } from "@/utils/phoneNumber";

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

  const handleTransfer = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const numAmount = parseFloat(amount);

      // 1. Resolve the recipient to a real user by phone number
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in to send money");

      // 1. Resolve the recipient to a real user by phone number.
      // This used to select from public.profiles in the browser, but
      // profiles RLS only ever returns the caller's OWN profile — so
      // the lookup could never find any other user and every transfer
      // failed with "No account found", even when the recipient
      // existed. find_transfer_recipient is the SECURITY DEFINER RPC
      // added for SendMoney (migration 20261022): exact match on email
      // or phone equality, returning only the user id and a display
      // name, without exposing the profiles table.
      //
      // The query is prepared with prepareRecipientQuery first: a
      // Zambian number typed in ANY format (097…, +260 97 …, spaced)
      // is canonicalized to +260… before the lookup, and garbage input
      // is refused here with an invalid-format message instead of a
      // misleading "No account found" (live QA 2026-10-22: the local
      // format 0970000000 was refused while the stored format
      // +260 97 000 0000 worked). The RPC canonicalizes the stored
      // side too — the two rules are twins, keep them in sync.
      const prepared = prepareRecipientQuery(receiverPhone);
      if (prepared.ok === false) {
        throw new Error(prepared.message);
      }
      const { data: matches, error: lookupError } = await supabase
        .rpc("find_transfer_recipient", { p_query: prepared.query });

      if (lookupError) throw new Error(lookupError.message);

      const recipientProfile = Array.isArray(matches) ? matches[0] : matches;

      if (!recipientProfile?.user_id) {
        throw new Error("No account found for that phone number. The recipient must have an account.");
      }
      if (recipientProfile.user_id === user.id) {
        throw new Error("You cannot send money to yourself");
      }

      // 2. Execute the transfer atomically, server-side
      const idempotencyKey = `transfer-${user.id}-${Date.now()}`;
      const { data, error } = await supabase.functions.invoke("atomic-transfer", {
        body: {
          from_user_id: user.id,
          to_user_id: recipientProfile.user_id,
          amount: numAmount,
          currency: "ZMW",
          reference_type: "transfer",
          reference_id: null,
          idempotency_key: idempotencyKey,
          description: note || `Transfer to ${formatPhoneForDisplay(receiverPhone)}`,
          recipient_name: formatPhoneForDisplay(receiverPhone),
          payment_method: "wallet",
        },
      });

      if (error) throw new Error(await resolveEdgeFunctionError(error, "Transfer failed"));
      if (data?.error) throw new Error(data.error);

      setIsProcessing(false);

      toast({
        title: "Transfer successful",
        description: `You've sent ${formatCurrency(numAmount)} to ${formatPhoneForDisplay(receiverPhone)}`,
      });

      if (onSuccess) {
        onSuccess({
          transferId: data.transaction_id,
          amount: numAmount,
          receiverPhone,
        });
      }
    } catch (err) {
      setIsProcessing(false);
      const message = toUserFacingError(err, "Transfer failed");
      setError(message);
      toast({ title: "Transfer failed", description: message, variant: "destructive" });
    }
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
