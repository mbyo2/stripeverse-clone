// MoonPay on-ramp — client-side configuration.
//
// There are TWO distinct MoonPay card-buying paths in this app, and
// user copy must never blur them (CEO directive 2026-10-27):
//
//   1. CUSTODIAL (this config): the user pays by card on MoonPay's
//      hosted flow and the Bitcoin is delivered to their BMaGlass
//      Bitcoin wallet deposit address. It runs through our own
//      MoonPay account, the `moonpay-session` / `moonpay-admin` edge
//      functions and the `moonpay_transactions` ledger. It is gated
//      by platform_settings.moonpay_enabled and, until KYB completes
//      and production keys replace the test keys, it is AVAILABLE
//      SOON — every custodial surface says so and points at path 2.
//
//   2. SELF-CUSTODY: the self-custody wallet's "Buy Bitcoin" runs in
//      the user's own browser through the Breez SDK
//      (src/lib/selfcustody/spark.ts) under BREEZ's MoonPay partner
//      arrangement — no platform MoonPay account, keys or edge
//      function is involved, and the Bitcoin is delivered to the
//      user's own seed-derived wallet address. That path is live
//      today. It has its own kill switch,
//      platform_settings.moonpay_selfcustody_enabled (default on —
//      it guards a rail that is already live).
//
// No MoonPay key ever reaches the browser except, potentially, the
// publishable key. The secret and webhook keys live only in
// Supabase function secrets, and the admin console only ever shows
// whether each key is set — never its value.
//
// Purchases are in USD: MoonPay does not support ZMW, so no surface
// may present MoonPay as a kwacha payment method.

/** platform_settings flag that switches the custodial MoonPay rail on/off. */
export const MOONPAY_ENABLED_SETTING = "moonpay_enabled";

/**
 * platform_settings kill switch for the SELF-CUSTODY MoonPay buy
 * (the Breez-arranged checkout in the self-custody wallet). Default
 * ON in the database: unlike moonpay_enabled, this guards a rail
 * that is already live, so the switch exists to pause it, not to
 * launch it.
 */
export const MOONPAY_SELFCUSTODY_ENABLED_SETTING = "moonpay_selfcustody_enabled";

/** Purchases are made in this currency (MoonPay does not support ZMW). */
export const MOONPAY_FIAT_CURRENCY = "USD";

/** Title shown wherever the MoonPay card entry is offered. */
export const MOONPAY_CARD_TITLE = "Card (MoonPay)";

/** Label shown wherever custodial MoonPay is offered while its gate is off. */
export const MOONPAY_COMING_SOON_LABEL = "Available soon";

/** Plain copy for the MoonPay card entry on the Bitcoin buy area. */
export const MOONPAY_CARD_DESCRIPTION =
  "Buy Bitcoin with a debit or credit card, delivered straight to your wallet.";

/**
 * The pointer every custodial surface carries while the custodial
 * rail is off (CEO directive 2026-10-27): card buying HERE is
 * available soon; card buying in the self-custody wallet works now.
 */
export const MOONPAY_SELFCUSTODY_POINTER_COPY =
  "You can buy Bitcoin by card now in your self-custody wallet — MoonPay delivers it straight to the wallet only you control.";

/** The full copy shown on custodial surfaces while the rail is switched off. */
export const MOONPAY_COMING_SOON_COPY =
  `${MOONPAY_CARD_DESCRIPTION} For this wallet, card buying is ${MOONPAY_COMING_SOON_LABEL.toLowerCase()}. ${MOONPAY_SELFCUSTODY_POINTER_COPY}`;

/**
 * Copy shown in the self-custody wallet when its MoonPay kill
 * switch is off: the buy is paused, the wallet itself is not.
 */
export const MOONPAY_SELFCUSTODY_PAUSED_COPY =
  "Card buying in your self-custody wallet is paused right now. Your wallet, Lightning and on-chain Bitcoin all keep working — only the MoonPay card checkout is paused.";

