// useFeatureVisibility — the one hook every surface consults for
// the CEO's 2026-10-30 directive (unfinished features are visible
// to admin / super_admin only). It binds the pure registry in
// src/lib/featureVisibility.ts to the viewer's live roles
// (RoleContext) and the live platform_settings flags, read once and
// shared through react-query.
//
// Fail-closed for regular users: until the flags row has loaded,
// flag-driven features read as OFF (their true state today, and the
// only safe assumption). The admin tier never waits on flags —
// isAdminTier short-circuits every decision in the registry.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RoleContext";
import { isAdminTier } from "@/lib/roleVisibility";
import {
  PLATFORM_FLAGS_ALL_OFF,
  isFeatureVisible,
  isMobileMoneyProviderVisible,
  visibleFeatures,
  type FeatureKey,
  type MobileMoneyProvider,
  type PlatformFeatureFlags,
} from "@/lib/featureVisibility";

const FLAG_COLUMNS =
  "bank_payouts_enabled, receiving_accounts_enabled, moonpay_enabled, mtn_momo_enabled, airtel_money_enabled, paypal_payouts_enabled";

/** The live platform_settings kill switches, as one shared read. */
export const usePlatformFeatureFlags = (): {
  flags: PlatformFeatureFlags;
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-feature-flags"],
    queryFn: async (): Promise<PlatformFeatureFlags> => {
      // The flag columns are newer than the generated types — the
      // same scoped cast useMoonpay / receivingAccountsService use
      // for their platform_settings reads.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("platform_settings")
        .select(FLAG_COLUMNS)
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return PLATFORM_FLAGS_ALL_OFF;
      return {
        bank_payouts_enabled: data.bank_payouts_enabled === true,
        receiving_accounts_enabled: data.receiving_accounts_enabled === true,
        moonpay_enabled: data.moonpay_enabled === true,
        mtn_momo_enabled: data.mtn_momo_enabled === true,
        airtel_money_enabled: data.airtel_money_enabled === true,
        paypal_payouts_enabled: data.paypal_payouts_enabled === true,
      };
    },
    staleTime: 60_000,
  });
  return { flags: data ?? PLATFORM_FLAGS_ALL_OFF, isLoading };
};

export interface FeatureVisibility {
  /** Full per-feature map for this viewer (registry decision). */
  visible: Record<FeatureKey, boolean>;
  canSee: (feature: FeatureKey) => boolean;
  providerVisible: (provider: MobileMoneyProvider) => boolean;
  /** admin OR super_admin — sees everything, exactly as before. */
  adminTier: boolean;
  flags: PlatformFeatureFlags;
  /** True while roles or flags are still resolving. Gates that must
   *  not flash an unfinished surface for a regular user wait on
   *  this; the admin tier's answer never depends on flags. */
  isLoading: boolean;
}

export const useFeatureVisibility = (): FeatureVisibility => {
  const { roles, isLoading: rolesLoading } = useRoles();
  const { flags, isLoading: flagsLoading } = usePlatformFeatureFlags();
  const adminTier = isAdminTier(roles);
  return {
    visible: visibleFeatures(roles, flags),
    canSee: (feature) => isFeatureVisible(feature, roles, flags),
    providerVisible: (provider) =>
      isMobileMoneyProviderVisible(provider, roles, flags),
    adminTier,
    flags,
    isLoading: rolesLoading || flagsLoading,
  };
};

/**
 * Whether the signed-in user already holds records inside the
 * flag-off payout rails (a saved bank account, a bank withdrawal, a
 * PayPal withdrawal). Drives the data-stranding guard in the Wallet:
 * a regular user with records keeps a read-only view of their own
 * items even though the rails themselves are hidden. Returns
 * undefined while loading. (All three tables carry owner SELECT
 * policies; counts are head-only.)
 */
export const useHasPayoutRecords = (): boolean | undefined => {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["has-payout-records", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<boolean> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const tables = ["bank_accounts", "bank_withdrawals", "paypal_withdrawals"];
      for (const table of tables) {
        const { count, error } = await db
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id);
        if (!error && (count ?? 0) > 0) return true;
      }
      return false;
    },
    staleTime: 60_000,
  });
  return data;
};

/**
 * Whether the signed-in user already holds a receiving account.
 * Same data-stranding logic as useHasPayoutRecords: their existing
 * account stays reachable (read-only status) while the feature is
 * switched off for everyone else.
 */
export const useHasReceivingAccounts = (): boolean | undefined => {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["has-receiving-accounts", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<boolean> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (supabase as any)
        .from("receiving_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id);
      return !error && (count ?? 0) > 0;
    },
    staleTime: 60_000,
  });
  return data;
};
