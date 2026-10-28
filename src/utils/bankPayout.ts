// Bank withdrawal (payout) math + display — the client-side
// mirror of the server-side bank withdrawal path.
//
// The authoritative implementation is the bank-payout edge
// function on top of the reserve/transition RPCs
// (supabase/migrations/20261245_bank_withdrawals.sql): the RPC
// computes the fee from platform_settings.bank_payout_fee_percent,
// enforces the settings-driven minimum
// (bank_payout_min_zmw), and owns every state change. This module
// exists so the Wallet page can preview the exact same arithmetic
// and copy — the server never trusts the preview.
//
// The bank list and limits here MUST stay identical to
// supabase/functions/_shared/bank-payout.ts (the vitest suite pins
// them). ZMW is the ONLY bank-payout currency — Zambian banks are
// paid in kwacha; a USD wallet converts first, exactly the rule
// the PayPal surface states for its own ZMW gate.

import { roundMoney } from "./splitPayments";

/** Zambian banks a payout can be sent to (see the shared module). */
export interface ZambianBank {
  code: string;
  name: string;
}

export const ZAMBIAN_BANKS: readonly ZambianBank[] = [
  { code: "ZANACO", name: "Zanaco" },
  { code: "FNB", name: "FNB Zambia" },
  { code: "STANBIC", name: "Stanbic Bank" },
  { code: "ABSA", name: "Absa Bank Zambia" },
  { code: "SBZ", name: "Standard Chartered" },
  { code: "INDO", name: "Indo Zambia Bank" },
  { code: "ACCESS", name: "Access Bank Zambia" },
  { code: "ATLAS", name: "Atlas Mara (BancABC)" },
  { code: "UBA", name: "United Bank for Africa" },
  { code: "ZICB", name: "Zambia Industrial Commercial Bank" },
  { code: "FCB", name: "First Capital Bank" },
  { code: "ECOBANK", name: "Ecobank Zambia" },
  { code: "INVESTRUST", name: "Investrust Bank" },
  { code: "CAVMONT", name: "Cavmont Bank" },
];

/** Launch defaults — the settings row is authoritative (the
 *  bank-payout function's settings action); these are the
 *  fallbacks mirroring the migration's DEFAULTs. */
export const BANK_PAYOUT_MIN_ZMW_DEFAULT = 50;
export const BANK_PAYOUT_FEE_PERCENT_DEFAULT = 0;

/**
 * Rail-gate copy (migration 20261245): while
 * platform_settings.bank_payouts_enabled is off, the withdraw
 * form presents this activating state instead of the form, and
 * the bank-payout function refuses create before any reservation
 * with its own matching copy (BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE
 * in supabase/functions/_shared/bank-payout.ts).
 */
export const BANK_PAYOUTS_ACTIVATING_MESSAGE =
  "Bank withdrawals are being activated and aren't available yet. Your balance stays safely in your wallet — you can still save your bank account below, and withdrawals will open here as soon as activation completes.";

/**
 * The bank withdrawal fee on `amount` at `ratePercent`:
 * round(amount * rate / 100, 2), charged ON TOP — the bank
 * receives exactly `amount`; the wallet is debited amount + fee.
 */
export function computeBankPayoutFee(amount: number, ratePercent: number): number {
  if (!(amount > 0) || !(ratePercent > 0)) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

/** The masked form a user ever sees: all but the last four hidden. */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return `•••• ${trimmed.slice(-4)}`;
}

/**
 * Token-based account-name match (warning only, never a gate) —
 * the client mirror of the shared module's rule: every token of
 * the shorter name appearing in the longer counts as a match.
 */
export function bankAccountNameMatches(
  accountName: string | null | undefined,
  holderName: string | null | undefined,
): boolean {
  const tokens = (v: string | null | undefined) =>
    typeof v === "string"
      ? v.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1)
      : [];
  const a = tokens(accountName);
  const b = tokens(holderName);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((t) => longer.includes(t));
}

/** Honest, plain status labels for the withdrawal history. */
export const BANK_WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  pending_review: "Waiting for review",
  approved: "Approved — being paid to your bank",
  paid_out: "Paid to your bank account",
  rejected: "Not approved — money returned to your wallet",
  failed: "Couldn't be completed — money returned to your wallet",
};

export function bankWithdrawalStatusLabel(status: string): string {
  return BANK_WITHDRAWAL_STATUS_LABELS[status] ?? status;
}
