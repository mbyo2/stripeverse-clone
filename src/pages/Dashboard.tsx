
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
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
  ArrowDownLeft,
  Star,
  Send,
  CreditCard,
  Plus,
  Eye,
  TrendingUp,
  PieChart,
  BarChart
} from "lucide-react";
import { Link } from "react-router-dom";
import { RoleBadge } from "@/components/FeatureAccess";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useCurrency } from "@/contexts/CurrencyContext";
import RewardsCard from "@/components/rewards/RewardsCard";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { useOnboarding } from "@/hooks/useOnboarding";

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { dashboardStats, monthlyData, spendingData, recentTransactions, rewards, isLoading } = useDashboardData();
  const { formatAmount } = useCurrency();
  const { showOnboarding, kycLevel, walletBalance, hasProfile, dismiss } = useOnboarding();

  const firstName = user?.user_metadata?.first_name || "there";

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-20 pb-16 px-4 max-w-[1320px] mx-auto w-full">
          <div className="mb-6 mt-6">
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-5 w-64" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent>
              </Card>
            ))}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const quickActions = [
    { label: 'Send', icon: Send, action: () => navigate('/transfer'), color: 'bg-primary' },
    { label: 'Request', icon: ArrowDownRight, action: () => navigate('/wallet'), color: 'bg-success' },
    { label: 'Cards', icon: CreditCard, action: () => navigate('/card/new'), color: 'bg-paypal-gold' },
    { label: 'Add Money', icon: Plus, action: () => navigate('/wallet'), color: 'bg-primary' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-20 pb-16">
        {/* Balance Hero */}
        <div className="paypal-gradient">
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <p className="text-white/80 text-sm font-medium mb-1">Welcome back, {firstName}</p>
                <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                  {formatAmount(dashboardStats?.totalBalance || 0)}
                </h1>
                <p className="text-white/70 text-sm">Available balance</p>
              </div>
              <div className="flex gap-3">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.action}
                    className="flex flex-col items-center gap-1.5 group"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center">
                      <action.icon className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xs text-white/80 font-medium">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 mt-6">
          {/* Onboarding */}
          {showOnboarding && (
            <div className="mb-6">
              <OnboardingWizard
                kycLevel={kycLevel}
                walletBalance={walletBalance}
                hasProfile={hasProfile}
                onDismiss={dismiss}
              />
            </div>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            <Card className="card-hover">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Monthly Activity</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{formatAmount(dashboardStats?.monthlyAmount || 0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{dashboardStats?.monthlyTransactions || 0} transactions</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Total Transactions</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{dashboardStats?.totalTransactions || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">All time</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                    <BarChart className="h-5 w-5 text-success" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover cursor-pointer" onClick={() => navigate('/rewards')}>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Rewards Points</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{rewards?.total_points || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1 capitalize">{rewards?.tier || 'bronze'} tier</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                    <Star className="h-5 w-5 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts & Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Monthly Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyData || []}>
                      <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(213, 100%, 36%)" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="hsl(213, 100%, 36%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(215, 16%, 47%)" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(215, 16%, 47%)" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Area 
                        type="monotone" 
                        dataKey="amount" 
                        stroke="hsl(213, 100%, 36%)" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorAmount)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-primary" />
                  Spending
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={spendingData || []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(215, 16%, 47%)" />
                      <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={80} stroke="hsl(215, 16%, 47%)" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Bar dataKey="amount" fill="hsl(213, 100%, 36%)" radius={[0, 4, 4, 0]} />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
                <Button variant="ghost" size="sm" asChild className="text-primary font-medium">
                  <Link to="/transactions">View All</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recentTransactions && recentTransactions.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentTransactions.map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                          transaction.direction === "outgoing" ? "bg-destructive/10" : "bg-success/10"
                        }`}>
                          {transaction.direction === "outgoing" ? (
                            <ArrowUpRight className="h-4 w-4 text-destructive" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4 text-success" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{transaction.recipient_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(transaction.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-semibold ${
                        transaction.direction === "outgoing" ? "text-destructive" : "text-success"
                      }`}>
                        {transaction.direction === "outgoing" ? "-" : "+"}
                        {formatAmount(transaction.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Wallet className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm mb-3">No recent transactions</p>
                  <Button size="sm" className="rounded-full" onClick={() => navigate("/transfer")}>
                    Make your first transaction
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rewards */}
          <RewardsCard />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
