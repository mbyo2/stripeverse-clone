// Mastercard Move — pure request / decision logic shared by the
// `mastercard-move` edge function and the vitest suite.
//
// Deliberately pure (no imports, no Deno APIs, no fetch) so tests
// exercise the exact code the edge function runs — the repo pattern
// from _shared/payment-providers.ts and _shared/deposit-capture.ts.
//
// What this module encodes:
//   * The exact provider URLs from the gateway brief (§1.2 Send,
//     §1.2A Cross-Border Services), switched by MASTERCARD_ENV.
//   * The admin gate decision (admin OR super_admin — nothing else).
//   * The idempotency rule for payments: a transaction_reference is
//     generated (or accepted from the caller's idempotency key)
//     BEFORE any provider call, persisted first, and REUSED on every
//     retry. A retry must never mint a second reference for the same
//     payment intent — that is what would double-pay.
//   * Crafted, plain-language error copy for every provider failure
//     (CEO error-presentation rule: never a raw system response).

export type MastercardEnv = "sandbox" | "production";
export type DestinationType = "bank" | "mobile_money" | "card" | "cash_pickup";

export interface MastercardMoveConfig {
  env: MastercardEnv;
  consumerKey: string | null;
  signingKeyPem: string | null;
  /** Issued production IDs; null in sandbox (stubs accept a placeholder). */
  sendPartnerId: string | null;
  xbsPartnerId: string | null;
}

/**
 * Sandbox placeholder partner id. Brief §1.2: the Send static sandbox
 * accepts any 32-character partnerId; §1.2A: the XBS sandbox stubs
 * answer without a real (issued) Partner ID. Production NEVER uses
 * this — see resolvePartnerId.
 */
export const SANDBOX_PARTNER_ID = "sandbox0000000000000000000000000"; // 32 chars

export function resolvePartnerId(
  config: MastercardMoveConfig,
  rail: "send" | "xbs",
): string | null {
  const issued = rail === "send" ? config.sendPartnerId : config.xbsPartnerId;
  if (issued && issued.trim().length > 0) return issued.trim();
  if (config.env === "sandbox") return SANDBOX_PARTNER_ID;
  return null; // production without an issued ID is not configured
}

export function isConfigured(config: MastercardMoveConfig): boolean {
  return Boolean(config.consumerKey && config.signingKeyPem);
}

/** Roles allowed to use the Mastercard Move surface at all. */
export function isMastercardAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function hasMastercardAdmin(roles: Array<string | null | undefined>): boolean {
  return roles.some((r) => isMastercardAdminRole(r));
}

export const ADMIN_REFUSAL_MESSAGE =
  "Cross-border payouts are not available yet — this feature is being prepared and is currently open to administrators only.";

export const NOT_CONFIGURED_MESSAGE =
  "Cross-border payouts are not configured on this platform yet. Please try again later.";

// ---------------------------------------------------------------------------
// Provider URLs (exact, from gateway-integrations-api-brief.md)
// ---------------------------------------------------------------------------

export function sendDisbursementUrl(config: MastercardMoveConfig, partnerId: string): string {
  if (config.env === "production") {
    return `https://api.move.mastercard.com/send/v1/partners/${partnerId}/disbursements/payment`;
  }
  // Brief §1.2: static sandbox is the only Send sandbox reachable
  // before Delivery-Manager MTF configuration.
  return `https://sandbox.api.move.mastercard.com/send/static/v1/partners/${partnerId}/disbursements/payment`;
}

export function sendStatusUrl(
  config: MastercardMoveConfig,
  partnerId: string,
  disbursementReference: string,
): string {
  const base = sendDisbursementUrl(config, partnerId);
  return `${base}?disbursement_reference=${encodeURIComponent(disbursementReference)}`;
}

export function xbsQuotesUrl(config: MastercardMoveConfig, partnerId: string): string {
  const host = config.env === "production" ? "https://api.mastercard.com" : "https://sandbox.api.mastercard.com";
  return `${host}/send/v1/partners/${partnerId}/crossborder/quotes`;
}

