
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { ArrowUpRight, ArrowDownLeft, ShieldCheck, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// This would come from an API in a real application
const mockVirtualCardData = {
  1: {
    id: 1,
    name: "Shopping Card",
    number: "4111 2222 3333 4444",
    maskedNumber: "**** **** **** 4444",
    cvv: "123",
    expiry: "12/25",
    balance: 350.00,
    status: "active",
    provider: "Visa",
    type: "debit",
    createdAt: "2023-10-01T12:00:00Z",
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
    ]
  },
  2: {
    id: 2,
    name: "Subscription Card",
    number: "5111 2222 3333 4444",
    maskedNumber: "**** **** **** 4444",
    cvv: "456",
    expiry: "06/26",
    balance: 125.50,
    status: "active",
    provider: "Mastercard",
    type: "prepaid",
    createdAt: "2023-09-15T10:30:00Z",
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
    ]
  }
};

const VirtualCardDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const cardId = id ? parseInt(id) : 0;
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCardDetails, setShowCardDetails] = useState(false);
  const [fundAmount, setFundAmount] = useState<string>("50");

  useEffect(() => {
    // In a real app, this would fetch the card details from an API
    setTimeout(() => {
      if (mockVirtualCardData[cardId as keyof typeof mockVirtualCardData]) {
        setCard(mockVirtualCardData[cardId as keyof typeof mockVirtualCardData]);
      } else {
        navigate("/wallet");
        toast({
          title: "Card Not Found",
          description: "The requested virtual card could not be found.",
          variant: "destructive",
        });
      }
      setLoading(false);
    }, 500);
  }, [cardId, navigate, toast]);

  const handleFreezeCard = () => {
    // In a real app, this would make an API call to freeze/unfreeze the card
    toast({
      title: card.status === "active" ? "Card Frozen" : "Card Activated",
      description: card.status === "active" 
        ? "Your virtual card has been temporarily frozen." 
        : "Your virtual card has been activated.",
    });
    setCard({ ...card, status: card.status === "active" ? "frozen" : "active" });
  };

  const handleDeleteCard = () => {
    // In a real app, this would make an API call to delete the card
    toast({
      title: "Card Deleted",
      description: "Your virtual card has been permanently deleted.",
    });
    navigate("/wallet");
  };

  const handleCopyCardNumber = () => {
    navigator.clipboard.writeText(card.number);
    toast({
      title: "Copied to Clipboard",
      description: "Card number has been copied to clipboard.",
    });
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

    // In a real app, this would make an API call to fund the card
    toast({
      title: "Card Funded",
      description: `${formatCurrency(amount)} has been added to your card.`,
    });
    
    // Update the card balance locally
    setCard({
      ...card,
      balance: card.balance + amount,
      transactions: [
        { 
          id: card.transactions.length + 1, 
          type: "funding", 
          amount: amount, 
          description: "Card Funding", 
          date: new Date().toISOString(),
          status: "completed"
        },
        ...card.transactions
      ]
    });
    
    setFundAmount("50"); // Reset the form
  };

  if (loading) {
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

  if (!card) return null;

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
            <p className="text-muted-foreground">{card.provider} Virtual Card</p>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" onClick={handleFreezeCard}>
              {card.status === "active" ? "Freeze Card" : "Activate Card"}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteCard}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </div>
        </div>
        
        {/* Card Preview */}
        <Card className={`mb-6 relative overflow-hidden ${
          card.provider.toLowerCase() === 'visa' ? 'bg-gradient-to-r from-blue-800 to-blue-600' : 
          card.provider.toLowerCase() === 'mastercard' ? 'bg-gradient-to-r from-red-800 to-orange-600' : 
          'bg-gradient-to-r from-gray-800 to-gray-600'
        }`}>
          <CardContent className="p-6 text-white">
            <div className="absolute top-4 right-4">
              {card.provider === "Visa" ? (
                <svg className="h-8" viewBox="0 0 512 512" fill="white">
                  <path d="M211.7,184.4l-26.4,125.1h-33L178.7,184.4Zm221,125.1-3.1-15.3c-5.7,0-22.8,0-39.9-8.2c-16.7-7.5-25.2-19.3-25.2-19.3l9.1-56.5H406l7.5-33H380.9l7.9-39.7H352.4l-7.9,39.7H312.2l-7.5,33h33l-6.9,41.7c-2.5,16.4,9.1,17.8,15.2,17.8h28.1l-3.8,15.3ZM222,309.5,272,184.4H236.5L206.4,266l-11.3-81.6H165.8L135,309.5h31.8l7.9-39.7h42.2l3.8,39.7Z"/>
                </svg>
              ) : card.provider === "Mastercard" ? (
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
                {showCardDetails ? card.number : card.maskedNumber}
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
              <div className="text-base font-medium">{formatDate(card.createdAt)}</div>
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
              <Button onClick={handleFundCard}>Add Funds</Button>
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
            {card.transactions.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {card.transactions.map((transaction: any) => (
                      <div key={transaction.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            transaction.type === "payment" ? "bg-red-100" : "bg-green-100"
                          }`}>
                            {transaction.type === "payment" ? (
                              <ArrowUpRight className="h-5 w-5 text-red-600" />
                            ) : (
                              <ArrowDownLeft className="h-5 w-5 text-green-600" />
                            )}
                          </div>
                          <div className="ml-4">
                            <div className="font-medium">
                              {transaction.description}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatDate(transaction.date)} at {formatTime(transaction.date)}
                            </div>
                          </div>
                        </div>
                        <div className={`font-medium ${transaction.type === "payment" ? "text-red-600" : "text-green-600"}`}>
                          {transaction.type === "payment" ? "-" : "+"}K {transaction.amount.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
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
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Online Transactions</h3>
                    <p className="text-sm text-muted-foreground">
                      Allow card to be used for online purchases
                    </p>
                  </div>
                  <div className="flex h-6">
                    <Button variant="outline" size="sm">Enabled</Button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">International Transactions</h3>
                    <p className="text-sm text-muted-foreground">
                      Allow card to be used internationally
                    </p>
                  </div>
                  <div className="flex h-6">
                    <Button variant="outline" size="sm">Disabled</Button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Card Limits</h3>
                    <p className="text-sm text-muted-foreground">
                      Maximum transaction limit: {formatCurrency(2000)}
                    </p>
                  </div>
                  <div className="flex h-6">
                    <Button variant="outline" size="sm">Edit</Button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Rename Card</h3>
                    <p className="text-sm text-muted-foreground">
                      Current name: {card.name}
                    </p>
                  </div>
                  <div className="flex h-6">
                    <Button variant="outline" size="sm">Rename</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default VirtualCardDetails;
