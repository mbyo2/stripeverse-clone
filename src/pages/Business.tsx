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
import { Link, useNavigate } from "react-router-dom";
import { 
  Store, CreditCard, BarChart3, Settings, Shield, Wallet, FileText, 
  Webhook, TrendingUp, Activity, ArrowUpRight, ArrowRight, 
  CheckCircle, AlertCircle, Clock, Users, Zap, Globe
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { BusinessSettings } from "@/components/business/BusinessSettings";
import { BusinessBankingInfo } from "@/components/business/BusinessBankingInfo";
import BusinessCompliance from "@/components/business/BusinessCompliance";
import { ApiKeyManager } from "@/components/business/ApiKeyManager";
import { WebhookManager } from "@/components/business/WebhookManager";
import { ApiDocs } from "@/components/business/ApiDocs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";

const Business = () => {
  const { user } = useAuth();
  const { merchantAccount, metrics, monthlyChart, paymentMethodBreakdown, businessTransactions, isLoading } = useBusinessData();
  const { formatAmount } = useCurrency();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <Skeleton className="h-9 w-64 mb-2" />
              <Skeleton className="h-5 w-48" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-96 rounded-xl" />
        </main>
      </div>
    );
  }

  const setupProgress = [
    { label: 'Business Profile', done: !!merchantAccount?.business_name, link: 'settings' },
    { label: 'Bank Account', done: !!(merchantAccount?.contact_info as any)?.banking?.accountName, link: 'banking' },
    { label: 'API Key', done: !!merchantAccount?.api_key_masked, link: 'api' },
    { label: 'Webhook', done: !!merchantAccount?.webhook_url, link: 'webhooks' },
  ];
  const completedSteps = setupProgress.filter(s => s.done).length;

  const statCards = [
    {
      title: "Total Revenue",
      value: formatAmount(metrics?.revenue || 0),
      icon: TrendingUp,
      gradient: "from-emerald-500 to-emerald-600",
      change: "From completed transactions",
    },
    {
      title: "Transactions",
      value: (metrics?.txCount || 0).toLocaleString(),
      icon: Activity,
      gradient: "from-blue-500 to-blue-600",
      change: "All time",
    },
    {
      title: "Success Rate",
      value: `${metrics?.successRate || 0}%`,
      icon: CheckCircle,
      gradient: "from-violet-500 to-violet-600",
      change: "Completed vs total",
    },
    {
      title: "Status",
      value: merchantAccount?.status === 'active' ? 'Active' : 'Setup',
      icon: Store,
      gradient: merchantAccount?.status === 'active' ? "from-emerald-500 to-teal-600" : "from-amber-500 to-orange-600",
      change: merchantAccount?.status === 'active' ? 'Account verified' : 'Complete setup',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        {/* Header */}
        <motion.div 
          className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold text-foreground">Business Portal</h1>
              {merchantAccount?.status && (
                <Badge 
                  variant={merchantAccount.status === 'active' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {merchantAccount.status}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              {merchantAccount?.business_name || 'Set up your merchant account to start accepting payments'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/business-dashboard')}>
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </Button>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </div>
        </motion.div>

        {/* Stat Cards */}
        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {statCards.map((stat, i) => (
            <Card key={stat.title} className={`bg-gradient-to-br ${stat.gradient} text-white border-0 overflow-hidden relative`}>
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-8 -mt-8" />
              <CardContent className="p-5 relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-white/80">{stat.title}</p>
                  <stat.icon className="h-5 w-5 text-white/70" />
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-white/60 mt-1">{stat.change}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        {/* Setup Progress (show only if not fully set up) */}
        {completedSteps < 4 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <Card className="mb-8 border-dashed border-2 border-primary/20 bg-primary/5">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-foreground">Complete Your Setup</h3>
                    <p className="text-sm text-muted-foreground">{completedSteps} of 4 steps completed</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-primary">{Math.round((completedSteps / 4) * 100)}%</span>
                  </div>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mb-4">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-500" 
                    style={{ width: `${(completedSteps / 4) * 100}%` }} 
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {setupProgress.map((step) => (
                    <div 
                      key={step.label}
                      className={`flex items-center gap-2 text-sm p-2 rounded-lg ${
                        step.done ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-muted'
                      }`}
                    >
                      {step.done ? (
                        <CheckCircle className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">{step.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="w-full flex overflow-x-auto bg-muted/50 p-1 rounded-xl">
              <TabsTrigger value="overview" className="flex-1 min-w-0 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Store className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="banking" className="flex-1 min-w-0 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Wallet className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">Banking</span>
              </TabsTrigger>
              <TabsTrigger value="compliance" className="flex-1 min-w-0 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Shield className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">Compliance</span>
              </TabsTrigger>
              <TabsTrigger value="api" className="flex-1 min-w-0 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <FileText className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">API</span>
              </TabsTrigger>
              <TabsTrigger value="webhooks" className="flex-1 min-w-0 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Webhook className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">Webhooks</span>
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Business Profile */}
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Store className="h-5 w-5 text-primary" />
                          Business Profile
                        </CardTitle>
                        <CardDescription className="mt-1">Your merchant account details</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                        <Settings className="h-4 w-4 mr-1.5" />
                        Edit
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {merchantAccount ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Business Name</p>
                            <p className="font-semibold text-foreground mt-0.5">{merchantAccount.business_name}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Business Type</p>
                            <p className="font-medium text-foreground mt-0.5 capitalize">{merchantAccount.business_type}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Registration Number</p>
                            <p className="font-medium text-foreground mt-0.5">{merchantAccount.registration_number || '—'}</p>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Status</p>
                            <Badge variant={merchantAccount.status === 'active' ? 'default' : 'secondary'} className="mt-1">
                              {merchantAccount.status}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact Email</p>
                            <p className="font-medium text-foreground mt-0.5">{(merchantAccount.contact_info as any)?.email || '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact Phone</p>
                            <p className="font-medium text-foreground mt-0.5">{(merchantAccount.contact_info as any)?.phone || '—'}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-10">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                          <Store className="h-8 w-8 text-primary" />
                        </div>
                        <h3 className="font-semibold text-foreground mb-2">No Merchant Account</h3>
                        <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                          Set up your business profile to start accepting payments and managing your merchant account.
                        </p>
                        <Button onClick={() => setSettingsOpen(true)} size="lg">
                          <Store className="h-4 w-4 mr-2" />
                          Set Up Business Account
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {[
                        { label: 'View Analytics', icon: BarChart3, href: '/business-dashboard', color: 'text-blue-500' },
                        { label: 'Process Payments', icon: CreditCard, href: '/payment-processor', color: 'text-emerald-500' },
                        { label: 'View Disputes', icon: FileText, href: '/disputes', color: 'text-amber-500' },
                        { label: 'Compliance', icon: Shield, href: '/compliance', color: 'text-violet-500' },
                      ].map((action) => (
                        <Button
                          key={action.label}
                          variant="ghost"
                          className="w-full justify-between h-12 px-4 hover:bg-muted/80"
                          onClick={() => navigate(action.href)}
                        >
                          <span className="flex items-center gap-3">
                            <action.icon className={`h-4 w-4 ${action.color}`} />
                            <span className="font-medium">{action.label}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Integration Status */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Integration Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        { label: 'API Key', status: merchantAccount?.api_key_masked ? 'Configured' : 'Not set', active: !!merchantAccount?.api_key_masked },
                        { label: 'Webhook', status: merchantAccount?.webhook_url ? 'Active' : 'Not set', active: !!merchantAccount?.webhook_url },
                        { label: 'Settlement', status: (merchantAccount?.contact_info as any)?.banking?.accountName ? 'Ready' : 'Pending', active: !!(merchantAccount?.contact_info as any)?.banking?.accountName },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between py-1.5">
                          <span className="text-sm text-muted-foreground">{item.label}</span>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                            <span className={`text-sm font-medium ${item.active ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {item.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Banking Tab */}
            <TabsContent value="banking">
              <BusinessBankingInfo />
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance">
              <BusinessCompliance />
            </TabsContent>

            {/* API Tab */}
            <TabsContent value="api">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
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
            <TabsContent value="webhooks">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Webhook className="h-5 w-5 text-primary" />
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
        </motion.div>

        <BusinessSettings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </main>
      <Footer />
    </div>
  );
};

export default Business;
