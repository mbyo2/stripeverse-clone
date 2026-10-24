import React from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SecurityDashboard from "@/components/SecurityDashboard";
import SecurityStatus from "@/components/SecurityStatus";
import SecurityAlert from "@/components/security/SecurityAlert";
import { EnhancedSecuritySettings } from "@/components/security/EnhancedSecuritySettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertTriangle, CheckCircle } from "lucide-react";

const SecuritySettings = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Security Settings</h1>
          <p className="text-muted-foreground">
            Monitor your account security and manage access controls
          </p>
        </div>
        {/* Security Patches Applied Alert */}
        <SecurityAlert
          type="success"
          title="Critical Security Patches Applied"
          description="Your account has been upgraded with the latest security enhancements including encrypted card storage and role escalation protection."
        />

        <Tabs defaultValue="enhanced" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
            <TabsTrigger value="enhanced">Enhanced Security</TabsTrigger>
            <TabsTrigger value="dashboard">Security Dashboard</TabsTrigger>
            <TabsTrigger value="status">Security Status</TabsTrigger>
            <TabsTrigger value="encryption">Data Protection</TabsTrigger>
          </TabsList>

          <TabsContent value="enhanced">
            <EnhancedSecuritySettings />
          </TabsContent>

          <TabsContent value="dashboard">
            <SecurityDashboard />
          </TabsContent>

          <TabsContent value="status">
            <SecurityStatus />
          </TabsContent>

          <TabsContent value="encryption">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-green-600 dark:text-green-400" />
                    Data Encryption Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-500/10 rounded-lg border border-green-200 dark:border-green-500/30">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <div>
                        <p className="font-medium text-green-800 dark:text-green-200">Virtual Card Data</p>
                        <p className="text-sm text-green-700 dark:text-green-300">Card numbers and CVV codes are encrypted</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-700 border-green-300 dark:text-green-300 dark:border-green-500/40">
                      ENCRYPTED
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-500/10 rounded-lg border border-green-200 dark:border-green-500/30">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <div>
                        <p className="font-medium text-green-800 dark:text-green-200">Role Management</p>
                        <p className="text-sm text-green-700 dark:text-green-300">Protected against escalation attacks</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-700 border-green-300 dark:text-green-300 dark:border-green-500/40">
                      SECURED
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-200 dark:border-blue-500/30">
                    <div className="flex items-center gap-3">
                      <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p className="font-medium text-blue-800 dark:text-blue-200">Security Monitoring</p>
                        <p className="text-sm text-blue-700 dark:text-blue-300">All sensitive actions are logged and monitored</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-500/40">
                      ACTIVE
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <SecurityAlert
                type="warning"
                title="Additional Security Recommendations"
                description="Consider enabling two-factor authentication and reviewing your security settings regularly for optimal protection."
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default SecuritySettings;