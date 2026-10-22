import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ensureWalletExists } from '@/utils/walletUtils';
import { resolveDepositTarget } from '@/utils/depositTarget';
import { PAYPAL_AVAILABLE } from '@/config/paypal';

export interface Wallet {
  id: string;
  user_id: string;
  account_id: string | null;
  balance: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VirtualCard {
  id: string;
  user_id: string;
  name: string;
  card_number: string;
  masked_number: string;
  cvv: string;
  expiry_date: string;
  balance: number;
  currency: string;
  status: 'active' | 'frozen' | 'cancelled';
  provider: string;
  card_type: string;
  daily_limit: number;
  monthly_limit: number;
  transaction_limit: number;
  online_transactions: boolean;
  international_transactions: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * With no argument this behaves exactly as it always has (the Main
 * account's primary wallet). Pass an account id — or explicit null for
 * Main — to scope the wallet to a sub-account; scoped calls use their
 * own query key so accounts never share a cache entry.
 */
export const useWallet = (accountId?: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scoped = accountId !== undefined;

  // Fetch wallet data with proper error handling
  const { data: wallet, isLoading: walletLoading, error: walletError } = useQuery({
    queryKey: scoped ? ['wallet', user?.id, accountId ?? 'main'] : ['wallet', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');

      try {
        // Ensure wallet exists for the user (within the selected account)
        const walletData = await ensureWalletExists(user.id, accountId ?? null);
        return walletData as unknown as Wallet;
      } catch (error) {
        console.error('Error in wallet query:', error);
        throw error;
      }
    },
    enabled: !!user?.id,
    retry: 2,
    retryDelay: 1000,
  });

  // Fetch virtual cards with proper error handling
  const { data: virtualCards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['virtualCards', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      
      try {
        const { data, error } = await supabase
          .from('virtual_cards')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching virtual cards:', error);
          throw error;
        }

        return data as VirtualCard[];
      } catch (error) {
        console.error('Error in virtual cards query:', error);
        return [] as VirtualCard[];
      }
    },
    enabled: !!user?.id,
    retry: 1,
  });

  // Create virtual card mutation with usage tracking
  const createVirtualCardMutation = useMutation({
    mutationFn: async (cardData: any) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      // Check if user can create more cards
      const { data: canCreate, error: limitError } = await supabase.rpc('check_usage_limit', {
        p_user_id: user.id,
        p_limit_type: 'virtual_cards',
        p_amount: 1
      });
      
      if (limitError) throw limitError;
      if (!canCreate) {
        throw new Error('You have reached your monthly virtual card creation limit. Please upgrade your plan to create more cards.');
      }
      
      const { data, error } = await supabase.functions.invoke('create-virtual-card', {
        body: { ...cardData, user_id: user.id },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['virtualCards'] });
      queryClient.invalidateQueries({ queryKey: ['usage'] });
      toast({
        title: "Virtual Card Created",
        description: "Your new virtual card has been created successfully.",
      });
    },
    onError: (error: any) => {
      console.error('Create virtual card error:', error);
      toast({
        title: "Failed to Create Card",
        description: error.message || "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  // Fund virtual card mutation
  const fundVirtualCardMutation = useMutation({
    mutationFn: async ({ cardId, amount }: { cardId: string; amount: number }) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const { data, error } = await supabase.functions.invoke('fund-virtual-card', {
        body: { cardId, amount, user_id: user.id },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['virtualCards'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast({
        title: "Card Funded",
        description: "Your virtual card has been funded successfully.",
      });
    },
    onError: (error: any) => {
      console.error('Fund virtual card error:', error);
      toast({
        title: "Failed to Fund Card",
        description: error.message || "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  // Wallet deposit mutation. The deposit targets the wallet the user
  // is viewing (selected account + currency) explicitly — the function
  // credits only that wallet, and only against a confirmed payment.
  // Mobile money / card currently answer 'not_configured'; PayPal
  // answers 'pending' with an approval URL the user must complete.
  //
  // PayPal is the one exception to "target the viewed wallet": PayPal
  // does not support ZMW, so a PayPal order for the viewed (ZMW)
  // wallet fails at creation. A PayPal deposit instead targets the
  // user's USD wallet in the same account scope when one exists, and
  // otherwise passes currency 'USD' with no wallet_id so the function
  // resolves (or creates) the Main USD wallet itself — see
  // resolveDepositTarget. The dialog tells the user this up front.
  const depositMutation = useMutation({
    mutationFn: async ({ amount, paymentMethod, walletId, currency, provider }: {
      amount: number; paymentMethod: string;
      walletId?: string; currency?: string; provider?: string;
    }) => {
      if (!user?.id) throw new Error('User not authenticated');

      // PayPal gate (defense in depth): while PAYPAL_AVAILABLE is off
      // the dialog cannot select PayPal, and any direct call with
      // paymentMethod 'paypal' stops here — no order is created and
      // nobody is redirected to the (sandbox) PayPal environment.
      if (paymentMethod === 'paypal' && !PAYPAL_AVAILABLE) {
        throw new Error('PayPal is coming soon — deposits by PayPal are not available yet.');
      }

      let targetWalletId = walletId;
      let targetCurrency = currency;
      if (paymentMethod === 'paypal') {
        // Same account scope the viewed wallet lives in: sub-account
        // deposits look for that account's USD wallet, Main (null)
        // for Main's. A failed lookup is not fatal — resolving with
        // no USD wallet just defers to the function's fallback.
        let usdQuery = supabase
          .from('wallets')
          .select('id')
          .eq('user_id', user.id)
          .eq('currency', 'USD');
        usdQuery = (accountId ?? null) === null
          ? usdQuery.is('account_id', null)
          : usdQuery.eq('account_id', accountId as string);
        const { data: usdWallet, error: usdError } = await usdQuery.maybeSingle();
        if (usdError) console.error('Error resolving USD wallet for PayPal deposit:', usdError);
        const target = resolveDepositTarget({
          paymentMethod, walletId, currency, usdWalletId: usdWallet?.id ?? null,
        });
        targetWalletId = target.walletId;
        targetCurrency = target.currency;
      }

      const { data, error } = await supabase.functions.invoke('wallet-deposit', {
        body: {
          amount, paymentMethod, provider, wallet_id: targetWalletId, currency: targetCurrency, user_id: user.id,
          // Where PayPal sends the user after approval / cancellation.
          // PayPal appends &token=<order id> to the return URL, which
          // usePayPalDepositReturn hands to paypal-deposit-capture.
          return_url: `${window.location.origin}/wallet?paypal_return=deposit`,
          cancel_url: `${window.location.origin}/wallet?paypal_return=cancelled`,
        },
      });

      if (error) throw error;
      if (data?.status === 'pending' && data?.approval_url) {
        // Hand the user to PayPal; the wallet is credited on capture,
        // not on initiation. This is the ONLY success exit: the
        // navigation below is the result the user was promised.
        window.location.href = data.approval_url;
        return data;
      }
      // Every other response is NOT a started deposit — the function
      // answers 'failed' when PayPal could not create the order (e.g.
      // an unsupported currency), 'not_configured' when the method has
      // no gateway, 'forbidden' for someone else's wallet. Previously
      // only not_configured/forbidden were thrown, so a 'failed'
      // response fell through to the "Deposit Initiated" success
      // toast while nothing had happened at all. Surface the
      // function's own message verbatim instead.
      throw new Error(
        data?.error || data?.message || 'This deposit could not be started. No money has moved.',
      );
    },
    onSuccess: () => {
      // Reached only when an approval URL existed and the browser is
      // navigating to PayPal (see mutationFn) — so this toast is a
      // "redirecting" note, never a completion claim.
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast({
        title: "Redirecting to PayPal",
        description: "Complete the payment on PayPal — your wallet is credited once the payment is confirmed.",
      });
    },
    onError: (error: any) => {
      console.error('Deposit error:', error);
      toast({
        title: "Failed to Process Deposit",
        description: error.message || "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    wallet,
    virtualCards,
    isLoading: walletLoading || cardsLoading,
    walletError,
    createVirtualCard: createVirtualCardMutation.mutate,
    fundVirtualCard: fundVirtualCardMutation.mutate,
    deposit: depositMutation.mutate,
    isCreatingCard: createVirtualCardMutation.isPending,
    isFundingCard: fundVirtualCardMutation.isPending,
    isDepositing: depositMutation.isPending,
  };
};
