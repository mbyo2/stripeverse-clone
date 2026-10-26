// Provider routing decisions shared by the `process-payment` and
// `payment-link-checkout` edge functions.
//
// This module is deliberately pure (no imports, no Deno APIs) so the
// vitest suite can exercise the exact code the edge functions run.
//
// The rule it encodes: this platform has exactly ONE real external
// gateway wired today — PayPal (credentials in function secrets). Every
// other provider that older code "processed" with a random success roll
// (MTN / Airtel / Zamtel / Visa / Mastercard) has no live gateway behind
// it, so the only honest answer is a `not_configured` state. Nothing in
// here may ever report a payment as completed: completion only exists
// after a gateway capture (PayPal) or an atomic wallet settlement (the
// execute_*_transfer / execute_payment_link_settlement RPCs).

export interface ProviderEnv {
  /** True when PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are both set. */
  paypalConfigured: boolean;
}

export type ProviderRoute =
  | { kind: "paypal" }
  | { kind: "not_configured"; error: string };

const NOT_CONFIGURED_MESSAGES: Record<string, string> = {
  mtn: "MTN mobile money is not enabled yet — no live mobile-money gateway is connected to this platform.",
  airtel: "Airtel Money is not enabled yet — no live mobile-money gateway is connected to this platform.",
  zamtel: "Zamtel Kwacha is not enabled yet — no live mobile-money gateway is connected to this platform.",
  mobile: "Mobile money is not enabled yet — no live mobile-money gateway is connected to this platform.",
  mobile_money: "Mobile money is not enabled yet — no live mobile-money gateway is connected to this platform.",
  visa: "Card processing is not configured on this platform yet.",
  mastercard: "Card processing is not configured on this platform yet.",
  card: "Card processing is not configured on this platform yet.",
  bank: "Bank transfer processing is not configured on this platform yet.",
  bank_transfer: "Bank transfer processing is not configured on this platform yet.",
  ussd: "USSD payments are not enabled yet — no telco gateway is connected to this platform.",
  wallet: "Wallet balance movements are handled by the transfer flow, not the payment processor.",
  deposit: "Deposits are handled by the wallet deposit flow, not the payment processor.",
};

/** Decide what `process-payment` may do with a provider name. */
export function classifyProvider(provider: string, env: ProviderEnv): ProviderRoute {
  const p = (provider || "").trim().toLowerCase();
  if (p === "paypal") {
    if (env.paypalConfigured) return { kind: "paypal" };
    return {
      kind: "not_configured",
      error: "PayPal is not configured on this platform yet.",
    };
  }
  const known = NOT_CONFIGURED_MESSAGES[p];
  if (known) return { kind: "not_configured", error: known };
  return {
    kind: "not_configured",
    error: `Payment provider "${provider}" is not supported.`,
  };
}

/**
 * The PayPal deposit gate on currency. PayPal does not support ZMW
 * at all, and this platform's PayPal rail settles USD wallets only.
 * A deposit aimed at
 * a non-USD wallet can therefore never succeed — refuse it up front
 * with the reason, instead of round-tripping to PayPal and handing
 * the user a generic late failure (found live 2026-10-26: a ZMW
 * wallet deposit travelled to PayPal, was rejected there, and came
 * back as "could not create this deposit"). Returns the refusal
 * message, or null when the currency may proceed.
 */
export function paypalDepositCurrencyRefusal(currency: string): string | null {
  const c = (currency || "").trim().toUpperCase();
  if (c === "USD") return null;
  return "PayPal deposits are in US dollars only — choose your USD wallet to deposit by PayPal.";
}

/**
 * Currencies a PayPal ORDER may be created in on this platform
 * (audit D3, 2026-10-26). One allowlist, enforced up front at every
 * order-creation site (process-payment, wallet-deposit via the
 * stricter USD-only deposit gate above, and the subscription flow
 * in paypal-checkout) — before it existed, each site kept its own
 * list, two of them included ZMW, and process-payment silently
 * defaulted a missing currency to "ZMW": orders PayPal could only
 * reject after a round-trip, because ZMW is not a PayPal currency
 * at all. The set is the two-decimal major currencies this platform
 * can settle into a same-currency wallet; zero-decimal currencies
 * (JPY, HUF, …) are deliberately excluded so every amount here
 * formats as "12.34", the same reasoning as PAYPAL_PAYOUT_CURRENCIES.
 */
export const PAYPAL_ORDER_CURRENCIES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "MXN",
  "PLN",
  "CZK",
];

/** Up-front refusal for a PayPal order in a currency we cannot settle. */
export function paypalOrderCurrencyRefusal(currency: string): string | null {
  const c = (currency || "").trim().toUpperCase();
  if (PAYPAL_ORDER_CURRENCIES.includes(c)) return null;
  if (c === "ZMW") {
    return "PayPal can't take Zambian kwacha (ZMW) — PayPal payments are made in US dollars or another major currency. Choose a USD amount to pay by PayPal.";
  }
  if (!c) {
    return "Choose a currency for this PayPal payment — PayPal payments are made in US dollars or another major currency, not kwacha.";
  }
  return `PayPal payments aren't supported in ${c} on this platform — use US dollars or another major currency instead.`;
}

export type LinkPaymentMethod = "wallet" | "card" | "mobile_money" | "bank";

export type LinkMethodRoute =
  | { kind: "wallet" }
  | { kind: "not_configured"; error: string };

const LINK_METHOD_MESSAGES: Record<string, string> = {
  card: "Card payments are not enabled for payment links yet. If you have a BMaGlass account, sign in and pay from your wallet balance instead.",
  mobile_money: "Mobile money payments are not enabled for payment links yet. If you have a BMaGlass account, sign in and pay from your wallet balance instead.",
  bank: "Bank transfer payments are not enabled for payment links yet. If you have a BMaGlass account, sign in and pay from your wallet balance instead.",
};

/** Decide what `payment-link-checkout` may do with a payment method. */
export function classifyLinkMethod(method: string): LinkMethodRoute {
  const m = (method || "").trim().toLowerCase();
  if (m === "wallet") return { kind: "wallet" };
  const known = LINK_METHOD_MESSAGES[m];
  if (known) return { kind: "not_configured", error: known };
  return {
    kind: "not_configured",
    error: `Payment method "${method}" is not supported for payment links.`,
  };
}
