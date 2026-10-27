// selfcustody-sell: pure policy + math for SELF-CUSTODY sell-to-ZMW.
//
// Flow (see supabase/functions/btc-sell-selfcustody and migration
// 20261235): a self-custody (Spark) user creates a sell intent, which
// locks a quote (platform mid rate, 1.5% sell fee, ZMW due, expiry).
// The user then sends BTC from their self-custody wallet to the
// platform — their own custodial deposit address (on-chain rail) or a
// Lightning invoice the platform issued for the intent (Lightning
// rail). The EXISTING exactly-once deposit settlement credits the
// user's custodial BTC wallet first (btc_record_deposit /
// btc_settle_lightning_deposit — unchanged); the intent settlement
// (btc_settle_selfcustody_sell) then converts that credit to ZMW in
// one transaction. No parallel watcher exists.
//
// DOCUMENTED POLICY DECISIONS (tested below in spirit + in
// tests/selfcustody/sellToZmw.test.ts):
//  1. EXPIRY / GRACE: an intent gives the user INTENT_TTL_SECONDS
//     (30 minutes) to get the payment to the platform, plus a GRACE
//     of GRACE_SECONDS (60 minutes) after expiry. A deposit CREDITED
//     (on-chain: credited_at; Lightning: settled_at) at or before
//     expires_at + grace settles at the intent's LOCKED rate, even if
//     the conversion itself runs later. A deposit credited after the
//     grace deadline does NOT settle the intent: the intent expires
//     and the BTC stays as an ordinary custodial deposit credit,
//     which the user can sell at a fresh quote. The rate is never
//     silently re-quoted.
//  2. UNDER / OVER-PAYMENT: settlement is on the ACTUAL amount
//     received, priced at the locked rate with the same 1.5% fee —
//     never on the expected amount. A partial payment settles for
//     what arrived; an overpayment settles for what arrived (the
//     extra is sold too, at the locked rate). Nothing is refused
//     for a size mismatch, and nothing is credited that did not
//     arrive.
//  3. EXACTLY-ONCE: a deposit identity (on-chain txid+vout, or a
//     Lightning payment id) can settle at most one intent, and an
//     intent settles at most once — enforced by unique partial
//     indexes + the intent row lock in the settle RPC. Duplicate
//     deposit notifications / polls replay to the stored result.
//
// This module is dependency-free on purpose (no npm: specifiers, no
// Supabase import) so vitest can import it directly, like
// price-index.ts. The quote math mirrors quoteSellZmw in btc-core.ts
// EXACTLY (same floor-to-cents rule); the settle RPC mirrors it in
// SQL. The tests pin all three to the same numbers.

export const SELL_FEE_BPS = 150; // 1.5% — same as custodial sell (btc-trade TRADE_FEE_BPS default)
export const INTENT_TTL_SECONDS = 1800; // 30 minutes to send
export const GRACE_SECONDS = 3600; // +60 minutes for the deposit to be credited
export const MIN_SELL_SATS = 1000; // same floor as custodial sell (btc-trade MIN_SELL_SATS)
export const MAX_SELL_SATS = 100_000_000; // same cap as custodial sell

const SATS_PER_BTC = 100_000_000;

function floorToCents(x: number): number {
  return Math.floor((x + 1e-9) * 100) / 100;
}

export interface SellQuoteMath {
  /** Gross ZMW value at the mid rate, before the fee (2dp). */
  grossZmw: number;
  /** ZMW the user is credited (gross minus fee, floored to ngwee). */
  zmw: number;
  /** The fee's ZMW value (2dp). */
  feeZmw: number;
}

/**
 * Sell quote math — IDENTICAL to quoteSellZmw in btc-core.ts:
 * credited ZMW is the mid value minus the spread, FLOORED to whole
 * ngwee (rounding never creates value). Pure.
 */
export function sellQuoteMath(
  amountSats: number,
  midRateZmwPerBtc: number,
  feeBps: number = SELL_FEE_BPS,
): SellQuoteMath {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error("Invalid sell amount");
  }
  if (!(midRateZmwPerBtc > 0) || !Number.isFinite(midRateZmwPerBtc)) {
    throw new Error("Invalid sell rate");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error("Invalid sell fee");
  }
  const gross = (amountSats * midRateZmwPerBtc) / SATS_PER_BTC;
  const net = floorToCents(gross * (1 - feeBps / 10_000));
  const feeZmw = Math.round((gross - net) * 100) / 100;
  return { grossZmw: Math.round(gross * 100) / 100, zmw: net, feeZmw };
}

