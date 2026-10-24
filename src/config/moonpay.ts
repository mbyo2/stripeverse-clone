// MoonPay on-ramp — client-side configuration.
//
// MoonPay is the card on-ramp for buying Bitcoin: the user pays by
// debit or credit card on MoonPay's hosted flow and the Bitcoin is
// delivered straight to their BMaGlass Bitcoin wallet deposit
// address. It is a different flow from the self-custody wallet's
// Breez/MoonPay buy (src/lib/selfcustody/spark.ts) — this one runs
// through our own MoonPay account, the `moonpay-session` /
// `moonpay-admin` edge functions and the `moonpay_transactions`
// ledger the backend worker owns.
//
// No MoonPay key ever reaches the browser except, potentially, the
// publishable key. The secret and webhook keys live only in
// Supabase function secrets, and the admin console only ever shows
// whether each key is set — never its value.
//
// Purchases are in USD: MoonPay does not support ZMW, so no surface
// may present MoonPay as a kwacha payment method.

/** platform_settings flag that switches the MoonPay rail on/off. */
export const MOONPAY_ENABLED_SETTING = "moonpay_enabled";

/** Purchases are made in this currency (MoonPay does not support ZMW). */
export const MOONPAY_FIAT_CURRENCY = "USD";

/** Title shown wherever the MoonPay card entry is offered. */
export const MOONPAY_CARD_TITLE = "Card (MoonPay)";

/** Label shown wherever MoonPay is offered while the gate is off. */
export const MOONPAY_COMING_SOON_LABEL = "Coming soon";

/** Plain copy for the MoonPay card entry on the Bitcoin buy area. */
export const MOONPAY_CARD_DESCRIPTION =
  "Buy Bitcoin with a debit or credit card, delivered straight to your wallet.";

/** The full copy shown while the rail is switched off. */
export const MOONPAY_COMING_SOON_COPY = `${MOONPAY_CARD_DESCRIPTION} ${MOONPAY_COMING_SOON_LABEL}.`;

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
        "Card purchases through MoonPay are coming soon. No money has moved.",
    };
  }
  return {
    kind: "failed",
    message:
      message || "MoonPay could not start this purchase. No money was charged.",
  };
}
