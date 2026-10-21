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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWallet } from "@/hooks/useWallet";
import { usePayPalDepositReturn } from "@/hooks/usePayPalDepositReturn";
import { useAccount } from "@/contexts/AccountContext";
import { useToast } from "@/hooks/use-toast";

const Wallet = () => {
  const navigate = useNavigate();
  const { selectedAccountId, selectedAccountName } = useAccount();
  const { wallet, isLoading, deposit, isDepositing } = useWallet(selectedAccountId);
  const { paymentMethods } = usePaymentMethods();
  const [amount, setAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("mobile_money");
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // Completes a PayPal deposit when the user returns from approval
  // (/wallet?paypal_return=deposit&token=<order id>).
  usePayPalDepositReturn();

  const handleSendMoney = () => {
    navigate("/transfer");
  };
  
  const handleAddMoney = () => {
    const parsedAmount = parseFloat(amount);
    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      // Target the wallet of the account the user is viewing — never
      // an arbitrary wallet on the account.
      deposit({
        amount: parsedAmount,
        paymentMethod: depositMethod,
        walletId: wallet?.id,
        currency: wallet?.currency,
      });
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
      <div className="space-y-2">
        <Label htmlFor="deposit-method" className="text-sm font-medium">
          Deposit method
        </Label>
        <Select value={depositMethod} onValueChange={setDepositMethod}>
          <SelectTrigger id="deposit-method">
            <SelectValue placeholder="Select deposit method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mobile_money">Mobile Money</SelectItem>
            <SelectItem value="paypal">PayPal</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground text-center">
          {depositMethod === 'paypal'
            ? "You'll be redirected to PayPal. Your wallet is credited once the payment is confirmed."
            : "Mobile money deposits are not live yet — you'll be told before anything is charged."}
        </p>
      </div>
      <Button 
        onClick={handleAddMoney} 
        className="w-full h-12 rounded-full text-base font-semibold" 
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
        <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <div className="flex justify-between items-center mb-8">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-11 w-32 rounded-full" />
          </div>
          <Skeleton className="h-48 rounded-[24px] mb-8" />
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
      <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">Wallet</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your money and cards
              {selectedAccountId && <> · Viewing <span className="font-medium text-foreground">{selectedAccountName}</span></>}
            </p>
          </div>
          
          {isMobile ? (
            <Drawer>
              <DrawerTrigger asChild>
                <Button className="h-11 px-5 rounded-full font-semibold">
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
                <Button className="h-11 px-5 rounded-full font-semibold">
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
        <WalletBalance onSendMoney={handleSendMoney} accountId={selectedAccountId} />
        
        {/* Quick Actions */}
        <QuickActions />
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Virtual Cards */}
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Virtual Cards</CardTitle>
                  </div>
                  <Button variant="link" size="sm" onClick={() => navigate('/wallet')} className="font-medium px-0">
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
            <Card className="h-full">
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
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Recent Activity</CardTitle>
              </div>
              <Button variant="link" size="sm" onClick={() => navigate('/transactions')} className="font-medium px-0">
                View all <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <TransactionHistory limit={5} showFilters={false} embedded />
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Wallet;
