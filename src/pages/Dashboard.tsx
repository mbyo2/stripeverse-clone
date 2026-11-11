
import React from "react";
import { useNavigate } from "react-router-dom";
import { useFeatureVisibility } from "@/hooks/useFeatureVisibility";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
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
  ArrowDownToLine,
  ArrowLeftRight,
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
import { formatBtcRowAmount } from "@/lib/btcHistory";
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
  const { canSee: canSeeFeature } = useFeatureVisibility();
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
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-2 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <div role="status" aria-label="Loading dashboard">
            <DashboardSkeleton />
          </div>
        </main>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-2 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <PageErrorState
            title="We couldn't load your dashboard"
            message="Your balance and recent activity didn't load. Check your connection and try again."
            onRetry={retryWithRecovery}
          />
        </main>
      </div>
    );
  }

  const quickActions = [
    { label: 'Send', icon: Send, action: () => navigate('/transfer') },
    { label: 'Request', icon: ArrowDownRight, action: () => navigate('/request-money') },
    { label: 'Cards', icon: CreditCard, action: () => navigate('/card/new'), feature: 'virtualCards' as const },
    { label: 'Add Money', icon: Plus, action: () => navigate('/wallet') },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
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
          {/* Greeting — the PayPal anatomy header (CEO rollout
              2026-11-11): the bold greeting, one quiet subline. The
              fiat total rides the subline; the Bitcoin wallet below
              is the page's hero. */}
          <div className="mt-6 mb-6">
            <h1 className="text-greeting text-foreground">Welcome back, {firstName}</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {formatAmount(dashboardStats?.totalBalance || 0)} available in your everyday money
            </p>
          </div>

          {/* Bitcoin Wallet hero — the main product leads the page.
              ONE sky hero card (#60CDFF; a dark hairline card in dark
              mode), the ₿ medallion as its brand mark — the analogue
              of the P tile on PayPal's balance card — and the BTC
              balance as the headline number. Orange stays on the ₿
              mark only, never on buttons or bands. */}
          <div className="bg-[#60CDFF] dark:bg-card dark:border dark:border-border rounded-[24px] p-5 mb-6 text-slate-950 dark:text-card-foreground">
            <div className="flex items-start justify-between gap-4 mb-5">
              <p className="text-sm font-semibold">Bitcoin Wallet</p>
              <div className="w-11 h-11 shrink-0 rounded-2xl bg-white flex items-center justify-center" aria-hidden="true">
                <Bitcoin className="h-6 w-6 text-bitcoin" />
              </div>
            </div>
            {btcWallet ? (
              <>
                <p className="text-heronum tabular-nums">
                  {(btcWallet.balance_sats ?? 0).toLocaleString()} <span className="text-[22px] font-bold">sats</span>
                </p>
                <p className="text-sm text-slate-950/70 dark:text-muted-foreground mt-1.5 tabular-nums">
                  {(btcWallet.available_sats ?? 0).toLocaleString()} sats available
                </p>
              </>
            ) : btcLoading ? (
              <Skeleton className="h-10 w-64 max-w-full bg-slate-950/15 dark:bg-primary-foreground/15" aria-label="Loading your Bitcoin wallet" />
            ) : (
              <p className="text-[15px] leading-relaxed max-w-md">
                Deposit, buy, sell and withdraw Bitcoin — held for you, or self-custody with your own seed phrase. Your choice.
              </p>
            )}
            <div className="flex flex-wrap gap-2.5 mt-6">
              {/* Hero CTAs in the PayPal app pattern: black pill
                  primary on the sky card (the platform blue returns
                  in dark mode, where the hero is a dark card), pale
                  pill secondary. */}
              <Button asChild className="bg-slate-950 text-white hover:bg-slate-950/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90">
                <Link to="/bitcoin-wallet">Open wallet</Link>
              </Button>
              <Button asChild variant="secondary" className="bg-white/70 text-slate-950 hover:bg-white dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80">
                <Link to="/bitcoin-wallet/self-custody">Self-custody</Link>
              </Button>
            </div>
          </div>

          {/* The custodial wallet's quick actions — pale circles,
              always shown to every viewer (CEO standing rule
              2026-11-08: Deposit and Withdraw — the send — are never
              hidden). Buy is absent because the wallet page does not
              offer it. */}
          <div className="flex gap-5 px-1 mb-8">
            {["Deposit", "Sell", "Withdraw"].map((action) => {
              const ActionIcon = action === "Deposit" ? ArrowDownToLine : action === "Sell" ? ArrowLeftRight : ArrowUpRight;
              return (
                <Link
                  key={action}
                  to="/bitcoin-wallet"
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span className="w-14 h-14 rounded-full bg-secondary group-hover:bg-secondary/70 transition-colors flex items-center justify-center">
                    <ActionIcon className="h-6 w-6 text-secondary-foreground" />
                  </span>
                  <span className="text-xs font-medium text-foreground">{action}</span>
                </Link>
              );
            })}
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

          {/* Everyday balance — a quiet hairline card (the fiat total
              no longer wears a colour band) with its quick actions as
              pale circles, the same anatomy as the wallet actions. */}
          <Card className="mb-6">
            <CardContent className="pt-5 pb-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Available balance</p>
                  <p className="text-[28px] font-display font-bold text-foreground mt-1 tabular-nums">
                    {formatAmount(dashboardStats?.totalBalance || 0)}
                  </p>
                </div>
                <div className="flex gap-4">
                  {quickActions.filter((a) => !('feature' in a) || canSeeFeature(a.feature)).map((action) => (
                    <button
                      key={action.label}
                      onClick={action.action}
                      className="flex flex-col items-center gap-1.5 group"
                    >
                      <span className="w-14 h-14 rounded-full bg-secondary group-hover:bg-secondary/70 transition-colors flex items-center justify-center">
                        <action.icon className="h-6 w-6 text-secondary-foreground" />
                      </span>
                      <span className="text-xs font-medium text-foreground">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

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
                        {/* BTC rows resolve their true amount from
                            metadata.sats (the amount column rounds
                            small movements to 0.00); other rows use
                            their own currency (a USD row reads $5.00,
                            not K5.00). */}
                        {transaction.currency === "BTC"
                          ? formatBtcRowAmount(transaction)
                          : formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))}
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
                  Activity trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyData || []}>
                      <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="hsl(var(--chart-2))"
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
            {/* Stats as one hairline list, not a stack of cards
                (PayPal anatomy): pale icon square, label + subline,
                value on the right. */}
            <Card>
              <CardContent className="py-2">
                <div className="divide-y divide-border">
                  <div className="flex items-center gap-3 min-h-16 py-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Monthly Activity</p>
                      <p className="text-xs text-muted-foreground">{dashboardStats?.monthlyTransactions || 0} transactions</p>
                    </div>
                    <span className="text-[15px] font-bold text-foreground tabular-nums shrink-0">{formatAmount(dashboardStats?.monthlyAmount || 0)}</span>
                  </div>
                  <div className="flex items-center gap-3 min-h-16 py-3">
                    <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                      <BarChart className="h-5 w-5 text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Total Transactions</p>
                      <p className="text-xs text-muted-foreground">All time</p>
                    </div>
                    <span className="text-[15px] font-bold text-foreground tabular-nums shrink-0">{dashboardStats?.totalTransactions || 0}</span>
                  </div>
                  <button onClick={() => navigate('/rewards')} className="flex items-center gap-3 min-h-16 py-3 w-full text-left">
                    <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
                      <Star className="h-5 w-5 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Rewards Points</p>
                      <p className="text-xs text-muted-foreground capitalize">{rewards?.tier || 'bronze'} tier</p>
                    </div>
                    <span className="text-[15px] font-bold text-foreground tabular-nums shrink-0">{rewards?.total_points || 0}</span>
                  </button>
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
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={80} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip formatter={(value) => [formatAmount(Number(value)), 'Amount']} />
                      <Bar dataKey="amount" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
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
    </div>
  );
};

export default Dashboard;
