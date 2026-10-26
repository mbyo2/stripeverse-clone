import { toUserFacingError } from "@/utils/userFacingError";

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { CardPageSkeleton } from "@/components/ui/skeletons";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatCardNumber } from "@/lib/utils";
import { formatCardExpiry } from "@/utils/cardDisplay";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, WalletCards, Copy, Check, ShieldAlert } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useRoles } from "@/contexts/RoleContext";
import VirtualCardsComingSoon from "@/components/VirtualCardsComingSoon";
import { supabase } from "@/integrations/supabase/client";
import { cardFundingFee, cardFundingTotal } from "@/utils/cardFunding";

const VirtualCardNew = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { wallet } = useWallet();
  const { hasRole, isLoading: rolesLoading } = useRoles();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    cardName: "",
    initialFunding: 100,
    // Internal wallet cards are issued by BMaGlass itself — the
    // provider value must say so. It used to default to a card
    // network's brand, which the card page then rendered as the
    // product name, mislabelling an internal wallet card as a
    // network card.
    cardProvider: "bmaglass",
    cardType: "debit",
  });
  // Creation reveal: the full card number, CVV and expiry arrive
  // in the create-virtual-card response. They are never stored in
  // plaintext (the live table has no columns for them) — the
  // server keeps only an encrypted vault envelope, and this page
  // persists nothing itself (no localStorage, no URL). The owner
  // can view the details again from the card page after password
  // re-auth (manage-virtual-card).
  const [createdCard, setCreatedCard] = useState<{
    id: string;
    cardNumber?: string;
    cvv?: string;
    expiry?: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (field: string, value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access — copy the value by hand.",
        variant: "destructive",
      });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "initialFunding") {
      // Only allow positive numbers
      const amount = parseFloat(value);
      if (!isNaN(amount) && amount >= 0) {
        setFormData({ ...formData, [name]: amount });
      }
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Check wallet can cover the initial funding (amount + 1% fee, min K2)
    const funding = formData.initialFunding;
    const fee = funding > 0 ? Math.max(funding * 0.01, 2) : 0;
    if (funding > 0 && (wallet?.balance ?? 0) < funding + fee) {
      setError(`Insufficient wallet balance. You need ${formatCurrency(funding + fee)} (includes ${formatCurrency(fee)} fee).`);
      setLoading(false);
      return;
    }

    let reveal: {
      id: string;
      cardNumber?: string;
      cvv?: string;
      expiry?: string;
    } | null = null;

    try {
      // 1. Create the card via the real edge function
      const { data, error: fnError } = await supabase.functions.invoke('create-virtual-card', {
        body: {
          name: formData.cardName,
          provider: formData.cardProvider,
          cardType: formData.cardType,
          dailyLimit: 5000,
          monthlyLimit: 50000,
          transactionLimit: 2000,
          allowOnline: true,
          allowInternational: false,
        },
      });

      if (fnError) throw new Error(fnError.message || 'Failed to create card');
      if (!data?.success) throw new Error(data?.error || 'Failed to create card');

      const cardId: string = data.card.id;

      // Capture the creation reveal BEFORE anything else can fail:
      // the full card number, CVV and expiry are shown from this
      // response — later views go through the manage-virtual-card
      // re-auth reveal, never through this page's state.
      reveal = {
        id: cardId,
        cardNumber: data.card.card_number,
        cvv: data.card.cvv,
        expiry: data.card.expiry ??
          (data.card.expiry_date ? formatCardExpiry(data.card.expiry_date) : undefined),
      };

      // 2. Fund it if an initial amount was requested
      if (funding > 0) {
        const { data: fundData, error: fundError } = await supabase.functions.invoke('fund-virtual-card', {
          body: { cardId, amount: funding },
        });
        if (fundError) throw new Error(fundError.message || 'Card created but funding failed');
        if (!fundData?.success) throw new Error(fundData?.error || 'Card created but funding failed');
      }

      setCreatedCard(reveal);
      toast({
        title: "Virtual Card Created",
        description: funding > 0
          ? `Your virtual card was created and funded with ${formatCurrency(funding)}.`
          : `Your virtual card has been created successfully.`,
      });
    } catch (err: any) {
      // Creation succeeded but a later step (funding) failed: still
      // show the one-time reveal — the card's secrets must not be
      // lost to a funding hiccup. The error is surfaced as before.
      if (reveal) setCreatedCard(reveal);
      console.error('Create virtual card error:', err);
      setError(toUserFacingError(err, 'Failed to create virtual card. Please try again.'));
      toast({
        title: "Failed to Create Card",
        description: toUserFacingError(err, 'An unknown error occurred'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Virtual cards are "Coming soon" for the public (CEO decision,
  // 2026-10-22) until the Mastercard integration is built and tested:
  // only admins reach the creation form. The create-virtual-card edge
  // function enforces the same rule server-side.
  if (rolesLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-secondary/10">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
          <CardPageSkeleton />
        </main>
        <Footer />
      </div>
    );
  }
  // super_admin is additive over admin (console-gate semantics): a
  // super_admin-only holder reaches the same tool an admin does.
  if (!hasRole("admin") && !hasRole("super_admin")) {
    return (
      <div className="min-h-screen flex flex-col bg-secondary/10">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Virtual Cards</h1>
          </div>
          <VirtualCardsComingSoon />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Create Virtual Card</h1>
          <p className="text-muted-foreground mt-2">
            A BMaGlass virtual card holds a separate balance inside your wallet so you can set money aside for a purpose.
            It is not issued by any card network or bank, and it can't be used for online purchases or subscriptions outside BMaGlass Pay.
          </p>
        </div>
        
        {createdCard && (
          <>
            {error && (
              <div className="mb-6 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                {error}
              </div>
            )}
            <Card className="mb-6 border-amber-500/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-500" />
                  Your New Card Details
                </CardTitle>
                <CardDescription>
                  Your virtual card was created. Here are its full details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm font-medium">
                    Keep these private. They're stored encrypted — you can view them again any time from the card's page after confirming your password.
                  </div>

                  <div className="space-y-2">
                    <Label>Card Number</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-base tracking-wider break-all">
                        {createdCard.cardNumber ? formatCardNumber(createdCard.cardNumber) : "—"}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Copy card number"
                        onClick={() => copyToClipboard("cardNumber", createdCard.cardNumber)}
                      >
                        {copiedField === "cardNumber" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>CVV</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-base tracking-wider">
                          {createdCard.cvv ?? "—"}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Copy CVV"
                          onClick={() => copyToClipboard("cvv", createdCard.cvv)}
                        >
                          {copiedField === "cvv" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Expiry</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-base tracking-wider">
                          {createdCard.expiry ?? "—"}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Copy expiry"
                          onClick={() => copyToClipboard("expiry", createdCard.expiry)}
                        >
                          {copiedField === "expiry" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Button className="w-full" onClick={() => navigate(`/card/${createdCard.id}`)}>
                    Done — View My Card
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!createdCard && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New Virtual Card</CardTitle>
            <CardDescription>
              Fill in the details to create your virtual card. You can fund it from your main wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="cardName">Card Name</Label>
                  <Input
                    id="cardName"
                    name="cardName"
                    placeholder="e.g., Shopping Card, Netflix Card"
                    value={formData.cardName}
                    onChange={handleChange}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="initialFunding">Initial Funding Amount</Label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                      K
                    </div>
                    <Input
                      id="initialFunding"
                      name="initialFunding"
                      type="number"
                      min="0"
                      step="0.01"
                      className="pl-8"
                      value={formData.initialFunding}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This amount will be deducted from your wallet balance
                    {wallet ? ` (${formatCurrency(wallet.balance)} available)` : ""}.
                    Leave it at 0 to create the card now and fund it later — no fee is charged when funding is 0.
                  </p>
                  {/* Fee breakdown BEFORE creating — shown whenever
                      an initial funding amount is entered, in the
                      same style as the Fund page and Send Money. */}
                  {formData.initialFunding > 0 && (
                    <div className="p-4 bg-secondary/10 rounded-md">
                      <div className="flex justify-between mb-2">
                        <span className="text-muted-foreground">Funding amount</span>
                        <span>{formatCurrency(formData.initialFunding)}</span>
                      </div>
                      <div className="flex justify-between mb-2">
                        <span className="text-muted-foreground">Fee (1%, minimum K2)</span>
                        <span>{formatCurrency(cardFundingFee(formData.initialFunding))}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t font-medium">
                        <span>Total from wallet</span>
                        <span>{formatCurrency(cardFundingTotal(formData.initialFunding))}</span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Card</Label>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-medium text-sm">BMaGlass Virtual Card</p>
                      <p className="text-xs text-muted-foreground mt-1">Internal wallet card — not a card-network or bank card</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cardType">Card Type</Label>
                    <Select 
                      value={formData.cardType}
                      onValueChange={(value) => handleSelectChange("cardType", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select card type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debit">Debit Card</SelectItem>
                        <SelectItem value="prepaid">Prepaid Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="mt-6 flex flex-col space-y-2">
                  <Button type="submit" disabled={loading || !formData.cardName}>
                    {loading ? "Creating..." : "Create Virtual Card"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigate("/wallet")}>
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>About Virtual Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start">
                <div className="mt-1 mr-4 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">A Separate Balance</h3>
                  <p className="text-muted-foreground text-sm">
                    Fund a named card balance from your wallet and keep that money separate from your main balance.
                  </p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="mt-1 mr-4 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <WalletCards className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Budget Management</h3>
                  <p className="text-muted-foreground text-sm">
                    Create separate cards for different purposes to better track your spending.
                  </p>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Fee Structure</h4>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex justify-between">
                    <span>Card Creation</span>
                    <span className="font-medium">Free</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Funding a Card</span>
                    <span className="font-medium">1% (minimum K2)</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default VirtualCardNew;
