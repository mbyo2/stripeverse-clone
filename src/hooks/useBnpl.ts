import { toUserFacingError } from "@/utils/userFacingError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface BnplPlan {
  id: string;
  user_id: string;
  total_amount: number;
  installment_amount: number;
  installments_total: number;
  installments_paid: number;
  currency: string;
  next_payment_date: string | null;
  status: string;
  merchant_name: string | null;
  description: string | null;
  created_at: string;
}

export interface BnplAutoDebit {
  id: string;
  status: string;
  next_run_at: string;
}

export const useBnpl = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['bnpl-plans', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bnpl_plans')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as BnplPlan[];
    },
    enabled: !!user?.id,
  });

  // Auto-debit schedules linked to BNPL plans (via metadata.bnpl_plan_id)
  const { data: autoDebits = [] } = useQuery({
    queryKey: ['bnpl-autodebits', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_payments')
        .select('id, status, next_run_at, metadata')
        .eq('user_id', user!.id)
        .neq('status', 'deleted');
      if (error) throw error;
      return (data || []) as Array<BnplAutoDebit & { metadata: { bnpl_plan_id?: string } }>;
    },
    enabled: !!user?.id,
  });

  const autoDebitByPlan: Record<string, BnplAutoDebit> = {};
  for (const s of autoDebits) {
    const planId = s.metadata?.bnpl_plan_id;
    if (planId && (s.status === 'active' || s.status === 'paused')) {
      autoDebitByPlan[planId] = { id: s.id, status: s.status, next_run_at: s.next_run_at };
    }
  }

  const activePlans = plans.filter((p) => p.status === 'active');
  const totalOwed = activePlans.reduce(
    (sum, p) => sum + (p.installments_total - p.installments_paid) * p.installment_amount,
    0
  );

  /** Pay the next installment now via the atomic money-movement function. */
  const payInstallment = useMutation({
    mutationFn: async (plan: BnplPlan) => {
      const nextNumber = plan.installments_paid + 1;
      const idempotencyKey = `bnpl:${plan.id}:${nextNumber}`;

      const { data, error } = await supabase.functions.invoke('atomic-transfer', {
        body: {
          from_user_id: user!.id,
          to_user_id: null, // BNPL merchants are external
          amount: Number(plan.installment_amount),
          currency: plan.currency || 'ZMW',
          reference_type: 'bnpl_installment',
          reference_id: plan.id,
          idempotency_key: idempotencyKey,
          description: `BNPL installment ${nextNumber} of ${plan.installments_total} — ${plan.merchant_name || 'Purchase'}`,
          recipient_name: plan.merchant_name || 'Merchant',
          payment_method: 'wallet',
        },
      });
      if (error) throw new Error(error.message || 'Payment failed');
      if (data?.error) throw new Error(data.error);

      // Advance the plan
      const done = nextNumber >= plan.installments_total;
      const nextDate = new Date(plan.next_payment_date || new Date());
      nextDate.setDate(nextDate.getDate() + 14); // Pay-in-4 cadence: every 2 weeks
      const { error: planError } = await supabase
        .from('bnpl_plans')
        .update({
          installments_paid: nextNumber,
          next_payment_date: done ? null : nextDate.toISOString(),
          status: done ? 'completed' : 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', plan.id);
      if (planError) throw planError;

      // If auto-debit is on, push its next run forward so it doesn't
      // double-pay the installment we just paid manually.
      const schedule = autoDebitByPlan[plan.id];
      if (schedule) {
        const skipDate = new Date();
        skipDate.setDate(skipDate.getDate() + 14);
        await supabase
          .from('scheduled_payments')
          .update({
            next_run_at: skipDate.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bnpl-plans'] });
      queryClient.invalidateQueries({ queryKey: ['bnpl-autodebits'] });
      toast.success('Installment paid');
    },
    onError: (err: Error) => toast.error(toUserFacingError(err)),
  });

  /** Enable auto-debit: creates a scheduled payment the runner collects. */
  const enableAutoDebit = useMutation({
    mutationFn: async (plan: BnplPlan) => {
      const remaining = plan.installments_total - plan.installments_paid;
      if (remaining <= 0) throw new Error('Plan is already fully paid');
      const { data, error } = await supabase
        .from('scheduled_payments')
        .insert({
          user_id: user!.id,
          recipient_name: plan.merchant_name || 'BNPL Merchant',
          amount: Number(plan.installment_amount),
          currency: plan.currency || 'ZMW',
          payment_method: 'wallet',
          frequency: 'biweekly',
          description: `Auto-debit: BNPL installment — ${plan.merchant_name || 'Purchase'}`,
          next_run_at: plan.next_payment_date || new Date().toISOString(),
          max_runs: remaining,
          status: 'active',
          metadata: { bnpl_plan_id: plan.id },
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bnpl-autodebits'] });
      toast.success('Auto-debit enabled — installments will be collected automatically');
    },
    onError: (err: Error) => toast.error(toUserFacingError(err)),
  });

  /** Disable auto-debit: pauses the linked scheduled payment. */
  const disableAutoDebit = useMutation({
    mutationFn: async (planId: string) => {
      const schedule = autoDebitByPlan[planId];
      if (!schedule) throw new Error('No auto-debit schedule found');
      const { error } = await supabase
        .from('scheduled_payments')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', schedule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bnpl-autodebits'] });
      toast.success('Auto-debit disabled');
    },
    onError: (err: Error) => toast.error(toUserFacingError(err)),
  });

  return {
    plans,
    activePlans,
    totalOwed,
    isLoading,
    autoDebitByPlan,
    payInstallment,
    enableAutoDebit,
    disableAutoDebit,
  };
};
