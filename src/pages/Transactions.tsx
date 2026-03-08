import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EnhancedTransactionManager from "@/components/wallet/EnhancedTransactionManager";
import { Suspense } from "react";
import { ArrowDownLeft, ArrowUpRight, History, Download, Filter, Loader2 } from "lucide-react";

const Transactions = () => {
  const [activeFilter, setActiveFilter] = useState<"all" | "incoming" | "outgoing">("all");
  
  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <History className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Transactions</h1>
              <p className="text-sm text-muted-foreground">View and manage your transaction history</p>
            </div>
          </div>
          <Button variant="outline" className="h-10 rounded-lg gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          <Button
            variant={activeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("all")}
            className="rounded-full h-9 px-4"
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" /> All
          </Button>
          <Button
            variant={activeFilter === "incoming" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("incoming")}
            className="rounded-full h-9 px-4"
          >
            <ArrowDownLeft className="h-3.5 w-3.5 mr-1.5" /> Received
          </Button>
          <Button
            variant={activeFilter === "outgoing" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("outgoing")}
            className="rounded-full h-9 px-4"
          >
            <ArrowUpRight className="h-3.5 w-3.5 mr-1.5" /> Sent
          </Button>
        </div>

        {/* Transactions Content */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {activeFilter === "all" && "All Transactions"}
                  {activeFilter === "incoming" && "Received Payments"}
                  {activeFilter === "outgoing" && "Sent Payments"}
                </CardTitle>
                <CardDescription>
                  {activeFilter === "all" && "Complete history of all your transactions"}
                  {activeFilter === "incoming" && "Money you've received from others"}
                  {activeFilter === "outgoing" && "Money you've sent to others"}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="text-xs">
                Real-time sync
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Suspense fallback={<LoadingState />}>
              <EnhancedTransactionManager 
                showFilters={true} 
                showExport={false}
                directionFilter={activeFilter}
              />
            </Suspense>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

const LoadingState = () => (
  <div className="flex flex-col items-center justify-center py-16">
    <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
    <p className="text-sm text-muted-foreground">Loading transactions...</p>
  </div>
);

export default Transactions;
