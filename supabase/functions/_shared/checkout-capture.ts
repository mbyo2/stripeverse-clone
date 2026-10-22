// Pure decision logic for PayPal CHECKOUT payments (the orders that
// `process-payment` creates), as opposed to wallet deposits.
//
// Deliberately pure — no imports, no Deno APIs, no fetch — so the
// vitest suite exercises the exact code the edge functions run (same
// pattern as _shared/deposit-capture.ts and
// _shared/payment-providers.ts). The capture verification itself
// (amount/currency/status) is NOT re-implemented here: it reuses
// verifyCapture / planCompletion from deposit-capture.ts, because the
// money rule is identical — a wallet may be credited only from a
// COMPLETED capture that exactly matches the pending row recorded at
// order creation.
//
// What lives here is the part that is specific to checkout orders:
// deciding, at order-creation time, whether a PayPal order may be
// created at all, and on what terms. A checkout payment settles to a
// MERCHANT (a different user from the payer), so an order without a
// named merchant can never settle — creating it anyway would take a
// customer to PayPal for a payment nobody can receive. The honest
// behaviour is to refuse up front, which is what parseCheckoutTerms
// encodes.

/** The settlement terms a checkout order is created under. */
export interface CheckoutOrderTerms {
  /** Platform user id of the merchant who will be settled. */
  merchantUserId: string;
  /** Merchant's settlement account id; null = their Main account. */
  accountId: string | null;
  /** https-only post-approval landing URL, or null. */
  returnUrl: string | null;
  /** https-only cancellation landing URL, or null. */
  cancelUrl: string | null;
}

export type CheckoutTermsResult =
  | { ok: true; terms: CheckoutOrderTerms }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a canonical UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Returns the value unchanged only when it is a well-formed https
 * URL; null otherwise. Identical bar to wallet-deposit's sanitiser:
 * the codebase has no origin allowlist for PayPal flows, so https +
 * parseable blocks scheme injection (javascript:, data:, http
 * downgrade) without inventing a host policy the platform does not
 * have. An unsanitised value is DROPPED, never forwarded to PayPal.
 */
export function sanitizeCheckoutRedirectUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate the metadata a caller attached to a process-payment
 * request and extract the checkout settlement terms.
 *
 * Rules (any violation refuses the order BEFORE PayPal is touched —
 * no order, no charge, no pending row):
 *   - metadata.merchant_user_id is required and must be a UUID: the
 *     payment settles to that user's wallet, and an order that cannot
 *     name its merchant can never settle.
 *   - The merchant cannot be the payer (a user "paying" their own
 *     checkout settles nothing and would only confuse the ledger).
 *   - metadata.account_id is optional (null = Main account); when
 *     present it must be a UUID. Ownership (that the account belongs
 *     to the merchant) is checked against the database by the caller —
 *     it cannot be decided purely.
 *   - return_url / cancel_url are sanitised to https-only; invalid
 *     values are dropped to null rather than failing the payment,
 *     mirroring wallet-deposit.
 */
export function parseCheckoutTerms(
  metadata: unknown,
  payerUserId: string,
): CheckoutTermsResult {
  const meta = asRecord(metadata);

  const merchantUserId = meta?.merchant_user_id;
  if (!isUuid(merchantUserId)) {
    return {
      ok: false,
      error:
        "A merchant must be named for a PayPal checkout payment (metadata.merchant_user_id), so the payment can settle to their wallet.",
    };
  }
  if (merchantUserId.toLowerCase() === payerUserId.toLowerCase()) {
    return {
      ok: false,
      error: "The merchant of a checkout payment cannot be its payer.",
    };
  }

  const rawAccountId = meta?.account_id ?? null;
  if (rawAccountId !== null && !isUuid(rawAccountId)) {
    return {
      ok: false,
      error: "metadata.account_id must be a valid account id when provided.",
    };
  }

  return {
    ok: true,
    terms: {
      merchantUserId,
      accountId: rawAccountId,
      returnUrl: sanitizeCheckoutRedirectUrl(meta?.return_url),
      cancelUrl: sanitizeCheckoutRedirectUrl(meta?.cancel_url),
    },
  };
}
