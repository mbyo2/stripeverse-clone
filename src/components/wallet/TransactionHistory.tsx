import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

// Interface for transaction data
interface Transaction {
  id: number;
  type: 'outgoing' | 'incoming';
  recipient: string;
  date: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed';
  created_at?: string;
}

const TransactionHistory = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        
        // First try to get real transactions from the database
        const { data: dbTransactions, error } = await supabase
          .from('transactions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (error) throw error;
        
        if (dbTransactions && dbTransactions.length > 0) {
          // Map the database transactions to our interface
          const formattedTransactions = dbTransactions.map(tx => ({
            id: tx.id,
            type: tx.direction as 'outgoing' | 'incoming',
            recipient: tx.recipient_name || tx.recipient_account || 'Unknown',
            date: tx.created_at ? formatDistanceToNow(new Date(tx.created_at), { addSuffix: true }) : 'Unknown date',
            amount: tx.amount,
            status: tx.status as 'completed' | 'pending' | 'failed',
            created_at: tx.created_at
          }));
          
          setTransactions(formattedTransactions);
        } else {
          // Fallback to mock data if no real transactions exist
          setTransactions(mockTransactions);
        }
      } catch (err) {
        console.error("Error fetching transactions:", err);
        setError("Failed to load transactions");
        // Fallback to mock data on error
        setTransactions(mockTransactions);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
    
    // Set up real-time subscription for new transactions
    const channel = supabase
      .channel('public:transactions')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'transactions' 
      }, (payload) => {
        console.log('Transaction change received:', payload);
        // Refresh transactions when new ones come in
        fetchTransactions();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Mock transactions for fallback when API fails or no data exists
  const mockTransactions = [
    { id: 1, type: 'outgoing', recipient: 'John Banda', date: 'Oct 15, 2023', amount: 250.75, status: 'completed' },
    { id: 2, type: 'incoming', recipient: 'Mary Phiri', date: 'Oct 14, 2023', amount: 320.50, status: 'completed' },
    { id: 3, type: 'outgoing', recipient: 'Zamtel', date: 'Oct 13, 2023', amount: 100.00, status: 'completed' },
    { id: 4, type: 'incoming', recipient: 'MTN Mobile', date: 'Oct 12, 2023', amount: 500.25, status: 'completed' },
    { id: 5, type: 'outgoing', recipient: 'Airtel Money', date: 'Oct 11, 2023', amount: 150.00, status: 'pending' },
  ];

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="ml-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24 mt-2" />
                  </div>
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-destructive">
          <p>{error}</p>
          <p className="text-sm text-muted-foreground mt-2">Using fallback transaction data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-lg">Recent Transactions</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-4">
          {transactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">No transactions yet</p>
          ) : (
            transactions.map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    transaction.type === 'outgoing' ? "bg-red-100" : "bg-green-100"
                  }`}>
                    {transaction.status === 'pending' ? (
                      <Clock className="h-5 w-5 text-amber-600" />
                    ) : transaction.type === 'outgoing' ? (
                      <ArrowUpRight className="h-5 w-5 text-red-600" />
                    ) : (
                      <ArrowDownLeft className="h-5 w-5 text-green-600" />
                    )}
                  </div>
                  <div className="ml-4">
                    <div className="font-medium">
                      {transaction.type === 'outgoing' ? "Sent to" : "Received from"} {" "}
                      {transaction.recipient}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center">
                      {transaction.date}
                      {transaction.status === 'pending' && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
                          Pending
                        </span>
                      )}
                      {transaction.status === 'failed' && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded-full">
                          Failed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`font-medium ${
                  transaction.status === 'pending' 
                    ? "text-amber-600" 
                    : transaction.type === 'outgoing' 
                      ? "text-red-600" 
                      : "text-green-600"
                }`}>
                  {transaction.type === 'outgoing' ? "-" : "+"}K {transaction.amount.toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TransactionHistory;
