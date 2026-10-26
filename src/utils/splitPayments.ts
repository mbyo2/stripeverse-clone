// Split-payment leg math — the client-side mirror of the execution
// rules implemented authoritatively in SQL by
// supabase/migrations/20261022_split_payments_execution.sql and
// supabase/migrations/20261022_split_platform_fee.sql
// (inside execute_payment_link_settlement). The database function is
// the source of truth for real money; this module exists so the Split
// Payments page can explain and sanity-check a user's rules with the
// exact same arithmetic, and so the algorithm is pinned by unit tests.
//
// The algorithm (both implementations agree):
//   - FIRST, the platform fee: BMaGlass Pay takes
//     round(amount * rate / 100, 2), capped at the amount, where the
//     rate is platform_settings.split_platform_fee_percent (2.5% at
//     launch). The server skips the fee when the rate is <= 0, when
//     no platform operator exists, or when the link owner IS the
//     platform operator — the preview cannot know those cases, so it
//     shows the standard fee.
//   - Then the owner's rules apply in the order given (the server
//     orders by created_at, then id — the UI passes its rules in that
//     same order), against what the fee left behind.
//   - A percentage leg is a share of the ORIGINAL payment amount,
//     rounded to 2 decimal places.
//   - A flat leg is its configured value.
//   - Every leg is capped at what remains of the payment, so fee +
//     legs can never sum to more than the payment; the owner keeps
//     the rest.
//   - Rules with a value <= 0 are inert.
// Legs whose recipient cannot be resolved to a BMaGlass wallet are
// skipped by the SERVER (resolution needs auth data the client cannot
// see), so this mirror takes an `executable` flag per rule: the page
// cannot know resolution results, so its previews pass executable=true
// and describe the result as the maximum the rules would divert.

export interface SplitRuleLike {
  id: string;
  split_type: string; // 'percentage' | 'flat'
  split_value: number;
  /** False when the leg is known not to execute (server skips it too). */
  executable?: boolean;
}

export interface SplitLeg {
  ruleId: string;
  amount: number;
}

export interface SplitPreview {
  platformFee: number;
  legs: SplitLeg[];
  ownerKeeps: number;
}

/** Round to 2dp, half-up — mirrors Postgres round(numeric, 2) for the
 *  non-negative money values involved here. */
