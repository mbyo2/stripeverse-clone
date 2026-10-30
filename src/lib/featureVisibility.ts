// Feature visibility — the presentation rules behind the CEO
// directive (2026-10-30): "make things not completed or working stop
// being seen by all user roles except admin and superadmin, so people
// won't get confused with a lot of things that aren't even working."
//
// ONE registry decides whether an unfinished feature is visible to a
// viewer. Every entry point — navigation, dashboard cards, settings
// sections, in-page buttons, checkout option lists and the routes
// themselves — consults this registry (via useFeatureVisibility),
// never a scattered local conditional.
//
// The rules:
//   - The admin tier (admin OR super_admin — super_admin is additive
//     over admin everywhere in this app) sees EVERYTHING, exactly as
//     before: they operate and test the unfinished features.
//   - Everyone else (role `user`, other non-admin roles, and guests)
//     sees a feature only when it is actually live for them:
//       * flag-driven features follow their platform_settings flag —
//         flip the flag on and the feature appears for users through
//         this same registry, with no further code change;
//       * features with no flag are unfinished work with no live
//         backend path for users; they stay hidden until the work is
//         completed and the registry entry is retired (the entry's
//         `flag` is set, or the entry is removed) — again, this file
//         is the only place that changes.
//
// PRESENTATION ONLY. Nothing here grants or denies data access: the
// database (RLS + SECURITY DEFINER RPCs with in-DB role checks) and
// the edge functions remain the enforcement layer, exactly as before
// (the flag-off rails already refuse server-side). These helpers
// only decide what renders and where a mismatched navigation lands.

import { isAdminTier } from "./roleVisibility";

/** The platform_settings kill switches that gate live rails. */
export interface PlatformFeatureFlags {
  bank_payouts_enabled: boolean;
  receiving_accounts_enabled: boolean;
  moonpay_enabled: boolean;
  mtn_momo_enabled: boolean;
  airtel_money_enabled: boolean;
  paypal_payouts_enabled: boolean;
}

export type PlatformFlagKey = keyof PlatformFeatureFlags;

/** Fail-closed default: until the settings row has been read, every
 *  flag-driven rail reads as OFF (the live state of every flag
 *  today, and the only safe assumption for a regular user). */
export const PLATFORM_FLAGS_ALL_OFF: PlatformFeatureFlags = {
  bank_payouts_enabled: false,
  receiving_accounts_enabled: false,
  moonpay_enabled: false,
  mtn_momo_enabled: false,
  airtel_money_enabled: false,
  paypal_payouts_enabled: false,
};

/** Every feature the CEO's 2026-10-30 directive covers. A feature
 *  that is finished and working for regular users is NOT listed
 *  here at all — see WORKING_FEATURE_ROUTES below. */
export type FeatureKey =
  | "bankWithdrawals"
  | "paypalPayouts"
  | "receivingAccounts"
  | "custodialMoonpay"
  | "mobileMoney"
  | "virtualCards"
  | "bankTransfers"
  | "collectPayments"
  | "ussdAccess"
  | "billPayments"
  | "agentNetwork"
  | "cardVault"
  | "cardProcessing"
  | "payLater"
  | "settlements"
  | "cryptoPayouts"
  | "legacyCheckout"
  | "paymentMethods"
  | "inactivePaymentSettings";

