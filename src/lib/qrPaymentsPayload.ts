// BMaGlass payment-QR payload classification for the QR Payments
// scan tab.
//
// A scanned QR is untrusted text until it is classified here. This
// is the single classifier for the page's own codes: the JSON the
// Generate tab writes ({ platform: 'bmaglass', version, type,
// recipient, amount, currency, description, timestamp }). Anything
// else is either a non-BMaGlass code (shown back to the payer, never
// paid) or invalid (plain-language error, nothing filled in).
//
// Money-safety rules baked in here:
//   - Classification never pays anything. A valid code only fills
//     the review panel; the payer still confirms the amount and the
//     named recipient before any money moves.
//   - A code whose currency is not ZMW classifies as valid but the
//     page refuses to pay it: in-app QR payments settle in ZMW only.
//     That refusal lives in the page, keyed off the parsed payload.
//   - Amounts arrive as JSON numbers; a non-finite, zero or negative
//     amount is dropped to "no amount" (the payer types it) rather
//     than prefilled wrong.

export type BmaglassQrPayload = {
  type: "merchant_payment" | "p2p_transfer";
  recipient: string;
  amount: number | null;
  currency: string;
  description: string;
};

export type BmaglassQrResult =
  | { status: "valid"; payload: BmaglassQrPayload }
  | { status: "non-bmaglass"; raw: string }
  | { status: "invalid"; raw: string };

/** Classify raw scanned text into a BMaGlass payment code or a refusal. */
export function parseBmaglassQrPayment(raw: string): BmaglassQrResult {
  const text = raw.trim();
  if (!text) return { status: "invalid", raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "non-bmaglass", raw };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { status: "non-bmaglass", raw };
  }
  const p = parsed as Record<string, unknown>;
  if (p.platform !== "bmaglass") return { status: "non-bmaglass", raw };
  if (typeof p.recipient !== "string" || !p.recipient.trim()) {
    return { status: "invalid", raw };
  }
  const amount =
    typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount > 0
      ? p.amount
      : null;
  return {
    status: "valid",
    payload: {
      type: p.type === "merchant_payment" ? "merchant_payment" : "p2p_transfer",
      recipient: p.recipient.trim(),
      amount,
      currency: typeof p.currency === "string" && p.currency ? p.currency : "ZMW",
      description: typeof p.description === "string" ? p.description : "",
    },
  };
}
