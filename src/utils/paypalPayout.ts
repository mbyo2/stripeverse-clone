// PayPal withdrawal (payout) math + display — the client-side
// mirror of the server-side withdrawal path.
//
// The authoritative implementation is the paypal-payout edge
// function on top of the reserve/refund/complete RPCs
// (supabase/migrations/20261024_paypal_withdrawals.sql): the RPC
// computes the fee from platform_settings.paypal_payout_fee_percent,
// enforces the provenance rule (you can withdraw to PayPal at most
// the PayPal-sourced portion of your balance — the mark follows the
// money when it's sent between users; the counter lives in
// paypal_provenance_balances, 20261028) and the limits. This module
// exists so the Wallet page can preview the exact same arithmetic
// and copy — the server never trusts the preview: it recomputes
// everything itself.
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

/**
 * The platform float (20261213): a USD withdrawal larger than the
 * user's PayPal-sourced mark can draw the remainder from the
 * platform's own PayPal money, capped by a super_admin-set allowance
 * (default 0). Client mirror of _shared/paypal-payout.ts — the
 * reserve RPC re-derives everything under lock; these exist so the
 * withdraw form can preview the same combined figure.
 */
export function floatAvailable(allowanceUsd: number, usedUsd: number): number {
  const allowance = Number.isFinite(allowanceUsd) ? allowanceUsd : 0;
  const used = Number.isFinite(usedUsd) ? usedUsd : 0;
  return Math.max(0, roundMoney(allowance - used));
}

export interface WithdrawalSplitPlan {
  ok: boolean;
  totalAvailable: number;
  provenancePart: number;
  floatPart: number;
}

/** Provenance is spent FIRST; the float covers only the remainder. */
export function planWithdrawalSplit(
  amount: number,
  provenanceAvail: number,
  floatAvail: number,
): WithdrawalSplitPlan {
  const provenance = Math.max(0, roundMoney(Number.isFinite(provenanceAvail) ? provenanceAvail : 0));
  const float = Math.max(0, roundMoney(Number.isFinite(floatAvail) ? floatAvail : 0));
  const totalAvailable = roundMoney(provenance + float);
  const amt = roundMoney(Number.isFinite(amount) ? amount : 0);
  const provenancePart = Math.min(amt, provenance);
  const floatPart = roundMoney(amt - provenancePart);
  return {
    ok: amt > 0 && amt <= totalAvailable,
    totalAvailable,
    provenancePart,
    floatPart,
  };
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
  "How withdrawals work: money that arrives via PayPal can be withdrawn back to PayPal — and it " +
  "keeps that right when it's sent between BMaGlass users, so whoever holds it can withdraw it " +
  "(from a USD wallet — PayPal doesn't pay out in ZMW). Money that arrived another way can be " +
  "withdrawn once other payout methods are live. Mobile money withdrawals are coming soon — " +
  "they aren't live yet.";
