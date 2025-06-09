
import React from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SubscriptionManager from "@/components/subscription/SubscriptionManager";
import UsageTracker from "@/components/subscription/UsageTracker";
import BillingHistory from "@/components/subscription/BillingHistory";

const Billing = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Billing & Subscription</h1>
          <p className="text-muted-foreground">
            Manage your subscription, view usage, and access billing history
          </p>
        </div>

        <Tabs defaultValue="subscription" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="subscription">Subscription</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="billing">Billing History</TabsTrigger>
          </TabsList>

          <TabsContent value="subscription">
            <SubscriptionManager />
          </TabsContent>

          <TabsContent value="usage">
            <UsageTracker />
          </TabsContent>

          <TabsContent value="billing">
            <BillingHistory />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Billing;
