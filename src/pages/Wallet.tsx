
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { PlusCircle, CreditCard, Landmark, ArrowDownLeft, ArrowUpRight, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// Mock payment methods
const paymentMethods = [
  { id: 1, type: "card", name: "Visa Card", number: "**** **** **** 3456", expiry: "12/25" },
  { id: 2, type: "bank", name: "Zambia National Bank", number: "**** **** 7890", branch: "Cairo Road" },
];

const Wallet = () => {
  const navigate = useNavigate();
  const walletBalance = 2450.00;
  
  const handleSendMoney = () => {
    navigate("/transfer");
  };
  
  const handleAddMoney = () => {
    navigate("/checkout", { state: { productName: "Wallet Top-up", amount: 100 } });
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
        
        {/* Tabs for Accounts and Payment Methods */}
        <Tabs defaultValue="payment-methods" className="mb-8">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>
            <TabsTrigger value="transaction-history">Transaction History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="payment-methods" className="mt-6">
            <div className="grid gap-4">
              {paymentMethods.map((method) => (
                <Card key={method.id}>
                  <CardContent className="p-4 flex items-center">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mr-4">
                      {method.type === "card" ? (
                        <CreditCard className="h-5 w-5 text-primary" />
                      ) : (
                        <Landmark className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium">{method.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {method.type === "card" ? (
                          <>Card Number: {method.number} • Expires: {method.expiry}</>
                        ) : (
                          <>Account Number: {method.number} • Branch: {method.branch}</>
                        )}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </CardContent>
                </Card>
              ))}
              
              <Button variant="outline" className="mt-2">
                <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Method
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="transaction-history" className="mt-6">
            <Card>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          i % 2 === 0 ? "bg-red-100" : "bg-green-100"
                        }`}>
                          {i % 2 === 0 ? (
                            <ArrowUpRight className="h-5 w-5 text-red-600" />
                          ) : (
                            <ArrowDownLeft className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="font-medium">
                            {i % 2 === 0 ? "Sent to" : "Received from"} {" "}
                            {["John Banda", "Mary Phiri", "Zamtel", "MTN Mobile", "Airtel Money"][i % 5]}
                          </div>
                          <div className="text-sm text-muted-foreground">Oct {15 - i}, 2023</div>
                        </div>
                      </div>
                      <div className={`font-medium ${i % 2 === 0 ? "text-red-600" : "text-green-600"}`}>
                        {i % 2 === 0 ? "-" : "+"}K {(Math.random() * 500 + 50).toFixed(2)}
                      </div>
                    </div>
                  ))}
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

export default Wallet;
