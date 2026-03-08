import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessData } from "@/hooks/useBusinessData";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useNavigate } from "react-router-dom";
import { 
  Store, CreditCard, BarChart3, Settings, Shield, Wallet, FileText, 
  Webhook, TrendingUp, Activity, ArrowUpRight, ArrowRight, 
  CheckCircle, AlertCircle, Users, Zap, Globe, ExternalLink,
  ChevronRight, Code2, ArrowDownLeft
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { BusinessSettings } from "@/components/business/BusinessSettings";
import { BusinessBankingInfo } from "@/components/business/BusinessBankingInfo";
import BusinessCompliance from "@/components/business/BusinessCompliance";
import { ApiKeyManager } from "@/components/business/ApiKeyManager";
import { WebhookManager } from "@/components/business/WebhookManager";
import { ApiDocs } from "@/components/business/ApiDocs";
import { Skeleton } from "@/components/ui/skeleton";

const Business = () => {
  const { user } = useAuth();
  const { merchantAccount, metrics, monthlyChart, paymentMethodBreakdown, businessTransactions, isLoading } = useBusinessData();
  const { formatAmount } = useCurrency();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-20 pb-16">
          <div className="paypal-gradient py-8">
            <div className="max-w-[1320px] mx-auto px-4 sm:px-6">
              <Skeleton className="h-8 w-48 mb-2 bg-white/20" />
              <Skeleton className="h-5 w-64 bg-white/10" />
            </div>
          </div>
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
            <Skeleton className="h-96 rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  const setupProgress = [
    { label: 'Business Profile', desc: 'Company information', done: !!merchantAccount?.business_name, action: () => setSettingsOpen(true) },
    { label: 'Bank Account', desc: 'Settlement details', done: !!(merchantAccount?.contact_info as any)?.banking?.accountName, action: () => setActiveTab('banking') },
    { label: 'API Key', desc: 'Integration credentials', done: !!merchantAccount?.api_key_masked, action: () => setActiveTab('api') },
    { label: 'Webhook', desc: 'Event notifications', done: !!merchantAccount?.webhook_url, action: () => setActiveTab('webhooks') },
  ];
  const completedSteps = setupProgress.filter(s => s.done).length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-14">
        {/* Hero Banner */}
        <div className="paypal-gradient">
          <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-white">
                    {merchantAccount?.business_name || 'Business Portal'}
                  </h1>
                  {merchantAccount?.status && (
                    <Badge className={`text-xs ${merchantAccount.status === 'active' ? 'bg-white/20 text-white border-white/30' : 'bg-warning/80 text-white border-0'}`}>
                      {merchantAccount.status === 'active' ? '● Active' : '○ Setup Required'}
                    </Badge>
                  )}
                </div>
                <p className="text-white/70 text-sm">
                  Manage payments, view analytics, and configure integrations
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
                  onClick={() => navigate('/business-dashboard')}
                >
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Analytics
                </Button>
                <Button 
                  size="sm" 
                  className="bg-white text-primary hover:bg-white/90"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="h-4 w-4 mr-1.5" />
                  Settings
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              {
                label: 'Total Revenue',
                value: formatAmount(metrics?.revenue || 0),
                sub: 'From completed transactions',
                icon: TrendingUp,
                iconColor: 'text-success',
                iconBg: 'bg-success/10',
                onClick: () => navigate('/business-dashboard'),
              },
              {
                label: 'Transactions',
                value: (metrics?.txCount || 0).toLocaleString(),
                sub: 'All time',
                icon: Activity,
                iconColor: 'text-primary',
                iconBg: 'bg-primary/10',
                onClick: () => navigate('/transactions'),
              },
              {
                label: 'Success Rate',
                value: `${metrics?.successRate || 0}%`,
                sub: 'Completed vs total',
                icon: CheckCircle,
                iconColor: 'text-success',
                iconBg: 'bg-success/10',
                onClick: () => navigate('/business-dashboard'),
              },
              {
                label: 'Account Status',
                value: merchantAccount?.status === 'active' ? 'Verified' : 'Setup',
                sub: merchantAccount?.status === 'active' ? 'Account verified' : `${completedSteps}/4 steps done`,
                icon: Store,
                iconColor: merchantAccount?.status === 'active' ? 'text-success' : 'text-warning',
                iconBg: merchantAccount?.status === 'active' ? 'bg-success/10' : 'bg-warning/10',
                onClick: merchantAccount?.status === 'active' ? undefined : () => setSettingsOpen(true),
              },
            ].map((stat) => (
              <Card 
                key={stat.label} 
                className={`card-hover ${stat.onClick ? 'cursor-pointer' : ''}`}
                onClick={stat.onClick}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                    <div className={`w-8 h-8 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                      <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
                    </div>
                  </div>
                  <p className="text-xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Setup Banner */}
          {completedSteps < 4 && (
            <Card className="mb-6 border-primary/20 bg-primary/[0.03]">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Complete Your Setup</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{completedSteps} of 4 steps completed</p>
                  </div>
                  <span className="text-lg font-bold text-primary">{Math.round((completedSteps / 4) * 100)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 mb-4">
                  <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${(completedSteps / 4) * 100}%` }} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {setupProgress.map((step) => (
                    <button 
                      key={step.label}
                      onClick={!step.done ? step.action : undefined}
                      disabled={step.done}
                      className={`flex items-center gap-3 text-left p-3 rounded-lg border transition-all ${
                        step.done 
                          ? 'bg-success/5 border-success/20 text-success' 
                          : 'bg-card border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer'
                      }`}
                    >
                      {step.done ? (
                        <CheckCircle className="h-4 w-4 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${step.done ? 'text-success' : 'text-foreground'}`}>{step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.desc}</p>
                      </div>
                      {!step.done && <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground shrink-0" />}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs Navigation */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="border-b border-border">
              <TabsList className="bg-transparent h-auto p-0 gap-0 rounded-none">
                {[
                  { value: 'overview', label: 'Overview', icon: Store },
                  { value: 'banking', label: 'Banking', icon: Wallet },
                  { value: 'compliance', label: 'Compliance', icon: Shield },
                  { value: 'api', label: 'API Keys', icon: Code2 },
                  { value: 'webhooks', label: 'Webhooks', icon: Webhook },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 pb-3 pt-2 text-sm font-medium text-muted-foreground data-[state=active]:text-primary"
                  >
                    <tab.icon className="h-4 w-4 mr-1.5" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-0 pt-6">
              <div className="space-y-6">
                {/* Revenue + Payment Methods */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold">Revenue Overview</CardTitle>
                        <Button variant="ghost" size="sm" className="text-primary text-xs font-medium" onClick={() => navigate('/business-dashboard')}>
                          Full Report <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {monthlyChart.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                          <AreaChart data={monthlyChart}>
                            <defs>
                              <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(213, 100%, 36%)" stopOpacity={0.12} />
                                <stop offset="95%" stopColor="hsl(213, 100%, 36%)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" vertical={false} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip />
                            <Area type="monotone" dataKey="amount" stroke="hsl(213, 100%, 36%)" fill="url(#revenueGrad)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-[260px] text-muted-foreground">
                          <BarChart3 className="h-10 w-10 mb-3 text-muted-foreground/20" />
                          <p className="text-sm font-medium">No revenue data yet</p>
                          <p className="text-xs">Completed transactions will appear here</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">Payment Methods</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {paymentMethodBreakdown.length > 0 ? (
                        <div className="space-y-4">
                          <ResponsiveContainer width="100%" height={150}>
                            <PieChart>
                              <Pie data={paymentMethodBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                                {paymentMethodBreakdown.map((_, i) => (
                                  <Cell key={i} fill={['hsl(213, 100%, 36%)', 'hsl(152, 69%, 31%)', 'hsl(38, 92%, 50%)', 'hsl(262, 83%, 58%)'][i % 4]} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-2">
                            {paymentMethodBreakdown.map((method, i) => (
                              <div key={method.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ['hsl(213, 100%, 36%)', 'hsl(152, 69%, 31%)', 'hsl(38, 92%, 50%)', 'hsl(262, 83%, 58%)'][i % 4] }} />
                                  <span className="text-muted-foreground capitalize">{method.name.replace('_', ' ')}</span>
                                </div>
                                <span className="font-medium text-foreground">{method.value}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-[260px] text-muted-foreground">
                          <CreditCard className="h-10 w-10 mb-3 text-muted-foreground/20" />
                          <p className="text-sm">No payment data</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Transactions + Sidebar */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
                        <Button variant="ghost" size="sm" className="text-primary text-xs font-medium" onClick={() => navigate('/transactions')}>
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {businessTransactions && businessTransactions.length > 0 ? (
                        <div className="divide-y divide-border">
                          {businessTransactions.slice(0, 6).map((tx) => (
                            <div key={tx.uuid_id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                  tx.direction === 'incoming' ? 'bg-success/10' : 'bg-destructive/10'
                                }`}>
                                  {tx.direction === 'incoming' ? (
                                    <ArrowDownLeft className="h-4 w-4 text-success" />
                                  ) : (
                                    <ArrowUpRight className="h-4 w-4 text-destructive" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {tx.recipient_name || tx.description || tx.payment_method}
                                  </p>
                                  <p className="text-xs text-muted-foreground capitalize">
                                    {tx.payment_method?.replace('_', ' ')} · {new Date(tx.created_at || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className={`text-sm font-semibold ${tx.direction === 'incoming' ? 'text-success' : 'text-foreground'}`}>
                                  {tx.direction === 'incoming' ? '+' : '-'}{formatAmount(tx.amount)}
                                </p>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                                  {tx.status}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                          <Activity className="h-10 w-10 mb-3 text-muted-foreground/20" />
                          <p className="text-sm font-medium">No transactions yet</p>
                          <p className="text-xs">Payment activity will appear here</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Quick Links */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold">Quick Links</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1">
                        {[
                          { label: 'Analytics Dashboard', icon: BarChart3, href: '/business-dashboard' },
                          { label: 'Payment Processor', icon: CreditCard, href: '/payment-processor' },
                          { label: 'Disputes', icon: FileText, href: '/disputes' },
                          { label: 'Compliance', icon: Shield, href: '/compliance' },
                          { label: 'Developer Portal', icon: Code2, href: '/developers' },
                        ].map((action) => (
                          <button
                            key={action.label}
                            onClick={() => navigate(action.href)}
                            className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-muted transition-colors group text-left"
                          >
                            <span className="flex items-center gap-2.5">
                              <action.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                              <span className="text-sm font-medium text-foreground">{action.label}</span>
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                          </button>
                        ))}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold">Integration</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {[
                          { label: 'API Key', status: merchantAccount?.api_key_masked ? 'Active' : 'Not set', active: !!merchantAccount?.api_key_masked },
                          { label: 'Webhook', status: merchantAccount?.webhook_url ? 'Active' : 'Not set', active: !!merchantAccount?.webhook_url },
                          { label: 'Settlement', status: (merchantAccount?.contact_info as any)?.banking?.accountName ? 'Ready' : 'Pending', active: !!(merchantAccount?.contact_info as any)?.banking?.accountName },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">{item.label}</span>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                              <span className={`text-xs font-medium ${item.active ? 'text-success' : 'text-muted-foreground'}`}>
                                {item.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* Business Profile */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold">Business Profile</CardTitle>
                      <Button variant="ghost" size="sm" className="text-primary text-xs font-medium" onClick={() => setSettingsOpen(true)}>
                        Edit Profile
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {merchantAccount ? (
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                          { label: 'Business Name', value: merchantAccount.business_name },
                          { label: 'Business Type', value: merchantAccount.business_type },
                          { label: 'Contact Email', value: (merchantAccount.contact_info as any)?.email || '—' },
                          { label: 'Status', value: merchantAccount.status, isBadge: true },
                        ].map((field) => (
                          <div key={field.label}>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{field.label}</p>
                            {field.isBadge ? (
                              <Badge variant={field.value === 'active' ? 'default' : 'secondary'} className="capitalize">
                                {field.value}
                              </Badge>
                            ) : (
                              <p className="text-sm font-medium text-foreground capitalize">{field.value}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Store className="h-7 w-7 text-primary" />
                        </div>
                        <h3 className="font-semibold text-foreground mb-1">No Merchant Account</h3>
                        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                          Set up your business profile to start accepting payments
                        </p>
                        <Button onClick={() => setSettingsOpen(true)} className="rounded-full px-6">
                          Set Up Business Account
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Banking Tab */}
            <TabsContent value="banking" className="mt-0 pt-6">
              <BusinessBankingInfo />
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance" className="mt-0 pt-6">
              <BusinessCompliance />
            </TabsContent>

            {/* API Tab */}
            <TabsContent value="api" className="mt-0 pt-6">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Code2 className="h-4 w-4 text-primary" />
                      API Key Management
                    </CardTitle>
                    <CardDescription>Generate and manage your API keys for integration</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ApiKeyManager />
                  </CardContent>
                </Card>
                <ApiDocs />
              </div>
            </TabsContent>

            {/* Webhooks Tab */}
            <TabsContent value="webhooks" className="mt-0 pt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-primary" />
                    Webhook Configuration
                  </CardTitle>
                  <CardDescription>Set up webhook endpoints to receive real-time event notifications</CardDescription>
                </CardHeader>
                <CardContent>
                  <WebhookManager />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <BusinessSettings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </main>
      <Footer />
    </div>
  );
};

export default Business;
