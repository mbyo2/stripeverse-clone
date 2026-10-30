// link-btc: pure math + state logic for paying a payment link with
// Bitcoin from ANY external wallet ("Pay with Bitcoin" on /pay/:code).
//
// Deliberately free of Deno APIs / imports (BigInt + plain functions
// only) so the vitest suite exercises the exact code the edge
// functions run — the same pattern as _shared/btc-core.ts and
// _shared/developer-webhooks.ts.
//
// THE MONEY RULES (deterministic, whole sats, no floats near money):
//   - A payment attempt LOCKS its rate at creation: `rateCents` is
//     the fiat price of 1 BTC in integer minor units (e.g. ngwee).
//     The fiat value of the payment is computed at the LOCKED rate,
//     never at the arrival-time rate.
//   - amount_sats = ceil(fiat / rate × 1e8): the quoted sats always
//     COVER the full fiat amount at the locked rate (the payer never
//     under-covers the price by a rounding hair; the excess is < 1
//     sat of value).
//   - The platform fee mirrors the fiat settlement exactly: the fee
//     is the platform_settings percentage (default 2.5%) OF THE FIAT
//     AMOUNT, rounded half-up to whole minor units exactly as the
//     fiat RPC rounds it (round(amount × pct / 100, 2)), then
//     converted to sats at the locked rate with the same ceil rule.
//   - fee_payer (resolved from the link / merchant setting at
//     creation; 'seller' is the platform default):
//       seller → the payer is asked for amount_sats; the fee comes
//                out of the proceeds.
//       buyer  → the payer is asked for amount_sats + fee_sats; the
//                merchant nets the full amount's sats.
//     Either way the settlement split is identical:
//       merchant_credit = received_sats − fee_sats
//       platform_fee    = fee_sats
//     Overpayment (received > required) belongs to the merchant: it
//     rides on top of merchant_credit untouched — the fee is only
//     ever computed on the link amount, never on the excess.
export const LINK_BTC_ATTEMPT_WINDOW_MINUTES = 60;
/** Fiat major units → integer minor units (ngwee/cents). Amounts are
 *  validated whole-minor before this is called; Math.round only
 *  absorbs binary representation error. */
export function fiatToMinor(amount) {
    return Math.round(amount * 100);
}
/** Fiat-per-BTC rate (major units, ≤2dp as the platform's sources
 *  publish it) → integer minor units per BTC. */
