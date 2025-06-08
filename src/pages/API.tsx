
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Eye, EyeOff, Key, Code, Book } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeys, setApiKeys] = useState([
    {
      id: 1,
      name: "Production API Key",
      key: "pk_live_51H...",
      created: "2024-01-15",
      lastUsed: "2024-01-20",
      status: "active"
    },
    {
      id: 2,
      name: "Test API Key",
      key: "pk_test_51H...",
      created: "2024-01-15",
      lastUsed: "2024-01-18",
      status: "active"
    }
  ]);
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "API key has been copied to your clipboard.",
    });
  };

  const generateNewKey = () => {
    const newKey = {
      id: Date.now(),
      name: "New API Key",
      key: `pk_live_${Math.random().toString(36).substring(2, 15)}`,
      created: new Date().toISOString().split('T')[0],
      lastUsed: "Never",
      status: "active"
    };
    setApiKeys([...apiKeys, newKey]);
    toast({
      title: "API key generated",
      description: "New API key has been created successfully.",
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">API Management</h1>
          <p className="text-muted-foreground">
            Manage your API keys and integration settings
          </p>
        </div>

        <Tabs defaultValue="keys" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="keys">API Keys</TabsTrigger>
            <TabsTrigger value="docs">Documentation</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Keys
                  </CardTitle>
                  <Button onClick={generateNewKey}>Generate New Key</Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {apiKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium">{key.name}</h3>
                            <Badge variant={key.status === 'active' ? 'default' : 'secondary'}>
                              {key.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                              {showApiKey ? key.key : '••••••••••••••••'}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowApiKey(!showApiKey)}
                            >
                              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(key.key)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Created: {key.created} • Last used: {key.lastUsed}
                          </p>
                        </div>
                        <Button variant="destructive" size="sm">
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="docs">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Book className="h-5 w-5" />
                  API Documentation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-2">Quick Start</h3>
                    <div className="bg-gray-100 p-4 rounded-lg">
                      <pre className="text-sm overflow-x-auto">
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
                  </div>
                  
                  <div>
                    <h3 className="font-medium mb-2">Available Endpoints</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <span className="font-mono text-sm">POST /v1/payments</span>
                          <p className="text-sm text-muted-foreground">Create a new payment</p>
                        </div>
                        <Badge variant="outline">Active</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <span className="font-mono text-sm">GET /v1/payments/:id</span>
                          <p className="text-sm text-muted-foreground">Retrieve payment details</p>
                        </div>
                        <Badge variant="outline">Active</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <span className="font-mono text-sm">POST /v1/transfers</span>
                          <p className="text-sm text-muted-foreground">Create money transfer</p>
                        </div>
                        <Badge variant="outline">Active</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks">
            <Card>
              <CardHeader>
                <CardTitle>Webhook Endpoints</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <Input placeholder="https://your-site.com/webhook" />
                    <Button>Add Webhook</Button>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 border rounded">
                      <div>
                        <span className="font-mono text-sm">https://mysite.com/webhook</span>
                        <p className="text-sm text-muted-foreground">payment.completed, payment.failed</p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="default">Active</Badge>
                        <Button variant="outline" size="sm">Edit</Button>
                        <Button variant="destructive" size="sm">Delete</Button>
                      </div>
                    </div>
                  </div>
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

export default API;
