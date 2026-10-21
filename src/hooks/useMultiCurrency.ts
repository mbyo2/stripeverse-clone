import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/**
 * With no argument: every wallet the user holds (legacy behaviour).
 * Pass an account id — or explicit null for the Main account — to list
 * only that account's wallets, under a separate query key.
 */
export const useMultiCurrencyWallets = (accountId?: string | null) => {
  const { user } = useAuth();
  const scoped = accountId !== undefined;
  return useQuery({
    queryKey: scoped ? ['multi-wallets', user?.id, accountId ?? 'main'] : ['multi-wallets', user?.id],
    queryFn: async () => {
      let query = supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user!.id);
      if (scoped) {
        query = accountId === null || accountId === undefined
          ? query.is('account_id', null)
          : query.eq('account_id', accountId);
      }
      const { data, error } = await query.order('currency');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateWallet = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { currency: string; accountId?: string | null }) => {
      const currency = typeof input === 'string' ? input : input.currency;
      const accountId = typeof input === 'string' ? undefined : input.accountId;
      const payload: {
        user_id: string; currency: string; balance: number; status: string;
        account_id?: string | null;
      } = {
        user_id: user!.id, currency, balance: 0, status: 'active',
      };
      // Legacy string calls insert exactly what they always did; scoped
      // calls attach the wallet to the selected account (null = Main).
      if (accountId !== undefined) payload.account_id = accountId;
      const { data, error } = await supabase.from('wallets').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['multi-wallets'] }); toast.success('Wallet created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useExchangeRates = () => {
  return useQuery({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      // Fetch every row and let resolveExchangeRate (src/utils/
      // exchangeRates.ts) apply the RPC's validity window client-side.
      // The previous `.gte('valid_until', now)` filter silently
      // discarded open-ended rows (valid_until IS NULL) — exactly the
      // rows execute_currency_conversion treats as live — so the UI
      // refused conversions the server would have accepted.
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .order('valid_from', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
};

export const useConvertCurrency = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      from_currency: string; to_currency: string;
      from_amount: number; exchange_rate: number;
      from_wallet_id: string; to_wallet_id: string;
    }) => {
      // The movement happens server-side (currency-convert ->
      // execute_currency_conversion): the RPC reads the stored rate
      // from exchange_rates itself (the rate passed here is only the
      // expectation the user saw — the RPC refuses if the stored rate
      // has moved >2%), debits/credits both wallets, and writes the
      // conversion record + ledger legs atomically. The browser never
      // writes a balance or a history-only "conversion".
      const { data, error } = await supabase.functions.invoke('currency-convert', {
        body: {
          from_wallet_id: params.from_wallet_id,
          to_wallet_id: params.to_wallet_id,
          from_amount: params.from_amount,
          expected_rate: params.exchange_rate,
          idempotency_key: `conv-${user!.id}-${crypto.randomUUID()}`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['multi-wallets'] });
      qc.invalidateQueries({ queryKey: ['currency-conversions'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      toast.success(
        data?.to_amount != null
          ? `Currency converted successfully — received ${Number(data.to_amount).toFixed(2)}`
          : 'Currency converted successfully',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useConversionHistory = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['currency-conversions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('currency_conversions')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};
