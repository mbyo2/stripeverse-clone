
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import EnhancedTransactionManager from "@/components/wallet/EnhancedTransactionManager";
import { Suspense } from "react";

const Transactions = () => {
  const [activeTab, setActiveTab] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h1 className="text-3xl font-bold">Transaction History</h1>
          <Badge variant="outline" className="text-sm py-1 px-3">
            Optimized for high volume
          </Badge>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-8">
          <TabsList className="grid grid-cols-3 w-full md:w-auto">
            <TabsTrigger value="all">All Transactions</TabsTrigger>
            <TabsTrigger value="incoming">Received</TabsTrigger>
            <TabsTrigger value="outgoing">Sent</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="mt-6">
            <Suspense fallback={<LoadingCard />}>
              <EnhancedTransactionManager showFilters={true} showExport={true} />
            </Suspense>
          </TabsContent>
          
          <TabsContent value="incoming" className="mt-6">
            <Suspense fallback={<LoadingCard />}>
              <EnhancedTransactionManager 
                showFilters={true} 
                showExport={true} 
              />
            </Suspense>
          </TabsContent>
          
          <TabsContent value="outgoing" className="mt-6">
            <Suspense fallback={<LoadingCard />}>
              <EnhancedTransactionManager 
                showFilters={true} 
                showExport={true} 
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

const LoadingCard = () => (
  <Card>
    <CardContent className="p-6 flex items-center justify-center min-h-[300px]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </CardContent>
  </Card>
);

export default Transactions;
