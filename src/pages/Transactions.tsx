
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowDownLeft, ArrowUpRight, Download, Search } from "lucide-react";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { useToast } from "@/components/ui/use-toast";
import { Transaction } from "@/types/transaction";

const Transactions = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const { toast } = useToast();

  // This function will be passed to the TransactionHistory component to receive all transactions
  const handleTransactionsLoaded = (transactions: Transaction[]) => {
    setAllTransactions(transactions);
  };

  // Apply filters whenever search term or filter type changes
  useEffect(() => {
    if (!allTransactions.length) return;

    let result = [...allTransactions];

    // Apply direction filter
    if (filterType !== "all") {
      result = result.filter(transaction => transaction.direction === filterType);
    }

    // Apply search filter - search by recipient name or transaction ID
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      result = result.filter(transaction => 
        transaction.recipient_name.toLowerCase().includes(search) || 
        transaction.id.toLowerCase().includes(search) ||
        (transaction.reference && transaction.reference.toLowerCase().includes(search))
      );
    }

    setFilteredTransactions(result);
  }, [searchTerm, filterType, allTransactions]);

  const handleExport = () => {
    // Create CSV content
    const headers = ["Date", "Type", "Amount", "Recipient", "Status", "Reference"];
    const csvContent = filteredTransactions.map(t => {
      const date = new Date(t.created_at).toLocaleDateString();
      const type = t.direction === "incoming" ? "Received" : "Sent";
      const amount = `${t.currency} ${t.amount.toFixed(2)}`;
      return [date, type, amount, t.recipient_name, t.status, t.reference || ""].join(",");
    });
    
    // Create and download the CSV file
    const csv = [headers.join(","), ...csvContent].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `transactions-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Export successful",
      description: "Your transactions have been exported to CSV",
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h1 className="text-3xl font-bold">Transaction History</h1>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input 
              placeholder="Search transactions..." 
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Transactions</SelectItem>
              <SelectItem value="incoming">Incoming</SelectItem>
              <SelectItem value="outgoing">Outgoing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Transaction History Component */}
        <TransactionHistory 
          filteredTransactions={filteredTransactions}
          onTransactionsLoaded={handleTransactionsLoaded}
        />
      </main>
      <Footer />
    </div>
  );
};

export default Transactions;
