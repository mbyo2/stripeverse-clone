import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export const useOnboarding = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useLocalStorage("onboarding_dismissed", false);
  const [kycLevel, setKycLevel] = useState("none");
  const [walletBalance, setWalletBalance] = useState(0);
  const [hasProfile, setHasProfile] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchOnboardingState = async () => {
      setIsLoading(true);
      try {
        const [profileRes, kycRes, walletRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("first_name, last_name, phone")
            .eq("id", user.id)
            .single(),
          supabase
            .from("kyc_verifications")
            .select("level")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.rpc("get_user_wallet_balance", { p_user_id: user.id }),
        ]);

        if (profileRes.data) {
          setHasProfile(
            !!(profileRes.data.first_name && profileRes.data.last_name)
          );
        }
        if (kycRes.data) {
          setKycLevel(kycRes.data.level || "none");
        }
        if (walletRes.data !== null) {
          setWalletBalance(Number(walletRes.data) || 0);
        }
      } catch (err) {
        console.error("Error fetching onboarding state:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOnboardingState();
  }, [user]);

  const showOnboarding = !dismissed && !isLoading && !!user;

  return {
    showOnboarding,
    kycLevel,
    walletBalance,
    hasProfile,
    isLoading,
    dismiss: () => setDismissed(true),
  };
};