/**
 * Resolve the self-custody MoonPay gate from a platform_settings
 * row. Only a literal `true` in moonpay_selfcustody_enabled means
 * the buy is offered; a missing row, a missing column or any other
 * value fails CLOSED (paused) — the same posture as the custodial
 * flag's reader in useMoonpay.
 */
export function resolveMoonpaySelfcustodyEnabled(settingsRow: unknown): boolean {
  if (!settingsRow || typeof settingsRow !== "object") return false;
  return (
    (settingsRow as Record<string, unknown>).moonpay_selfcustody_enabled === true
  );
}

/** The six internal purchase statuses recorded by the backend. */
export type MoonpayTransactionStatus =
  | "initiated"
  | "waiting_payment"
  | "pending"
  | "waiting_authorization"
  | "completed"
  | "failed";

/** Plain-language label for each internal purchase status. */
export const MOONPAY_STATUS_LABELS: Record<MoonpayTransactionStatus, string> = {
  initiated: "Started",
  waiting_payment: "Waiting for payment",
  pending: "Processing",
  waiting_authorization: "Waiting for card approval",
  completed: "Completed",
  failed: "Failed",
};

/** Plain-language label for a purchase status; unknown values stay honest. */
export function moonpayStatusLabel(status: unknown): string {
  if (typeof status === "string" && status in MOONPAY_STATUS_LABELS) {
    return MOONPAY_STATUS_LABELS[status as MoonpayTransactionStatus];
  }
  return "Unknown";
}

/**
 * Plain-language environment label. The backend reports the
 * environment its keys belong to ("sandbox" while testing,
 * "production" once live keys are added); anything unrecognised is
 * shown capitalised rather than guessed at.
 */
export function moonpayEnvironmentLabel(environment: unknown): string | null {
  if (typeof environment !== "string" || !environment.trim()) return null;
  const value = environment.trim().toLowerCase();
  if (value === "sandbox" || value === "test") return "Sandbox";
  if (value === "production" || value === "live") return "Production";
  return environment.trim();
}

/** Whether the reported environment is the sandbox (simulated money). */
export function isMoonpaySandbox(environment: unknown): boolean {
  return moonpayEnvironmentLabel(environment) === "Sandbox";
}

/** Shorten a long value (deposit address, reference) for table cells. */
export function shortenMoonpayValue(
  value: string | null | undefined,
  head = 10,
  tail = 6,
): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type MoonpaySessionOutcome =
  | { kind: "ready"; url: string }
  | { kind: "not_configured"; message: string }
  | { kind: "coming_soon"; message: string }
  | { kind: "failed"; message: string };

/**
 * Interpret a `moonpay-session` response. A usable hosted-checkout
 * URL is the only success shape; the crafted not_configured /
 * coming-soon answers carry the server's plain-language message,
 * which is surfaced as-is. Anything else is a plain failure — the
 * caller never claims a purchase started without a URL.
 */
export function resolveMoonpaySessionOutcome(data: unknown): MoonpaySessionOutcome {
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const url = typeof record.url === "string" ? record.url : "";
  if (url) return { kind: "ready", url };
  const message =
    (typeof record.error === "string" && record.error) ||
    (typeof record.message === "string" && record.message) ||
    "";
  if (record.status === "not_configured") {
    return {
      kind: "not_configured",
      message:
        message ||
        "MoonPay is not connected yet — card purchases are unavailable until the MoonPay keys are added in Supabase. No money has moved.",
    };
  }
  if (record.status === "coming_soon" || record.status === "coming-soon") {
    return {
      kind: "coming_soon",
      message:
        message ||
        "Card purchases through MoonPay are available soon for this wallet — you can buy by card now in your self-custody wallet. No money has moved.",
    };
  }
  return {
    kind: "failed",
    message:
      message || "MoonPay could not start this purchase. No money was charged.",
  };
}
