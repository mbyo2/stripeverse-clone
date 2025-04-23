import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { PlusCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import VirtualCardManager from "@/components/wallet/VirtualCardManager";
import PaymentMethodList from "@/components/wallet/PaymentMethodList";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { paymentMethods, getWalletBalance } from "@/data/mockData";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

// Simple error boundary component
const ErrorBoundary = ({ children, fallback }: { children: React.ReactNode, fallback: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  
  useEffect(() => {
    const errorHandler = (error: ErrorEvent) => {
      console.error("Error caught by error boundary:", error);
      setHasError(true);
    };
    
    window.addEventListener('error', errorHandler);
    return () => window.removeEventListener('error', errorHandler);
  }, []);
  
  return hasError ? <>{fallback}</> : <>{children}</>;
};

const VirtualCardFallback = () => {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-center text-muted-foreground">
          Unable to load virtual cards. Please try again later.
        </p>
      </CardContent>
    </Card>
  );
};

const TransactionHistoryFallback = () => {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-center text-muted-foreground">
          Unable to load transaction history. Please try again later.
        </p>
      </CardContent>
    </Card>
  );
};

const Wallet = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const walletBalance = getWalletBalance();
  const [isLoading, setIsLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const isMobile = useIsMobile();
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);
    return () => clearTimeout(timer);
  }, []);
  
  const handleSendMoney = () => {
    toast({
      title: "Initiating Transfer",
      description: "Taking you to the transfer page..."
    });
    navigate("/transfer");
  };
  
  const handleAddMoney = () => {
    const parsedAmount = parseFloat(amount);
    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      toast({
        title: "Processing Top-up",
        description: `Adding ${formatCurrency(parsedAmount)} to your wallet`
      });
      navigate("/checkout", { 
        state: { 
          productName: "Wallet Top-up", 
          amount: parsedAmount 
        } 
      });
    }
  };

  const handleReceiveMoney = () => {
    toast({
      title: "Receive Money",
      description: "Your payment details have been copied to clipboard"
    });
  };

  const AddMoneyContent = () => (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <label htmlFor="amount" className="text-sm font-medium">
          Enter Amount
        </label>
        <Input
          id="amount"
          type="number"
          placeholder="Enter amount to add"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="text-lg"
          min="0"
        />
      </div>
      <Button 
        onClick={handleAddMoney} 
        className="w-full" 
        disabled={!amount || parseFloat(amount) <= 0}
      >
        Add Money
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Wallet</h1>
          {isMobile ? (
            <Drawer>
              <DrawerTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Money
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Add Money to Wallet</DrawerTitle>
                </DrawerHeader>
                <AddMoneyContent />
              </DrawerContent>
            </Drawer>
          ) : (
            <Dialog>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Money
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Money to Wallet</DialogTitle>
                </DialogHeader>
                <AddMoneyContent />
              </DialogContent>
            </Dialog>
          )}
        </div>
        
        {/* Enhanced Balance Card */}
        <Card className="mb-8 bg-gradient-to-br from-blue-500 to-blue-600 text-white transform hover:scale-105 transition-all duration-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium opacity-90">Available Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mb-4">{formatCurrency(walletBalance)}</div>
            <div className="flex space-x-4">
              <Button onClick={handleSendMoney} variant="secondary" className="flex-1 hover:bg-white hover:text-blue-600">
                <ArrowUpRight className="mr-2 h-4 w-4" /> Send
              </Button>
              <Button onClick={handleReceiveMoney} variant="secondary" className="flex-1 hover:bg-white hover:text-blue-600">
                <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
              </Button>
            </div>
          </CardContent>
        </Card>
        
        {/* Virtual Cards Section */}
        <div className="mb-8 animate-fadeIn">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Virtual Cards</h2>
          </div>
          <ErrorBoundary fallback={<VirtualCardFallback />}>
            <VirtualCardManager maxCards={5} />
          </ErrorBoundary>
        </div>
        
        {/* Enhanced Tabs */}
        <Tabs defaultValue="payment-methods" className="mb-8">
          <TabsList className="grid w-full grid-cols-2 bg-gradient-to-r from-blue-100 to-purple-100">
            <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>
            <TabsTrigger value="transaction-history">Transaction History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="payment-methods" className="mt-6">
            <PaymentMethodList paymentMethods={paymentMethods} />
          </TabsContent>
          
          <TabsContent value="transaction-history" className="mt-6">
            <ErrorBoundary fallback={<TransactionHistoryFallback />}>
              <TransactionHistory limit={5} />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Wallet;
