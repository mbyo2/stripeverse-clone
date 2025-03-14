
import React, { useMemo, useState, useCallback } from "react";
import { useVirtualization, processInChunks } from "@/lib/virtualization";
import { Transaction } from "@/types/transaction";
import { ArrowDownLeft, ArrowUpRight, Clock, XIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { trackRender } from "@/lib/performance";
import { formatCurrency } from "@/lib/utils";

interface TransactionItemProps {
  transaction: Transaction;
  style?: React.CSSProperties;
}

// Memoized transaction item to prevent unnecessary re-renders
const TransactionItem = React.memo(({ transaction, style }: TransactionItemProps) => {
  return (
    <div 
      className="flex items-center justify-between py-4 border-b last:border-0" 
      style={style}
    >
      <div className="flex items-center">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
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
        <div className="ml-4">
          <div className="font-medium">
            {transaction.direction === 'outgoing' ? "Sent to" : "Received from"} {" "}
            {transaction.recipient_name || "Unknown"}
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            {transaction.created_at ? formatDistanceToNow(new Date(transaction.created_at), { addSuffix: true }) : 'Unknown date'}
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
      <div className={`font-medium ${
        transaction.status === 'failed' ? "text-destructive" :
        transaction.status === 'pending' ? "text-amber-600" :
        transaction.direction === 'outgoing' ? "text-blue-600" : "text-green-600"
      }`}>
        {transaction.direction === 'outgoing' ? "-" : "+"}
        {transaction.currency} {transaction.amount.toFixed(2)}
      </div>
    </div>
  );
});
TransactionItem.displayName = "TransactionItem";

interface OptimizedTransactionListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  className?: string;
}

const OptimizedTransactionList: React.FC<OptimizedTransactionListProps> = ({ 
  transactions, 
  isLoading = false,
  className = ""
}) => {
  const [processedTransactions, setProcessedTransactions] = useState<Transaction[]>([]);
  const [processingProgress, setProcessingProgress] = useState(0);
  
  // Track component render performance
  const endRenderTracking = trackRender("OptimizedTransactionList");
  
  // Process transactions in chunks to avoid UI blocking
  React.useEffect(() => {
    if (transactions.length > 0) {
      processInChunks(
        transactions,
        (chunk) => chunk, // Just return the chunk as is for now, could add transformations
        500,
        (processed, total) => {
          setProcessingProgress(Math.round((processed / total) * 100));
        }
      ).then(result => {
        setProcessedTransactions(result);
      });
    } else {
      setProcessedTransactions([]);
    }
  }, [transactions]);
  
  // Setup virtualization for efficient rendering
  const { 
    containerRef, 
    visibleItems, 
    totalHeight, 
    virtualProps, 
    itemProps 
  } = useVirtualization(processedTransactions, { 
    itemHeight: 80, // Approximate height of each transaction item
    overscan: 5     // Number of items to render outside of the viewport
  });
  
  // Track when the component finishes rendering
  React.useEffect(() => {
    return endRenderTracking;
  }, [endRenderTracking]);
  
  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {Array(5).fill(0).map((_, i) => (
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
    );
  }
  
  if (transactions.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>No transactions available</p>
      </div>
    );
  }
  
  if (processedTransactions.length === 0 && transactions.length > 0) {
    return (
      <div className="text-center py-8">
        <p>Processing {transactions.length} transactions...</p>
        <div className="w-full bg-secondary h-2 mt-2 rounded-full overflow-hidden">
          <div 
            className="bg-primary h-full transition-all duration-300 ease-in-out"
            style={{ width: `${processingProgress}%` }}
          ></div>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef} 
      className={`h-[400px] overflow-auto ${className}`}
    >
      <div {...virtualProps}>
        {visibleItems.map((transaction, index) => (
          <TransactionItem 
            key={transaction.id}
            transaction={transaction} 
            {...itemProps(index)}
          />
        ))}
      </div>
    </div>
  );
};

export default OptimizedTransactionList;