export function roundMoney(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

/**
 * The platform fee on a payment of `amount` at `ratePercent`:
 * round(amount * rate / 100, 2), capped at the payment itself.
 * A rate of 0 (or less) means no fee.
 */
export function computePlatformFee(amount: number, ratePercent: number): number {
  if (!(amount > 0) || !(ratePercent > 0)) return 0;
  return Math.min(roundMoney((amount * ratePercent) / 100), roundMoney(amount));
}

export interface PaymentLinkNet {
  platformFee: number;
  sellerReceives: number;
}

/**
 * What the owner of a payment link receives from one payment of
 * `amount`: the payment minus the platform fee, BEFORE any of the
 * owner's split rules divide it further (the Split Payments page
 * explains that second step, and its preview starts from this same
 * figure). The Payment Links page discloses this at creation time —
 * before this, the fee was visible only after the fact in the
 * transaction history, so a seller's first warning was a K2.00 link
 * payment landing as K1.95 (Wave B QA, 2026-10-24). Mirrors the fee
 * step of execute_payment_link_settlement in SQL exactly; the
 * server-side exceptions noted in the module header (rate <= 0,
 * no platform operator, owner IS the operator) mean the disclosed
 * figure is the standard case.
 */
export function computePaymentLinkNet(amount: number, ratePercent: number): PaymentLinkNet {
  const platformFee = computePlatformFee(amount, ratePercent);
  const sellerReceives = amount > 0 ? roundMoney(roundMoney(amount) - platformFee) : 0;
  return { platformFee, sellerReceives };
}

/** Who funds the payment-link platform fee (CEO order, 2026-10-26):
 *  "seller" — it comes out of what the seller receives (the original
 *  behaviour); "buyer" — it is added on top of the price, so the
 *  seller receives the full price. The choice is the merchant's
 *  account setting (profiles.payment_link_fee_payer, set in Settings
 *  → Payment); each link stores its resolved value
 *  (payment_links.fee_payer), and settlement enforces the stored
 *  value — nothing can change it at pay time. */
export type FeePayer = "seller" | "buyer";

export interface PaymentLinkBreakdown {
  /** The link's price — what the payment is FOR. */
  price: number;
  /** The platform fee at the given rate (computePlatformFee). */
  platformFee: number;
  /** What the buyer actually pays: price (+ fee when buyer-pays). */
  buyerPays: number;
  /** What lands with the seller before their split rules run:
   *  the full price when buyer-pays, price − fee when seller-pays. */
  sellerReceives: number;
}

/**
 * The full money picture of one payment-link payment for the given
 * fee-bearer. The fee itself is computePlatformFee — the same single
 * rule the settlement charges (round-half-up to whole ngwee, capped
 * at the price); only WHO funds it changes between the two modes.
 * Seller-pays at K100 / 2.5%: buyer pays K100.00, seller gets K97.50.
 * Buyer-pays: buyer pays K102.50, seller receives exactly K100.00.
 */
export function computePaymentLinkBreakdown(
  amount: number,
  ratePercent: number,
  feePayer: FeePayer,
): PaymentLinkBreakdown {
  const price = amount > 0 ? roundMoney(amount) : 0;
  const platformFee = computePlatformFee(price, ratePercent);
  return {
    price,
    platformFee,
    buyerPays: feePayer === "buyer" ? roundMoney(price + platformFee) : price,
    sellerReceives: feePayer === "buyer" ? price : roundMoney(price - platformFee),
  };
}

/** Shared leg loop: percentages are shares of `amount` (the ORIGINAL
 *  payment), capped at a remainder that starts at `startingRemaining`. */
function computeLegsFrom(
  amount: number,
  rules: SplitRuleLike[],
  startingRemaining: number,
): { legs: SplitLeg[]; ownerKeeps: number } {
  const legs: SplitLeg[] = [];
  let remaining = roundMoney(startingRemaining);
  if (!(remaining > 0)) return { legs, ownerKeeps: 0 };

  for (const rule of rules) {
    if (remaining <= 0) break;
    if (!(rule.split_value > 0)) continue;
    if (rule.executable === false) continue;

    const raw =
      rule.split_type === "percentage"
        ? roundMoney((amount * rule.split_value) / 100)
        : rule.split_value;
    const leg = Math.min(raw, remaining);
    if (!(leg > 0)) continue;

    legs.push({ ruleId: rule.id, amount: leg });
    remaining = roundMoney(remaining - leg);
  }

  return { legs, ownerKeeps: remaining };
}

/**
 * Compute the legs a payment of `amount` produces under `rules`.
 * Returns the executed legs and what the owner keeps.
 */
export function computeSplitLegs(
  amount: number,
  rules: SplitRuleLike[],
): { legs: SplitLeg[]; ownerKeeps: number } {
  if (!(amount > 0)) return { legs: [], ownerKeeps: 0 };
  return computeLegsFrom(amount, rules, amount);
}

/**
 * The full settlement preview the server will execute: the platform
 * fee comes off first, then the owner's rules run against what is
 * left. platformFee + legs + ownerKeeps always equals the payment.
 */
export function computeSplitPreview(
  amount: number,
  rules: SplitRuleLike[],
  platformFeeRatePercent: number,
): SplitPreview {
  const platformFee = computePlatformFee(amount, platformFeeRatePercent);
  if (!(amount > 0)) return { platformFee: 0, legs: [], ownerKeeps: 0 };
  const { legs, ownerKeeps } = computeLegsFrom(amount, rules, amount - platformFee);
  return { platformFee, legs, ownerKeeps };
}

/**
 * Total percentage committed by a set of rules (flat rules excluded).
 * When `platformFeeRatePercent` is given, the platform fee is included
 * — it is committed on every settlement before any rule runs.
 */
export function committedPercentage(
  rules: SplitRuleLike[],
  platformFeeRatePercent = 0,
): number {
  const rulesPct = rules
    .filter((r) => r.split_type === "percentage" && r.split_value > 0)
    .reduce((sum, r) => sum + r.split_value, 0);
  return rulesPct + (platformFeeRatePercent > 0 ? platformFeeRatePercent : 0);
}

/**
 * A plain-language warning when the rules deserve one, else null.
 * Percentages above 100% are not an error — later rules simply receive
 * only what remains — but the owner should be told that before relying
 * on every rule paying out in full. The platform fee counts toward the
 * total: it is taken first, so it is part of what a payment commits.
 */
export function splitRulesWarning(
  rules: SplitRuleLike[],
  platformFeeRatePercent = 0,
): string | null {
  const pct = committedPercentage(rules, platformFeeRatePercent);
  if (pct > 100) {
    const lead =
      platformFeeRatePercent > 0
        ? `Your percentage rules plus the ${platformFeeRatePercent}% BMaGlass Pay platform fee (taken first, before your rules) add up to ${pct}%`
        : `Your percentage rules add up to ${pct}%`;
    return (
      `${lead}, more than a whole payment. ` +
      "Rules are paid in the order they were created, so later rules only " +
      "receive whatever is left — they may get less than their full share, or nothing."
    );
  }
  return null;
}
