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
 * at all, and this platform's PayPal rail settles USD wallets only
 * (the PayPal precedent the Stripe rail mirrors). A deposit aimed at
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
