import { toUserFacingError } from "@/utils/userFacingError";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { normalizeZambianPhone } from '@/utils/phoneNumber';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useBulkPayments = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['bulk-payments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_payments')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useBulkPaymentItems = (bulkPaymentId?: string) => {
  return useQuery({
    queryKey: ['bulk-payment-items', bulkPaymentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_payment_items')
        .select('*')
        .eq('bulk_payment_id', bulkPaymentId!)
        .order('created_at');
      if (error) throw error;
      return data;
    },
    enabled: !!bulkPaymentId,
  });
};

export const useCreateBulkPayment = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      name: string; currency?: string;
      items: Array<{
        recipient_name: string; recipient_account?: string;
        recipient_bank?: string; recipient_phone?: string;
        recipient_email?: string; amount: number;
        payment_method?: string;
      }>;
    }) => {
      const totalAmount = params.items.reduce((s, i) => s + i.amount, 0);
      const { data: batch, error: batchErr } = await supabase.from('bulk_payments').insert({
        user_id: user!.id, name: params.name,
        currency: params.currency || 'ZMW',
        total_amount: totalAmount, total_items: params.items.length,
        status: 'draft',
      }).select().single();
      if (batchErr) throw batchErr;

      const items = params.items.map(item => ({
        bulk_payment_id: batch.id, ...item,
        currency: params.currency || 'ZMW',
        payment_method: item.payment_method || 'bank_transfer',
      }));
      const { error: itemsErr } = await supabase.from('bulk_payment_items').insert(items);
      if (itemsErr) throw itemsErr;
      return batch;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bulk-payments'] }); toast.success('Bulk payment created'); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

export const useProcessBulkPayment = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bulkPaymentId: string) => {
      if (!user) throw new Error('Not signed in');

      // 1. Load batch + items
      const { data: batch, error: batchErr } = await supabase
        .from('bulk_payments')
        .select('*')
        .eq('id', bulkPaymentId)
        .single();
      if (batchErr || !batch) throw new Error('Batch not found');
      if (batch.status !== 'draft') throw new Error(`Batch is ${batch.status}, only drafts can be processed`);
      if (batch.user_id !== user.id) throw new Error('Not your batch');

      const { data: items, error: itemsErr } = await supabase
        .from('bulk_payment_items')
        .select('*')
        .eq('bulk_payment_id', bulkPaymentId)
        .eq('status', 'pending');
      if (itemsErr) throw itemsErr;
      if (!items?.length) throw new Error('No pending items to process');

      // 2. Verify sufficient balance for the total upfront
      const total = items.reduce((s, i) => s + Number(i.amount), 0);
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .eq('currency', batch.currency || 'ZMW')
        .single();
      if (!wallet || Number(wallet.balance) < total) {
        throw new Error(
          `Insufficient balance: need K${total.toLocaleString()}, have K${Number(wallet?.balance || 0).toLocaleString()}`
        );
      }

      // 3. Mark batch as processing
      await supabase.from('bulk_payments').update({ status: 'processing' }).eq('id', bulkPaymentId);

      // 4. Process each item via atomic-transfer
      let completed = 0;
      let failed = 0;
      for (const item of items) {
        const amount = Number(item.amount);
        try {
          // Resolve recipient to a platform user by phone or email when possible.
          // External recipients (bank accounts) settle as to_user_id=null —
          // funds leave the sender's wallet and the disbursement is recorded.
          let toUserId: string | null = null;
          if (item.recipient_phone || item.recipient_email) {
            // Match the phone in the form it was entered AND in its
            // canonical +260… form (shared rule, utils/phoneNumber) —
            // profiles.phone is free text, so either form may be the
            // stored one. Strictly additive vs the previous raw-only
            // comparison. NOTE: this select is still limited by
            // profiles RLS (a sender can only ever see their own
            // profile), unlike /transfer and /send-money, which resolve
            // recipients through the find_transfer_recipient RPC.
            const phoneForms = Array.from(
              new Set(
                [item.recipient_phone, normalizeZambianPhone(item.recipient_phone ?? "")].filter(
                  (p): p is string => !!p,
                ),
              ),
            );
            const orFilter = [
              ...phoneForms.map((p) => `phone.eq.${p}`),
              `email.eq.${item.recipient_email || ''}`,
            ].join(',');
            const { data: profile } = await supabase
              .from('profiles')
              .select('id')
              .or(orFilter)
              .limit(1)
              .maybeSingle();
            if (profile) toUserId = profile.id;
          }

          const { data, error } = await supabase.functions.invoke('atomic-transfer', {
            body: {
              from_user_id: user.id,
              to_user_id: toUserId,
              amount,
              currency: item.currency || batch.currency || 'ZMW',
              reference_type: 'bulk_payment',
              reference_id: item.id,
              idempotency_key: `bulk-${bulkPaymentId}-${item.id}`,
              description: `Bulk payment: ${batch.name} → ${item.recipient_name}`,
              recipient_name: item.recipient_name,
              payment_method: item.payment_method || 'bank_transfer',
            },
          });
          if (error) throw new Error(await resolveEdgeFunctionError(error, 'Transfer failed'));
          if (data?.error) throw new Error(data.error);

          await supabase.from('bulk_payment_items').update({
            status: 'completed',
            transaction_id: data.transaction_id,
            processed_at: new Date().toISOString(),
          }).eq('id', item.id);
          completed++;
        } catch (e) {
          const message = toUserFacingError(e, 'Processing failed');
          await supabase.from('bulk_payment_items').update({
            status: 'failed',
            error_message: message,
            processed_at: new Date().toISOString(),
          }).eq('id', item.id);
          failed++;
        }
      }

      // 5. Finalize batch
      const finalStatus = failed === 0 ? 'completed' : completed === 0 ? 'failed' : 'partial';
      await supabase.from('bulk_payments').update({
        status: finalStatus,
        completed_items: completed,
        failed_items: failed,
        processed_at: new Date().toISOString(),
      }).eq('id', bulkPaymentId);

      return { completed, failed, total: items.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['bulk-payments'] });
      if (r.failed === 0) toast.success(`Bulk payment complete: ${r.completed} recipients paid`);
      else toast.warning(`Processed ${r.completed}/${r.total} — ${r.failed} failed`);
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};
