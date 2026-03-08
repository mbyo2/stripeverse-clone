import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const billers = [
  { name: 'ZESCO', code: 'ZESCO', category: 'electricity', icon: '⚡' },
  { name: 'Lusaka Water', code: 'LWSC', category: 'water', icon: '💧' },
  { name: 'MTN Airtime', code: 'MTN_AIR', category: 'airtime', icon: '📱' },
  { name: 'Airtel Airtime', code: 'AIRTEL_AIR', category: 'airtime', icon: '📱' },
  { name: 'Zamtel Airtime', code: 'ZAMTEL_AIR', category: 'airtime', icon: '📱' },
  { name: 'DStv', code: 'DSTV', category: 'tv', icon: '📺' },
  { name: 'GOtv', code: 'GOTV', category: 'tv', icon: '📺' },
  { name: 'TopStar', code: 'TOPSTAR', category: 'tv', icon: '📺' },
  { name: 'Zamtel Internet', code: 'ZAMTEL_NET', category: 'internet', icon: '🌐' },
  { name: 'MTN Data', code: 'MTN_DATA', category: 'internet', icon: '🌐' },
];

export const useBillPayments = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const payments = useQuery({
    queryKey: ['bill-payments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bill_payments')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const payBill = useMutation({
    mutationFn: async (bill: { biller_name: string; biller_code: string; category: string; account_number: string; amount: number }) => {
      const ref = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const { data, error } = await supabase
        .from('bill_payments')
        .insert({ user_id: user!.id, ...bill, reference: ref, status: 'completed', paid_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Bill paid successfully'); queryClient.invalidateQueries({ queryKey: ['bill-payments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { payments, payBill, billers };
};
