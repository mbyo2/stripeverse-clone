import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const usePaymentPlans = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const plans = useQuery({
    queryKey: ['payment-plans', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_payment_plans')
        .select('*')
        .eq('merchant_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createPlan = useMutation({
    mutationFn: async (plan: { customer_email: string; customer_name?: string; description?: string; total_amount: number; installments_total: number; currency?: string; frequency?: string }) => {
      const { data, error } = await supabase
        .from('merchant_payment_plans')
        .insert({
          merchant_id: user!.id,
          ...plan,
          installment_amount: plan.total_amount / plan.installments_total,
          next_payment_date: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Payment plan created'); queryClient.invalidateQueries({ queryKey: ['payment-plans'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Record a collected installment: writes the payment row and advances the plan. */
  const recordInstallmentPayment = useMutation({
    mutationFn: async ({
      plan,
      payment_method,
      reference,
      notes,
    }: {
      plan: any;
      payment_method?: string;
      reference?: string;
      notes?: string;
    }) => {
      const nextNumber = (plan.installments_paid || 0) + 1;
      if (nextNumber > plan.installments_total) throw new Error('All installments already paid');

      const { error: payError } = await supabase
        .from('plan_installment_payments')
        .insert({
          plan_id: plan.id,
          installment_number: nextNumber,
          amount: Number(plan.installment_amount),
          currency: plan.currency || 'ZMW',
          payment_method: payment_method || 'manual',
          reference: reference || null,
          notes: notes || null,
          recorded_by: user!.id,
        });
      if (payError) throw payError;

      const done = nextNumber >= plan.installments_total;
      const nextDate = advanceDateByFrequency(plan.next_payment_date || new Date().toISOString(), plan.frequency || 'monthly');

      const { error: planError } = await supabase
        .from('merchant_payment_plans')
        .update({
          installments_paid: nextNumber,
          next_payment_date: done ? null : nextDate.toISOString(),
          status: done ? 'completed' : 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', plan.id);
      if (planError) throw planError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['plan-payments'] });
      toast.success('Installment recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Payment history across the merchant's plans. */
  const paymentHistory = useQuery({
    queryKey: ['plan-payments', user?.id],
    queryFn: async () => {
      const { data: planRows } = await supabase
        .from('merchant_payment_plans')
        .select('id')
        .eq('merchant_id', user!.id);
      const planIds = (planRows || []).map((p: any) => p.id);
      if (planIds.length === 0) return [];
      const { data, error } = await supabase
        .from('plan_installment_payments')
        .select('*, merchant_payment_plans!inner(customer_name, customer_email, description)')
        .in('plan_id', planIds)
        .order('paid_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return { plans, createPlan, recordInstallmentPayment, paymentHistory };
};

/** Advance a date by the plan frequency. Exported for the runner/page. */
export function advanceDateByFrequency(iso: string, frequency: string): Date {
  const date = new Date(iso);
  switch (frequency) {
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'biweekly': date.setDate(date.getDate() + 14); break;
    case 'quarterly': date.setMonth(date.getMonth() + 3); break;
    case 'yearly': date.setFullYear(date.getFullYear() + 1); break;
    case 'monthly':
    default: date.setMonth(date.getMonth() + 1);
  }
  return date;
}
