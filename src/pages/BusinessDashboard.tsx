import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { TrendingUp, Activity, CreditCard, DollarSign, ArrowLeft, ArrowUpRight, ArrowDownRight, ChevronRight } from "lucide-react";
import { useBusinessData } from "@/hooks/useBusinessData";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

const BusinessDashboard = () => {
  const { metrics, monthlyChart, paymentMethodBreakdown, merchantAccount, usageData, isLoading } = useBusinessData();
  const { formatAmount } = useCurrency();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 rounded-[24px]" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-80 rounded-[24px]" />
            <Skeleton className="h-80 rounded-[24px]" />
          </div>
        </main>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Revenue",
      value: formatAmount(metrics.revenue),
      icon: DollarSign,
      color: "bg-emerald-600",
      description: "Completed incoming",
    },
    {
      title: "Transactions",
      value: metrics.txCount.toLocaleString(),
      icon: Activity,
      color: "bg-[#003087]",
      description: "All types",
    },
    {
      title: "Success Rate",
      value: `${metrics.successRate}%`,
      icon: CreditCard,
      color: "bg-[#44464A]",
      description: "Completed vs total",
    },
    {
      title: "API Calls",
      value: (usageData?.api_calls || 0).toLocaleString(),
      icon: TrendingUp,
      color: "bg-amber-700",
      description: "This month",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        {/* Header */}
        <motion.div 
          className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">Analytics Dashboard</h1>
              {merchantAccount?.status && (
                <Badge variant={merchantAccount.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                  {merchantAccount.status}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              {merchantAccount?.business_name || 'Your business'} — Performance overview
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/business')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Portal
          </Button>
        </motion.div>

        {/* Summary + Metrics */}
        <motion.div
          className="space-y-6 mb-8"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card>
            <CardContent className="p-6 md:p-8">
              <p className="text-sm font-medium text-muted-foreground">{statCards[0].title}</p>
              <p className="text-4xl md:text-[44px] leading-tight font-display font-semibold mt-2">{statCards[0].value}</p>
              <p className="text-sm text-muted-foreground mt-1">{statCards[0].description}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-6 py-2">
              <div className="divide-y divide-border">
                {statCards.slice(1).map((stat) => (
                  <div key={stat.title} className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <stat.icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-[15px] font-medium">{stat.title}</p>
                        <p className="text-[13px] text-muted-foreground">{stat.description}</p>
                      </div>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Charts */}
        <motion.div 
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ArrowUpRight className="h-5 w-5 text-primary" />
                Revenue by Month
              </CardTitle>
              <CardDescription>Monthly revenue trend from transactions</CardDescription>
            </CardHeader>
            <CardContent>
              {monthlyChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={monthlyChart}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }} 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="amount" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fill="url(#revenueGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
                  <ArrowUpRight className="h-12 w-12 mb-3 text-muted-foreground/30" />
                  <p className="font-medium">No revenue data yet</p>
                  <p className="text-sm">Revenue will appear as payments come in</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="h-5 w-5 text-primary" />
                Payment Methods
              </CardTitle>
              <CardDescription>Breakdown of payment method usage</CardDescription>
            </CardHeader>
            <CardContent>
              {paymentMethodBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={paymentMethodBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}%`}
                    >
                      {paymentMethodBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }} 
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
                  <CreditCard className="h-12 w-12 mb-3 text-muted-foreground/30" />
                  <p className="font-medium">No payment data yet</p>
                  <p className="text-sm">Payment method breakdown will appear here</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Links */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card>
            <CardContent className="px-6 py-2">
              <div className="divide-y divide-border">
                {[
                  { label: 'Business Settings', desc: 'Profile, banking & compliance', icon: Activity, href: '/business' },
                  { label: 'Payment Processor', desc: 'Configure payment integrations', icon: CreditCard, href: '/payment-processor' },
                  { label: 'Compliance Center', desc: 'Regulatory requirements', icon: TrendingUp, href: '/compliance' },
                ].map((link) => (
                  <div
                    key={link.label}
                    className="flex items-center gap-4 py-4 cursor-pointer"
                    onClick={() => navigate(link.href)}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <link.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{link.label}</p>
                      <p className="text-sm text-muted-foreground truncate">{link.desc}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
};

export default BusinessDashboard;
