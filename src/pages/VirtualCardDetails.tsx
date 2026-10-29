import { toUserFacingError } from "@/utils/userFacingError";

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { CardPageSkeleton } from "@/components/ui/skeletons";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { ArrowUpRight, ArrowDownLeft, ShieldCheck, RefreshCw, Trash2, Lock, Settings, Eye, Copy, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/contexts/RoleContext";
import { formatCardExpiry } from "@/utils/cardDisplay";
import { cardFundingFee, cardFundingTotal, cardHistoryLabel } from "@/utils/cardFunding";
import { applyCardLimitsToCache } from "@/utils/cardCache";
import VirtualCardsComingSoon from "@/components/VirtualCardsComingSoon";
// In a real app, this would fetch from API
const fetchVirtualCard = async (cardId: string) => {
  // Explicit column list: the vault ciphertext columns
  // (details_ciphertext / details_iv) must never be sent to the
  // browser. has_vaulted_details is the generated flag the UI
  // branches on — vaulted cards can be revealed again after
  // password re-auth; legacy cards honestly cannot.
  const { data: row, error } = await supabase
    .from('virtual_cards')
    .select('id, user_id, wallet_id, name, masked_number, expiry_date, balance, currency, status, provider, card_type, daily_limit, monthly_limit, transaction_limit, online_transactions, international_transactions, has_vaulted_details, created_at, updated_at')
    .eq('id', cardId)
    .single();

  if (error) throw error;
  if (!row) throw new Error('Card not found');

  // Cardholder name for the card face: the owner's profile.
  let holderName = '';
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', row.user_id)
      .maybeSingle();
    holderName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  } catch {
    holderName = '';
  }

  // Transaction history for this card — via manage-virtual-card,
  // the checked server path (ownership + card gate enforced
  // there). The old direct query named columns that don't exist
  // on the live transactions table, failed silently, and always
  // rendered an empty history.
  let transactions: any[] = [];
  try {
    const { data } = await supabase.functions.invoke('manage-virtual-card', {
      body: { action: 'transactions', cardId },
    });
    if (data?.success) transactions = data.transactions || [];
  } catch {
    transactions = [];
  }

  return {
    ...row,
    holderName: holderName || row.name,
    hasVaultedDetails: !!row.has_vaulted_details,
    expiry: formatCardExpiry(row.expiry_date),
    limits: {
      daily: Number(row.daily_limit ?? 0),
      monthly: Number(row.monthly_limit ?? 0),
      transaction: Number(row.transaction_limit ?? 0),
    },
    settings: {
      online_transactions: !!row.online_transactions,
      international_transactions: !!row.international_transactions,
    },
    transactions: transactions.map((tx: any) => ({
      id: tx.id,
      type: tx.category === 'card_funding' ? 'funding' : 'payment',
      amount: Number(tx.amount ?? 0),
      // Funding rows are titled "Card funding" — the old mapping
      // preferred tx.reference, so every funding row was titled
      // with the raw ledger reference ("FUND-<uuid>-<ts>").
      description: cardHistoryLabel(tx),
      date: tx.created_at,
      status: tx.status,
    })),
  };
};

const VirtualCardDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasRole, isLoading: rolesLoading } = useRoles();
  const [fundAmount, setFundAmount] = useState<string>("50");
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showLimitsDialog, setShowLimitsDialog] = useState(false);
  const [limitsForm, setLimitsForm] = useState({
    daily: 0,
    monthly: 0,
    transaction: 0
  });

  // Fetch card data
  const { 
    data: card, 
    isLoading, 
    isError 
  } = useQuery({
    queryKey: ['virtualCard', id],
    queryFn: () => fetchVirtualCard(id || ""),
    enabled: !!id
  });

  useEffect(() => {
    if (card?.limits) {
      setLimitsForm({
        daily: card.limits.daily,
        monthly: card.limits.monthly,
        transaction: card.limits.transaction
      });
    }
  }, [card]);

  // Card status mutation — via manage-virtual-card, the checked
  // server path (auth + card gate + ownership enforced there).
  // Direct UPDATEs on virtual_cards are closed at the DB level:
  // the old owner UPDATE policy let any owner PATCH any column,
  // including balance, so no card write happens from the browser.
  const toggleCardStatusMutation = useMutation({
    mutationFn: async (newStatus: 'active' | 'frozen') => {
      const { data, error } = await supabase.functions.invoke('manage-virtual-card', {
        body: { action: 'set_status', cardId: id, status: newStatus },
      });
      if (error) throw new Error(error.message || 'Failed to update card status');
      if (!data?.success) throw new Error(data?.error || 'Failed to update card status');
      return newStatus;
    },
    onSuccess: (newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['virtualCard', id] });
      queryClient.invalidateQueries({ queryKey: ['virtualCards'] });
      toast({
        title: newStatus === 'active' ? 'Card Activated' : 'Card Frozen',
        description: newStatus === 'active'
          ? "Your virtual card has been activated."
          : "Your virtual card has been temporarily frozen.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: toUserFacingError(err, "Could not update card status."), variant: "destructive" });
    }
  });

  // Card funding mutation — real edge function (debits wallet, credits card)
  const fundCardMutation = useMutation({
    mutationFn: async (amount: number) => {
      const { data, error } = await supabase.functions.invoke('fund-virtual-card', {
        body: { cardId: id, amount },
      });
      if (error) throw new Error(error.message || 'Failed to fund card');
      if (!data?.success) throw new Error(data?.error || 'Failed to fund card');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['virtualCard', id] });
      queryClient.invalidateQueries({ queryKey: ['virtualCards'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast({
        title: "Card Funded",
        description: `${formatCurrency(Number(fundAmount))} has been added to your card. New balance: ${formatCurrency(data.newCardBalance)}.`,
      });
      setFundAmount("50");
    },
    onError: (err: any) => {
      toast({ title: "Funding Failed", description: toUserFacingError(err, "Could not fund card."), variant: "destructive" });
    }
  });

  // Card terminate mutation — via manage-virtual-card: soft delete
  // (status = cancelled) to preserve the audit trail, and the
  // server wipes the card's vault envelope so its secrets cease
  // to exist.
  const deleteCardMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-virtual-card', {
        body: { action: 'terminate', cardId: id },
      });
      if (error) throw new Error(error.message || 'Failed to cancel card');
      if (!data?.success) throw new Error(data?.error || 'Failed to cancel card');
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['virtualCards'] });
      toast({
        title: "Card Cancelled",
        description: "Your virtual card has been cancelled.",
      });
      navigate("/wallet");
    },
    onError: (err: any) => {
      toast({ title: "Delete Failed", description: toUserFacingError(err, "Could not cancel card."), variant: "destructive" });
    }
  });

  // Card limits mutation — via manage-virtual-card (validated and
  // ownership-checked server-side).
  const updateCardLimitsMutation = useMutation({
    mutationFn: async (limits: typeof limitsForm) => {
      const { data, error } = await supabase.functions.invoke('manage-virtual-card', {
        body: {
          action: 'set_limits',
          cardId: id,
          dailyLimit: limits.daily,
          monthlyLimit: limits.monthly,
          transactionLimit: limits.transaction,
        },
      });
      if (error) throw new Error(error.message || 'Failed to update limits');
      if (!data?.success) throw new Error(data?.error || 'Failed to update limits');
      return true;
    },
    onSuccess: (_data, limits) => {
      // Write the saved limits into the cache FIRST so the settings
      // display renders them immediately; invalidation alone left
      // the old values on screen until the background refetch (or a
      // full reload) landed. Invalidation still runs to reconcile.
      if (id) applyCardLimitsToCache(queryClient, id, limits);
      queryClient.invalidateQueries({ queryKey: ['virtualCard', id] });
      toast({
        title: "Card Limits Updated",
        description: "Your card spending limits have been updated successfully.",
      });
      setShowLimitsDialog(false);
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: toUserFacingError(err, "Could not update limits."), variant: "destructive" });
    }
  });

  const handleFreezeCard = () => {
    if (card) {
      toggleCardStatusMutation.mutate(card.status === "active" ? "frozen" : "active");
    }
  };

  const handleDeleteCard = () => {
    setShowConfirmDelete(true);
  };

  const confirmDeleteCard = () => {
    deleteCardMutation.mutate();
  };

  const handleFundCard = () => {
    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to fund the card.",
        variant: "destructive",
      });
      return;
    }

    fundCardMutation.mutate(amount);
  };

  const handleUpdateLimits = () => {
    updateCardLimitsMutation.mutate(limitsForm);
  };

  // ── Secure reveal state ──────────────────────────────────────
  // The full details live ONLY in this component's state after a
  // successful password re-auth against manage-virtual-card. They
  // are auto-hidden after 30 seconds, cleared when the dialog
  // closes, and discarded on unmount/navigation — never persisted
  // anywhere (no storage, no URL, no query cache).
  const [showRevealDialog, setShowRevealDialog] = useState(false);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    cardNumber: string;
    cvv: string | null;
    expiry: string;
  } | null>(null);
  const [revealSecondsLeft, setRevealSecondsLeft] = useState(0);
  const [copiedRevealField, setCopiedRevealField] = useState<string | null>(null);

  const clearReveal = () => {
    setRevealed(null);
    setRevealPassword("");
    setRevealError(null);
    setRevealSecondsLeft(0);
    setCopiedRevealField(null);
  };

  useEffect(() => {
    if (!revealed) return;
    setRevealSecondsLeft(30);
    const started = Date.now();
    const timer = setInterval(() => {
      const left = 30 - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearReveal();
        setShowRevealDialog(false);
      } else {
        setRevealSecondsLeft(left);
      }
    }, 500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  useEffect(() => () => clearReveal(), []);

  const revealMutation = useMutation({
    mutationFn: async (password: string) => {
      const { data, error } = await supabase.functions.invoke('manage-virtual-card', {
        body: { action: 'reveal', cardId: id, password },
      });
      if (error) {
        // supabase-js wraps non-2xx; the function's crafted message
        // rides in the response body — surface it via the data path
        // below when present.
        throw new Error('reveal_failed');
      }
      return data;
    },
    onSuccess: (data) => {
      if (!data?.success) {
        setRevealError(data?.error || "Card details couldn't be shown.");
        return;
      }
      if (!data.vaulted) {
        setRevealError(data.message || "This card's full details can't be displayed again.");
        return;
      }
      if (!data.card) {
        setRevealError("These card details couldn't be shown right now. Please try again.");
        return;
      }
      setRevealError(null);
      setRevealPassword("");
      setRevealed({
        cardNumber: data.card.card_number,
        cvv: data.card.cvv ?? null,
        expiry: formatCardExpiry(data.card.expiry_date),
      });
    },
    onError: () => {
      setRevealError("That password didn't match your account, or details couldn't be shown. Card details stay hidden.");
    },
  });

  const copyRevealField = async (field: string, value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedRevealField(field);
      setTimeout(() => setCopiedRevealField(null), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access — copy the value by hand.",
        variant: "destructive",
      });
    }
  };

  // Virtual cards are "Coming soon" for the public (CEO decision,
  // 2026-10-22): card details and every card action on this page stay
  // admin-only until the Mastercard integration is built and tested.
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

  // super_admin is additive over admin — see VirtualCardNew.
  if (!hasRole("admin") && !hasRole("super_admin")) {
    return (
      <div className="min-h-screen flex flex-col bg-secondary/10">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
          <VirtualCardsComingSoon />
        </main>
        <Footer />
      </div>
    );
  }

  if (isLoading) {
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

  if (isError || !card) {
    navigate("/wallet");
    return null;
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold">{card.name}</h1>
            <p className="text-muted-foreground">BMaGlass Virtual Card</p>
          </div>
          <div className="flex space-x-2">
            <Button 
              variant={card.status === "active" ? "outline" : "default"}
              size="sm" 
              onClick={handleFreezeCard}
              disabled={toggleCardStatusMutation.isPending}
            >
              {toggleCardStatusMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : card.status === "active" ? (
                <Lock className="h-4 w-4 mr-1" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1" />
              )}
              {card.status === "active" ? "Freeze Card" : "Activate Card"}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteCard}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </div>
        </div>
        
        {/* Card Preview */}
        <Card className="mb-6 relative overflow-hidden bg-[#44464A]">
          <CardContent className="p-6 text-white">
            <div className="absolute top-4 right-4">
              <span className="text-sm font-bold tracking-widest">BMAGLASS PAY</span>
            </div>
            
            <div className="mb-6 pt-8">
              <div className="flex items-center mb-4">
                <div className="w-10 h-6 bg-white/20 rounded mr-2"></div>
                <div className="w-6 h-6 bg-white/30 rounded-full"></div>
              </div>
              
              <div className="font-mono text-xl mt-8 mb-6">
                {revealed ? revealed.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : card.masked_number}
              </div>

              <div className="flex justify-between text-sm">
                <div>
                  <div className="text-white/70">Card Holder</div>
                  <div>{(card.holderName || 'BMAGLASS PAY USER').toUpperCase()}</div>
                </div>
                <div>
                  <div className="text-white/70">Expires</div>
                  <div>{card.expiry}</div>
                </div>
                <div>
                  <div className="text-white/70">CVV</div>
                  <div>{revealed ? (revealed.cvv ?? '—') : '***'}</div>
                </div>
                <div>
                  <div className="text-white/70">Status</div>
                  <div>{card.status.charAt(0).toUpperCase() + card.status.slice(1)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground -mt-4 mb-2">
          This is an internal BMaGlass wallet card. It isn't a card-network or bank card and can't be used on card networks or for purchases outside BMaGlass Pay.
        </p>
        {card.hasVaultedDetails ? (
          <div className="flex items-center gap-3 mb-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { clearReveal(); setShowRevealDialog(true); }}
            >
              <Eye className="h-4 w-4 mr-1" /> Show card details
            </Button>
            <span className="text-xs text-muted-foreground">
              You'll confirm your password first. Details hide again automatically after 30 seconds.
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-6" data-testid="legacy-card-note">
            This card was created before secure card storage: its full number and CVV were shown once when it was created and can't be displayed again for this card.
          </p>
        )}
        
        {/* Card Details */}
        <div className="grid gap-6 mb-6 md:grid-cols-3">
          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-muted-foreground">Balance</div>
              <div className="text-2xl font-bold">{formatCurrency(card.balance)}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-muted-foreground">Status</div>
              <div className="flex items-center mt-1">
                <Badge variant={card.status === "active" ? "default" : "outline"} className="mr-2">
                  {card.status.charAt(0).toUpperCase() + card.status.slice(1)}
                </Badge>
                {card.status === "active" && (
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-muted-foreground">Created On</div>
              <div className="text-base font-medium">{formatDate(card.created_at)}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* Fund Card */}
        <Card className="mb-6 bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <h2 className="text-xl font-semibold mb-4">Fund Your Card</h2>
            <div className="flex space-x-4">
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                    K
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-8"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                onClick={handleFundCard}
                disabled={fundCardMutation.isPending}
              >
                {fundCardMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> 
                    Processing...
                  </>
                ) : (
                  "Add Funds"
                )}
              </Button>
            </div>
            {/* Fee breakdown BEFORE confirming — the funding fee
                (1%, minimum K2) used to be charged without ever
                being shown on this flow. Same breakdown style as
                the Fund page and Send Money. */}
            {(() => {
              const amt = parseFloat(fundAmount) || 0;
              return (
                <div className="p-4 bg-secondary/10 rounded-md mt-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Amount</span>
                    <span>{formatCurrency(amt)}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Fee (1%, minimum K2)</span>
                    <span>{formatCurrency(cardFundingFee(amt))}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t font-medium">
                    <span>Total from wallet</span>
                    <span>{formatCurrency(cardFundingTotal(amt))}</span>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
        
        {/* Transactions */}
        <Tabs defaultValue="transactions">
          <TabsList className="w-full">
            <TabsTrigger value="transactions" className="flex-1">Transactions</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">Card Settings</TabsTrigger>
          </TabsList>
          
          <TabsContent value="transactions" className="mt-6">
            {card.transactions && card.transactions.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Transaction History</CardTitle>
                  <CardDescription>
                    View all transactions made with this card
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {card.transactions.map((transaction: any) => (
                        <TableRow key={transaction.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                                transaction.type === "payment" ? "bg-red-100" : "bg-green-100"
                              }`}>
                                {transaction.type === "payment" ? (
                                  <ArrowUpRight className="h-4 w-4 text-red-600" />
                                ) : (
                                  <ArrowDownLeft className="h-4 w-4 text-green-600" />
                                )}
                              </div>
                              {transaction.description}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{formatDate(transaction.date)}</div>
                            <div className="text-xs text-muted-foreground">{formatTime(transaction.date)}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-right font-medium ${
                            transaction.type === "payment" ? "text-red-600" : "text-green-600"
                          }`}>
                            {transaction.type === "payment" ? "-" : "+"}
                            {formatCurrency(transaction.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center mb-4">
                    <RefreshCw className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-medium mb-2">No Transactions Yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Your transaction history will appear here once you start using this card.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="settings" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Card Settings</CardTitle>
                <CardDescription>
                  Configure your card's settings and spending limits
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Transaction Control</h3>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="online-switch">Online Transactions</Label>
                      <p className="text-sm text-muted-foreground">
                        Not available — this card only holds a balance inside BMaGlass Pay and can't be used for online purchases
                      </p>
                    </div>
                    <Switch
                      id="online-switch"
                      checked={false}
                      disabled
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="international-switch">International Transactions</Label>
                      <p className="text-sm text-muted-foreground">
                        Not available — this card can't be used internationally
                      </p>
                    </div>
                    <Switch
                      id="international-switch"
                      checked={false}
                      disabled
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium">Spending Limits</h3>
                      <p className="text-sm text-muted-foreground">
                        Control how much can be spent using this card
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowLimitsDialog(true)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Adjust Limits
                    </Button>
                  </div>
                  
                  <div className="grid gap-4 mt-2">
                    <div className="bg-secondary/20 p-3 rounded-md">
                      <div className="text-sm font-medium">Daily Limit</div>
                      <div className="text-lg font-semibold">{formatCurrency(card.limits?.daily || 0)}</div>
                    </div>
                    
                    <div className="bg-secondary/20 p-3 rounded-md">
                      <div className="text-sm font-medium">Per Transaction Limit</div>
                      <div className="text-lg font-semibold">{formatCurrency(card.limits?.transaction || 0)}</div>
                    </div>
                    
                    <div className="bg-secondary/20 p-3 rounded-md">
                      <div className="text-sm font-medium">Monthly Limit</div>
                      <div className="text-lg font-semibold">{formatCurrency(card.limits?.monthly || 0)}</div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <h3 className="text-lg font-medium mb-4">Card Details</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Card Number:</span>
                      <span className="font-mono">{card.masked_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Card Type:</span>
                      <span>{card.card_type.charAt(0).toUpperCase() + card.card_type.slice(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expiry Date:</span>
                      <span>{card.expiry}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />

      {/* Secure Reveal Dialog — password re-auth, then the full
          details with per-field copy; auto-hides after 30 seconds
          and clears on close. */}
      <Dialog
        open={showRevealDialog}
        onOpenChange={(open) => {
          setShowRevealDialog(open);
          if (!open) clearReveal();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Card details</DialogTitle>
            <DialogDescription>
              {revealed
                ? `These details hide again in ${revealSecondsLeft} seconds. Never share them with anyone.`
                : "Confirm it's you: enter your account password to view this card's full number and CVV."}
            </DialogDescription>
          </DialogHeader>
          {revealed ? (
            <div className="space-y-3 py-2">
              {[
                { field: 'number', label: 'Card number', value: revealed.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 '), raw: revealed.cardNumber },
                { field: 'expiry', label: 'Expiry', value: revealed.expiry, raw: revealed.expiry },
                { field: 'cvv', label: 'CVV', value: revealed.cvv ?? 'Not set for this card', raw: revealed.cvv },
              ].map((row) => (
                <div key={row.field} className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-muted-foreground">{row.label}</div>
                    <div className="font-mono text-base">{row.value}</div>
                  </div>
                  {row.raw && (
                    <Button variant="ghost" size="sm" onClick={() => copyRevealField(row.field, row.raw)}>
                      {copiedRevealField === row.field ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label htmlFor="reveal-password">Account password</Label>
                <Input
                  id="reveal-password"
                  type="password"
                  autoComplete="current-password"
                  value={revealPassword}
                  onChange={(e) => setRevealPassword(e.target.value)}
                />
              </div>
              {revealError && <p className="text-sm text-destructive">{revealError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowRevealDialog(false); clearReveal(); }}
            >
              {revealed ? "Hide details" : "Cancel"}
            </Button>
            {!revealed && (
              <Button
                onClick={() => revealMutation.mutate(revealPassword)}
                disabled={!revealPassword || revealMutation.isPending}
              >
                {revealMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Checking…
                  </>
                ) : (
                  "Show details"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Virtual Card</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this virtual card? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDeleteCard}
              disabled={deleteCardMutation.isPending}
            >
              {deleteCardMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Card"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Limits Dialog */}
      <Dialog open={showLimitsDialog} onOpenChange={setShowLimitsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Card Limits</DialogTitle>
            <DialogDescription>
              Set spending limits for your virtual card.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="daily-limit">Daily Limit (K)</Label>
              <Input 
                id="daily-limit"
                type="number" 
                value={limitsForm.daily} 
                onChange={(e) => setLimitsForm({...limitsForm, daily: Number(e.target.value)})}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="transaction-limit">Transaction Limit (K)</Label>
              <Input 
                id="transaction-limit"
                type="number" 
                value={limitsForm.transaction} 
                onChange={(e) => setLimitsForm({...limitsForm, transaction: Number(e.target.value)})}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="monthly-limit">Monthly Limit (K)</Label>
              <Input 
                id="monthly-limit"
                type="number" 
                value={limitsForm.monthly} 
                onChange={(e) => setLimitsForm({...limitsForm, monthly: Number(e.target.value)})}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowLimitsDialog(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateLimits}
              disabled={updateCardLimitsMutation.isPending}
            >
              {updateCardLimitsMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Limits"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VirtualCardDetails;
