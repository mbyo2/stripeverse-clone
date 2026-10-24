// fiat-amount: the ONE validator for fiat money amounts entering the
// platform (Final-QA FIX-1, 2026-10-24).
//
// The bug: atomic-transfer accepted 10.001 ZMW. The sender was debited
// 10.001 + fee (a 3-decimal balance in a 2dp currency) while the
// recipient was credited a rounded 10.00 — value destroyed and both
// balances corrupted. Every fiat entry point now funnels through here.
//
// Rule: a fiat amount must be a positive, finite number with AT MOST
// TWO decimal places (whole ngwee / cents). Anything else is REFUSED —
// never rounded, never truncated. Rounding is how the bug happened.
//
// Accepted: 10, 10.5, 10.50, "10.00", " 10.00 ", "1e2" (= 100).
// Refused: 10.001, 10.005, 0, -5, NaN, Infinity, "abc", "1,000.00",
// "", null, undefined, objects, booleans.
//
// The decimal-place check is done on the value's shortest decimal
// string form (expanding scientific notation), NOT on `n * 100`
// float arithmetic: 10.005 is stored as 10.00499999… in binary, so a
// float check can wave it through; its decimal form "10.005" cannot
// be miscounted. This module is import-free so the vitest suite can
// transpile-test the byte-identical source (pos-core pattern).

export interface FiatAmountOk {
  ok: true;
  amount: number;
}
export interface FiatAmountErr {
  ok: false;
  error: string;
}
export type FiatAmountResult = FiatAmountOk | FiatAmountErr;

export const FIAT_DECIMAL_PLACES_ERROR =
  "Amounts must be in whole ngwee — enter an amount with no more than two decimal places, like 10.00 or 10.50.";
export const FIAT_POSITIVE_ERROR = "Enter an amount greater than zero.";

const PLAIN_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Count the decimal places in the shortest string form of a finite
 * number, expanding scientific notation ("1.5e-3" → 4 places).
 * Returns null when the text is not a plain decimal literal.
 */
export function decimalPlacesOf(text: string): number | null {
  const t = text.trim();
  if (!PLAIN_DECIMAL.test(t)) return null;
  const [mantissa, expText] = t.split(/[eE]/);
  const exp = expText ? Number.parseInt(expText, 10) : 0;
  const dot = mantissa.indexOf(".");
  const fracDigits = dot === -1 ? 0 : mantissa.length - dot - 1;
  const places = fracDigits - exp;
  return places < 0 ? 0 : places;
}

/** True when `raw` is a usable fiat amount within (0, max]. */
export function validateFiatAmount(
  raw: unknown,
  max = 1_000_000,
): FiatAmountResult {
  let n: number;
  let text: string;
  if (typeof raw === "number") {
    n = raw;
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim();
    if (!PLAIN_DECIMAL.test(text)) {
      return { ok: false, error: FIAT_POSITIVE_ERROR };
    }
    n = Number(text);
  } else {
    return { ok: false, error: FIAT_POSITIVE_ERROR };
  }
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: FIAT_POSITIVE_ERROR };
  }
  const places = decimalPlacesOf(text);
  if (places === null || places > 2) {
    return { ok: false, error: FIAT_DECIMAL_PLACES_ERROR };
  }
  if (n > max) {
    return {
      ok: false,
      error: `Amount exceeds the limit of ${max.toLocaleString("en-GB")} for a single payment.`,
    };
  }
  // Normalise to the exact 2dp double (10 → 10, "10.50" → 10.5).
  return { ok: true, amount: Math.round(n * 100) / 100 };
}

/** Nullable convenience wrapper (pos-core style call sites). */
export function parseFiatAmount(raw: unknown, max = 1_000_000): number | null {
  const r = validateFiatAmount(raw, max);
  return r.ok ? r.amount : null;
}
