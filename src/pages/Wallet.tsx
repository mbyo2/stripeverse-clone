
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WalletBalance from "@/components/wallet/WalletBalance";
import QuickActions from "@/components/wallet/QuickActions";
import VirtualCardManager from "@/components/wallet/VirtualCardManager";
import PaymentMethodList from "@/components/wallet/PaymentMethodList";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { PlusCircle } from "lucide-react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";

const Wallet = () => {
  const navigate = useNavigate();
  const { isLoading, deposit, isDepositing } = useWallet();
  const { paymentMethods } = usePaymentMethods();
  const [amount, setAmount] = useState("");
  const isMobile = useIsMobile();
  const { toast } = useToast();
  
  const handleSendMoney = () => {
    navigate("/transfer");
  };
  
  const handleAddMoney = () => {
    const parsedAmount = parseFloat(amount);
    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      deposit({ amount: parsedAmount, paymentMethod: 'mobile_money' });
      setAmount("");
    }
  };

  const handleReceiveMoney = () => {
    toast({
      title: "Receive Money",
      description: "QR code generation feature coming soon",
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
        disabled={!amount || parseFloat(amount) <= 0 || isDepositing}
      >
        {isDepositing ? "Processing..." : "Add Money"}
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
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
        
        {/* Wallet Balance */}
        <WalletBalance 
          onSendMoney={handleSendMoney}
          onReceiveMoney={handleReceiveMoney}
        />
        
        {/* Quick Actions */}
        <QuickActions />
        
        {/* Virtual Cards Section */}
        <div className="mb-8 animate-fadeIn">
          <VirtualCardManager maxCards={5} />
        </div>
        
        {/* Enhanced Tabs */}
        <Tabs defaultValue="payment-methods" className="mb-8">
          <TabsList className="grid w-full grid-cols-2 bg-muted">
            <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>
            <TabsTrigger value="transaction-history">Transaction History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="payment-methods" className="mt-6">
            <PaymentMethodList paymentMethods={paymentMethods} />
          </TabsContent>
          
          <TabsContent value="transaction-history" className="mt-6">
            <TransactionHistory limit={5} />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Wallet;
