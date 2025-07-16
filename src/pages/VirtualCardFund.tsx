
import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { ArrowRight, Wallet } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

const VirtualCardFund = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { virtualCards } = useWallet();
  const [amount, setAmount] = useState<string>("50");
  const [loading, setLoading] = useState(false);
  
  // Get cardId from location state
  const cardId = location.state?.cardId;
  
  // Use useMemo for card data to avoid unnecessary recalculations
  const card = useMemo(() => {
    if (!cardId) return null;
    return virtualCards.find(card => card.id === cardId) || null;
  }, [cardId, virtualCards]);
  
  useEffect(() => {
    if (!cardId) {
      navigate("/wallet");
      return;
    }
    
    if (!card) {
      navigate("/wallet");
      toast({
        title: "Card Not Found",
        description: "The virtual card you're trying to fund could not be found.",
        variant: "destructive",
      });
    }
  }, [cardId, card, navigate, toast]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d{0,2}$/.test(value)) {
      setAmount(value);
    }
  };

  // Memoize calculated values
  const parsedAmount = useMemo(() => parseFloat(amount) || 0, [amount]);
  const fee = useMemo(() => Math.max(parsedAmount * 0.01, 2), [parsedAmount]);
  const total = useMemo(() => parsedAmount + fee, [parsedAmount, fee]);

  const handleFundCard = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount to fund the card.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    
    // In a real app, this would make an API call to fund the card
    setTimeout(() => {
      setLoading(false);
      toast({
        title: "Card Funded Successfully",
        description: `${formatCurrency(parsedAmount)} has been added to your ${card?.name}.`,
      });
      navigate(`/virtual-card/${cardId}`);
    }, 1500);
  };

  if (!card) {
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

  // Quick fund options component
  const QuickFundOptions = () => (
    <Card>
      <CardHeader>
        <CardTitle>Quick Fund Options</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {[50, 100, 200, 500, 1000, 2000].map((value) => (
            <Button 
              key={value} 
              variant="outline"
              onClick={() => setAmount(value.toString())}
            >
              {formatCurrency(value)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Fund Virtual Card</h1>
          <p className="text-muted-foreground mt-2">
            Add funds to your virtual card from your main wallet.
          </p>
        </div>
        
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add Funds</CardTitle>
            <CardDescription>
              The amount will be deducted from your main wallet balance and added to your virtual card.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleFundCard}>
              <div className="space-y-4">
                <div className="p-4 bg-secondary/20 rounded-md">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mr-3">
                      <Wallet className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium">{card.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {card.provider} • {card.masked_number}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t">
                    <div className="text-sm text-muted-foreground">Current Balance</div>
                    <div className="font-medium">{formatCurrency(card.balance)}</div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="amount">Fund Amount</Label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                      K
                    </div>
                    <Input
                      id="amount"
                      type="text"
                      className="pl-8"
                      value={amount}
                      onChange={handleAmountChange}
                      placeholder="Enter amount"
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Funding fee: 1% (minimum K 2.00)
                  </p>
                </div>
                
                <div className="p-4 bg-secondary/10 rounded-md mt-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Amount</span>
                    <span>{formatCurrency(parsedAmount)}</span>
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Fee (1%)</span>
                    <span>{formatCurrency(fee)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t font-medium">
                    <span>Total</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
                
                <div className="pt-4">
                  <Button type="submit" className="w-full" disabled={loading || !amount || parsedAmount <= 0}>
                    {loading ? "Processing..." : "Fund Card"} {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full mt-2" 
                    onClick={() => navigate(`/virtual-card/${cardId}`)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
        
        <QuickFundOptions />
      </main>
      <Footer />
    </div>
  );
};

export default VirtualCardFund;
