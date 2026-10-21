
import { supabase } from '@/integrations/supabase/client';

export const ensureWalletExists = async (userId: string, accountId: string | null = null) => {
  try {
    // Fetch the primary (ZMW) wallet. A user can hold several wallets
    // (one per currency), so an unscoped maybeSingle() errors with
    // "multiple rows returned" the moment a second wallet exists —
    // that error is what left the Wallet page stuck on skeletons.
    // The account scope keeps that guarantee per account: the Main
    // account's wallets are the ones with account_id NULL, and each
    // sub-account has its own ZMW wallet.
    let query = supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'ZMW');
    query = accountId === null
      ? query.is('account_id', null)
      : query.eq('account_id', accountId);
    const { data: existingWallet, error: checkError } = await query.maybeSingle();

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
        status: 'active',
        account_id: accountId
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

export const getWalletByUserId = async (userId: string, accountId: string | null = null) => {
  try {
    let query = supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'ZMW');
    query = accountId === null
      ? query.is('account_id', null)
      : query.eq('account_id', accountId);
    const { data, error } = await query.maybeSingle();

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
