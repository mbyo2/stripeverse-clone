// fee-math: the payment-link platform fee, computed ONE way
// everywhere it is shown or charged (CEO fee-bearer order, 2026-10-26).
//
// THE RULE — identical to the settlement RPC
// (execute_payment_link_settlement), which charges
//   fee = LEAST(round(price * rate / 100, 2), price)
// on Postgres numeric: round-half-up to whole ngwee (2dp), capped at
// the price. Quote, pay page and settlement must never disagree, so
// this module computes in integer ngwee with the rate as an exact
// decimal rational (parsed from its string form) — binary floats
// never get a vote (40.20 at 2.5% is exactly 1.005 in decimal, which
// rounds half-up to 1.01; in floats it is 1.00499999… and would
// wrongly round to 1.00).
//
// Free of Deno-specific APIs so the vitest suite can exercise the
// exact code the edge functions run (developer-webhooks pattern).

/** Parse a decimal string ("2.5", "2.55", "0.5", "10") into an exact
 *  rational { num, den }. Returns null for anything else. */
export function parseDecimalRational(
  raw: string,
): { num: number; den: number } | null {
  const t = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [intPart, fracPart = ""] = t.split(".");
  const den = 10 ** fracPart.length;
  const num = Number(intPart) * den + (fracPart ? Number(fracPart) : 0);
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return null;
  return { num, den };
}

/** round-half-up of a / b for non-negative safe integers. */
function roundHalfUpDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * The platform fee on `amount` at `ratePercent` — integer-ngwee
 * mirror of the SQL fee step. Amounts/rates outside the sane money
 * domain (non-positive amount, unparseable or non-positive rate)
 * yield 0, exactly as the RPC's skip rules produce no fee.
 */
export function platformFeeFor(amount: number, ratePercent: number | string): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const rate = parseDecimalRational(String(ratePercent));
  if (!rate || rate.num <= 0) return 0;
  const amountNgwee = Math.round(amount * 100);
  // fee = amount * rate / 100, in ngwee: amountNgwee * num / (den * 100)
  const feeNgwee = Math.min(
    roundHalfUpDiv(amountNgwee * rate.num, rate.den * 100),
    amountNgwee,
  );
  return feeNgwee / 100;
}

export type FeePayer = "seller" | "buyer";

export interface PaymentLinkAmounts {
  /** The link's price — what the payment is FOR. */
  price: number;
  /** The platform fee at the current rate. */
  fee_amount: number;
  /** Who bears the fee (the link's resolved, stored choice). */
  fee_payer: FeePayer;
  /** What the buyer actually pays: price (+ fee when buyer-pays). */
  buyer_total: number;
  /** What lands with the seller before their split rules: price
   *  (− fee when seller-pays). */
  seller_receives: number;
}

/** The full money picture of one payment of `amount` on a link whose
 *  fee-bearer is `feePayer`, at the platform's current rate. */
export function paymentLinkAmounts(
  amount: number,
  ratePercent: number | string,
  feePayer: FeePayer,
): PaymentLinkAmounts {
  const price = Math.round(amount * 100) / 100;
  const fee = platformFeeFor(price, ratePercent);
  const buyer_total = feePayer === "buyer" ? (Math.round(price * 100) + Math.round(fee * 100)) / 100 : price;
  const seller_receives = feePayer === "buyer" ? price : (Math.round(price * 100) - Math.round(fee * 100)) / 100;
  return { price, fee_amount: fee, fee_payer: feePayer, buyer_total, seller_receives };
}
