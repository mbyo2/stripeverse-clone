import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessData } from "@/hooks/useBusinessData";
import { Link } from "react-router-dom";
import { Store, CreditCard, BarChart3, Settings, Shield, Wallet, FileText, Webhook } from "lucide-react";
import { BusinessSettings } from "@/components/business/BusinessSettings";
import { BusinessBankingInfo } from "@/components/business/BusinessBankingInfo";
import BusinessCompliance from "@/components/business/BusinessCompliance";
import { ApiKeyManager } from "@/components/business/ApiKeyManager";
import { WebhookManager } from "@/components/business/WebhookManager";
import { ApiDocs } from "@/components/business/ApiDocs";
import { Skeleton } from "@/components/ui/skeleton";

const Business = () => {
  const { user } = useAuth();
  const { merchantAccount, isLoading } = useBusinessData();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Business Portal</h1>
            <p className="text-muted-foreground">
              {merchantAccount?.business_name || 'Configure your business account'}
            </p>
          </div>
          <div className="flex gap-2">
            {merchantAccount?.status && (
              <Badge variant={merchantAccount.status === 'active' ? 'default' : 'secondary'}>
                {merchantAccount.status}
              </Badge>
            )}
            <Link to="/business-dashboard">
              <Button size="sm">
                <BarChart3 className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="overview">
              <Store className="h-4 w-4 mr-1 hidden sm:inline" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 mr-1 hidden sm:inline" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="banking">
              <Wallet className="h-4 w-4 mr-1 hidden sm:inline" />
              Banking
            </TabsTrigger>
            <TabsTrigger value="compliance">
              <Shield className="h-4 w-4 mr-1 hidden sm:inline" />
              Compliance
            </TabsTrigger>
            <TabsTrigger value="api">
              <FileText className="h-4 w-4 mr-1 hidden sm:inline" />
              API
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <Webhook className="h-4 w-4 mr-1 hidden sm:inline" />
              Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Business Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="h-5 w-5" />
                    Business Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {merchantAccount ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Business Name</p>
                          <p className="font-medium text-foreground">{merchantAccount.business_name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Type</p>
                          <p className="font-medium text-foreground">{merchantAccount.business_type}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Registration</p>
                          <p className="font-medium text-foreground">{merchantAccount.registration_number || 'Not set'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Status</p>
                          <Badge variant={merchantAccount.status === 'active' ? 'default' : 'secondary'}>
                            {merchantAccount.status}
                          </Badge>
                        </div>
                      </div>
                      <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Profile
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <Store className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-4">
                        No merchant account found. Complete your business setup to get started.
                      </p>
                      <Button onClick={() => setSettingsOpen(true)}>
                        Set Up Business Account
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <Link to="/business-dashboard">
                      <Button variant="outline" className="w-full h-16 flex flex-col gap-1">
                        <BarChart3 className="h-5 w-5" />
                        <span className="text-xs">Analytics</span>
                      </Button>
                    </Link>
                    <Link to="/payment-processor">
                      <Button variant="outline" className="w-full h-16 flex flex-col gap-1">
                        <CreditCard className="h-5 w-5" />
                        <span className="text-xs">Payments</span>
                      </Button>
                    </Link>
                    <Link to="/compliance">
                      <Button variant="outline" className="w-full h-16 flex flex-col gap-1">
                        <Shield className="h-5 w-5" />
                        <span className="text-xs">Compliance</span>
                      </Button>
                    </Link>
                    <Link to="/disputes">
                      <Button variant="outline" className="w-full h-16 flex flex-col gap-1">
                        <FileText className="h-5 w-5" />
                        <span className="text-xs">Disputes</span>
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              {/* API Integration Summary */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Integration Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-secondary/20 text-center">
                      <p className="text-sm text-muted-foreground">API Key</p>
                      <p className="font-medium text-foreground">
                        {merchantAccount?.api_key_masked || 'Not configured'}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-secondary/20 text-center">
                      <p className="text-sm text-muted-foreground">Webhook</p>
                      <p className="font-medium text-foreground">
                        {merchantAccount?.webhook_url ? 'Configured' : 'Not set'}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-secondary/20 text-center">
                      <p className="text-sm text-muted-foreground">Webhook Secret</p>
                      <p className="font-medium text-foreground">
                        {merchantAccount?.webhook_secret_masked || 'Not set'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Business Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setSettingsOpen(true)} className="mb-4">
                  <Settings className="h-4 w-4 mr-2" />
                  Open Settings Panel
                </Button>
                <p className="text-sm text-muted-foreground">
                  Configure your business name, contact details, notification preferences, and settlement options.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="banking">
            <BusinessBankingInfo />
          </TabsContent>

          <TabsContent value="compliance">
            <BusinessCompliance />
          </TabsContent>

          <TabsContent value="api">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>API Keys</CardTitle>
                </CardHeader>
                <CardContent>
                  <ApiKeyManager />
                </CardContent>
              </Card>
              <ApiDocs />
            </div>
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
        </Tabs>

        <BusinessSettings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </main>
      <Footer />
    </div>
  );
};

export default Business;
