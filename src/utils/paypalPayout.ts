// PayPal withdrawal (payout) math + display — the client-side
// mirror of the server-side withdrawal path.
//
// The authoritative implementation is the paypal-payout edge
// function on top of the reserve/refund/complete RPCs
// (supabase/migrations/20261024_paypal_withdrawals.sql): the RPC
// computes the fee from platform_settings.paypal_payout_fee_percent,
// enforces the provenance guardrail (you can withdraw to PayPal at
// most what PayPal paid into your wallets), and enforces the
// min/daily limits. This module exists so the Wallet page can
// preview the exact same arithmetic and copy — the server never
// trusts the preview: it recomputes everything itself.
//
// The currency list and limits here MUST stay identical to
// supabase/functions/_shared/paypal-payout.ts (the vitest suite
// pins them); ZMW is absent on purpose — PayPal cannot pay out in
// kwacha, and no code in this app may imply that it can.

import { roundMoney } from "./splitPayments";

/** Currencies PayPal Payouts can send (two-decimal codes only). */
export const PAYPAL_PAYOUT_CURRENCIES: readonly string[] = [
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

/** Per-payout minimum, in the payout currency's major units. */
export const PAYOUT_MIN_AMOUNT = 5;
/** Per-user, per-currency daily cap, in major units. */
export const PAYOUT_DAILY_LIMIT = 2000;

/** Launch payout-fee rate (%): 0 until the CEO sets one in
 *  platform_settings — mirrors the migration's DEFAULT 0. */
export const PAYPAL_PAYOUT_FEE_PERCENT_DEFAULT = 0;

export function isPayPalPayoutCurrency(currency: string | null | undefined): boolean {
  if (!currency) return false;
  return PAYPAL_PAYOUT_CURRENCIES.includes(currency.trim().toUpperCase());
}

/**
 * The withdrawal fee on `amount` at `ratePercent`:
 * round(amount * rate / 100, 2), charged ON TOP — the recipient
 * receives exactly `amount`; the wallet is debited amount + fee.
 */
export function computePayoutFee(amount: number, ratePercent: number): number {
  if (!(amount > 0) || !(ratePercent > 0)) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

/** Honest, plain status labels for the withdrawal history. */
export const PAYOUT_STATUS_LABELS: Record<string, string> = {
  pending: "Sending…",
  processing: "Processing — waiting for PayPal to confirm",
  completed: "Completed",
  failed: "Failed — money returned to your wallet",
};

export function payoutStatusLabel(status: string): string {
  return PAYOUT_STATUS_LABELS[status] ?? status;
}

/** Shown on ZMW (or other unsupported-currency) wallets — plainly,
 *  before the user can type an amount into a dead end. */
export const ZMW_PAYOUT_MESSAGE =
  "PayPal can't pay out in Zambian kwacha (ZMW), so PayPal withdrawals are made from a USD wallet. " +
  "Convert your balance to USD first (Multi-Currency page), then withdraw from that wallet.";

/**
 * The disclosure shown on the PayPal DEPOSIT surface, before any
 * money goes in: how funds that arrive via PayPal can leave again.
 */
export const PAYPAL_DEPOSIT_WITHDRAWAL_DISCLOSURE =
  "How withdrawals work: money you deposit here can be withdrawn back to PayPal from a USD wallet " +
  "(PayPal doesn't pay out in ZMW). Mobile money withdrawals are coming soon — they aren't live yet.";
