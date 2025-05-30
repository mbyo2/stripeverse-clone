
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUpRight, ArrowDownLeft, Search, Filter, CalendarIcon, Receipt } from "lucide-react";
import { formatCurrency } from "@/utils/walletUtils";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'completed' | 'failed';
  description: string;
  reference?: string;
  recipient?: string;
  payment_method: string;
  created_at: string;
}

interface TransactionHistoryProps {
  limit?: number;
  showFilters?: boolean;
}

const TransactionHistory = ({ limit, showFilters = true }: TransactionHistoryProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  // Mock transaction data - this would come from your API
  const mockTransactions: Transaction[] = [
    {
      id: '1',
      amount: 250.00,
      currency: 'ZMW',
      direction: 'incoming',
      status: 'completed',
      description: 'Wallet funding via Mobile Money',
      payment_method: 'mobile_money',
      created_at: '2024-01-15T10:30:00Z'
    },
    {
      id: '2',
      amount: 50.00,
      currency: 'ZMW',
      direction: 'outgoing',
      status: 'completed',
      description: 'Virtual card funding - Shopping Card',
      payment_method: 'wallet',
      created_at: '2024-01-15T09:15:00Z'
    },
    {
      id: '3',
      amount: 100.00,
      currency: 'ZMW',
      direction: 'outgoing',
      status: 'pending',
      description: 'Transfer to John Doe',
      recipient: 'John Doe',
      payment_method: 'wallet',
      created_at: '2024-01-14T16:45:00Z'
    },
    {
      id: '4',
      amount: 25.00,
      currency: 'ZMW',
      direction: 'outgoing',
      status: 'failed',
      description: 'Online payment - Netflix',
      payment_method: 'virtual_card',
      created_at: '2024-01-14T14:20:00Z'
    }
  ];

  const filteredTransactions = mockTransactions
    .filter(transaction => {
      const matchesSearch = transaction.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           transaction.recipient?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || transaction.status === statusFilter;
      const matchesDirection = directionFilter === 'all' || transaction.direction === directionFilter;
      return matchesSearch && matchesStatus && matchesDirection;
    })
    .slice(0, limit);

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

  const getDirectionIcon = (direction: string) => {
    return direction === 'incoming' ? (
      <ArrowDownLeft className="h-4 w-4 text-green-600" />
    ) : (
      <ArrowUpRight className="h-4 w-4 text-red-600" />
    );
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case 'mobile_money':
        return 'Mobile Money';
      case 'bank_transfer':
        return 'Bank Transfer';
      case 'virtual_card':
        return 'Virtual Card';
      case 'wallet':
        return 'Wallet';
      default:
        return method;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center">
            <Receipt className="mr-2 h-5 w-5" />
            Transaction History
          </CardTitle>
          {showFilters && (
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Export
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="space-y-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={directionFilter} onValueChange={setDirectionFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="incoming">Incoming</SelectItem>
                  <SelectItem value="outgoing">Outgoing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {filteredTransactions.length === 0 ? (
            <div className="text-center py-8">
              <Receipt className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Transactions Found</h3>
              <p className="text-muted-foreground">
                {searchTerm || statusFilter !== 'all' || directionFilter !== 'all'
                  ? 'Try adjusting your filters to see more results.'
                  : 'Your transactions will appear here once you start using your wallet.'
                }
              </p>
            </div>
          ) : (
            filteredTransactions.map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    {getDirectionIcon(transaction.direction)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {transaction.description}
                    </p>
                    {transaction.recipient && (
                      <p className="text-sm text-muted-foreground">
                        To: {transaction.recipient}
                      </p>
                    )}
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(transaction.created_at), 'MMM dd, yyyy HH:mm')}
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        {getPaymentMethodLabel(transaction.payment_method)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <p className={cn(
                      "font-semibold",
                      transaction.direction === 'incoming' ? 'text-green-600' : 'text-red-600'
                    )}>
                      {transaction.direction === 'incoming' ? '+' : '-'}
                      {formatCurrency(transaction.amount)}
                    </p>
                    <Badge variant="secondary" className={getStatusColor(transaction.status)}>
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {limit && filteredTransactions.length >= limit && (
          <div className="text-center mt-6">
            <Button variant="outline">
              View All Transactions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TransactionHistory;
