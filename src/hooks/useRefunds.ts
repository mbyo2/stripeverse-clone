import { toUserFacingError } from "@/utils/userFacingError";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useRefunds = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['refunds', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refunds')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateRefund = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      transaction_id: string; amount: number; currency?: string;
      reason: string; refund_type?: string; notes?: string;
    }) => {
      if (!user) throw new Error('Not signed in');
      const amount = Number(params.amount);
      if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');

      // Validate the referenced transaction exists (match by uuid_id string)
      const { data: originalTx, error: txErr } = await supabase
        .from('transactions')
        .select('id, uuid_id, user_id, amount, currency, direction')
        .eq('uuid_id', params.transaction_id)
        .maybeSingle();
      if (txErr || !originalTx) throw new Error('Original transaction not found — check the transaction ID');

      const { data, error } = await supabase.from('refunds').insert({
        user_id: user.id,
        transaction_id: params.transaction_id,
        amount,
        currency: params.currency || originalTx.currency || 'ZMW',
        reason: params.reason,
        refund_type: params.refund_type || 'full',
        notes: params.notes,
        status: 'pending',
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refunds'] }); toast.success('Refund request submitted'); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

// Approve: the approver (original payment recipient) sends funds back to the
// requester via atomic-transfer, then the refund is marked completed.
export const useApproveRefund = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refundId: string) => {
      if (!user) throw new Error('Not signed in');

      const { data: refund, error: refundErr } = await supabase
        .from('refunds')
        .select('*')
        .eq('id', refundId)
        .single();
      if (refundErr || !refund) throw new Error('Refund not found');
      if (refund.status !== 'pending') throw new Error(`Refund is already ${refund.status}`);

      const amount = Number(refund.amount);

      // The approver sends the refund from their own wallet to the requester.
      // (atomic-transfer enforces from_user_id === authenticated user.)
      const { data, error } = await supabase.functions.invoke('atomic-transfer', {
        body: {
          from_user_id: user.id,
          to_user_id: refund.user_id,
          amount,
          currency: refund.currency || 'ZMW',
          reference_type: 'refund',
          reference_id: refund.id,
          idempotency_key: `refund-${refund.id}`,
          description: `Refund: ${refund.reason} (tx ${refund.transaction_id})`,
        },
      });
      if (error) throw new Error(await resolveEdgeFunctionError(error, 'Refund transfer failed'));
      if (data?.error) throw new Error(data.error);

      const { error: updateErr } = await supabase
        .from('refunds')
        .update({
          status: 'completed',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          settlement_transaction_id: data.transaction_id,
        })
        .eq('id', refundId);
      if (updateErr) throw updateErr;

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refunds'] });
      toast.success('Refund approved — funds sent');
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

export const useRejectRefund = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refundId: string) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('refunds')
        .update({ status: 'rejected', rejected_at: new Date().toISOString(), approved_by: user.id })
        .eq('id', refundId)
        .eq('status', 'pending');
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refunds'] });
      toast.success('Refund rejected');
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};
