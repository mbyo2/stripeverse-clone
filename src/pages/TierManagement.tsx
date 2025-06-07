
import React from 'react';
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TierFeatureMatrix from "@/components/tiers/TierFeatureMatrix";
import TierWorkflow from "@/components/tiers/TierWorkflow";
import { FeatureList } from "@/components/FeatureAccess";

const TierManagement = () => {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Tier & Feature Management</h1>
          <p className="text-muted-foreground">
            Comprehensive overview of subscription tiers, features, and workflows
          </p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="features">My Features</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="comparison">Compare Tiers</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <TierFeatureMatrix />
          </TabsContent>

          <TabsContent value="features">
            <div className="max-w-2xl">
              <FeatureList />
            </div>
          </TabsContent>

          <TabsContent value="workflows">
            <TierWorkflow />
          </TabsContent>

          <TabsContent value="comparison">
            <TierFeatureMatrix />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default TierManagement;
