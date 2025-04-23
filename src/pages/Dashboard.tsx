import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";
import { Link } from "react-router-dom";

// Mock data for charts
const monthlyData = [
  { name: 'Jan', amount: 1200 },
  { name: 'Feb', amount: 1900 },
  { name: 'Mar', amount: 1600 },
  { name: 'Apr', amount: 2100 },
  { name: 'May', amount: 1800 },
  { name: 'Jun', amount: 2400 }
];

const spendingData = [
  { category: 'Shopping', amount: 450 },
  { category: 'Bills', amount: 380 },
  { category: 'Food', amount: 290 },
  { category: 'Transport', amount: 220 },
  { category: 'Others', amount: 180 }
];

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
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Main Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 2,450.00</div>
              <div className="flex mt-4">
                <Button asChild variant="secondary" className="mr-2 flex-1">
                  <Link to="/transfer">
                    <ArrowUpRight className="mr-2 h-4 w-4" /> Send
                  </Link>
                </Button>
                <Button variant="secondary" className="flex-1">
                  <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Savings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 5,200.00</div>
              <div className="text-sm opacity-90 mt-2">
                +12.5% from last month
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Monthly Spending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">K 1,820.00</div>
              <div className="text-sm opacity-90 mt-2">
                +8.2% from last month
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Area 
                      type="monotone" 
                      dataKey="amount" 
                      stroke="#3B82F6" 
                      fillOpacity={1} 
                      fill="url(#colorAmount)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Spending by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={spendingData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="amount" fill="#8B5CF6" />
                  </BarChart>
                </ResponsiveContainer>
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
