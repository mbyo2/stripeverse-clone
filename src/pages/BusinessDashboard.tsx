
import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { 
  LineChart, 
  BarChart, 
  PieChart, 
  Users, 
  CreditCard, 
  ArrowUpCircle, 
  ArrowDownCircle,
  Settings,
  Wallet,
  Building2,
  Phone
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BusinessSettings } from "@/components/business/BusinessSettings";

const BusinessDashboard = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Business Dashboard</h1>
            <p className="text-muted-foreground">Manage your payment services and view analytics</p>
          </div>
          <Button onClick={openSettings}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
        
        {/* Settings component */}
        <BusinessSettings isOpen={isSettingsOpen} onClose={closeSettings} />
        
        {/* Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">K 125,430.00</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center">
                <ArrowUpCircle className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-500 font-medium">12.5%</span>
                <span className="ml-1">from last month</span>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2,345</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center">
                <ArrowUpCircle className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-500 font-medium">8.2%</span>
                <span className="ml-1">from last month</span>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">New Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">432</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center">
                <ArrowUpCircle className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-500 font-medium">5.1%</span>
                <span className="ml-1">from last month</span>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Payment Success Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">97.8%</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center">
                <ArrowDownCircle className="h-3 w-3 text-red-500 mr-1" />
                <span className="text-red-500 font-medium">0.5%</span>
                <span className="ml-1">from last month</span>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <Tabs defaultValue="analytics" className="mb-8">
          <TabsList className="mb-6">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="settlements">Settlements</TabsTrigger>
            <TabsTrigger value="integrations">API & Integrations</TabsTrigger>
          </TabsList>
          
          <TabsContent value="analytics" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <LineChart className="mr-2 h-5 w-5" />
                  Revenue Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80 flex items-center justify-center bg-secondary/20">
                  <p className="text-muted-foreground">Revenue chart visualization will appear here</p>
                </div>
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <PieChart className="mr-2 h-5 w-5" />
                    Payment Methods
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60 flex items-center justify-center bg-secondary/20">
                    <p className="text-muted-foreground">Payment methods chart will appear here</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <BarChart className="mr-2 h-5 w-5" />
                    Transaction Volume
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60 flex items-center justify-center bg-secondary/20">
                    <p className="text-muted-foreground">Transaction volume chart will appear here</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="transactions">
            <Card>
              <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <div key={item} className="flex items-center justify-between p-3 border-b last:border-0">
                      <div className="flex items-center">
                        <Avatar className="h-10 w-10 mr-3">
                          <div className="bg-primary/10 rounded-full h-full w-full flex items-center justify-center">
                            {item % 2 === 0 ? <CreditCard className="h-5 w-5 text-primary" /> : <Phone className="h-5 w-5 text-primary" />}
                          </div>
                        </Avatar>
                        <div>
                          <p className="font-medium">Payment #{1000 + item}</p>
                          <p className="text-sm text-muted-foreground">
                            {item % 2 === 0 ? "Card Payment" : "Mobile Money"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">K {(Math.random() * 1000).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date().toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={item % 3 === 0 ? "outline" : "default"}>
                        {item % 3 === 0 ? "Pending" : "Completed"}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="mt-4 text-center">
                  <Button variant="outline">View All Transactions</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="settlements">
            <Card>
              <CardHeader>
                <CardTitle>Settlement History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="flex items-center justify-between p-3 border-b last:border-0">
                      <div className="flex items-center">
                        <Avatar className="h-10 w-10 mr-3">
                          <div className="bg-green-100 rounded-full h-full w-full flex items-center justify-center">
                            <Wallet className="h-5 w-5 text-green-600" />
                          </div>
                        </Avatar>
                        <div>
                          <p className="font-medium">Settlement #{5000 + item}</p>
                          <p className="text-sm text-muted-foreground">
                            {item === 1 ? "Today" : item === 2 ? "Yesterday" : "Apr 1, 2025"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">K {(Math.random() * 10000).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {item === 1 ? "48 transactions" : item === 2 ? "35 transactions" : "62 transactions"}
                        </p>
                      </div>
                      <Button variant="outline" size="sm">
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <h3 className="font-medium mb-3">Next Settlement</h3>
                  <Card className="bg-secondary/20">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">Estimated Amount</p>
                          <p className="text-2xl font-bold mt-1">K 5,432.00</p>
                        </div>
                        <div>
                          <p className="font-medium">Settlement Date</p>
                          <p className="text-md mt-1">April 5, 2025</p>
                        </div>
                        <div>
                          <Button>View Details</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="integrations">
            <Card>
              <CardHeader>
                <CardTitle>API Keys & Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="p-4 border rounded-md">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-medium">API Keys</h3>
                      <Button variant="outline" size="sm">Generate New Key</Button>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-secondary/20 rounded-md">
                        <div>
                          <p className="font-medium">Live API Key</p>
                          <p className="text-sm text-muted-foreground">Use for production transactions</p>
                        </div>
                        <div className="flex items-center">
                          <p className="font-mono bg-secondary px-3 py-1 rounded mr-2">••••••••••••••••</p>
                          <Button variant="ghost" size="sm">Show</Button>
                          <Button variant="ghost" size="sm">Copy</Button>
                        </div>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-secondary/20 rounded-md">
                        <div>
                          <p className="font-medium">Test API Key</p>
                          <p className="text-sm text-muted-foreground">Use for testing integration</p>
                        </div>
                        <div className="flex items-center">
                          <p className="font-mono bg-secondary px-3 py-1 rounded mr-2">••••••••••••••••</p>
                          <Button variant="ghost" size="sm">Show</Button>
                          <Button variant="ghost" size="sm">Copy</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border rounded-md">
                    <h3 className="font-medium mb-3">Webhook Settings</h3>
                    <div className="space-y-4">
                      <div className="flex flex-col">
                        <label className="text-sm mb-1">Webhook URL</label>
                        <div className="flex">
                          <input type="text" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" placeholder="https://your-domain.com/webhook" />
                          <Button className="ml-2">Save</Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm">Event Notifications</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="flex items-center space-x-2">
                            <input type="checkbox" id="payment_success" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" defaultChecked />
                            <label htmlFor="payment_success" className="text-sm">Payment Success</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input type="checkbox" id="payment_failed" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" defaultChecked />
                            <label htmlFor="payment_failed" className="text-sm">Payment Failed</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input type="checkbox" id="settlement" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" defaultChecked />
                            <label htmlFor="settlement" className="text-sm">Settlement Complete</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input type="checkbox" id="refund" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" defaultChecked />
                            <label htmlFor="refund" className="text-sm">Refund Processed</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 border rounded-md">
                    <h3 className="font-medium mb-3">Documentation & Resources</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="p-4 flex flex-col items-center text-center">
                          <div className="bg-primary/10 p-3 rounded-full mb-3">
                            <Building2 className="h-6 w-6 text-primary" />
                          </div>
                          <h4 className="font-medium mb-2">API Documentation</h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            Comprehensive API docs with examples
                          </p>
                          <Button variant="outline" size="sm" className="mt-auto">View Docs</Button>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex flex-col items-center text-center">
                          <div className="bg-primary/10 p-3 rounded-full mb-3">
                            <Users className="h-6 w-6 text-primary" />
                          </div>
                          <h4 className="font-medium mb-2">SDK Downloads</h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            Client libraries for popular languages
                          </p>
                          <Button variant="outline" size="sm" className="mt-auto">Download</Button>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex flex-col items-center text-center">
                          <div className="bg-primary/10 p-3 rounded-full mb-3">
                            <CreditCard className="h-6 w-6 text-primary" />
                          </div>
                          <h4 className="font-medium mb-2">Testing Guide</h4>
                          <p className="text-sm text-muted-foreground mb-3">
                            Learn how to test our integration
                          </p>
                          <Button variant="outline" size="sm" className="mt-auto">View Guide</Button>
                        </CardContent>
                      </Card>
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

export default BusinessDashboard;