interface FeatureDefinition {
  /**
   * platform_settings flag(s) that switch this feature on for
   * regular users. More than one flag means ANY of them being on
   * makes the feature live (mobile money is live when either direct
   * telco connection is on). No flag = unfinished work with no live
   * switch: hidden from regular users until the work is completed
   * and this entry is retired.
   */
  flag?: PlatformFlagKey | PlatformFlagKey[];
  /** Why the feature is in the registry (evidence, 2026-10-30). */
  note: string;
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDefinition> = {
  bankWithdrawals: {
    flag: "bank_payouts_enabled",
    note: "Bank payout rail built but switched off (migration 20261245); the wallet panel only ever showed the 'being activated' state.",
  },
  paypalPayouts: {
    flag: "paypal_payouts_enabled",
    note: "PayPal Payouts still awaiting PayPal's account-level approval; the withdraw panel only ever showed the 'being activated' state.",
  },
  receivingAccounts: {
    flag: "receiving_accounts_enabled",
    note: "Partner receiving accounts built but no partner has signed (migration 20261246); no live partner exists to issue an account.",
  },
  custodialMoonpay: {
    flag: "moonpay_enabled",
    note: "Custodial card buy waits on MoonPay KYB; the buy entries only ever rendered disabled as 'Coming soon'. (The SELF-custody MoonPay buy is a different, live rail — moonpay_selfcustody_enabled — and is NOT gated here.)",
  },
  mobileMoney: {
    flag: ["mtn_momo_enabled", "airtel_money_enabled"],
    note: "Direct telco connections not live yet; deposits answer not_configured and send options render disabled. Live when either connection switches on.",
  },
  virtualCards: {
    note: "Card creation is admin-only by CEO decision (2026-10-22) until the card integration is finished and tested; regular users only ever saw a 'Coming soon' panel on the card pages.",
  },
  bankTransfers: {
    note: "Legacy bank-transfer page: every primary action is a disabled '(not yet available)' button. Bank cash-out, when it opens, is the wallet's bank withdrawal rail — not this page.",
  },
  collectPayments: {
    note: "Page renders 'Not yet available' badges for every collection method; no working collection flow behind it (payment links and POS are the live collection tools).",
  },
  ussdAccess: {
    note: "The page's only action ('Generate USSD Code') is disabled as not yet available; no USSD channel is connected.",
  },
  billPayments: {
    note: "The page itself declares bill payments are not live: no biller integration is connected and payments are disabled.",
  },
  agentNetwork: {
    note: "Directory of cash-in/cash-out agents: no agents exist (agent_locations is empty) and there is no agent onboarding — the network it maps does not exist yet.",
  },
  cardVault: {
    note: "Card storage is disabled until a PCI-compliant vault is connected; the page can only explain that and show a disabled 'Add Card' button. No user has a stored card.",
  },
  cardProcessing: {
    note: "No card processor is connected (the Stripe rail was removed 2026-10-26); card marketing surfaces present a rail that cannot take a payment.",
  },
  payLater: {
    note: "Buy Now Pay Later has no creation path anywhere in the product — plans can never come into existence for a user; the page can only ever be an empty list.",
  },
  settlements: {
    note: "Settlement reports are never generated (nothing writes settlement_reports), so the page is permanently empty.",
  },
  cryptoPayouts: {
    note: "EVM/USDC payout page: no payout treasury is configured and no payout has ever been requested or paid; not part of the Bitcoin product.",
  },
  legacyCheckout: {
    note: "Legacy demo checkout (/checkout): no product catalogue behind it, its mobile-money panel answers not_configured, its card panel has no processor, and its USSD panel quotes merchant codes that were never issued. The live guest checkout is /pay/:code.",
  },
  paymentMethods: {
    note: "The wallet's Payment Methods card: its Add flow (card / mobile money / bank) only ever updated on-screen state — nothing was saved anywhere, and it collected card numbers into a form that went nowhere.",
  },
  inactivePaymentSettings: {
    note: "Settings blocks that are disabled switches saving nothing ('Not yet available' — transaction limits and international payments).",
  },
};

/**
 * Whether `feature` is visible to a viewer holding `roles` with the
 * platform flags in `flags`. Admin tier: always. Everyone else:
 * only when the feature's flag is on; flag-less (unfinished)
 * features are never visible.
 */
export const isFeatureVisible = (
  feature: FeatureKey,
  roles: readonly string[],
  flags: PlatformFeatureFlags,
): boolean => {
  if (isAdminTier(roles)) return true;
  const def = FEATURE_REGISTRY[feature];
  if (!def.flag) return false;
  const keys = Array.isArray(def.flag) ? def.flag : [def.flag];
  return keys.some((key) => flags[key] === true);
};

/** The full visibility map for a viewer — what nav/dashboard/route
 *  gates consume so they all agree. */
export const visibleFeatures = (
  roles: readonly string[],
  flags: PlatformFeatureFlags,
): Record<FeatureKey, boolean> => {
  const out = {} as Record<FeatureKey, boolean>;
  (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach((feature) => {
    out[feature] = isFeatureVisible(feature, roles, flags);
  });
  return out;
};

/** Mobile-money providers offered as send/deposit destinations.
 *  Zamtel has no API, portal or flag at all (commercial engagement
 *  only), so it can only ever be an admin-visible placeholder. */
export type MobileMoneyProvider = "mtn" | "airtel" | "zamtel";

export const isMobileMoneyProviderVisible = (
  provider: MobileMoneyProvider,
  roles: readonly string[],
  flags: PlatformFeatureFlags,
): boolean => {
  if (isAdminTier(roles)) return true;
  if (provider === "mtn") return flags.mtn_momo_enabled === true;
  if (provider === "airtel") return flags.airtel_money_enabled === true;
  return false; // zamtel: no connection exists to switch on
};

/**
 * Routes that belong to gated features. The route guard in
 * AnimatedRoutes wraps each of these with the registry decision, so
 * hiding a nav link can never leave a live route behind. Patterns
 * match the declared route paths segment-for-segment (`:id` covers
 * any single segment).
 */
export const FEATURE_ROUTE_MAP: Record<string, FeatureKey> = {
  "/bank-transfers": "bankTransfers",
  "/collect-payments": "collectPayments",
  "/ussd-access": "ussdAccess",
  "/bill-payments": "billPayments",
  "/agent-network": "agentNetwork",
  "/card-vault": "cardVault",
  "/pay-later": "payLater",
  "/settlements": "settlements",
  "/receiving-accounts": "receivingAccounts",
  "/wallet/crypto": "cryptoPayouts",
  "/card/new": "virtualCards",
  "/card/:id": "virtualCards",
  "/card/:id/fund": "virtualCards",
  "/checkout/*": "legacyCheckout",
};

/**
 * Routes of features that are finished and WORKING for regular
 * users. They must never enter the gate: the registry's whole point
 * is that only unfinished surfaces are hidden. Pinned by tests so a
 * future registry edit cannot quietly swallow a live feature.
 */
export const WORKING_FEATURE_ROUTES: readonly string[] = [
  "/dashboard",
  "/wallet",
  "/bitcoin-wallet",
  "/bitcoin-wallet/self-custody",
  "/p2p",
  "/p2p/ads/new",
  "/p2p/my-ads",
  "/p2p/orders",
  "/p2p/profile",
  "/payment-links",
  "/pos",
  "/transfer",
  "/send-money",
  "/request-money",
  "/transactions",
  "/transaction-list",
  "/transaction-search",
  "/statements",
  "/spending-insights",
  "/multi-currency",
  "/sub-accounts",
  "/split-payments",
  "/scheduled-payments",
  "/savings",
  "/escrow",
  "/bulk-payments",
  "/invoices",
  "/payment-plans",
  "/qr-payments",
  "/contacts",
  "/refunds",
  "/disputes",
  "/notifications",
  "/rewards",
  "/kyc",
  "/verify-identity",
  "/settings",
  "/security-settings",
  "/two-factor-auth",
  "/billing",
  "/analytics",
  "/webhook-logs",
  "/checkout-widget",
  "/role-management",
  "/feedback",
];
