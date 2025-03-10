
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Transaction } from "@/types/transaction";

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
          // Map the database transactions to our Transaction interface
          const formattedTransactions = dbTransactions.map(tx => ({
            id: tx.id.toString(),
            user_id: tx.user_id || '',
            amount: tx.amount,
            currency: tx.currency,
            payment_method: tx.payment_method,
            direction: tx.direction as 'incoming' | 'outgoing',
            recipient_name: tx.recipient_name || 'Unknown',
            recipient_account: tx.recipient_account || '',
            recipient_bank: tx.recipient_bank || '',
            status: tx.status as 'completed' | 'pending' | 'failed',
            reference: tx.reference || '',
            provider: tx.provider || '',
            metadata: tx.metadata,
            created_at: tx.created_at || new Date().toISOString(),
            updated_at: tx.updated_at || new Date().toISOString()
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
  const mockTransactions: Transaction[] = [
    { 
      id: '1', 
      user_id: '',
      amount: 250.75, 
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'outgoing', 
      recipient_name: 'John Banda', 
      status: 'completed',
      created_at: new Date('2023-10-15').toISOString(),
      updated_at: new Date('2023-10-15').toISOString()
    },
    { 
      id: '2', 
      user_id: '',
      amount: 320.50, 
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'incoming', 
      recipient_name: 'Mary Phiri', 
      status: 'completed',
      created_at: new Date('2023-10-14').toISOString(),
      updated_at: new Date('2023-10-14').toISOString()
    },
    { 
      id: '3', 
      user_id: '',
      amount: 100.00, 
      currency: 'ZMW',
      payment_method: 'ussd',
      direction: 'outgoing', 
      recipient_name: 'Zamtel', 
      status: 'completed',
      created_at: new Date('2023-10-13').toISOString(),
      updated_at: new Date('2023-10-13').toISOString()
    },
    { 
      id: '4', 
      user_id: '',
      amount: 500.25, 
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'incoming', 
      recipient_name: 'MTN Mobile', 
      status: 'completed',
      created_at: new Date('2023-10-12').toISOString(),
      updated_at: new Date('2023-10-12').toISOString()
    },
    { 
      id: '5', 
      user_id: '',
      amount: 150.00, 
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'outgoing', 
      recipient_name: 'Airtel Money', 
      status: 'pending',
      created_at: new Date('2023-10-11').toISOString(),
      updated_at: new Date('2023-10-11').toISOString()
    },
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
                    transaction.direction === 'outgoing' ? "bg-red-100" : "bg-green-100"
                  }`}>
                    {transaction.status === 'pending' ? (
                      <Clock className="h-5 w-5 text-amber-600" />
                    ) : transaction.direction === 'outgoing' ? (
                      <ArrowUpRight className="h-5 w-5 text-red-600" />
                    ) : (
                      <ArrowDownLeft className="h-5 w-5 text-green-600" />
                    )}
                  </div>
                  <div className="ml-4">
                    <div className="font-medium">
                      {transaction.direction === 'outgoing' ? "Sent to" : "Received from"} {" "}
                      {transaction.recipient_name}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center">
                      {transaction.created_at ? formatDistanceToNow(new Date(transaction.created_at), { addSuffix: true }) : 'Unknown date'}
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
                    : transaction.direction === 'outgoing' 
                      ? "text-red-600" 
                      : "text-green-600"
                }`}>
                  {transaction.direction === 'outgoing' ? "-" : "+"}K {transaction.amount.toFixed(2)}
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