export function xbsPaymentUrl(config: MastercardMoveConfig, partnerId: string): string {
  const host = config.env === "production" ? "https://api.mastercard.com" : "https://sandbox.api.mastercard.com";
  return `${host}/send/v1/partners/${partnerId}/crossborder/payment`;
}

export function xbsPaymentStatusUrl(
  config: MastercardMoveConfig,
  partnerId: string,
  paymentId: string,
): string {
  const host = config.env === "production" ? "https://api.mastercard.com" : "https://sandbox.api.mastercard.com";
  return `${host}/send/v1/partners/${partnerId}/crossborder/${encodeURIComponent(paymentId)}`;
}

export function xbsAccountsUrl(config: MastercardMoveConfig, partnerId: string): string {
  const host = config.env === "production" ? "https://api.mastercard.com" : "https://sandbox.api.mastercard.com";
  // Brief §1.2A: balances live on /send/partners/{id}/crossborder/accounts
  // (no /v1 segment on this resource).
  return `${host}/send/partners/${partnerId}/crossborder/accounts?include_balance=true`;
}

// ---------------------------------------------------------------------------
// Idempotency — the transaction reference
// ---------------------------------------------------------------------------

/**
 * Resolve the transaction_reference for a payment attempt.
 *
 * The rule that prevents double-paying:
 *   1. If a row already exists for this payment intent (looked up by
 *      the caller-supplied idempotency key, or by a reference the
 *      caller is retrying with), REUSE its reference — never mint.
 *   2. Else, if the caller supplied an idempotency key, derive the
 *      reference deterministically from it (same key ⇒ same
 *      reference, even across processes).
 *   3. Else mint a fresh reference from the injected generator.
 *
 * `existingReference` is the persisted row's reference (or null);
 * `generate` is only invoked in case 3.
 */
export function resolveTransactionReference(input: {
  existingReference: string | null;
  suppliedReference: string | null;
  idempotencyKey: string | null;
  generate: () => string;
}): string {
  if (input.existingReference && input.existingReference.trim().length > 0) {
    return input.existingReference;
  }
  if (input.suppliedReference && input.suppliedReference.trim().length > 0) {
    return input.suppliedReference.trim();
  }
  if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
    return deriveReferenceFromIdempotencyKey(input.idempotencyKey.trim());
  }
  return input.generate();
}

/** Deterministic, URL-safe reference derived from an idempotency key. */
export function deriveReferenceFromIdempotencyKey(key: string): string {
  // FNV-1a 32-bit over the key, twice with different seeds, gives a
  // stable 16-hex-char suffix — enough to make the same key resolve
  // to the same reference everywhere without a shared store lookup.
  const hash = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `bmg-${hash(0x811c9dc5)}${hash(0x1000193)}`;
}

/**
 * A Mastercard Send disbursement_reference must be 6–40 chars
 * (brief §1.2). Our references satisfy that by construction; this
 * validator is the belt-and-braces check before any provider call.
 */
