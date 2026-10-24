import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { TrendingUp, CreditCard, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/utils/walletUtils";
import {
  EMPTY_SUMMARY,
  analyticsWindows,
  buildAnalyticsModel,
  fetchAnalyticsSummaries,
  pctChange,
  type AnalyticsRpcClient,
} from "@/utils/analyticsSummary";

const Analytics = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState('6m');

  // Aggregates are computed server-side by public.get_user_analytics
  // (migration 20261114) — four small fixed-size results for the
  // current period, the previous period, the last 6 calendar months
  // and the current week. This page used to pull up to 5,000 raw
  // transaction rows and aggregate in the browser; PostgREST's
  // 1,000-row cap silently truncated that pull, so the figures were
  // wrong at volume. Nothing here is estimated or sampled — the RPC
  // aggregates the same real rows with the same definitions.
  const { data: summaries, isLoading } = useQuery({
    queryKey: ['analytics-summary', user?.id, period],
    queryFn: () =>
      fetchAnalyticsSummaries(
        supabase as unknown as AnalyticsRpcClient,
        period,
        Date.now(),
      ),
    enabled: !!user,
  });

  const model = useMemo(() => {
    if (!summaries) {
      const { week } = analyticsWindows(period, Date.now());
      return buildAnalyticsModel(
        EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY, week.from,
      );
    }
    return buildAnalyticsModel(
      summaries.current,
      summaries.previous,
      summaries.months,
      summaries.week,
      summaries.windows.week.from,
    );
  }, [summaries, period]);

  const stats = [
    {
      title: 'Total Revenue', icon: DollarSign,
      value: formatCurrency(model.revenue),
      change: pctChange(model.revenue, model.prevRevenue),
      note: 'Completed incoming (ZMW)',
    },
    {
      title: 'Transactions', icon: CreditCard,
      value: model.currentCount.toLocaleString(),
      change: pctChange(model.currentCount, model.prevCount),
      note: 'In selected period',
    },
    {
      title: 'Success Rate', icon: TrendingUp,
      value: model.currentCount ? `${model.successRate.toFixed(1)}%` : '—',
      change: model.prevSuccessRate === null ? null : model.successRate - model.prevSuccessRate,
      note: 'Completed share of transactions',
    },
    {
      title: 'Total Sent', icon: Send,
      value: formatCurrency(model.sent),
      change: pctChange(model.sent, model.prevSent),
      note: 'Completed outgoing (ZMW)',
    },
  ];

  const renderDelta = (change: number | null, isRate = false) => {
    if (change === null) {
      return <p className="text-xs text-muted-foreground">No prior-period data to compare</p>;
    }
    const positive = change >= 0;
    return (
      <p className={`text-xs flex items-center gap-1 ${positive ? 'text-green-600' : 'text-red-600'}`}>
        {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {`${positive ? '+' : ''}${change.toFixed(1)}${isRate ? ' pts' : '%'}`} from last period
      </p>
    );
  };

  const emptyChart = (message: string) => (
    <div className="h-[300px] flex items-center justify-center text-center text-muted-foreground text-sm px-6">
      {message}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
            <p className="text-muted-foreground">Track your payment performance and business metrics</p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="1m">Last month</SelectItem>
              <SelectItem value="3m">Last 3 months</SelectItem>
              <SelectItem value="6m">Last 6 months</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats — computed from your real transactions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map(s => (
            <Card key={s.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{isLoading ? '…' : s.value}</div>
                {renderDelta(s.change, s.title === 'Success Rate')}
                <p className="text-xs text-muted-foreground mt-1">{s.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="conversion">Conversion</TabsTrigger>
            <TabsTrigger value="merchants">Counterparties</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Transaction Volume</CardTitle>
                  <CardDescription>Successful vs failed transactions</CardDescription>
                </CardHeader>
                <CardContent>
                  {model.monthly.every(m => m.transactions === 0)
                    ? emptyChart('No transactions in the last 6 months yet — your volume chart will appear here once you start transacting.')
                    : (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={model.monthly}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="month" className="text-muted-foreground" />
                          <YAxis className="text-muted-foreground" />
                          <Tooltip />
                          <Bar dataKey="successful" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Successful" />
                          <Bar dataKey="failed" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="Failed" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                  <CardDescription>Distribution by payment type</CardDescription>
                </CardHeader>
                <CardContent>
                  {model.paymentMethods.length === 0
                    ? emptyChart('No transactions in this period yet.')
                    : (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={model.paymentMethods}
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            innerRadius={60}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {model.paymentMethods.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Trend</CardTitle>
                  <CardDescription>Monthly revenue over time (completed incoming, ZMW)</CardDescription>
                </CardHeader>
                <CardContent>
                  {model.monthly.every(m => m.revenue === 0)
                    ? emptyChart('No revenue recorded in the last 6 months yet.')
                    : (
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={model.monthly}>
                          <defs>
                            <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="month" />
                          <YAxis />
                          <Tooltip />
                          <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revGradient)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Daily Revenue (This Week)</CardTitle>
                </CardHeader>
                <CardContent>
                  {model.dailyRevenue.every(d => d.amount === 0)
                    ? emptyChart('No revenue recorded this week yet.')
                    : (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={model.dailyRevenue}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="day" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="amount" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="conversion" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Checkout Conversion Funnel</CardTitle>
                <CardDescription>Where customers drop off in the payment process</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Checkout funnel tracking isn't available yet. It will appear here once checkout
                  session events are recorded — we don't estimate or simulate these figures.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Retention Cohorts</CardTitle>
                <CardDescription>Weekly retention rates by signup cohort</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Retention cohorts aren't available yet — they need recorded signup cohort data,
                  which this account doesn't have.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="merchants" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Counterparties</CardTitle>
                <CardDescription>Who you transact with most in this period, from your real transactions</CardDescription>
              </CardHeader>
              <CardContent>
                {model.topCounterparties.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No transactions with named counterparties in this period yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {model.topCounterparties.map((m, i) => (
                      <div key={m.name} className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                          {i + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.transactions} transactions</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-sm">{formatCurrency(m.volume)}</p>
                          <p className="text-xs text-muted-foreground">{m.share.toFixed(1)}% of volume</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Analytics;
