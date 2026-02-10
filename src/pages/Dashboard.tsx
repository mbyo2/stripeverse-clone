
import React from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { 
  LineChart, 
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart
} from "recharts";
import { Button } from "@/components/ui/button";
import { 
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  BarChart,
  PieChart,
  ArrowDownLeft,
  Star
} from "lucide-react";
import { Link } from "react-router-dom";
import { FeatureList, RoleBadge } from "@/components/FeatureAccess";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useCurrency } from "@/contexts/CurrencyContext";
import RewardsCard from "@/components/rewards/RewardsCard";

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { dashboardStats, monthlyData, spendingData, recentTransactions, rewards, isLoading } = useDashboardData();
  const { formatAmount } = useCurrency();

  const handleAction = (action: string) => {
    switch(action) {
      case "Transfer":
        toast({
          title: "Transfer",
          description: "Navigating to transfer page",
        });
        navigate("/transfer");
        break;
      case "Deposit":
        toast({
          title: "Deposit",
          description: "Navigating to deposit funds",
        });
        navigate("/wallet");
        break;
      case "Wallet":
        toast({
          title: "Wallet",
          description: "Navigating to your wallet",
        });
        navigate("/wallet");
        break;
      case "History":
        toast({
          title: "Transaction History",
          description: "Viewing your transaction history",
        });
        navigate("/transactions");
        break;
      case "Rewards":
        navigate("/rewards");
        break;
      default:
        toast({
          title: "Action",
          description: `${action} action completed successfully`,
        });
    }
  };

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

  // Calculate monthly savings (assume 20% of monthly amount)
  const monthlySavings = (dashboardStats?.monthlyAmount || 0) * 0.2;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <RoleBadge />
        </div>

        {/* Enhanced Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white transform hover:scale-105 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Total Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatAmount(dashboardStats?.totalBalance || 0)}</div>
              <div className="flex items-center mt-2 text-sm">
                <ArrowUpRight className="h-4 w-4 mr-1" />
                <span>Current balance</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white transform hover:scale-105 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Monthly Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatAmount(monthlySavings)}</div>
              <div className="flex items-center mt-2 text-sm">
                <ArrowUpRight className="h-4 w-4 mr-1" />
                <span>This month</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white transform hover:scale-105 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Total Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardStats?.totalTransactions || 0}</div>
              <div className="flex items-center mt-2 text-sm">
                <ArrowUpRight className="h-4 w-4 mr-1" />
                <span>{dashboardStats?.monthlyTransactions || 0} this month</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white transform hover:scale-105 transition-all duration-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium opacity-90">Rewards Points</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{rewards?.total_points || 0}</div>
              <div className="flex items-center mt-2 text-sm">
                <Star className="h-4 w-4 mr-1" />
                <span className="capitalize">{rewards?.tier || 'bronze'} tier</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts and Rewards Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="transform hover:scale-105 transition-all duration-300 bg-card">
            <CardHeader>
              <CardTitle className="flex items-center text-primary">
                <BarChart className="mr-2 h-5 w-5" />
                Monthly Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData || []}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
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

          <Card className="transform hover:scale-105 transition-all duration-300 bg-card">
            <CardHeader>
              <CardTitle className="flex items-center text-primary">
                <PieChart className="mr-2 h-5 w-5" />
                Spending Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={spendingData || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                    <Bar dataKey="amount" fill="#8B5CF6" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div>
            <RewardsCard />
          </div>
        </div>

        {/* Quick Actions */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Button 
              onClick={() => handleAction("Transfer")}
              className="flex flex-col items-center gap-2 h-24 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
            >
              <ArrowUpRight className="h-6 w-6" />
              <span>Transfer</span>
            </Button>
            <Button 
              onClick={() => handleAction("Deposit")}
              className="flex flex-col items-center gap-2 h-24 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
            >
              <ArrowDownRight className="h-6 w-6" />
              <span>Deposit</span>
            </Button>
            <Button 
              onClick={() => handleAction("Wallet")}
              className="flex flex-col items-center gap-2 h-24 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
            >
              <Wallet className="h-6 w-6" />
              <span>Wallet</span>
            </Button>
            <Button 
              onClick={() => handleAction("History")}
              className="flex flex-col items-center gap-2 h-24 bg-gradient-to-r from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600"
            >
              <BarChart className="h-6 w-6" />
              <span>History</span>
            </Button>
            <Button 
              onClick={() => handleAction("Rewards")}
              className="flex flex-col items-center gap-2 h-24 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
            >
              <Star className="h-6 w-6" />
              <span>Rewards</span>
            </Button>
          </CardContent>
        </Card>
        
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
            {recentTransactions && recentTransactions.length > 0 ? (
              <div className="space-y-4">
                {recentTransactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.direction === "outgoing" ? "bg-destructive/10" : "bg-primary/10"
                      }`}>
                        {transaction.direction === "outgoing" ? (
                          <ArrowUpRight className="h-5 w-5 text-destructive" />
                        ) : (
                          <ArrowDownLeft className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="ml-4">
                        <div className="font-medium">{transaction.recipient_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(transaction.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className={`font-medium ${
                      transaction.direction === "outgoing" ? "text-destructive" : "text-primary"
                    }`}>
                      {transaction.direction === "outgoing" ? "-" : "+"}
                      {formatAmount(transaction.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No recent transactions found</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate("/transfer")}>
                  Make your first transaction
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
