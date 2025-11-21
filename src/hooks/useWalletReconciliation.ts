import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface WalletReconciliation {
  id: string;
  wallet_id: string;
  reconciliation_type: 'manual' | 'automated' | 'scheduled';
  calculated_balance: number;
  recorded_balance: number;
  difference: number;
  transaction_count: number;
  status: 'completed' | 'pending' | 'failed';
  performed_by: string | null;
  notes: string | null;
  created_at: string;
  metadata: any;
}

export interface ReconciliationResult {
  wallet_id: string;
  user_id: string;
  reconciliation_id: string;
  has_discrepancy: boolean;
  difference: number;
}

export const useWalletReconciliation = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch reconciliation history for user's wallet
  const { data: reconciliations = [], isLoading } = useQuery({
    queryKey: ['wallet-reconciliations', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('wallet_reconciliations')
        .select(`
          *,
          wallets!inner(user_id)
        `)
        .eq('wallets.user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as WalletReconciliation[];
    },
    enabled: !!user?.id,
  });

  // Reconcile single wallet
  const reconcileWalletMutation = useMutation({
    mutationFn: async ({ 
      walletId, 
      notes 
    }: { 
      walletId: string; 
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc('reconcile_wallet', {
        p_wallet_id: walletId,
        p_reconciliation_type: 'manual',
        p_performed_by: user?.id,
        p_notes: notes || 'Manual reconciliation'
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-reconciliations'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast({
        title: "Reconciliation Complete",
        description: "Wallet balance has been reconciled successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reconciliation Failed",
        description: error.message || "Failed to reconcile wallet balance",
        variant: "destructive",
      });
    },
  });

  // Fix wallet balance discrepancies
  const fixBalanceMutation = useMutation({
    mutationFn: async ({ 
      walletId, 
      notes 
    }: { 
      walletId: string; 
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc('fix_wallet_balance', {
        p_wallet_id: walletId,
        p_performed_by: user?.id,
        p_notes: notes || 'Balance correction applied'
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-reconciliations'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast({
        title: "Balance Corrected",
        description: "Wallet balance has been corrected based on transaction history.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Balance Correction Failed",
        description: error.message || "Failed to correct wallet balance",
        variant: "destructive",
      });
    },
  });

  // Calculate wallet balance without storing
  const calculateBalance = async (walletId: string) => {
    const { data, error } = await supabase.rpc('calculate_wallet_balance', {
      p_wallet_id: walletId
    });

    if (error) throw error;
    return data[0];
  };

  return {
    reconciliations,
    isLoading,
    reconcileWallet: reconcileWalletMutation.mutate,
    fixBalance: fixBalanceMutation.mutate,
    calculateBalance,
    isReconciling: reconcileWalletMutation.isPending,
    isFixing: fixBalanceMutation.isPending,
  };
};