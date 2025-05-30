
import { supabase } from '@/integrations/supabase/client';

export const ensureWalletExists = async (userId: string) => {
  try {
    // Check if wallet exists
    const { data: existingWallet, error: checkError } = await supabase
      .from('wallets' as any)
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existingWallet) {
      return existingWallet;
    }

    // Create wallet if it doesn't exist
    const { data: newWallet, error: createError } = await supabase
      .from('wallets' as any)
      .insert({
        user_id: userId,
        balance: 0.00,
        currency: 'ZMW'
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating wallet:', createError);
      throw createError;
    }

    return newWallet;
  } catch (error) {
    console.error('Error ensuring wallet exists:', error);
    throw error;
  }
};

export const formatCurrency = (amount: number, currency: string = 'ZMW') => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

export const calculateTransactionFee = (amount: number, feeRate: number = 0.01, minFee: number = 2) => {
  return Math.max(amount * feeRate, minFee);
};
