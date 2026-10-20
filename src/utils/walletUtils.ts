
import { supabase } from '@/integrations/supabase/client';

export const ensureWalletExists = async (userId: string) => {
  try {
    // Fetch the primary (ZMW) wallet. A user can hold several wallets
    // (one per currency), so an unscoped maybeSingle() errors with
    // "multiple rows returned" the moment a second wallet exists —
    // that error is what left the Wallet page stuck on skeletons.
    const { data: existingWallet, error: checkError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'ZMW')
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

export const getWalletByUserId = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'ZMW')
      .maybeSingle();

    if (error) {
      console.error('Error fetching wallet:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in getWalletByUserId:', error);
    throw error;
  }
};
