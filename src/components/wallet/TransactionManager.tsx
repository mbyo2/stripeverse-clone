
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { 
  DownloadIcon, 
  FilterIcon, 
  SearchIcon, 
  XIcon, 
  ChevronsUpDown, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Clock,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Transaction, TransactionFilter } from "@/types/transaction";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CreateDisputeDialog } from "@/components/disputes/CreateDisputeDialog";
import { format, subDays, isValid } from "date-fns";

interface TransactionManagerProps {
  limit?: number;
  showFilters?: boolean;
  showExport?: boolean;
  className?: string;
}

const TransactionManager = ({
  limit = 50,
  showFilters = true,
  showExport = true,
  className = ""
}: TransactionManagerProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<TransactionFilter>({});
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: subDays(new Date(), 30),
    to: new Date()
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  
  // Fetch transactions with React Query
  const { data: transactions, isLoading, isError, refetch } = useQuery({
    queryKey: ['transactions', filters, limit, sortOrder],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: sortOrder === 'asc' });
        
      // Apply filters  
      if (filters.startDate && isValid(filters.startDate)) {
        query = query.gte('created_at', filters.startDate.toISOString());
      }
      
      if (filters.endDate && isValid(filters.endDate)) {
        query = query.lte('created_at', filters.endDate.toISOString());
      }
      
      if (filters.type && filters.type !== 'all') {
        query = query.eq('direction', filters.type);
      }
      
      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      
      if (filters.minAmount) {
        query = query.gte('amount', filters.minAmount);
      }
      
      if (filters.maxAmount) {
        query = query.lte('amount', filters.maxAmount);
      }
      
      if (filters.paymentMethod && filters.paymentMethod !== 'all') {
        query = query.eq('payment_method', filters.paymentMethod);
      }
      
      // Apply limit
      query = query.limit(limit);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return data as Transaction[];
    }
  });
  
  // Filter transactions based on search term
  const filteredTransactions = transactions?.filter(tx => {
    if (!searchTerm.trim()) return true;
    
    const search = searchTerm.toLowerCase();
    return (
      (tx.recipient_name && tx.recipient_name.toLowerCase().includes(search)) ||
      (tx.reference && tx.reference.toLowerCase().includes(search)) ||
      tx.id.toString().includes(search) ||
      (tx.provider && tx.provider.toLowerCase().includes(search))
    );
  }) || [];
  
  // Apply filters when they change
  useEffect(() => {
    const newFilters: TransactionFilter = {};
    
    if (dateRange.from) {
      newFilters.startDate = dateRange.from;
    }
    
    if (dateRange.to) {
      newFilters.endDate = dateRange.to;
    }
    
    if (typeFilter !== "all") {
      newFilters.type = typeFilter;
    }
    
    if (statusFilter !== "all") {
      newFilters.status = statusFilter;
    }
    
    setFilters(newFilters);
  }, [dateRange, typeFilter, statusFilter]);
  
  const handleExport = () => {
    if (!filteredTransactions.length) {
      toast({
        title: "No data to export",
        description: "There are no transactions matching your filters to export.",
        variant: "destructive"
      });
      return;
    }
    
    // Prepare CSV data
    const headers = ["Date", "Type", "Amount", "Recipient", "Status", "Reference", "Payment Method"];
    const csvRows = [headers.join(",")];
    
    filteredTransactions.forEach(tx => {
      const row = [
        new Date(tx.created_at).toLocaleDateString(),
        tx.direction === "incoming" ? "Received" : "Sent",
        `${tx.currency} ${tx.amount.toFixed(2)}`,
        tx.recipient_name || "Unknown",
        tx.status,
        tx.reference || "",
        tx.payment_method
      ];
      
      csvRows.push(row.join(","));
    });
    
    // Create and download CSV file
    const csvString = csvRows.join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `transactions_${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Export successful",
      description: `${filteredTransactions.length} transactions exported to CSV.`
    });
  };
  
  const resetFilters = () => {
    setDateRange({
      from: subDays(new Date(), 30),
      to: new Date()
    });
    setStatusFilter("all");
    setTypeFilter("all");
    setSearchTerm("");
  };
  
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search and filters */}
      {showFilters && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input 
                placeholder="Search transactions..." 
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <Button 
              variant="outline" 
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className="flex items-center gap-2"
            >
              <FilterIcon className="h-4 w-4" />
              Filters
              {(typeFilter !== "all" || statusFilter !== "all" || dateRange.from || dateRange.to) && (
                <Badge variant="secondary" className="ml-2">Active</Badge>
              )}
            </Button>
            
            {showExport && (
              <Button variant="outline" onClick={handleExport} disabled={!filteredTransactions.length}>
                <DownloadIcon className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            
            <Button variant="outline" onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}>
              <ChevronsUpDown className="mr-2 h-4 w-4" /> 
              {sortOrder === "desc" ? "Newest first" : "Oldest first"}
            </Button>
          </div>
          
          {showFilterPanel && (
            <Card>
              <CardContent className="p-4 grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Date Range</label>
                  <div className="grid gap-2">
                    <DatePicker 
                      date={dateRange.from} 
                      setDate={(date) => setDateRange(prev => ({ ...prev, from: date }))}
                      placeholder="Start date"
                    />
                    <DatePicker 
                      date={dateRange.to} 
                      setDate={(date) => setDateRange(prev => ({ ...prev, to: date }))}
                      placeholder="End date"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Transaction Type</label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="incoming">Received</SelectItem>
                      <SelectItem value="outgoing">Sent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2 flex items-end">
                  <Button onClick={resetFilters} className="w-full" variant="outline">
                    <XIcon className="mr-2 h-4 w-4" /> Reset Filters
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      
      {/* Transaction list */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-lg flex items-center justify-between">
            Transaction History
            <span className="text-sm font-normal text-muted-foreground">
              {filteredTransactions.length} transactions
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between py-4 border-b last:border-0 animate-pulse">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-secondary"></div>
                    <div className="ml-4">
                      <div className="h-4 w-32 bg-secondary rounded"></div>
                      <div className="h-3 w-24 mt-2 bg-secondary rounded"></div>
                    </div>
                  </div>
                  <div className="h-4 w-20 bg-secondary rounded"></div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center text-destructive py-8">
              <p>Failed to load transactions</p>
              <Button variant="outline" onClick={() => refetch()} className="mt-4">
                Try Again
              </Button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>No transactions match your filters</p>
              {showFilters && (
                <Button variant="outline" onClick={resetFilters} className="mt-4">
                  Reset Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between py-4 border-b last:border-0 gap-4">
                  <div className="flex items-center flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      transaction.status === 'pending' ? "bg-amber-100" :
                      transaction.status === 'failed' ? "bg-red-100" :
                      transaction.direction === 'outgoing' ? "bg-blue-100" : "bg-green-100"
                    }`}>
                      {transaction.status === 'pending' ? (
                        <Clock className="h-5 w-5 text-amber-600" />
                      ) : transaction.status === 'failed' ? (
                        <XIcon className="h-5 w-5 text-red-600" />
                      ) : transaction.direction === 'outgoing' ? (
                        <ArrowUpRight className="h-5 w-5 text-blue-600" />
                      ) : (
                        <ArrowDownLeft className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                    <div className="ml-4 min-w-0">
                      <div className="font-medium truncate">
                        {transaction.direction === 'outgoing' ? "Sent to" : "Received from"} {" "}
                        {transaction.recipient_name || "Unknown"}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                        {new Date(transaction.created_at).toLocaleDateString()} 
                        <Badge variant="outline" className="font-normal">
                          {transaction.payment_method.replace('_', ' ')}
                        </Badge>
                        {transaction.reference && (
                          <span className="text-xs text-muted-foreground">
                            Ref: {transaction.reference}
                          </span>
                        )}
                        {transaction.status === 'pending' && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                            Pending
                          </Badge>
                        )}
                        {transaction.status === 'failed' && (
                          <Badge variant="outline" className="bg-red-50 text-red-800 border-red-200">
                            Failed
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className={`font-medium text-right ${
                      transaction.status === 'failed' ? "text-destructive" :
                      transaction.status === 'pending' ? "text-amber-600" :
                      transaction.direction === 'outgoing' ? "text-blue-600" : "text-green-600"
                    }`}>
                      {transaction.direction === 'outgoing' ? "-" : "+"}
                      {transaction.currency} {transaction.amount.toFixed(2)}
                    </div>
                    {transaction.status === 'completed' && (
                      <CreateDisputeDialog
                        transactionId={(transaction as any).uuid_id || transaction.id.toString()}
                        transactionAmount={transaction.amount}
                        transactionDate={transaction.created_at}
                        trigger={
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                            <AlertCircle className="h-4 w-4" />
                          </Button>
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TransactionManager;
