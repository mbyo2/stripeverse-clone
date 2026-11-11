import Header from "@/components/Header";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import EnhancedTransactionManager from "@/components/wallet/EnhancedTransactionManager";
import { Suspense } from "react";
import { ArrowDownLeft, ArrowUpRight, Filter } from "lucide-react";
import { TransactionsManagerSkeleton } from "@/components/ui/skeletons";
import { useAccount } from "@/contexts/AccountContext";
import { useMultiCurrencyWallets } from "@/hooks/useMultiCurrency";

const Transactions = () => {
  const [activeFilter, setActiveFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const { selectedAccountId, selectedAccountName } = useAccount();
  const { data: allWallets } = useMultiCurrencyWallets();

  // When a sub-account is selected, show only that account's transactions.
  const walletIds = selectedAccountId
    ? (allWallets ?? []).filter(w => w.account_id === selectedAccountId).map(w => w.id)
    : undefined;
  
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-greeting text-foreground">Transactions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View and manage your transaction history
              {selectedAccountId && <> · Viewing <span className="font-medium text-foreground">{selectedAccountName}</span></>}
            </p>
          </div>
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

        <Suspense fallback={<TransactionsManagerSkeleton />}>
          <EnhancedTransactionManager
            showFilters={true}
            showExport={true}
            directionFilter={activeFilter}
            walletIds={walletIds}
          />
        </Suspense>
      </main>
    </div>
  );
};

export default Transactions;
