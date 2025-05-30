
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, TrendingDown, Users, CreditCard, DollarSign, Activity, Eye, EyeOff, Copy, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BusinessDashboard = () => {
  const { toast } = useToast();
  const [apiKeys, setApiKeys] = useState([
    {
      id: '1',
      name: 'Production API Key',
      key: 'bm_live_12345678901234567890',
      created: '2024-05-15',
      lastUsed: '2024-05-29',
      status: 'active'
    },
    {
      id: '2',
      name: 'Test API Key',
      key: 'bm_test_09876543210987654321',
      created: '2024-05-10',
      lastUsed: '2024-05-28',
      status: 'active'
    }
  ]);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const toggleKeyVisibility = (keyId: string) => {
    const newVisibleKeys = new Set(visibleKeys);
    if (newVisibleKeys.has(keyId)) {
      newVisibleKeys.delete(keyId);
    } else {
      newVisibleKeys.add(keyId);
    }
    setVisibleKeys(newVisibleKeys);
  };

  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({
      title: "API Key Copied",
      description: "The API key has been copied to your clipboard.",
    });
  };

  const generateNewKey = () => {
    const newKey = {
      id: Date.now().toString(),
      name: `API Key ${apiKeys.length + 1}`,
      key: `bm_test_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`,
      created: new Date().toISOString().split('T')[0],
      lastUsed: 'Never',
      status: 'active' as const
    };
    setApiKeys([...apiKeys, newKey]);
    toast({
      title: "New API Key Generated",
      description: "Your new API key has been created successfully.",
    });
  };

  // Mock data
  const transactionData = [
    { month: 'Jan', amount: 45000, transactions: 120 },
    { month: 'Feb', amount: 52000, transactions: 140 },
    { month: 'Mar', amount: 48000, transactions: 110 },
    { month: 'Apr', amount: 61000, transactions: 180 },
    { month: 'May', amount: 58000, transactions: 165 },
    { month: 'Jun', amount: 67000, transactions: 195 }
  ];

  const paymentMethodData = [
    { name: 'Mobile Money', value: 45, color: '#8884d8' },
    { name: 'Cards', value: 30, color: '#82ca9d' },
    { name: 'Bank Transfer', value: 20, color: '#ffc658' },
    { name: 'USSD', value: 5, color: '#ff7300' }
  ];

  const metrics = [
    {
      title: "Total Revenue",
      value: "K 331,000",
      change: "+12.5%",
      trend: "up",
      icon: DollarSign
    },
    {
      title: "Total Transactions",
      value: "1,010",
      change: "+8.2%",
      trend: "up",
      icon: Activity
    },
    {
      title: "Active Users",
      value: "2,847",
      change: "+15.3%",
      trend: "up",
      icon: Users
    },
    {
      title: "Success Rate",
      value: "98.5%",
      change: "-0.2%",
      trend: "down",
      icon: CreditCard
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Business Dashboard</h1>
          <p className="text-muted-foreground">Monitor your payment performance and manage your API integration</p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="api">API Management</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {/* Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              {metrics.map((metric) => (
                <Card key={metric.title}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{metric.title}</p>
                        <p className="text-2xl font-bold">{metric.value}</p>
                        <div className="flex items-center mt-1">
                          {metric.trend === "up" ? (
                            <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-600 mr-1" />
                          )}
                          <span className={`text-sm ${metric.trend === "up" ? "text-green-600" : "text-red-600"}`}>
                            {metric.change}
                          </span>
                        </div>
                      </div>
                      <metric.icon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={transactionData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={paymentMethodData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}%`}
                      >
                        {paymentMethodData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="analytics">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Transaction Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={transactionData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="transactions" stroke="#8884d8" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Top Countries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { country: "Zambia", percentage: 85 },
                        { country: "Zimbabwe", percentage: 8 },
                        { country: "Malawi", percentage: 4 },
                        { country: "Others", percentage: 3 }
                      ].map((item) => (
                        <div key={item.country} className="flex justify-between items-center">
                          <span className="text-sm">{item.country}</span>
                          <span className="text-sm font-medium">{item.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Peak Hours</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { time: "14:00 - 16:00", percentage: 35 },
                        { time: "10:00 - 12:00", percentage: 28 },
                        { time: "16:00 - 18:00", percentage: 22 },
                        { time: "Other hours", percentage: 15 }
                      ].map((item) => (
                        <div key={item.time} className="flex justify-between items-center">
                          <span className="text-sm">{item.time}</span>
                          <span className="text-sm font-medium">{item.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Error Rates</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { error: "Network Timeout", rate: "0.8%" },
                        { error: "Insufficient Funds", rate: "0.5%" },
                        { error: "Invalid Card", rate: "0.2%" },
                        { error: "Other", rate: "0.1%" }
                      ].map((item) => (
                        <div key={item.error} className="flex justify-between items-center">
                          <span className="text-sm">{item.error}</span>
                          <span className="text-sm font-medium text-red-600">{item.rate}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="api">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle>API Keys</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Manage your API keys for integration
                      </p>
                    </div>
                    <Button onClick={generateNewKey}>
                      Generate New Key
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {apiKeys.map((apiKey) => (
                      <div key={apiKey.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-medium">{apiKey.name}</h3>
                            <Badge variant={apiKey.status === 'active' ? 'default' : 'secondary'}>
                              {apiKey.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Created: {apiKey.created}</span>
                            <span>•</span>
                            <span>Last used: {apiKey.lastUsed}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                              {visibleKeys.has(apiKey.id) 
                                ? apiKey.key 
                                : apiKey.key.substring(0, 12) + '••••••••••••••••••'
                              }
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleKeyVisibility(apiKey.id)}
                            >
                              {visibleKeys.has(apiKey.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyApiKey(apiKey.key)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>API Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center">
                      <p className="text-3xl font-bold">24,567</p>
                      <p className="text-sm text-muted-foreground">Total API Calls</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold">98.9%</p>
                      <p className="text-sm text-muted-foreground">Success Rate</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold">125ms</p>
                      <p className="text-sm text-muted-foreground">Avg Response Time</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Integration Guide</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Getting Started</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Use your API key to authenticate requests to our payment API:
                      </p>
                      <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
{`curl -X POST https://api.bmaglass.com/v1/payments \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "ZMW",
    "payment_method": "mobile_money"
  }'`}
                      </pre>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        View Documentation
                      </Button>
                      <Button variant="outline" size="sm">
                        Download SDK
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default BusinessDashboard;
