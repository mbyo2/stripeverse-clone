
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
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { prepareRecipientQuery } from "@/utils/phoneNumber";
import {
  computeSendFee,
  planSendMoneyCall,
  SEND_MONEY_FEE_PERCENT_DEFAULT,
} from "@/utils/sendMoneyLegs";
import { roundMoney } from "@/utils/splitPayments";
import { usePlatformSettings } from "@/hooks/useSubaccounts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowRight, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

const SendMoney = () => {
  const [step, setStep] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const { wallet } = useWallet();
  const { formatAmount } = useCurrency();
  const navigate = useNavigate();

  // Send fee: 2.5% of the amount at launch (CEO decision, 2026-10-22),
  // set by the platform in platform_settings.send_money_fee_percent.
  // This preview mirrors the server: the execute_send_money_transfer
  // RPC recomputes the fee from the same setting and charges it
  // atomically with the send — the amount below is display only.
  const { data: platformSettings } = usePlatformSettings();
  const feeRate = Number(
    platformSettings?.send_money_fee_percent ?? SEND_MONEY_FEE_PERCENT_DEFAULT
  );
  const amountValue = parseFloat(amount || "0");
  const fee = computeSendFee(amountValue, feeRate);
  const total = roundMoney(amountValue + fee);

  const handleContinue = () => {
    if (step === 1) {
      if (!recipient) {
        toast({ title: "Error", description: "Please enter the recipient's email address or phone number.", variant: "destructive" });
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
    // Never fail silently on a money action: this guard used to be a
    // bare `return`, so if the auth/wallet context wasn't loaded the
    // Confirm button appeared to do absolutely nothing (live QA
    // Round 2 recorded exactly that symptom).
    if (!user?.id || !wallet?.id) {
      const message = "Your session or wallet isn't loaded. Refresh the page and try again — nothing has been charged.";
      setSubmitError(message);
      toast({ title: "Couldn't start the transfer", description: message, variant: "destructive" });
      return;
    }

    // Mobile money sending is NOT live: no disbursement gateway is
    // connected, so there is no queue this money could enter. Refuse
    // BEFORE any debit — the previous flow debited the wallet via
    // atomic-transfer and toasted "disbursement is queued" while the
    // money simply vanished into an external ledger row.
    if (paymentMethod !== "wallet") {
      toast({
        title: "Mobile money sending isn't live yet",
        description: "No mobile-money gateway is connected, so nothing has been charged. To send now, choose BMaGlass Wallet — the recipient needs a BMaGlass account.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSubmitError("");

    try {
      const parsedAmount = parseFloat(amount);
      const ref = `BP${Date.now().toString(36).toUpperCase()}`;

      // 1. Resolve the recipient by exact email or phone match.
      // profiles RLS only ever shows a user their OWN profile, so a
      // browser-side profiles select can never find another user —
      // every send failed with "must have an account" even when the
      // recipient existed. find_transfer_recipient is a SECURITY
      // DEFINER RPC that answers an exact-match lookup (user id +
      // display name only) without exposing the profiles table.
      //
      // prepareRecipientQuery canonicalizes a Zambian phone typed in
      // any format (097…, +260 97 …, spaced) to +260… first, and
      // refuses garbage input with an invalid-format message — the
      // shared rule in utils/phoneNumber (live QA 2026-10-22: the
      // local format was refused on /transfer while the stored
      // international format worked; same lookup, same fix).
      const prepared = prepareRecipientQuery(recipient);
      if (prepared.ok === false) {
        throw new Error(prepared.message);
      }
      const { data: matches, error: lookupError } = await supabase
        .rpc("find_transfer_recipient", { p_query: prepared.query });

      if (lookupError) throw new Error(lookupError.message);

      const recipientProfile = Array.isArray(matches) ? matches[0] : matches;

      if (!recipientProfile?.user_id) {
        throw new Error("Recipient must have an account for wallet transfers.");
      }

      // Prefer the platform display name for the recipient when the
      // sender didn't type one — confirmations and ledger labels read
      // better than a raw phone/email, and it proves who matched.
      const resolvedRecipientName =
        recipientName || recipientProfile.display_name || recipient;

      // 2. Execute the send as ONE atomic server call. The body is
      // planned by planSendMoneyCall with reference_type "send_money",
      // which routes the atomic-transfer function to the
      // execute_send_money_transfer RPC: the recipient is credited
      // EXACTLY the entered amount, and the 2.5% send fee is computed
      // by the server (from platform_settings), charged on top, and
      // credited to the platform — all in one transaction. There is
      // no separate client-planned fee leg anymore (the old flat-K5
      // leg was debit-only and credited nobody), so a send can no
      // longer succeed while its fee silently doesn't.
      const idempotencyKey = `send-${user.id}-${Date.now()}`;
      const plan = planSendMoneyCall({
        amount: parsedAmount,
        feeRatePercent: feeRate,
        senderUserId: user.id,
        recipientUserId: recipientProfile.user_id,
        recipientName: resolvedRecipientName,
        currency: wallet.currency,
        referenceId: ref,
        idempotencyKey,
      });
      if (!plan) throw new Error("Please enter a valid amount.");

      const { data, error } = await supabase.functions.invoke("atomic-transfer", {
        body: plan.body,
      });

      // A non-2xx answer from the function only surfaces the generic
      // "non-2xx status code" message through invoke's error — the
      // function's real reason is in the response body. Extract it
      // so the user (and support) sees what actually went wrong.
      const sendError = error
        ? await resolveEdgeFunctionError(error, "Transfer failed")
        : data?.error
          ? String(data.error)
          : null;
      if (sendError) throw new Error(sendError);

      setTransactionRef(ref);
      setStep(4);

      toast({
        title: "Money sent successfully",
        description: `You've sent ${formatAmount(parsedAmount)} to ${resolvedRecipientName}`,
      });
    } catch (error: any) {
      console.error("Send money error:", error);
      const message = error?.message || "Something went wrong. Please try again.";
      // Persistent on-screen error as well as the toast: a failed send
      // must leave a visible trace on the form, not just a toast that
      // auto-dismisses (QA Round 2 saw the form simply sitting there,
      // indistinguishable from "nothing happened").
      setSubmitError(message);
      toast({ title: "Transaction failed", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setSubmitError("");
    if (step > 1) setStep(step - 1);
  };

  const handleNewTransfer = () => {
    setStep(1);
    setSubmitError("");
    setRecipient("");
    setRecipientName("");
    setAmount("");
    setPaymentMethod("");
    setTransactionRef("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="max-w-md mx-auto">
          <h1 className="text-[28px] leading-tight font-display font-semibold mb-6">Send Money</h1>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
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
                    <Label htmlFor="recipient">Recipient's email or phone number</Label>
                    <Input
                      id="recipient"
                      placeholder="you@example.com or +260 XX XXX XXXX"
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
                        <SelectItem value="mtn" disabled>MTN Mobile Money (not yet available)</SelectItem>
                        <SelectItem value="airtel" disabled>Airtel Money (not yet available)</SelectItem>
                        <SelectItem value="zamtel" disabled>Zamtel Kwacha (not yet available)</SelectItem>
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
                      <span className="text-muted-foreground">Send fee ({feeRate}%)</span>
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
                  <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                  <h3 className="text-xl font-display font-semibold mb-2">Transaction Complete!</h3>
                  <p className="mb-2">
                    You've sent <strong>{formatAmount(parseFloat(amount))}</strong> to{" "}
                    <strong>{recipientName || recipient}</strong>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Reference: #{transactionRef}
                  </p>
                </div>
              )}

              {submitError && step < 4 && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Transaction failed</AlertTitle>
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
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
