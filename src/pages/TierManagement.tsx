
import React from 'react';
import Header from "@/components/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TierFeatureMatrix from "@/components/tiers/TierFeatureMatrix";
import TierWorkflow from "@/components/tiers/TierWorkflow";
import { FeatureList } from "@/components/FeatureAccess";

const TierManagement = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-[28px] leading-tight font-display font-semibold mb-2">Tier &amp; feature management</h1>
          <p className="text-muted-foreground">
            Comprehensive overview of subscription tiers, features, and workflows
          </p>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="features">My Features</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
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
        </Tabs>
      </main>
    </div>
  );
};

export default TierManagement;
