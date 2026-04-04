import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, FunnelChart } from "recharts";
import { TrendingUp, Users, CreditCard, DollarSign, ArrowUpRight, ArrowDownRight, Calendar, Filter } from "lucide-react";

const Analytics = () => {
  const [period, setPeriod] = useState('6m');

  const transactionData = [
    { month: 'Jan', transactions: 65, revenue: 1200, successful: 63, failed: 2 },
    { month: 'Feb', transactions: 78, revenue: 1450, successful: 76, failed: 2 },
    { month: 'Mar', transactions: 90, revenue: 1680, successful: 87, failed: 3 },
    { month: 'Apr', transactions: 85, revenue: 1580, successful: 83, failed: 2 },
    { month: 'May', transactions: 98, revenue: 1820, successful: 96, failed: 2 },
    { month: 'Jun', transactions: 110, revenue: 2040, successful: 108, failed: 2 },
  ];

  const paymentMethods = [
    { name: 'Mobile Money', value: 45, color: 'hsl(var(--primary))' },
    { name: 'Card Payment', value: 30, color: 'hsl(var(--chart-2))' },
    { name: 'Bank Transfer', value: 15, color: 'hsl(var(--chart-3))' },
    { name: 'Bitcoin', value: 5, color: 'hsl(var(--chart-4))' },
    { name: 'USSD', value: 5, color: 'hsl(var(--chart-5))' },
  ];

  const conversionData = [
    { stage: 'Checkout Started', count: 1000, rate: 100 },
    { stage: 'Payment Method Selected', count: 850, rate: 85 },
    { stage: 'Details Entered', count: 720, rate: 72 },
    { stage: 'Payment Attempted', count: 680, rate: 68 },
    { stage: 'Payment Successful', count: 650, rate: 65 },
  ];

  const dailyRevenue = [
    { day: 'Mon', amount: 450 }, { day: 'Tue', amount: 380 },
    { day: 'Wed', amount: 520 }, { day: 'Thu', amount: 490 },
    { day: 'Fri', amount: 610 }, { day: 'Sat', amount: 340 },
    { day: 'Sun', amount: 280 },
  ];

  const cohortData = [
    { cohort: 'Week 1', retention: 100, week2: 68, week3: 52, week4: 45 },
    { cohort: 'Week 2', retention: 100, week2: 72, week3: 55, week4: 48 },
    { cohort: 'Week 3', retention: 100, week2: 70, week3: 58, week4: 50 },
    { cohort: 'Week 4', retention: 100, week2: 75, week3: 60, week4: 52 },
  ];

  const topMerchants = [
    { name: 'Shoprite Zambia', volume: 'K45,200', transactions: 128, growth: 12 },
    { name: 'Total Energies', volume: 'K32,800', transactions: 95, growth: 8 },
    { name: 'Game Stores', volume: 'K28,100', transactions: 76, growth: -3 },
    { name: 'Hungry Lion', volume: 'K18,500', transactions: 210, growth: 22 },
    { name: 'Zambeef', volume: 'K15,400', transactions: 164, growth: 5 },
  ];

  const stats = [
    { title: 'Total Revenue', value: 'K89,400', change: '+20.1%', positive: true, icon: DollarSign },
    { title: 'Transactions', value: '1,248', change: '+12%', positive: true, icon: CreditCard },
    { title: 'Active Users', value: '573', change: '+8%', positive: true, icon: Users },
    { title: 'Success Rate', value: '98.5%', change: '+0.5%', positive: true, icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map(s => (
            <Card key={s.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
                <p className={`text-xs flex items-center gap-1 ${s.positive ? 'text-green-600' : 'text-red-600'}`}>
                  {s.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {s.change} from last period
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="conversion">Conversion</TabsTrigger>
            <TabsTrigger value="merchants">Merchants</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Transaction Volume</CardTitle>
                  <CardDescription>Successful vs failed transactions</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={transactionData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" className="text-muted-foreground" />
                      <YAxis className="text-muted-foreground" />
                      <Tooltip />
                      <Bar dataKey="successful" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Successful" />
                      <Bar dataKey="failed" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="Failed" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                  <CardDescription>Distribution by payment type</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={paymentMethods}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={60}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {paymentMethods.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Trend</CardTitle>
                  <CardDescription>Monthly revenue over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={transactionData}>
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Daily Revenue (This Week)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dailyRevenue}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="amount" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
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
                <div className="space-y-3">
                  {conversionData.map((step, i) => (
                    <div key={step.stage} className="flex items-center gap-4">
                      <div className="w-48 text-sm font-medium shrink-0">{step.stage}</div>
                      <div className="flex-1 relative">
                        <div className="h-8 bg-muted rounded-lg overflow-hidden">
                          <div
                            className="h-full rounded-lg transition-all"
                            style={{
                              width: `${step.rate}%`,
                              background: `hsl(var(--primary) / ${0.4 + (step.rate / 100) * 0.6})`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="w-20 text-right">
                        <span className="font-semibold text-sm">{step.rate}%</span>
                        <span className="text-xs text-muted-foreground ml-1">({step.count})</span>
                      </div>
                      {i > 0 && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          -{conversionData[i - 1].rate - step.rate}%
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Retention Cohorts</CardTitle>
                <CardDescription>Weekly retention rates by signup cohort</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Cohort</th>
                        <th className="text-center p-2 font-medium">Week 1</th>
                        <th className="text-center p-2 font-medium">Week 2</th>
                        <th className="text-center p-2 font-medium">Week 3</th>
                        <th className="text-center p-2 font-medium">Week 4</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohortData.map(row => (
                        <tr key={row.cohort} className="border-b">
                          <td className="p-2 font-medium">{row.cohort}</td>
                          {[row.retention, row.week2, row.week3, row.week4].map((val, i) => (
                            <td key={i} className="text-center p-2">
                              <span
                                className="inline-block px-3 py-1 rounded text-xs font-medium"
                                style={{
                                  background: `hsl(var(--primary) / ${val / 100 * 0.3})`,
                                  color: val > 60 ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                                }}
                              >
                                {val}%
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="merchants" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Merchants</CardTitle>
                <CardDescription>Highest volume merchants this period</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {topMerchants.map((m, i) => (
                    <div key={m.name} className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.transactions} transactions</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-sm">{m.volume}</p>
                        <p className={`text-xs flex items-center justify-end gap-1 ${m.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {m.growth >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {Math.abs(m.growth)}%
                        </p>
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

export default Analytics;
