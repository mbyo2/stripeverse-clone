
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Search, Filter, Download, Calendar as CalendarIcon, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { formatCurrency } from "@/utils/walletUtils";
import { format } from "date-fns";

interface Transaction {
  id: string;
  type: 'send' | 'receive' | 'deposit' | 'withdrawal' | 'card_payment';
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  description: string;
  date: string;
  recipient?: string;
  sender?: string;
  paymentMethod: string;
  reference: string;
}

const TransactionList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  // Mock transaction data
  const mockTransactions: Transaction[] = [
    {
      id: 'tx001',
      type: 'send',
      amount: 250.00,
      currency: 'ZMW',
      status: 'completed',
      description: 'Transfer to John Doe',
      date: '2024-05-29T10:30:00Z',
      recipient: '+260 97 123 4567',
      paymentMethod: 'wallet',
      reference: 'TX20240529001'
    },
    {
      id: 'tx002',
      type: 'receive',
      amount: 500.00,
      currency: 'ZMW',
      status: 'completed',
      description: 'Payment from Jane Smith',
      date: '2024-05-28T15:45:00Z',
      sender: '+260 96 987 6543',
      paymentMethod: 'mobile_money',
      reference: 'TX20240528002'
    },
    {
      id: 'tx003',
      type: 'deposit',
      amount: 1000.00,
      currency: 'ZMW',
      status: 'completed',
      description: 'Wallet top-up via MTN',
      date: '2024-05-27T09:15:00Z',
      paymentMethod: 'mobile_money',
      reference: 'TX20240527003'
    },
    {
      id: 'tx004',
      type: 'card_payment',
      amount: 89.99,
      currency: 'ZMW',
      status: 'pending',
      description: 'Online purchase - Amazon',
      date: '2024-05-26T20:30:00Z',
      paymentMethod: 'virtual_card',
      reference: 'TX20240526004'
    },
    {
      id: 'tx005',
      type: 'withdrawal',
      amount: 300.00,
      currency: 'ZMW',
      status: 'failed',
      description: 'ATM withdrawal attempt',
      date: '2024-05-25T14:20:00Z',
      paymentMethod: 'debit_card',
      reference: 'TX20240525005'
    }
  ];

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
        return 'bg-gray-100 text-gray-800';
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
        return 'text-gray-900';
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

  const filteredTransactions = mockTransactions.filter(transaction => {
    const matchesSearch = transaction.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         transaction.reference.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || transaction.type === filterType;
    const matchesStatus = filterStatus === 'all' || transaction.status === filterStatus;
    
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Transaction History</h1>
            <p className="text-muted-foreground">View and manage your transaction history</p>
          </div>
          <Button className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
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
            <CardTitle>
              Transactions ({filteredTransactions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="p-2 bg-muted rounded-full">
                      {getTransactionIcon(transaction.type)}
                    </div>
                    <div>
                      <h3 className="font-medium">{transaction.description}</h3>
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <span>{format(new Date(transaction.date), "MMM dd, yyyy 'at' HH:mm")}</span>
                        <span>•</span>
                        <span>{transaction.reference}</span>
                      </div>
                      {transaction.recipient && (
                        <p className="text-xs text-muted-foreground">To: {transaction.recipient}</p>
                      )}
                      {transaction.sender && (
                        <p className="text-xs text-muted-foreground">From: {transaction.sender}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className={`font-bold ${getAmountColor(transaction.type)}`}>
                      {getAmountPrefix(transaction.type)}{formatCurrency(transaction.amount)}
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
              <div className="text-center py-8">
                <p className="text-muted-foreground">No transactions found matching your criteria.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default TransactionList;
