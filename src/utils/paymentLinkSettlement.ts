// Pure helpers for payment-link settlement (Phase 1.5).
//
// A payment link names a settlement account — payment_links.account_id,
// where NULL means the owner's Main account. These helpers are the
// client-side mirror of the rules execute_payment_link_settlement
// enforces in the database; they exist so the UI can label targets and
// pre-validate before the (authoritative) server call, and so the logic
// is unit-testable without a browser or a database.

import type { AccountRow } from "./accountGrouping";
import { computePlatformFee } from "./splitPayments";

export type LinkPaymentMethod = "wallet" | "card" | "mobile_money" | "bank";

export interface PaymentLinkLike {
  /** Fixed amount, or null when the payer chooses. */
  amount: number | null;
  currency: string;
  /** Link owner's user id. */
  user_id: string;
  /** Settlement target account id; null/undefined = Main account. */
  account_id?: string | null;
}

/**
 * Display label for a link's settlement target: "Main account" when the
 * link settles to Main, the sub-account's name when set, and a neutral
 * fallback when the account row isn't available (e.g. it was renamed
 * away from the local cache) — never a guessed name.
 */
export function settlementTargetLabel(
  accountId: string | null | undefined,
  accounts: Pick<AccountRow, "id" | "name">[],
): string {
  if (!accountId) return "Main account";
  const account = accounts.find((a) => a.id === accountId);
  return account ? account.name : "Sub-account";
}

/**
 * The amount a payment must be: the link's fixed amount always wins;
 * otherwise the payer-entered amount. Returns null when there is no
 * usable amount (empty, non-numeric, zero or negative).
 */
export function resolveLinkAmount(
  link: Pick<PaymentLinkLike, "amount">,
  customAmount: string | number | null | undefined,
): number | null {
  if (link.amount != null) {
    return link.amount > 0 ? link.amount : null;
  }
  const parsed = typeof customAmount === "string" ? Number(customAmount) : customAmount;
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** The fee fields of a payment link, as the checkout function's
 *  describe action reports them (and as the dashboard stores them). */
export interface LinkFeeFields {
  /** Who funds the platform fee: the link's stored, seller-chosen
   *  value, enforced server-side at settlement. */
  fee_payer?: string | null;
  /** Server-computed fee for a fixed-price link; null when the
   *  price is not fixed yet (any-amount link). */
  fee_amount?: number | null;
  /** The platform's current link fee rate (%), for live breakdowns
   *  on any-amount links. */
  fee_rate_percent?: number | null;
}

export interface LinkFeeBreakdown {
  price: number;
  fee: number;
  total: number;
}

/**
 * Fee-bearer display truth for the public pay page: on a buyer-pays
 * link the buyer funds the platform fee, so the page shows
 * price + fee = total BEFORE paying. Fixed-price links take the
 * server's computed fee; any-amount links compute it live with the
 * same single fee rule the settlement charges (computePlatformFee).
 * Seller-pays links return null — the page shows the single total,
 * exactly as it always has. A describe payload that omits the fee
 * fields also returns null, which is why the describe contract is
 * pinned by tests alongside this helper: no fields, no breakdown.
 */
export function feeBreakdownForLink(
  link: (PaymentLinkLike & LinkFeeFields) | null | undefined,
  priceAmount: number,
): LinkFeeBreakdown | null {
  if (!link || link.fee_payer !== "buyer" || !(priceAmount > 0)) return null;
  const fee = link.amount != null && link.fee_amount != null
    ? link.fee_amount
    : computePlatformFee(priceAmount, link.fee_rate_percent ?? 0);
  return {
    price: priceAmount,
    fee,
    total: Math.round((priceAmount + fee) * 100) / 100,
  };
}

/**
 * Pre-flight validation for a link payment, mirroring the server rules.
 * Returns a user-presentable error string, or null when the payment may
 * proceed to the server (which re-checks everything and is the only
 * authority — balance, caps and account status live there).
 */
export function validateLinkPayment(input: {
  link: PaymentLinkLike;
  amount: number | null;
  method: LinkPaymentMethod;
  /** Signed-in payer's user id, or null for a guest. */
  payerId: string | null;
}): string | null {
  const { link, amount, method, payerId } = input;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return "Enter a valid amount";
  }
  if (link.amount != null && amount !== link.amount) {
    return `This link requires a payment of exactly ${link.currency} ${link.amount.toFixed(2)}`;
  }
  if (method === "wallet") {
    if (!payerId) {
      return "Sign in with your BMaGlass account to pay from your wallet balance";
    }
    if (payerId === link.user_id) {
      return "You cannot pay your own payment link";
    }
  }
  return null;
}

/** Accounts a link may settle into: anything except a closed account. */
export function selectableSettlementAccounts<T extends Pick<AccountRow, "status">>(
  accounts: T[],
): T[] {
  return accounts.filter((a) => a.status !== "closed");
}
