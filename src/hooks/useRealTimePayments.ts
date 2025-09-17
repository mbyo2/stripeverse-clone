import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface PaymentUpdate {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  payment_method: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export const useRealTimePayments = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [recentPayments, setRecentPayments] = useState<PaymentUpdate[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    // Subscribe to real-time payment updates
    const channel = supabase
      .channel('payment-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payment_processing',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Payment update received:', payload);
          
          const paymentData = payload.new as PaymentUpdate;
          
          // Update local state
          setRecentPayments(prev => {
            const existing = prev.find(p => p.id === paymentData.id);
            if (existing) {
              return prev.map(p => p.id === paymentData.id ? paymentData : p);
            }
            return [paymentData, ...prev.slice(0, 9)]; // Keep last 10
          });

          // Show toast for status changes
          if (payload.eventType === 'UPDATE' && payload.old) {
            const oldStatus = (payload.old as PaymentUpdate).status;
            const newStatus = paymentData.status;
            
            if (oldStatus !== newStatus) {
              let toastConfig: {
                title: string;
                description: string;
                variant?: 'default' | 'destructive';
              } = {
                title: '',
                description: '',
                variant: 'default'
              };

              switch (newStatus) {
                case 'completed':
                  toastConfig = {
                    title: 'Payment Successful',
                    description: `Your payment of ${paymentData.amount} ${paymentData.currency} has been completed.`,
                    variant: 'default'
                  };
                  break;
                case 'failed':
                  toastConfig = {
                    title: 'Payment Failed',
                    description: `Your payment of ${paymentData.amount} ${paymentData.currency} could not be processed.`,
                    variant: 'destructive'
                  };
                  break;
                case 'processing':
                  toastConfig = {
                    title: 'Payment Processing',
                    description: `Your payment of ${paymentData.amount} ${paymentData.currency} is being processed.`,
                    variant: 'default'
                  };
                  break;
              }

              if (toastConfig.title) {
                toast(toastConfig);
              }
            }
          }
        }
      )
      .subscribe();

    // Fetch initial payment data
    const fetchInitialPayments = async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching payments:', error);
        return;
      }

      const mappedData = (data || []).map(tx => ({
        id: tx.uuid_id || tx.id.toString(),
        status: tx.status as PaymentUpdate['status'],
        amount: tx.amount,
        currency: tx.currency,
        payment_method: tx.payment_method,
        provider: tx.provider || 'unknown',
        created_at: tx.created_at,
        updated_at: tx.updated_at
      }));

      setRecentPayments(mappedData);
    };

    fetchInitialPayments();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, toast]);

  return {
    recentPayments,
    setRecentPayments
  };
};