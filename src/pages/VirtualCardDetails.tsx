
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { ArrowUpRight, ArrowDownLeft, ShieldCheck, Copy, Eye, EyeOff, RefreshCw, Trash2, Lock, Settings } from "lucide-react";
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
// In a real app, this would fetch from API
const fetchVirtualCard = async (cardId: string) => {
  // Mock fetch function
  const mockCards = {
    "card_1": {
      id: "card_1",
      name: "Shopping Card",
      number: "4111 2222 3333 4444",
      masked_number: "**** **** **** 4444",
      cvv: "123",
      expiry: "12/25",
      balance: 350.00,
      status: "active",
      provider: "visa",
      card_type: "virtual",
      created_at: "2023-10-01T12:00:00Z",
      updated_at: "2023-10-01T12:00:00Z",
      currency: "ZMW",
      transactions: [
        { 
          id: 1, 
          type: "payment", 
          amount: 29.99, 
          description: "Netflix Subscription", 
          date: "2023-10-15T08:30:00Z",
          status: "completed"
        },
        { 
          id: 2, 
          type: "funding", 
          amount: 100.00, 
          description: "Card Funding", 
          date: "2023-10-10T14:15:00Z",
          status: "completed"
        },
        { 
          id: 3, 
          type: "payment", 
          amount: 42.50, 
          description: "Amazon Purchase", 
          date: "2023-10-05T18:20:00Z",
          status: "completed"
        }
      ],
      limits: {
        daily: 5000,
        monthly: 50000,
        transaction: 2000
      },
      settings: {
        online_transactions: true,
        international_transactions: false
      }
    },
    "card_2": {
      id: "card_2",
      name: "Subscription Card",
      number: "5111 2222 3333 4444",
      masked_number: "**** **** **** 4444",
      cvv: "456",
      expiry: "06/26",
      balance: 125.50,
      status: "active",
      provider: "mastercard",
      card_type: "virtual",
      created_at: "2023-09-15T10:30:00Z",
      updated_at: "2023-09-15T10:30:00Z",
      currency: "ZMW",
      transactions: [
        { 
          id: 1, 
          type: "payment", 
          amount: 9.99, 
          description: "Spotify Premium", 
          date: "2023-10-12T07:45:00Z",
          status: "completed"
        },
        { 
          id: 2, 
          type: "funding", 
          amount: 50.00, 
          description: "Card Funding", 
          date: "2023-10-01T11:30:00Z",
          status: "completed"
        }
      ],
      limits: {
        daily: 2000,
        monthly: 20000,
        transaction: 1000
      },
      settings: {
        online_transactions: true,
        international_transactions: false
      }
    }
  };

  return mockCards[cardId as keyof typeof mockCards];
};

const VirtualCardDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCardDetails, setShowCardDetails] = useState(false);
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

  // Card status mutation
  const toggleCardStatusMutation = useMutation({
    mutationFn: async (newStatus: 'active' | 'frozen') => {
      // In a real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 500));
      return { ...card, status: newStatus };
    },
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['virtualCard', id], updatedCard);
      toast({
        title: updatedCard.status === 'active' ? 'Card Activated' : 'Card Frozen',
        description: updatedCard.status === 'active' 
          ? "Your virtual card has been activated." 
          : "Your virtual card has been temporarily frozen.",
      });
    }
  });

  // Card funding mutation
  const fundCardMutation = useMutation({
    mutationFn: async (amount: number) => {
      // In a real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 500));
      const newBalance = (card?.balance || 0) + amount;
      const newTransaction = {
        id: Date.now(),
        type: "funding",
        amount: amount,
        description: "Card Funding",
        date: new Date().toISOString(),
        status: "completed"
      };
      return { 
        ...card, 
        balance: newBalance,
        transactions: [newTransaction, ...(card?.transactions || [])]
      };
    },
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['virtualCard', id], updatedCard);
      toast({
        title: "Card Funded",
        description: `${formatCurrency(Number(fundAmount))} has been added to your card.`,
      });
      setFundAmount("50");
    }
  });

  // Card delete mutation
  const deleteCardMutation = useMutation({
    mutationFn: async () => {
      // In a real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    },
    onSuccess: () => {
      toast({
        title: "Card Deleted",
        description: "Your virtual card has been permanently deleted.",
      });
      navigate("/wallet");
    }
  });

  // Card limits mutation
  const updateCardLimitsMutation = useMutation({
    mutationFn: async (limits: typeof limitsForm) => {
      // In a real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 500));
      return { 
        ...card,
        limits: limits
      };
    },
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['virtualCard', id], updatedCard);
      toast({
        title: "Card Limits Updated",
        description: "Your card spending limits have been updated successfully.",
      });
      setShowLimitsDialog(false);
    }
  });

  // Card settings mutation
  const updateCardSettingsMutation = useMutation({
    mutationFn: async (settings: { 
      online_transactions: boolean,
      international_transactions: boolean 
    }) => {
      // In a real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 500));
      return { 
        ...card,
        settings: settings
      };
    },
    onSuccess: (updatedCard) => {
      queryClient.setQueryData(['virtualCard', id], updatedCard);
      toast({
        title: "Card Settings Updated",
        description: "Your card settings have been updated successfully.",
      });
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

  const handleCopyCardNumber = () => {
    if (card) {
      navigator.clipboard.writeText(card.number);
      toast({
        title: "Copied to Clipboard",
        description: "Card number has been copied to clipboard.",
      });
    }
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

  const handleToggleSetting = (setting: 'online_transactions' | 'international_transactions') => {
    if (card && card.settings) {
      const updatedSettings = {
        ...card.settings,
        [setting]: !card.settings[setting]
      };
      updateCardSettingsMutation.mutate(updatedSettings);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-secondary/10">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
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
      <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold">{card.name}</h1>
            <p className="text-muted-foreground">{card.provider.charAt(0).toUpperCase() + card.provider.slice(1)} Virtual Card</p>
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
        <Card className={`mb-6 relative overflow-hidden ${
          card.provider === 'visa' ? 'bg-gradient-to-r from-blue-800 to-blue-600' : 
          card.provider === 'mastercard' ? 'bg-gradient-to-r from-red-800 to-orange-600' : 
          'bg-gradient-to-r from-gray-800 to-gray-600'
        }`}>
          <CardContent className="p-6 text-white">
            <div className="absolute top-4 right-4">
              {card.provider === "visa" ? (
                <svg className="h-8" viewBox="0 0 512 512" fill="white">
                  <path d="M211.7,184.4l-26.4,125.1h-33L178.7,184.4Zm221,125.1-3.1-15.3c-5.7,0-22.8,0-39.9-8.2c-16.7-7.5-25.2-19.3-25.2-19.3l9.1-56.5H406l7.5-33H380.9l7.9-39.7H352.4l-7.9,39.7H312.2l-7.5,33h33l-6.9,41.7c-2.5,16.4,9.1,17.8,15.2,17.8h28.1l-3.8,15.3ZM222,309.5,272,184.4H236.5L206.4,266l-11.3-81.6H165.8L135,309.5h31.8l7.9-39.7h42.2l3.8,39.7Z"/>
                </svg>
              ) : card.provider === "mastercard" ? (
                <svg className="h-8" viewBox="0 0 512 512" fill="white">
                  <path d="M221.6,272a42.32,42.32,0,1,1,42.32-42.32A42.32,42.32,0,0,1,221.6,272Zm67.4,0a42.32,42.32,0,1,0,0-84.64,42.32,42.32,0,0,0,0,84.64Z"/>
                </svg>
              ) : (
                <span className="text-xl font-bold">{card.provider}</span>
              )}
            </div>
            
            <div className="mb-6 pt-8">
              <div className="flex items-center mb-4">
                <div className="w-10 h-6 bg-white/20 rounded mr-2"></div>
                <div className="w-6 h-6 bg-white/30 rounded-full"></div>
              </div>
              
              <div className="font-mono text-xl mt-8 mb-6">
                {showCardDetails ? card.number : card.masked_number}
                <button 
                  onClick={() => setShowCardDetails(!showCardDetails)}
                  className="ml-2 text-white/70 hover:text-white transition-colors"
                >
                  {showCardDetails ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button 
                  onClick={handleCopyCardNumber}
                  className="ml-2 text-white/70 hover:text-white transition-colors"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              
              <div className="flex justify-between text-sm">
                <div>
                  <div className="text-white/70">Card Holder</div>
                  <div>BMAGLASS PAY USER</div>
                </div>
                <div>
                  <div className="text-white/70">Expires</div>
                  <div>{card.expiry}</div>
                </div>
                <div>
                  <div className="text-white/70">CVV</div>
                  <div>{showCardDetails ? card.cvv : "***"}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
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
                        Allow card to be used for online purchases
                      </p>
                    </div>
                    <Switch 
                      id="online-switch"
                      checked={card.settings?.online_transactions} 
                      onCheckedChange={() => handleToggleSetting('online_transactions')}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="international-switch">International Transactions</Label>
                      <p className="text-sm text-muted-foreground">
                        Allow card to be used internationally
                      </p>
                    </div>
                    <Switch 
                      id="international-switch"
                      checked={card.settings?.international_transactions} 
                      onCheckedChange={() => handleToggleSetting('international_transactions')}
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
