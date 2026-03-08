import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WalletBalance from "@/components/wallet/WalletBalance";
import QuickActions from "@/components/wallet/QuickActions";
import VirtualCardManager from "@/components/wallet/VirtualCardManager";
import PaymentMethodList from "@/components/wallet/PaymentMethodList";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { PlusCircle, Wallet as WalletIcon, CreditCard, Clock, ArrowRight, ChevronRight } from "lucide-react";
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

  const AddMoneyContent = () => (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <Label htmlFor="amount" className="text-sm font-medium">
          Amount to add
        </Label>
        <Input
          id="amount"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="text-2xl h-14 font-semibold text-center rounded-lg"
          min="0"
        />
        <p className="text-xs text-muted-foreground text-center">Enter the amount you want to add to your wallet</p>
      </div>
      <Button 
        onClick={handleAddMoney} 
        className="w-full h-12 rounded-lg text-base font-semibold" 
        disabled={!amount || parseFloat(amount) <= 0 || isDepositing}
      >
        {isDepositing ? "Processing..." : "Add Money"}
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-muted/30">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
          <div className="flex justify-between items-center mb-8">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-11 w-32 rounded-lg" />
          </div>
          <Skeleton className="h-48 rounded-xl mb-8" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 rounded-xl mb-8" />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <WalletIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Wallet</h1>
              <p className="text-sm text-muted-foreground">Manage your money and cards</p>
            </div>
          </div>
          
          {isMobile ? (
            <Drawer>
              <DrawerTrigger asChild>
                <Button className="h-11 px-5 rounded-lg font-semibold">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Money
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader className="text-center">
                  <DrawerTitle>Add Money to Wallet</DrawerTitle>
                </DrawerHeader>
                <AddMoneyContent />
              </DrawerContent>
            </Drawer>
          ) : (
            <Dialog>
              <DialogTrigger asChild>
                <Button className="h-11 px-5 rounded-lg font-semibold">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Money
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Money to Wallet</DialogTitle>
                </DialogHeader>
                <AddMoneyContent />
              </DialogContent>
            </Dialog>
          )}
        </div>
        
        {/* Wallet Balance Hero */}
        <WalletBalance onSendMoney={handleSendMoney} />
        
        {/* Quick Actions */}
        <QuickActions />
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Virtual Cards */}
          <div className="lg:col-span-2">
            <Card className="border-0 shadow-sm h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Virtual Cards</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/wallet')} className="text-primary">
                    View all <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
                <CardDescription>Manage your virtual payment cards</CardDescription>
              </CardHeader>
              <CardContent>
                <VirtualCardManager maxCards={3} />
              </CardContent>
            </Card>
          </div>
          
          {/* Payment Methods */}
          <div className="lg:col-span-1">
            <Card className="border-0 shadow-sm h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Payment Methods</CardTitle>
                <CardDescription>Your linked accounts</CardDescription>
              </CardHeader>
              <CardContent>
                <PaymentMethodList paymentMethods={paymentMethods} />
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Recent Transactions */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Recent Activity</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/transactions')} className="text-primary">
                View all <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <TransactionHistory limit={5} />
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Wallet;
