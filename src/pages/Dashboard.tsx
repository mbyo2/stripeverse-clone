
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { transactionCounterpartyLabel } from "@/utils/transactionLabels";
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
  BarChart,
  Bitcoin
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/FeatureAccess";
import { useDashboardData } from "@/hooks/useDashboardData";
import PageErrorState from "@/components/PageErrorState";
import { useProfile, resolveFirstName } from "@/hooks/useProfile";
import FrozenAccountBanner from "@/components/FrozenAccountBanner";
import { shouldShowFrozenBanner } from "@/utils/frozenBanner";
import { useCurrency, toSupportedCurrency } from "@/contexts/CurrencyContext";
import { useAccount } from "@/contexts/AccountContext";
import { useMultiCurrencyWallets } from "@/hooks/useMultiCurrency";
import { groupWalletsByAccount } from "@/utils/accountGrouping";
import RewardsCard from "@/components/rewards/RewardsCard";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import { DashboardSkeleton } from "@/components/ui/skeletons";

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { dashboardStats, monthlyData, spendingData, recentTransactions, rewards, isLoading, isError, isAuthRecovering, retryWithRecovery } = useDashboardData();
  const { formatAmount } = useCurrency();
  const { showOnboarding, kycLevel, walletBalance, hasProfile, dismiss } = useOnboarding();
  const { accounts } = useAccount();
  const { wallet: btcWallet, isLoading: btcLoading } = useBitcoinWallet();
  const { data: allWallets = [] } = useMultiCurrencyWallets();
  const accountGroups = groupWalletsByAccount(allWallets, accounts);

  // Greet from the profiles row the user edits in Settings — auth
  // user_metadata is creation-time only and misses dashboard-created
  // accounts entirely ("Welcome back, there", QA Wave 4).
  const { data: profile } = useProfile();
  const firstName = resolveFirstName(profile, user);

  // While an auth failure is being recovered (session refresh in
  // flight), the dashboard stays on its skeleton: an auth refusal is
  // not a connection failure and must never present as this page's
  // error wall. Recovery either refetches with a live token or ends
  // the session, and ProtectedRoute routes to /login.
  if (isLoading || isAuthRecovering) {
    return (
      <div className="min-h-screen flex flex-col bg-muted">
        <Header />
        <main className="flex-1 pt-2 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <div className="mt-6" role="status" aria-label="Loading dashboard">
            <DashboardSkeleton />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col bg-muted">
        <Header />
        <main className="flex-1 pt-2 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <PageErrorState
            title="We couldn't load your dashboard"
            message="Your balance and recent activity didn't load. Check your connection and try again."
            onRetry={retryWithRecovery}
          />
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
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-2 pb-16">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          {/* A frozen user's dashboard must not look normal: the
              freeze is stated up front (with the support remedy),
              not discovered at the first refused send. Own profile
              only — this is the signed-in user's own dashboard. */}
          {shouldShowFrozenBanner(profile) && (
            <div className="pt-6">
              <FrozenAccountBanner />
            </div>
          )}
          {/* Balance Summary */}
          <div className="bg-[#003087] rounded-[24px] px-6 py-8 md:px-8 mb-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <p className="text-white/80 text-sm font-medium mb-1">Welcome back, {firstName}</p>
                <h1 className="text-4xl md:text-[44px] font-display font-semibold text-white mb-2">
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

          {/* Bitcoin Wallet — the main product gets the primary panel,
              directly under the balance band. Everything below it on this
              page is everyday-money tooling that supports the wallet. */}
          <div className="bg-black dark:bg-[#0A0F1A] rounded-[24px] px-6 py-6 md:px-8 mb-6 border border-black/10 dark:border-white/10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-12 h-12 shrink-0 rounded-full bg-[#F7931A] flex items-center justify-center">
                  <Bitcoin className="h-6 w-6 text-black" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-display font-semibold text-xl leading-tight">Bitcoin Wallet</p>
                  {btcWallet ? (
                    <p className="text-white/70 text-sm mt-1">
                      {(btcWallet.available_sats ?? 0).toLocaleString()} sats available
                      <span className="text-white/50"> · {(btcWallet.balance_sats ?? 0).toLocaleString()} sats total</span>
                    </p>
                  ) : btcLoading ? (
                    <Skeleton className="h-4 w-64 max-w-full bg-white/20 mt-1" aria-label="Loading your Bitcoin wallet" />
                  ) : (
                    <p className="text-white/70 text-sm mt-1">
                      Deposit, buy, sell and withdraw Bitcoin — held for you, or self-custody with your own seed phrase. Your choice.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5 shrink-0">
                <Button asChild className="rounded-full bg-[#F7931A] text-black font-semibold hover:bg-[#DE830A] shadow-none">
                  <Link to="/bitcoin-wallet">Open wallet</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white shadow-none">
                  <Link to="/bitcoin-wallet/self-custody">Self-custody</Link>
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-5">
              {["Deposit", "Buy", "Sell", "Withdraw"].map((action) => (
                <Link
                  key={action}
                  to="/bitcoin-wallet"
                  className="rounded-full bg-white/10 hover:bg-white/15 transition-colors px-4 py-1.5 text-[13px] font-medium text-white"
                >
                  {action}
                </Link>
              ))}
            </div>
          </div>

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

          {/* Supporting layer: everyday money and activity under the wallet. */}
          <h2 className="text-base font-semibold text-foreground mb-4">Your everyday money</h2>

          {/* Main column + side stack */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
          {/* Recent Transactions */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
                <Button variant="link" size="sm" asChild className="font-medium px-0">
                  <Link to="/transactions">View All</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recentTransactions && recentTransactions.length > 0 ? (
                <div className="divide-y divide-border">
                  {recentTransactions.map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          transaction.direction === "outgoing" ? "bg-destructive/10" : "bg-success/10"
                        }`}>
                          {transaction.direction === "outgoing" ? (
                            <ArrowUpRight className="h-4 w-4 text-destructive" />
                          ) : (
                            <ArrowDownLeft className="h-4 w-4 text-success" />
                          )}
                        </div>
                        <div>
                          <p className="text-[15px] font-medium text-foreground">{transactionCounterpartyLabel(transaction)}</p>
                          <p className="text-[13px] text-muted-foreground">
                            {new Date(transaction.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[15px] font-semibold tabular-nums ${
                        transaction.direction === "outgoing" ? "text-destructive" : "text-success"
                      }`}>
                        {transaction.direction === "outgoing" ? "-" : "+"}
                        {/* The row's own currency (a USD row reads
                            $5.00, not K5.00). */}
                        {formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))}
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
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
                          <stop offset="5%" stopColor="hsl(210, 100%, 44%)" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="hsl(210, 100%, 44%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(216, 24%, 90%)" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(215, 16%, 43%)" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(215, 16%, 43%)" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="hsl(210, 100%, 44%)"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorAmount)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            </div>

            <div className="space-y-6">
            <Card className="card-hover">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Monthly Activity</p>
                    <p className="text-[28px] font-display font-semibold text-foreground mt-1">{formatAmount(dashboardStats?.monthlyAmount || 0)}</p>
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
                    <p className="text-[28px] font-display font-semibold text-foreground mt-1">{dashboardStats?.totalTransactions || 0}</p>
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
                    <p className="text-[28px] font-display font-semibold text-foreground mt-1">{rewards?.total_points || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1 capitalize">{rewards?.tier || 'bronze'} tier</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                    <Star className="h-5 w-5 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    Your accounts
                  </CardTitle>
                  <Button variant="link" size="sm" asChild className="font-medium px-0">
                    <Link to="/sub-accounts">View all</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {accountGroups.map((group) => (
                    <div key={group.accountId ?? 'main'} className="flex items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{group.name}</p>
                        {group.isMain && <Badge variant="outline" className="shrink-0">Main</Badge>}
                        {group.account?.status === 'frozen' && <Badge variant="secondary" className="shrink-0">Frozen</Badge>}
                        {group.account?.status === 'closed' && <Badge variant="outline" className="shrink-0">Closed</Badge>}
                      </div>
                      <span className="text-sm font-semibold tabular-nums shrink-0">{formatAmount(group.totalZMW)}</span>
                    </div>
                  ))}
                </div>
                {accounts.length === 0 && (
                  <Button size="sm" variant="outline" className="rounded-full mt-4" onClick={() => navigate('/sub-accounts')}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Create a sub-account
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-primary" />
                  Spending
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={spendingData || []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(216, 24%, 90%)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(215, 16%, 43%)" />
                      <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={80} stroke="hsl(215, 16%, 43%)" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Bar dataKey="amount" fill="hsl(210, 100%, 44%)" radius={[0, 4, 4, 0]} />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

          {/* Rewards */}
          <RewardsCard />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
