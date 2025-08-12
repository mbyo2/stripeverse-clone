import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CryptoWallet = {
  id: string;
  user_id: string;
  asset: string;
  balance_sats: number;
  available_sats: number;
  created_at: string;
  updated_at: string;
};

export const useBitcoinWallet = () => {
  const { user } = useAuth();

  const walletQuery = useQuery({
    queryKey: ["cryptoWallet", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<CryptoWallet | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("crypto_wallets")
        .select("*")
        .eq("user_id", user.id)
        .eq("asset", "BTC")
        .maybeSingle();
      if (error) throw error;
      return (data as CryptoWallet) ?? null;
    },
  });

  const txQuery = useQuery({
    queryKey: ["btcTransactions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as any[];
      const { data, error } = await supabase
        .from("transactions")
        .select("id, created_at, amount, status, transaction_id, metadata")
        .eq("user_id", user.id)
        .eq("currency", "BTC")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    wallet: walletQuery.data,
    isLoading: walletQuery.isLoading,
    refetchWallet: walletQuery.refetch,
    transactions: txQuery.data ?? [],
    isTxLoading: txQuery.isLoading,
    refetchTx: txQuery.refetch,
  };
};
