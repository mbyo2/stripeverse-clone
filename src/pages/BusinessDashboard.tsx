import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Users, CreditCard, DollarSign, Activity, Settings, FileText, Shield } from "lucide-react";
import { useBusinessData } from "@/hooks/useBusinessData";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ApiKeyManager } from "@/components/business/ApiKeyManager";
import { WebhookManager } from "@/components/business/WebhookManager";
import { ApiDocs } from "@/components/business/ApiDocs";
import { Skeleton } from "@/components/ui/skeleton";

const BusinessDashboard = () => {
  const { metrics, monthlyChart, paymentMethodBreakdown, merchantAccount, usageData, isLoading } = useBusinessData();
  const { formatAmount } = useCurrency();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
          </div>
          <Skeleton className="h-80" />
        </main>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Revenue",
      value: formatAmount(metrics.revenue),
      icon: DollarSign,
      description: "From completed incoming transactions",
    },
    {
      title: "Total Transactions",
      value: metrics.txCount.toLocaleString(),
      icon: Activity,
      description: "All transaction types",
    },
    {
      title: "Success Rate",
      value: `${metrics.successRate}%`,
      icon: CreditCard,
      description: "Completed vs total",
    },
    {
      title: "API Calls",
      value: (usageData?.api_calls || 0).toLocaleString(),
      icon: Users,
      description: "This month",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Business Dashboard</h1>
            <p className="text-muted-foreground">
              {merchantAccount?.business_name || 'Your business'} — Monitor performance & manage integrations
            </p>
          </div>
          <div className="flex gap-2">
            {merchantAccount?.status && (
              <Badge variant={merchantAccount.status === 'active' ? 'default' : 'secondary'}>
                {merchantAccount.status}
              </Badge>
            )}
            <Link to="/business">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
          </div>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {statCards.map((stat) => (
            <Card key={stat.title}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
                  </div>
                  <stat.icon className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="api">API Keys</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="docs">Documentation</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Month</CardTitle>
                </CardHeader>
                <CardContent>
                  {monthlyChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={monthlyChart}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" className="text-muted-foreground" />
                        <YAxis className="text-muted-foreground" />
                        <Tooltip />
                        <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No transaction data yet. Revenue will appear here as payments come in.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentMethodBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={paymentMethodBreakdown}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}%`}
                        >
                          {paymentMethodBreakdown.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No payment method data yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <Link to="/business">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Settings className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Business Settings</p>
                      <p className="text-sm text-muted-foreground">Profile, banking & compliance</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/payment-processor">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Payment Processor</p>
                      <p className="text-sm text-muted-foreground">Configure payment integrations</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/compliance">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Shield className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Compliance</p>
                      <p className="text-sm text-muted-foreground">Regulatory requirements</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </TabsContent>

          <TabsContent value="api">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  API Key Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ApiKeyManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks">
            <Card>
              <CardHeader>
                <CardTitle>Webhook Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <WebhookManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="docs">
            <ApiDocs />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default BusinessDashboard;
