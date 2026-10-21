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
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .gte('valid_until', new Date().toISOString())
        .order('from_currency');
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
      const to_amount = params.from_amount * params.exchange_rate;
      const fee = params.from_amount * 0.015; // 1.5% fee
      const { data, error } = await supabase.from('currency_conversions').insert({
        user_id: user!.id,
        from_currency: params.from_currency,
        to_currency: params.to_currency,
        from_amount: params.from_amount,
        to_amount,
        exchange_rate: params.exchange_rate,
        fee_amount: fee,
        from_wallet_id: params.from_wallet_id,
        to_wallet_id: params.to_wallet_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['multi-wallets'] });
      qc.invalidateQueries({ queryKey: ['currency-conversions'] });
      toast.success('Currency converted successfully');
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
