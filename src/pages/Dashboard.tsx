
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { LineChart, BarChart, Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";
import { Link } from "react-router-dom";

// Mock data
const recentTransactions = [
  { id: 1, type: "sent", name: "David Mulenga", amount: "K250.00", date: "Today, 2:34 PM" },
  { id: 2, type: "received", name: "MTN Mobile", amount: "K500.00", date: "Yesterday, 11:20 AM" },
  { id: 3, type: "sent", name: "Airtel Money", amount: "K100.00", date: "Oct 12, 9:45 AM" },
  { id: 4, type: "received", name: "Shoprite", amount: "K350.00", date: "Oct 10, 3:30 PM" },
];

const Dashboard = () => {
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
        
        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Main Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 2,450.00</div>
              <div className="flex mt-4">
                <Button asChild className="mr-2 flex-1">
                  <Link to="/send-money">
                    <ArrowUpRight className="mr-2 h-4 w-4" /> Send
                  </Link>
                </Button>
                <Button variant="outline" className="flex-1">
                  <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Savings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 5,200.00</div>
              <div className="text-sm text-muted-foreground mt-2">
                <span className="text-green-500 font-medium">+12.5%</span> from last month
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Spending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 1,820.00</div>
              <div className="text-sm text-muted-foreground mt-2">
                <span className="text-red-500 font-medium">+8.2%</span> from last month
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <Button variant="outline" className="h-auto py-6 flex flex-col items-center justify-center" asChild>
            <Link to="/send-money">
              <ArrowUpRight className="h-6 w-6 mb-2" />
              <span>Send Money</span>
            </Link>
          </Button>
          <Button variant="outline" className="h-auto py-6 flex flex-col items-center justify-center">
            <ArrowDownLeft className="h-6 w-6 mb-2" />
            <span>Receive</span>
          </Button>
          <Button variant="outline" className="h-auto py-6 flex flex-col items-center justify-center" asChild>
            <Link to="/wallet">
              <WalletIcon className="h-6 w-6 mb-2" />
              <span>Wallet</span>
            </Link>
          </Button>
          <Button variant="outline" className="h-auto py-6 flex flex-col items-center justify-center" asChild>
            <Link to="/transactions">
              <Clock className="h-6 w-6 mb-2" />
              <span>History</span>
            </Link>
          </Button>
        </div>
        
        {/* Recent Transactions */}
        <Card className="mb-8">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <CardTitle>Recent Transactions</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/transactions">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      transaction.type === "sent" ? "bg-red-100" : "bg-green-100"
                    }`}>
                      {transaction.type === "sent" ? (
                        <ArrowUpRight className={`h-5 w-5 text-red-600`} />
                      ) : (
                        <ArrowDownLeft className={`h-5 w-5 text-green-600`} />
                      )}
                    </div>
                    <div className="ml-4">
                      <div className="font-medium">{transaction.name}</div>
                      <div className="text-sm text-muted-foreground">{transaction.date}</div>
                    </div>
                  </div>
                  <div className={`font-medium ${
                    transaction.type === "sent" ? "text-red-600" : "text-green-600"
                  }`}>
                    {transaction.type === "sent" ? "-" : "+"}{transaction.amount}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
