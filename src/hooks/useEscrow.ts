import { toUserFacingError } from "@/utils/userFacingError";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const randomIdempotencyKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const useEscrow = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['escrow'] });

  const escrows = useQuery({
    queryKey: ['escrow', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('escrow_transactions')
        .select('*')
        .or(`buyer_id.eq.${user!.id},seller_id.eq.${user!.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Create + fund: inserts the escrow row, then debits the buyer via
  // atomic-transfer (to_user_id=null → funds held by platform).
  const createEscrow = useMutation({
    mutationFn: async (escrow: {
      seller_id: string; amount: number; description?: string;
      release_conditions?: string; currency?: string;
    }) => {
      if (!user) throw new Error('Not signed in');
      const amount = Number(escrow.amount);
      if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');
      if (escrow.seller_id === user.id) throw new Error('Cannot create escrow with yourself');

      // 1. Insert escrow row (status='pending')
      const { data: row, error: insertErr } = await supabase
        .from('escrow_transactions')
        .insert({
          buyer_id: user.id,
          seller_id: escrow.seller_id,
          amount,
          currency: escrow.currency || 'ZMW',
          description: escrow.description,
          release_conditions: escrow.release_conditions,
          status: 'pending',
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // 2. Debit buyer — funds move to platform hold via atomic-transfer
      const { data: transferData, error: transferErr } = await supabase.functions.invoke(
        'atomic-transfer',
        {
          body: {
            from_user_id: user.id,
            to_user_id: null,
            amount,
            currency: escrow.currency || 'ZMW',
            reference_type: 'escrow_hold',
            reference_id: row.id,
            idempotency_key: `escrow-hold-${row.id}`,
            description: `Escrow hold: ${escrow.description || row.id}`,
          },
        }
      );
      if (transferErr || transferData?.error) {
        // Roll back the escrow row — buyer was not debited
        await supabase.from('escrow_transactions').delete().eq('id', row.id);
        throw new Error(transferErr
          ? await resolveEdgeFunctionError(transferErr, 'Failed to fund escrow')
          : transferData.error);
      }

      // 3. Mark as funded with the hold transaction reference
      const { error: updateErr } = await supabase
        .from('escrow_transactions')
        .update({
          status: 'funded',
          funded_at: new Date().toISOString(),
          hold_transaction_id: transferData.transaction_id,
        })
        .eq('id', row.id);
      if (updateErr) throw updateErr;

      return row;
    },
    onSuccess: () => {
      toast.success('Escrow created and funded');
      invalidate();
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  // Release: buyer confirms → seller is credited via escrow-settle
  const releaseEscrow = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('escrow-settle', {
        body: { escrow_id: id, action: 'release' },
      });
      if (error) throw new Error(await resolveEdgeFunctionError(error, 'Release failed'));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Funds released to seller');
      invalidate();
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  // Cancel/refund: buyer cancels → buyer is refunded via escrow-settle
  const cancelEscrow = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('escrow-settle', {
        body: { escrow_id: id, action: 'refund' },
      });
      if (error) throw new Error(await resolveEdgeFunctionError(error, 'Refund failed'));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Escrow cancelled — funds refunded');
      invalidate();
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  // Dispute: either party flags for review (funds stay held)
  const disputeEscrow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('escrow_transactions')
        .update({ status: 'disputed', disputed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Escrow marked as disputed — funds remain held');
      invalidate();
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  return { escrows, createEscrow, releaseEscrow, cancelEscrow, disputeEscrow };
};