/**
 * Sats needed to net at least `targetZmw` after the fee at the given
 * rate (for the "sell by ZMW amount" entry mode). Ceiled, so the
 * locked quote for the returned sats nets at least the target.
 * Pure.
 */
export function satsForTargetZmw(
  targetZmw: number,
  midRateZmwPerBtc: number,
  feeBps: number = SELL_FEE_BPS,
): number {
  if (!(targetZmw > 0) || !(midRateZmwPerBtc > 0)) {
    throw new Error("Invalid target or rate");
  }
  const effectiveRate = midRateZmwPerBtc * (1 - feeBps / 10_000);
  return Math.ceil((targetZmw * SATS_PER_BTC) / effectiveRate);
}

export type SellIntentStatus =
  | "awaiting"
  | "settled"
  | "expired"
  | "cancelled";

export interface SellIntentLike {
  status: SellIntentStatus;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
  graceSeconds: number;
}

/** The last moment a deposit may be CREDITED and still settle at the locked rate. */
export function settleDeadline(intent: SellIntentLike): number {
  return new Date(intent.expiresAt).getTime() + intent.graceSeconds * 1000;
}

/**
 * POLICY 1 (expiry/grace): a deposit credited at or before
 * expires_at + grace settles at the locked rate. Credited later, it
 * does not settle this intent. Pure.
 */
export function settlesAtLockedRate(
  intent: SellIntentLike,
  depositCreditedAt: string | Date,
): boolean {
  const credited =
    depositCreditedAt instanceof Date
      ? depositCreditedAt.getTime()
      : new Date(depositCreditedAt).getTime();
  if (!Number.isFinite(credited)) return false;
  return credited <= settleDeadline(intent);
}

/** An awaiting intent is expired once `now` passes its settle deadline. Pure. */
export function isIntentExpired(intent: SellIntentLike, now: Date = new Date()): boolean {
  if (intent.status !== "awaiting") return false;
  return now.getTime() > settleDeadline(intent);
}

export type SellPhase =
  | "awaiting" // no deposit seen yet
  | "received" // a deposit was detected but is not credited yet (confirming / unpaid poll)
  | "settled" // ZMW credited — terminal
  | "expired" // past the settle deadline unsettled — terminal
  | "cancelled"; // user cancelled before sending — terminal

/**
 * The user-facing tracker phase, derived from the intent row plus
 * whether a matching deposit has been DETECTED (seen on-chain / the
 * invoice exists) but not yet CREDITED. Settlement itself is atomic
 * (credited deposit → conversion in one RPC), so "received" is only
 * ever the pre-credit state. Pure.
 */
export function sellPhase(
  intent: SellIntentLike,
  depositDetectedUncredited: boolean,
  now: Date = new Date(),
): SellPhase {
  if (intent.status === "settled") return "settled";
  if (intent.status === "cancelled") return "cancelled";
  if (intent.status === "expired") return "expired";
  if (isIntentExpired(intent, now)) return "expired";
  return depositDetectedUncredited ? "received" : "awaiting";
}

export const SELL_PHASE_COPY: Record<SellPhase, string> = {
  awaiting:
    "Waiting for your Bitcoin to arrive. Send it to the address or invoice below — this page updates on its own.",
  received:
    "Your Bitcoin has been seen and is confirming. Your ZMW is credited as soon as it is fully received.",
  settled: "Settled — the ZMW is in your platform ZMW wallet.",
  expired:
    "This sell expired before the Bitcoin was fully received. Any Bitcoin that did arrive stays in your custodial Bitcoin wallet — you can sell it from there at a fresh quote.",
  cancelled: "This sell was cancelled. Nothing was sent or credited for it.",
};

export interface DepositCandidate {
  txid: string;
  vout: number;
  amountSats: number;
  status: "detected" | "credited";
  createdAt: string;
}

/**
 * Choose which credited deposit settles an intent when several
 * unbound deposits exist after the intent was created: an
 * exact-amount match wins; otherwise the EARLIEST credited deposit
 * (settle-on-actual makes any of them honest, and earliest-first is
 * deterministic). Detected-but-uncredited deposits never settle.
 * Pure.
 */
export function pickSettlingDeposit(
  candidates: DepositCandidate[],
  expectedSats: number,
): DepositCandidate | null {
  const credited = candidates
    .filter((c) => c.status === "credited")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (credited.length === 0) return null;
  return credited.find((c) => c.amountSats === expectedSats) ?? credited[0];
}