export function rateToMinor(rateFiatPerBtc) {
    return Math.round(rateFiatPerBtc * 100);
}
function ceilDiv(a, b) {
    return (a + b - 1n) / b;
}
/** Sats covering `minor` fiat minor-units at `rateMinor` per BTC. */
export function satsForFiatMinor(minor, rateMinor) {
    if (!Number.isInteger(minor) || minor <= 0)
        throw new Error("amount must be positive");
    if (!Number.isInteger(rateMinor) || rateMinor <= 0)
        throw new Error("rate must be positive");
    const sats = ceilDiv(BigInt(minor) * 100000000n, BigInt(rateMinor));
    if (sats > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error("quoted sats out of range");
    return Number(sats);
}
/** The platform fee on a fiat amount, in fiat minor units — the same
 *  value the fiat settlement computes (round half-up to whole minor). */
export function feeFiatMinor(amountMinor, feePercent) {
    if (!Number.isFinite(feePercent) || feePercent < 0)
        throw new Error("invalid fee percent");
    const bps = BigInt(Math.round(feePercent * 100));
    // round half-up: floor((amount × bps + 5000) / 10000)
    return Number((BigInt(amountMinor) * bps + 5000n) / 10000n);
}
export function quoteLinkBtc(input) {
    const amountMinor = fiatToMinor(input.fiatAmount);
    const rateMinor = rateToMinor(input.rateFiatPerBtc);
    const amountSats = satsForFiatMinor(amountMinor, rateMinor);
    const feeMinor = feeFiatMinor(amountMinor, input.feePercent);
    const feeSats = feeMinor > 0 ? satsForFiatMinor(feeMinor, rateMinor) : 0;
    const requiredSats = input.feePayer === "buyer"
        ? amountSats + feeSats
        : amountSats;
    return {
        amountSats,
        feeSats,
        requiredSats,
        feeFiat: feeMinor / 100,
    };
}
/** The settlement split for a settled attempt. feeSats is the
 *  attempt's locked fee; it is only ever charged on a completed
 *  settlement, and the overpayment excess is never fee'd. */
export function splitLinkBtcSettlement(receivedSats, feeSats) {
    const fee = Math.max(0, Math.min(feeSats, receivedSats));
    return { merchantCreditSats: receivedSats - fee, platformFeeSats: fee };
}
// ── Provider-deduction tolerance (protection P1, 2026-10-26) ─────────
//
// The Lightning leg's invoice is fixed-amount: the provider reports
// what ACTUALLY arrived (`received`). Today that receive is free
// (Coinos takes 0% on Lightning receives), but if the provider ever
// starts deducting a fee on receives, an exact-equality settle rule
// would strand a paid invoice one sat short forever. The tolerance
// below settles such an attempt on the ACTUAL received sats:
//
//   shortfall = requiredSats − receivedSats
//   BAND: shortfall ≤ floor(requiredSats × 1%) AND ≤ 100 sats.
//
// Within the band the shortfall is absorbed by the PLATFORM side,
// out of its fee, first: platformFee = max(0, feeSats − shortfall),
// merchant = received − platformFee. Because the locked fee is
// 2.5% of the amount and the band is 1% of required, the shortfall
// is smaller than the fee on every real quote, so the merchant nets
// EXACTLY what an undeducted settlement would have paid them — in
// buyer mode the full amount's sats, in seller mode amount − fee —
// and only the platform's take shrinks. (If a pathological fee of 0
// ever met a deduction, the residual beyond the fee would come off
// the merchant: the formula degrades gracefully and never credits
// more than actually arrived.)
//
// Below the band the receipt is a genuine underpayment: it is NOT
// recorded against the attempt, the attempt stays open, and the
// payer's existing top-up behaviour applies (any leg can complete
// the quote; expiry close-out handles what was credited on-chain).
//
// The SQL settlement RPC mirrors splitLinkBtcSettlementOnReceived
// exactly; the record RPC re-validates the band server-side.
/** Widest provider deduction (percent of required sats) the platform
 *  absorbs out of its fee on a Lightning receipt. */
export const PROVIDER_DEDUCTION_BAND_PERCENT = 1;
/** Absolute cap (sats) on an absorbable provider deduction. */
export const PROVIDER_DEDUCTION_BAND_MAX_SATS = 100;
/** The absorbable shortfall for a quote of `requiredSats`. */
export function providerDeductionBandSats(requiredSats) {
    if (!Number.isInteger(requiredSats) || requiredSats <= 0)
        return 0;
    return Math.min(Math.floor((requiredSats * PROVIDER_DEDUCTION_BAND_PERCENT) / 100), PROVIDER_DEDUCTION_BAND_MAX_SATS);
}
/** Classify what the provider reports for a fixed-amount invoice. */
export function classifyLightningReceipt(requiredSats, receivedSats) {
    if (!Number.isInteger(receivedSats) || receivedSats <= 0)
        return "none";
    if (receivedSats >= requiredSats)
        return "full";
    const shortfall = requiredSats - receivedSats;
    return shortfall <= providerDeductionBandSats(requiredSats)
        ? "absorbed"
        : "underpaid";
}
/** The settlement split when a provider deduction (or any shortfall
 *  `shortfallSats` = required − received, ≥ 0) was absorbed: the
 *  platform's fee shrinks by the shortfall first; the merchant is
 *  made whole whenever the shortfall fits inside the fee. Never
 *  credits more than `receivedSats` in total. */
export function splitLinkBtcSettlementOnReceived(receivedSats, feeSats, shortfallSats) {
    const fee = Math.max(0, Math.min(feeSats, Math.max(0, receivedSats)) - Math.max(0, shortfallSats));
    return {
        merchantCreditSats: Math.max(0, receivedSats) - fee,
        platformFeeSats: fee,
    };
}
// ── Minimum Bitcoin link amount (protection P2a, 2026-10-26) ────────
//
// Every attempt mints a fresh address and its receipts become small
// UTXOs in the pooled custodial wallet; below a floor the coin a
// payment leaves behind costs more to spend later than the payment
// is worth (gas audit row 4). Attempts below the configured minimum
// fiat amount (platform_settings.btc_link_min_amount, in the LINK's
// currency; default 5.00) are refused server-side at creation with a
// crafted message — wallet payment for small links is untouched.
/** True when a link amount falls below the Bitcoin minimum. */
export function btcLinkBelowMinimum(fiatAmount, minAmount) {
    if (!Number.isFinite(fiatAmount) || !Number.isFinite(minAmount))
        return false;
    if (minAmount <= 0)
        return false; // a zero/negative setting disables the floor
    return fiatAmount < minAmount;
}
/**
 * Map a stored attempt to the state the payer page renders. The
 * caller runs lazy transitions (settle / expire / partial-finalize)
 * BEFORE mapping, so a stored 'settled' is the only way to reach
 * 'paid' from money movement; this function additionally treats a
 * fully-covered attempt as 'detected' (settlement in flight) rather
 * than ever showing 'underpaid' for a complete payment.
 */
export function linkBtcDisplayState(attempt, now = new Date()) {
    if (attempt.status === "settled")
        return "paid";
    if (attempt.status === "partial_credited")
        return "partial_credited";
    if (attempt.status === "failed")
        return "failed";
    const expired = attempt.status === "expired" ||
        now.getTime() > new Date(attempt.expiresAt).getTime();
    if (expired) {
        if (attempt.receivedSats >= attempt.requiredSats && attempt.requiredSats > 0) {
            return "detected"; // fully covered; settlement is being applied
        }
        return attempt.receivedSats > 0 ? "partial_credited" : "expired";
    }
    if (attempt.receivedSats >= attempt.requiredSats && attempt.requiredSats > 0) {
        return "detected"; // covered; settlement lands momentarily
    }
    if (attempt.receivedSats > 0)
        return "underpaid";
    if (attempt.seenSats > 0)
        return "detected";
    return "waiting";
}
/** BIP21 payment URI for the on-chain leg (amount in BTC, ≤8dp). */
export function bip21Uri(address, sats) {
    const whole = Math.floor(sats / 100_000_000);
    const frac = sats % 100_000_000;
    const amount = frac === 0
        ? `${whole}`
        : `${whole}.${`${frac}`.padStart(8, "0").replace(/0+$/, "")}`;
    return `bitcoin:${address}?amount=${amount}`;
}
/** Format sats as a BTC decimal string for display (8dp, trimmed). */
export function satsToBtcString(sats) {
    const sign = sats < 0 ? "-" : "";
    const abs = Math.abs(sats);
    const whole = Math.floor(abs / 100_000_000);
    const frac = abs % 100_000_000;
    if (frac === 0)
        return `${sign}${whole}`;
    return `${sign}${whole}.${`${frac}`.padStart(8, "0").replace(/0+$/, "")}`;
}
