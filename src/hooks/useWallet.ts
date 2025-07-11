import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ensureWalletExists } from '@/utils/walletUtils';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
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

export const useWallet = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch wallet data with proper error handling
  const { data: wallet, isLoading: walletLoading, error: walletError } = useQuery({
    queryKey: ['wallet', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      
      try {
        // Ensure wallet exists for the user
        const walletData = await ensureWalletExists(user.id);
        return walletData as Wallet;
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

  // Wallet deposit mutation
  const depositMutation = useMutation({
    mutationFn: async ({ amount, paymentMethod }: { amount: number; paymentMethod: string }) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const { data, error } = await supabase.functions.invoke('wallet-deposit', {
        body: { amount, paymentMethod, user_id: user.id },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast({
        title: "Deposit Initiated",
        description: "Your wallet deposit has been initiated.",
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
