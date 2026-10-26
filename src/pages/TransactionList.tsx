import React, { useState } from 'react';
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SkeletonListRows } from "@/components/ui/skeletons";
import { Search, Filter, Download, Calendar as CalendarIcon, ArrowUpRight, ArrowDownLeft, Receipt } from "lucide-react";
import { formatCurrency } from "@/utils/walletUtils";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { transactionTitle } from "@/utils/transactionLabels";

type DisplayType = 'send' | 'receive' | 'deposit' | 'withdrawal' | 'card_payment';

interface TransactionRow {
  id: number;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  category: string | null;
  direction: string;
  payment_method: string;
  virtual_card_id?: string | null;
  card_masked_number?: string | null;
  recipient_name: string | null;
  reference: string | null;
  transaction_id: string | null;
  created_at: string | null;
}

interface Transaction {
  id: string;
  type: DisplayType;
  amount: number;
  currency: string;
  status: string;
  description: string;
  date: string;
  recipient?: string;
  sender?: string;
  paymentMethod: string;
  reference: string;
}

const deriveType = (row: TransactionRow): DisplayType => {
  const category = (row.category || '').toLowerCase();
  const method = (row.payment_method || '').toLowerCase();
  if (category.includes('deposit')) return 'deposit';
  if (category.includes('withdraw')) return 'withdrawal';
  if (method.includes('card')) return 'card_payment';
  return row.direction === 'incoming' ? 'receive' : 'send';
};

const mapRow = (row: TransactionRow): Transaction => {
  const type = deriveType(row);
  return {
    id: String(row.id),
    type,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    // Incoming rows use the shared direction-aware labelling (a
    // transfer's stored description is the sender's phrasing and
    // names this user); outgoing rows keep the description as written.
    // Card-funding rows go through the shared labelling in BOTH
    // directions: they carry no description or recipient, so the
    // outgoing fallback used to surface the raw category string.
    description:
      row.direction === 'incoming' || row.category === 'card_funding'
        ? transactionTitle(row)
        : row.description ||
          row.recipient_name ||
          row.category ||
          'Transaction',
    date: row.created_at || new Date().toISOString(),
    recipient: row.direction === 'outgoing' ? row.recipient_name || undefined : undefined,
    sender: row.direction === 'incoming' ? row.recipient_name || undefined : undefined,
    paymentMethod: row.payment_method,
    reference: row.reference || row.transaction_id || `#${row.id}`,
  };
};

const TransactionList = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: transactions = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['transaction-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, amount, currency, status, description, category, direction, payment_method, recipient_name, reference, transaction_id, created_at, virtual_card_id')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      // Resolve card masked numbers so card-funding rows can name
      // the card ("To virtual card ••••3696") instead of a bare
      // category or reference. Best-effort: labels degrade to
      // "To virtual card" when a card can't be resolved.
      const { data: cards } = await supabase
        .from('virtual_cards')
        .select('id, masked_number')
        .eq('user_id', user!.id);
      const maskedByCardId = new Map(
        (cards || []).map((c) => [c.id, c.masked_number as string | null]),
      );
      return (data || []).map((row) =>
        mapRow({
          ...row,
          card_masked_number: row.virtual_card_id
            ? maskedByCardId.get(row.virtual_card_id) ?? null
            : null,
        }),
      );
    },
    enabled: !!user,
  });

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'send':
      case 'withdrawal':
      case 'card_payment':
        return <ArrowUpRight className="h-4 w-4 text-red-600" />;
      case 'receive':
      case 'deposit':
        return <ArrowDownLeft className="h-4 w-4 text-green-600" />;
      default:
        return <ArrowUpRight className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getAmountColor = (type: string) => {
    switch (type) {
      case 'send':
      case 'withdrawal':
      case 'card_payment':
        return 'text-red-600';
      case 'receive':
      case 'deposit':
        return 'text-green-600';
      default:
        return 'text-foreground';
    }
  };

  const getAmountPrefix = (type: string) => {
    switch (type) {
      case 'send':
      case 'withdrawal':
      case 'card_payment':
        return '-';
      case 'receive':
      case 'deposit':
        return '+';
      default:
        return '';
    }
  };

  const filteredTransactions = transactions.filter(transaction => {
    const matchesSearch = transaction.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         transaction.reference.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || transaction.type === filterType;
    const matchesStatus = filterStatus === 'all' || transaction.status === filterStatus;
    const txDate = new Date(transaction.date);
    const matchesFrom = !dateFrom || txDate >= new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate());
    const matchesTo = !dateTo || txDate < new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate() + 1);

    return matchesSearch && matchesType && matchesStatus && matchesFrom && matchesTo;
  });

  const handleExport = () => {
    if (!filteredTransactions.length) return;
    const headers = ["Date", "Description", "Type", "Amount", "Currency", "Status", "Reference", "Payment Method"];
    const csvRows = [headers.join(",")];
    filteredTransactions.forEach(tx => {
      const row = [
        new Date(tx.date).toISOString(),
        `"${tx.description.replace(/"/g, '""')}"`,
        tx.type,
        tx.amount.toFixed(2),
        tx.currency,
        tx.status,
        tx.reference,
        tx.paymentMethod,
      ];
      csvRows.push(row.join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `transactions_${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">Transaction History</h1>
            <p className="text-sm text-muted-foreground mt-1">View and manage your transaction history</p>
          </div>
          <Button className="flex items-center gap-2" onClick={handleExport} disabled={filteredTransactions.length === 0}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="send">Send Money</SelectItem>
                    <SelectItem value="receive">Receive Money</SelectItem>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="withdrawal">Withdrawal</SelectItem>
                    <SelectItem value="card_payment">Card Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Date Range</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "PP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transaction List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">
              Transactions ({filteredTransactions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <SkeletonListRows rows={6} />
            ) : isError ? (
              <div className="text-center py-8">
                <p className="text-destructive mb-4">Failed to load transactions.</p>
                <Button variant="outline" onClick={() => refetch()}>Try Again</Button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {filteredTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between py-4"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center shrink-0">
                          {getTransactionIcon(transaction.type)}
                        </div>
                        <div>
                          <h3 className="font-medium text-[15px]">{transaction.description}</h3>
                          <div className="flex items-center space-x-2 text-[13px] text-muted-foreground">
                            <span>{format(new Date(transaction.date), "MMM dd, yyyy 'at' HH:mm")}</span>
                            <span>•</span>
                            <span>{transaction.reference}</span>
                          </div>
                          {transaction.recipient && (
                            <p className="text-[13px] text-muted-foreground">To: {transaction.recipient}</p>
                          )}
                          {transaction.sender && (
                            <p className="text-[13px] text-muted-foreground">From: {transaction.sender}</p>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className={`font-semibold tabular-nums ${getAmountColor(transaction.type)}`}>
                          {getAmountPrefix(transaction.type)}{formatCurrency(transaction.amount, transaction.currency)}
                        </div>
                        <div className="flex items-center space-x-2">
                          <Badge className={getStatusColor(transaction.status)}>
                            {transaction.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {filteredTransactions.length === 0 && (
                  <div className="text-center py-10">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                      <Receipt className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground">
                      {transactions.length === 0
                        ? "No transactions yet — your history will appear here once you make your first transaction."
                        : "No transactions found matching your criteria."}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default TransactionList;
