import { toUserFacingError } from "@/utils/userFacingError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/**
 * Savings goals are funded from — and paid back to — the user's real
 * wallet. Every movement goes through the `savings-transfer` edge
 * function (execute_savings_transfer RPC), which debits/credits the
 * wallet and the goal atomically with a paired ledger entry. The
 * browser never writes a savings or wallet balance directly: the old
 * client-side `balance + amount` write created money from nothing.
 */
export const useSavings = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const accounts = useQuery({
    queryKey: ['savings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_accounts')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createAccount = useMutation({
    mutationFn: async (account: { name: string; target_amount?: number; target_date?: string; auto_save_amount?: number; auto_save_frequency?: string }) => {
      const { data, error } = await supabase
        .from('savings_accounts')
        .insert({ user_id: user!.id, ...account })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Savings account created');
      queryClient.invalidateQueries({ queryKey: ['savings'] });
      // Force the visible list to refetch NOW (not just be marked
      // stale): with the app's 5-minute staleTime, QA saw the page
      // keep pre-action values until a manual reload after creates,
      // deposits and withdrawals.
      queryClient.refetchQueries({ queryKey: ['savings'], type: 'active' });
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  // The wallet that funds / receives for a goal: the user's Main
  // wallet (account_id null) in the goal's currency, else any active
  // wallet in that currency. The RPC re-validates ownership.
  const resolveWalletId = async (currency: string): Promise<string> => {
    const { data, error } = await supabase
      .from('wallets')
      .select('id, account_id')
      .eq('user_id', user!.id)
      .eq('currency', currency)
      .eq('status', 'active');
    if (error) throw error;
    const wallet = data?.find(w => w.account_id === null) ?? data?.[0];
    if (!wallet) {
      throw new Error(`You have no active ${currency} wallet to move savings money with. Create one first.`);
    }
    return wallet.id;
  };

  const moveMoney = async ({ id, amount, direction }: { id: string; amount: number; direction: 'deposit' | 'withdraw' }) => {
    if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');
    const { data: account, error: accountError } = await supabase
      .from('savings_accounts')
      .select('id, currency')
      .eq('id', id)
      .eq('user_id', user!.id)
      .single();
    if (accountError) throw accountError;

    const walletId = await resolveWalletId(account.currency || 'ZMW');

    const { data, error } = await supabase.functions.invoke('savings-transfer', {
      body: {
        savings_account_id: id,
        wallet_id: walletId,
        amount,
        direction,
        idempotency_key: `savings-${direction}-${user!.id}-${crypto.randomUUID()}`,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const invalidateMoney = () => {
    queryClient.invalidateQueries({ queryKey: ['savings'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['multi-wallets'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    // Same stale-render fix as createAccount: refetch the visible
    // lists immediately rather than leaving them to staleTime.
    queryClient.refetchQueries({ queryKey: ['savings'], type: 'active' });
    queryClient.refetchQueries({ queryKey: ['wallet'], type: 'active' });
  };

  const deposit = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => moveMoney({ id, amount, direction: 'deposit' }),
    onSuccess: () => { toast.success('Deposit successful — moved from your wallet'); invalidateMoney(); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  const withdraw = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => moveMoney({ id, amount, direction: 'withdraw' }),
    onSuccess: () => { toast.success('Withdrawal successful — moved back to your wallet'); invalidateMoney(); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });

  return { accounts, createAccount, deposit, withdraw };
};
