import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { AccountRow } from '@/utils/accountGrouping';

export type SubAccountKind = 'business' | 'savings' | 'trading' | 'personal' | 'custom';
export type SubAccountStatus = 'active' | 'frozen' | 'closed';

export const SUB_ACCOUNT_KINDS: { value: SubAccountKind; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'savings', label: 'Savings' },
  { value: 'trading', label: 'Trading' },
  { value: 'personal', label: 'Personal' },
  { value: 'custom', label: 'Custom' },
];

export const subAccountKindLabel = (kind: string): string =>
  SUB_ACCOUNT_KINDS.find((k) => k.value === kind)?.label ?? 'Custom';

/** All of the signed-in user's sub-accounts (any status), oldest first. */
export const useAccounts = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['accounts', user?.id],
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

/** Money lives on wallets, so account changes invalidate the wallet queries too. */
const invalidateAccountMoney = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['accounts'] });
  qc.invalidateQueries({ queryKey: ['multi-wallets'] });
  qc.invalidateQueries({ queryKey: ['wallet'] });
};

export const useCreateSubAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, kind }: { name: string; kind: SubAccountKind }) => {
      const { data, error } = await supabase.rpc('create_sub_account', {
        p_name: name,
        p_kind: kind,
      });
      if (error) throw error;
      // The RPC returns the accounts row; PostgREST may hand it back as a
      // single object or a one-element array depending on its shape.
      const row = (Array.isArray(data) ? data[0] : data) as AccountRow | undefined;
      if (!row) throw new Error('Sub-account was not created');
      return row;
    },
    onSuccess: () => { invalidateAccountMoney(qc); toast.success('Sub-account created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useRenameSubAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, name }: { accountId: string; name: string }) => {
      const { error } = await supabase.rpc('rename_sub_account', {
        p_account_id: accountId,
        p_name: name,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); toast.success('Account renamed'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useSetSubAccountStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, status }: { accountId: string; status: 'active' | 'frozen' }) => {
      const { error } = await supabase.rpc('set_sub_account_status', {
        p_account_id: accountId,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { status }) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success(status === 'frozen' ? 'Account frozen' : 'Account unfrozen');
    },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useCloseSubAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase.rpc('close_sub_account', {
        p_account_id: accountId,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidateAccountMoney(qc); toast.success('Account closed'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useInternalTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      fromWalletId: string;
      toWalletId: string;
      amount: number;
      description?: string;
    }) => {
      const { data, error } = await supabase.rpc('execute_internal_transfer', {
        p_from_wallet_id: params.fromWalletId,
        p_to_wallet_id: params.toWalletId,
        p_amount: params.amount,
        // Fresh key per attempt: a manual retry is a new transfer, while a
        // network-level retry of this same call reuses the key server-side
        // handling in the function.
        p_idempotency_key: crypto.randomUUID(),
        p_description: params.description,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateAccountMoney(qc);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Transfer complete');
    },
    onError: (e: Error) => toast.error(e.message),
  });
};
