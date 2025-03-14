import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { 
  DownloadIcon, 
  FilterIcon, 
  SearchIcon, 
  XIcon, 
  ChevronsUpDown, 
  RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Transaction, TransactionFilter } from "@/types/transaction";
import { format, subDays, isValid } from "date-fns";
import { memoize } from "@/lib/cache";
import { trackRender, measureExecutionTime } from "@/lib/performance";
import OptimizedTransactionList from "./OptimizedTransactionList";

const filterTransactionsBySearch = memoize(
  (transactions: Transaction[], searchTerm: string): Transaction[] => {
    if (!searchTerm.trim()) return transactions;
    
    const search = searchTerm.toLowerCase();
    return transactions.filter(tx => (
      (tx.recipient_name && tx.recipient_name.toLowerCase().includes(search)) ||
      (tx.reference && tx.reference.toLowerCase().includes(search)) ||
      tx.id.toString().includes(search) ||
      (tx.provider && tx.provider.toLowerCase().includes(search))
    ));
  },
  (transactions, searchTerm) => `search:${searchTerm}:${transactions.length}`,
  60000
);

interface EnhancedTransactionManagerProps {
  limit?: number;
  showFilters?: boolean;
  showExport?: boolean;
  className?: string;
}

const EnhancedTransactionManager = ({
  limit = 1000,
  showFilters = true,
  showExport = true,
  className = ""
}: EnhancedTransactionManagerProps) => {
  const endRenderTracking = trackRender("EnhancedTransactionManager");
  
  const queryClient = useQueryClient();
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
  const [currentPage, setCurrentPage] = useState(1);
  const searchDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    
    searchDebounceTimer.current = setTimeout(() => {
      setSearchTerm(value);
    }, 300);
  };
  
  const fetchTransactions = useCallback(async () => {
    let query = supabase
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: sortOrder === 'asc' });
      
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
    
    query = query.range((currentPage - 1) * limit, currentPage * limit - 1);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      return generateMockTransactions(limit);
    }
    
    return data as Transaction[];
  }, [filters, limit, sortOrder, currentPage]);
  
  const { 
    data: transactions = [], 
    isLoading, 
    isError, 
    refetch,
    isFetching
  } = useQuery({
    queryKey: ['transactions', filters, limit, sortOrder, currentPage],
    queryFn: fetchTransactions,
    staleTime: 30000,
    gcTime: 300000,
  });
  
  const filteredTransactionsFunc = measureExecutionTime(
    () => filterTransactionsBySearch(transactions, searchTerm),
    "filterTransactions"
  );
  
  const filteredTransactions: Transaction[] = filteredTransactionsFunc();
  
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
  
  useEffect(() => {
    const channel = supabase
      .channel('transactions_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'transactions' 
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
  
  const handleExport = () => {
    if (!filteredTransactions.length) {
      toast({
        title: "No data to export",
        description: "There are no transactions matching your filters to export.",
        variant: "destructive"
      });
      return;
    }
    
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
    setCurrentPage(1);
    
    const searchInput = document.querySelector('input[placeholder="Search transactions..."]') as HTMLInputElement;
    if (searchInput) {
      searchInput.value = "";
    }
  };
  
  const generateMockTransactions = (count: number): Transaction[] => {
    const mockTransactions: Transaction[] = [];
    const directions = ['incoming', 'outgoing'] as const;
    const statuses = ['completed', 'pending', 'failed'] as const;
    const methods = ['mobile_money', 'bank_transfer', 'card', 'ussd'] as const;
    const recipients = ['John Banda', 'Mary Phiri', 'Zamtel', 'MTN Mobile', 'Airtel Money', 'ZamPay', 'Standard Chartered'];
    
    for (let i = 0; i < count; i++) {
      const direction = directions[Math.floor(Math.random() * directions.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const method = methods[Math.floor(Math.random() * methods.length)];
      const recipient = recipients[Math.floor(Math.random() * recipients.length)];
      const amount = parseFloat((Math.random() * 1000 + 10).toFixed(2));
      const date = new Date();
      date.setDate(date.getDate() - Math.floor(Math.random() * 30));
      
      mockTransactions.push({
        id: i + 1,
        user_id: '',
        amount,
        currency: 'ZMW',
        payment_method: method,
        direction,
        recipient_name: recipient,
        recipient_account: '',
        recipient_bank: '',
        status,
        reference: `REF${Math.floor(Math.random() * 1000000)}`,
        provider: method === 'mobile_money' ? 'MTN' : '',
        created_at: date.toISOString(),
        updated_at: date.toISOString()
      });
    }
    
    return mockTransactions;
  };
  
  useEffect(() => {
    return endRenderTracking;
  }, [endRenderTracking]);
  
  return (
    <div className={`space-y-4 ${className}`}>
      {showFilters && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input 
                placeholder="Search transactions..." 
                className="pl-10"
                onChange={handleSearchChange}
                defaultValue={searchTerm}
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
              <Button variant="outline" onClick={handleExport} disabled={filteredTransactions.length === 0}>
                <DownloadIcon className="mr-2 h-4 w-4" /> Export
              </Button>
            )}
            
            <Button 
              variant="outline" 
              onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            >
              <ChevronsUpDown className="mr-2 h-4 w-4" /> 
              {sortOrder === "desc" ? "Newest first" : "Oldest first"}
            </Button>
            
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> 
              Refresh
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
            <OptimizedTransactionList transactions={[]} isLoading={true} />
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
            <OptimizedTransactionList transactions={filteredTransactions} />
          )}
          
          {!isLoading && filteredTransactions.length > 0 && (
            <div className="flex justify-between items-center mt-4">
              <Button 
                variant="outline" 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {currentPage}
              </span>
              <Button 
                variant="outline" 
                onClick={() => setCurrentPage(prev => prev + 1)}
                disabled={filteredTransactions.length < limit}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EnhancedTransactionManager;