export function isValidTransactionReference(ref: string): boolean {
  return typeof ref === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(ref);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface QuoteInput {
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationCountry: string;
  destinationType: DestinationType;
  paymentType?: string;
}

export function buildXbsQuoteBody(input: QuoteInput): Record<string, unknown> {
  return {
    payment_type: input.paymentType ?? "P2P",
    sender_amount: {
      amount: input.amount.toFixed(2),
      currency: input.sourceCurrency.toUpperCase(),
    },
    destination_country: input.destinationCountry.toUpperCase(),
    destination_currency: input.destinationCurrency.toUpperCase(),
    destination_payment_instrument: destinationInstrument(input.destinationType),
  };
}

export function destinationInstrument(type: DestinationType): string {
  switch (type) {
    case "bank":
      return "BANK_ACCOUNT";
    case "mobile_money":
      return "MOBILE_MONEY";
    case "card":
      return "CARD";
    case "cash_pickup":
      return "CASH_PICKUP";
  }
}

export interface PaymentInput extends QuoteInput {
  transactionReference: string;
  proposalId: string | null;
  recipientName: string;
  recipientAccount: string;
}

export function buildXbsPaymentBody(input: PaymentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transaction_reference: input.transactionReference,
    payment_type: input.paymentType ?? "P2P",
    sender_amount: {
      amount: input.amount.toFixed(2),
      currency: input.sourceCurrency.toUpperCase(),
    },
    destination_country: input.destinationCountry.toUpperCase(),
    destination_currency: input.destinationCurrency.toUpperCase(),
    destination_payment_instrument: destinationInstrument(input.destinationType),
    recipient: {
      name: input.recipientName,
      account_uri: input.recipientAccount,
    },
  };
  if (input.proposalId) body.proposal_id = input.proposalId;
  return body;
}

export function buildSendDisbursementBody(input: PaymentInput): Record<string, unknown> {
  return {
    payment_disbursement: {
      disbursement_reference: input.transactionReference,
      amount: input.amount.toFixed(2),
      currency: input.destinationCurrency.toUpperCase(),
      recipient_account_uri: input.recipientAccount,
      recipient: { name: input.recipientName },
      payment_type: "DISBURSEMENT",
      funding_source: "DEBIT",
    },
  };
}

// ---------------------------------------------------------------------------
// Provider responses → our status + crafted errors
// ---------------------------------------------------------------------------

/** Append one entry to a row's raw status history (immutable append). */
export function appendStatusHistory(
  history: unknown,
  entry: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const prior = Array.isArray(history) ? (history as Array<Record<string, unknown>>) : [];
  return [...prior, entry];
}

/**
 * Map a provider HTTP outcome to the crafted message a user may see.
 * Raw provider bodies are NEVER surfaced (CEO error rule) — they are
 * stored in the row's status history for admins to inspect instead.
 */
export function craftedProviderError(httpStatus: number): string {
  if (httpStatus === 401 || httpStatus === 403) {
    return "Mastercard refused our platform credentials for this request. The payment was not sent — please let an administrator know.";
  }
  if (httpStatus === 404) {
    return "Mastercard could not find that payment. It may not have been created — check the payment list before trying again.";
  }
  if (httpStatus === 422 || httpStatus === 400) {
    return "Mastercard could not accept those payment details. Check the amount, currency and recipient details, then try again.";
  }
  if (httpStatus >= 500) {
    return "Mastercard is having trouble right now. The payment has been saved — check its status before trying again, so it is not sent twice.";
  }
  return "The payment could not be completed. It has been saved — check its status before trying again.";
}

/** Normalise a provider status string into our row status vocabulary. */
export function normaliseProviderStatus(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toUpperCase();
  if (["APPROVED", "COMPLETED", "SUCCESS", "PAID"].includes(s)) return "completed";
  if (["DECLINED", "FAILED", "REJECTED", "CANCELLED", "CANCELED"].includes(s)) return "failed";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "UNKNOWN"].includes(s)) return "pending";
  return s.toLowerCase();
}

/**
 * Redact a recipient account reference before persistence: card PANs
 * and account numbers are stored last-4 only. Mobile-money numbers
 * (phone-shaped) are contact data the admin entered for the payout;
 * they are kept, because the payout cannot be reconciled without
 * them — but a `pan:` account URI is reduced to its last 4 digits.
 */
export function redactRecipientAccount(account: string): string {
  if (typeof account !== "string") return "";
  const panMatch = account.match(/pan:(\d{12,19})/i);
  if (panMatch) {
    return account.replace(panMatch[1], `****${panMatch[1].slice(-4)}`);
  }
  if (/^\d{13,19}$/.test(account.trim())) {
    return `****${account.trim().slice(-4)}`;
  }
  return account;
}
