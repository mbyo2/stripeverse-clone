
import { supabase } from '@/integrations/supabase/client';

export const ensureWalletExists = async (userId: string) => {
  try {
    // Check if wallet exists
    const { data: existingWallet, error: checkError } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking wallet:', checkError);
      throw checkError;
    }

    if (existingWallet) {
      return existingWallet;
    }

    // Create wallet if it doesn't exist
    const { data: newWallet, error: createError } = await supabase
      .from('wallets')
      .insert({
        user_id: userId,
        balance: 0.00,
        currency: 'ZMW',
        status: 'active'
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

export const updateWalletBalance = async (userId: string, amount: number) => {
  try {
    // Use the database function to safely update wallet balance
    const { error } = await supabase.rpc('increment_wallet_balance', {
      p_user_id: userId,
      p_amount: amount
    });

    if (error) {
      console.error('Error updating wallet balance:', error);
      throw error;
    }

    return true;
  } catch (error) {
    console.error('Error in updateWalletBalance:', error);
    throw error;
  }
};
