
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { PlusCircle, ArrowDownLeft, ArrowUpRight, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import VirtualCardList from "@/components/wallet/VirtualCardList";
import PaymentMethodList from "@/components/wallet/PaymentMethodList";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { paymentMethods, mockVirtualCards, getWalletBalance } from "@/data/mockData";

const Wallet = () => {
  const navigate = useNavigate();
  const walletBalance = getWalletBalance();
  
  // Convert our object to array for the list component
  const virtualCardsArray = Object.values(mockVirtualCards);
  
  const handleSendMoney = () => {
    navigate("/transfer");
  };
  
  const handleAddMoney = () => {
    navigate("/checkout", { state: { productName: "Wallet Top-up", amount: 100 } });
  };

  const handleCreateVirtualCard = () => {
    navigate("/virtual-card/new");
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Wallet</h1>
          <Button onClick={handleAddMoney}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Money
          </Button>
        </div>
        
        {/* Balance Card */}
        <Card className="mb-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Available Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mb-4">{formatCurrency(walletBalance)}</div>
            <div className="flex space-x-4">
              <Button onClick={handleSendMoney}>
                <ArrowUpRight className="mr-2 h-4 w-4" /> Send
              </Button>
              <Button variant="outline">
                <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
              </Button>
            </div>
          </CardContent>
        </Card>
        
        {/* Quick Transfer Card */}
        <Card className="mb-8 bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4">Quick Money Transfer</h2>
            <p className="text-muted-foreground mb-4">
              Transfer money to another BMaGlass Pay account instantly with no fees.
            </p>
            <Button onClick={handleSendMoney} className="w-full">
              Transfer Money <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
        
        {/* Virtual Cards Section */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Virtual Cards</h2>
            <Button onClick={handleCreateVirtualCard}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Card
            </Button>
          </div>
          
          <VirtualCardList 
            virtualCards={virtualCardsArray} 
            onCreateCard={handleCreateVirtualCard} 
          />
        </div>
        
        {/* Tabs for Payment Methods and Transaction History */}
        <Tabs defaultValue="payment-methods" className="mb-8">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>
            <TabsTrigger value="transaction-history">Transaction History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="payment-methods" className="mt-6">
            <PaymentMethodList paymentMethods={paymentMethods} />
          </TabsContent>
          
          <TabsContent value="transaction-history" className="mt-6">
            <TransactionHistory />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Wallet;
