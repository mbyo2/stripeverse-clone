// Pure decision logic for PayPal WITHDRAWALS (payouts).
//
// Shared by the `paypal-payout` edge function (create / status /
// list) and the `paypal-webhook` payout backstop. Deliberately pure —
// no imports, no Deno APIs, no fetch — so the vitest suite exercises
// the exact code the edge functions run (same pattern as
// _shared/deposit-capture.ts).
//
// The money rules this module encodes:
//   - A payout may be created ONLY in a currency PayPal actually
//     pays out in. ZMW is not one of them — there is no code path
//     here, in the function, or in the UI that implies a direct
//     ZMW -> PayPal payout.
//   - PROVENANCE (CEO compliance guardrail, 2026-10-22): a user may
//     withdraw to PayPal at most what PayPal itself paid INTO their
//     wallets, minus what they have already withdrawn to PayPal.
//     The authoritative sums are computed inside the
//     reserve_paypal_withdrawal RPC (see the 20261024 migration);
//     this module carries the same arithmetic for previews and for
//     the function's fast, honest refusal copy.
//   - Finalization is a one-way state machine: pending/processing
//     may become completed (PayPal says the item SUCCEEDED) or
//     failed+refunded (PayPal says it FAILED / was RETURNED /
//     DENIED). Terminal states never move again, so webhook +
//     polling replays are no-ops — refunds happen exactly once
//     because the refund RPC owns the transition.

/** This platform's own lifecycle for a withdrawal row. */
export type PayoutStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Currencies PayPal Payouts can send, restricted to the long-standing
 * two-decimal codes this platform might plausibly hold wallets in.
 * PayPal's full payout list is longer; codes with special amount
 * formatting (zero-decimal currencies such as JPY or HUF) are
 * deliberately EXCLUDED so every amount here formats as "12.34".
 * ZMW is NOT a PayPal payout currency at all — that is the whole
 * reason this gate exists.
 */
export const PAYPAL_PAYOUT_CURRENCIES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "MXN",
  "PLN",
  "CZK",
];

/** Per-payout minimum, in the payout currency's major units. */
export const PAYOUT_MIN_AMOUNT = 5;
/** Per-user, per-currency daily cap, in major units. */
export const PAYOUT_DAILY_LIMIT = 2000;

export function isPayPalPayoutCurrency(currency: unknown): boolean {
  if (typeof currency !== "string") return false;
  return PAYPAL_PAYOUT_CURRENCIES.includes(currency.trim().toUpperCase());
}

export function normalizeCurrency(currency: unknown): string {
  return typeof currency === "string" ? currency.trim().toUpperCase() : "";
}

/** Round to 2dp the way the SQL round(x, 2) does for these magnitudes. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The platform payout fee: a percent of the payout amount, charged ON
 * TOP (the recipient gets the full amount; the sender is debited
 * amount + fee) — the same shape as the Send Money fee. The rate
 * comes from platform_settings.paypal_payout_fee_percent, whose
 * DEFAULT is 0 until the CEO sets a commercial rate.
 */
export function computePayoutFee(amount: number, ratePercent: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

/** PayPal money values travel as strings with exactly 2 decimals. */
export function formatPayPalMoney(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

/** A plain, conservative email shape check (PayPal validates the rest). */
export function isPlausibleEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
    && !/\s/.test(trimmed);
}

// ── Provenance guardrail ─────────────────────────────────────────────

/**
 * How much more this user may withdraw to PayPal in one currency:
 * completed PayPal-sourced credits (computed by the RPC from the
 * ledger: payment_method 'paypal', status 'completed', metadata.kind
 * 'wallet_deposit' or 'checkout_payment') minus their PayPal
 * withdrawals that are not failed/refunded. Never negative.
 */
export function provenanceAvailable(
  completedPayPalCredits: number,
  activePayPalWithdrawals: number,
): number {
  const credits = Number.isFinite(completedPayPalCredits) ? completedPayPalCredits : 0;
  const withdrawn = Number.isFinite(activePayPalWithdrawals) ? activePayPalWithdrawals : 0;
  return Math.max(0, roundMoney(credits - withdrawn));
}

export type ProvenancePlan =
  | { ok: true; available: number }
  | { ok: false; available: number };

/** Decide whether a payout of `amount` fits inside the provenance cap. */
export function planProvenance(
  amount: number,
  completedPayPalCredits: number,
  activePayPalWithdrawals: number,
): ProvenancePlan {
  const available = provenanceAvailable(completedPayPalCredits, activePayPalWithdrawals);
  return roundMoney(amount) <= available ? { ok: true, available } : { ok: false, available };
}

/** The honest refusal copy the CEO approved the shape of. */
export function provenanceRefusalMessage(available: number, currency: string): string {
  return (
    `You can withdraw up to ${formatPayPalMoney(available)} ${normalizeCurrency(currency)} to PayPal — ` +
    "that's what you've deposited via PayPal. Money that arrived another way can be sent to other " +
    "BMaGlass users, converted, or withdrawn once other payout methods are live."
  );
}

// ── Payout creation payload ──────────────────────────────────────────

export interface PayoutRequestInput {
  /** The withdrawal row's own id — batch id AND item id (traceability). */
  withdrawalId: string;
  recipientEmail: string;
  amount: number;
  currency: string;
}

/**
 * The POST /v1/payments/payouts body. sender_batch_id and
 * sender_item_id are BOTH the withdrawal's own id: PayPal dedupes a
 * retried batch on sender_batch_id, and every payout item is
 * traceable back to its withdrawal row and ledger history.
 */
export function buildPayoutRequest(input: PayoutRequestInput) {
  const currency = normalizeCurrency(input.currency);
  return {
    sender_batch_header: {
      sender_batch_id: input.withdrawalId,
      email_subject: "You have a payout from BMaGlass Pay",
      email_message:
        "Your BMaGlass Pay withdrawal has been sent to this PayPal account.",
    },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: input.recipientEmail.trim(),
        amount: {
          value: formatPayPalMoney(input.amount),
          currency_code: currency,
        },
        sender_item_id: input.withdrawalId,
        note: `BMaGlass Pay withdrawal ${input.withdrawalId}`,
      },
    ],
  };
}

// ── Payout state reading + finalization ──────────────────────────────

export interface PayoutItemState {
  payoutItemId: string | null;
  /** PayPal's transaction_status for the item (SUCCESS, FAILED, …). */
  transactionStatus: string | null;
  /** PayPal's own transaction id for the completed payout, if any. */
  transactionId: string | null;
  errorName: string | null;
  errorMessage: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Pull OUR item out of a GET /v1/payments/payouts/{batch_id}
 * response (or out of the POST response, which has the same shape).
 * Matched by sender_item_id === withdrawalId; a single-item batch
 * falls back to its only item. Returns null when PayPal's answer
 * carries no usable item — callers treat that as "still processing",
 * never as success or failure.
 */
export function extractPayoutItem(
  batchResponse: unknown,
  withdrawalId: string,
): PayoutItemState | null {
  const root = asRecord(batchResponse);
  if (!root) return null;
  const items = Array.isArray(root.items) ? root.items : [];
  let chosen: Record<string, unknown> | null = null;
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const payoutItem = asRecord(item.payout_item);
    if (payoutItem && payoutItem.sender_item_id === withdrawalId) {
      chosen = item;
      break;
    }
  }
  if (!chosen && items.length === 1) chosen = asRecord(items[0]);
  if (!chosen) return null;

  const errors = asRecord(chosen.errors);
  return {
    payoutItemId: stringOrNull(chosen.payout_item_id),
    transactionStatus: stringOrNull(chosen.transaction_status)?.toUpperCase() ?? null,
    transactionId: stringOrNull(chosen.transaction_id),
    errorName: errors ? stringOrNull(errors.name) : null,
    errorMessage: errors ? stringOrNull(errors.message) : null,
  };
}

/** Batch-level status from a payouts response (PENDING, DENIED, …). */
export function extractBatchStatus(batchResponse: unknown): string | null {
  const root = asRecord(batchResponse);
  const header = root ? asRecord(root.batch_header) : null;
  return header ? stringOrNull(header.batch_status)?.toUpperCase() ?? null : null;
}

export type PayoutFinalization = "complete" | "refund" | "none";

/** Item states after which the money is gone for good — refund the user. */
const REFUND_ITEM_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "BLOCKED",
  "RETURNED",
  "REFUNDED",
  "REVERSED",
  "DENIED",
]);

/**
 * The finalization state machine, shared by the status action and
 * the webhook. Terminal local states (completed / failed) never move
 * again — that is what makes finalization idempotent and refunds
 * exactly-once (the refund itself is additionally guarded inside
 * the refund RPC). UNCLAIMED is deliberately NOT a refund trigger:
 * PayPal holds unclaimed payouts for up to 30 days and then returns
 * them, at which point the item turns RETURNED and we refund.
 */
export function planPayoutFinalization(
  currentStatus: string,
  itemStatus: string | null,
  batchStatus?: string | null,
): PayoutFinalization {
  if (currentStatus === "completed" || currentStatus === "failed") return "none";
  if (batchStatus === "DENIED") return "refund";
  if (!itemStatus) return "none";
  if (itemStatus === "SUCCESS") return "complete";
  if (REFUND_ITEM_STATUSES.has(itemStatus)) return "refund";
  return "none";
}

/** Plain-language failure reason for a refunded withdrawal. */
export function payoutFailureReason(item: PayoutItemState | null): string {
  if (item?.errorMessage) return item.errorMessage;
  switch (item?.transactionStatus) {
    case "FAILED":
      return "PayPal could not complete this payout.";
    case "BLOCKED":
      return "PayPal blocked this payout.";
    case "RETURNED":
      return "The payout was not claimed and PayPal returned it.";
    case "REFUNDED":
    case "REVERSED":
      return "PayPal reversed this payout.";
    case "DENIED":
      return "PayPal denied this payout.";
    default:
      return "PayPal could not complete this payout.";
  }
}

// ── Synchronous POST failure classification ──────────────────────────

export type PayoutPostFailure =
  | { kind: "not_enabled" }
  | { kind: "insufficient_funds" }
  | { kind: "rejected"; message: string };

/**
 * Classify a non-2xx POST /v1/payments/payouts answer. The one that
 * matters most commercially: a 403 means the platform's PayPal
 * account is not enabled for Payouts (or the API caller lacks the
 * payout permission) — the user must hear "not available yet", never
 * a raw PayPal error and never a fake success.
 */
export function classifyPayoutPostFailure(
  httpStatus: number,
  body: unknown,
): PayoutPostFailure {
  const record = asRecord(body);
  const name = record ? stringOrNull(record.name)?.toUpperCase() ?? "" : "";
  const message = record ? stringOrNull(record.message) ?? "" : "";
  if (
    httpStatus === 403 ||
    name === "AUTHORIZATION_ERROR" ||
    name === "PERMISSION_DENIED" ||
    name === "NOT_AUTHORIZED"
  ) {
    return { kind: "not_enabled" };
  }
  if (name === "INSUFFICIENT_FUNDS" || /insufficient/i.test(message)) {
    return { kind: "insufficient_funds" };
  }
  return {
    kind: "rejected",
    message: message || "PayPal rejected this payout request.",
  };
}

// ── Webhook resource extraction ──────────────────────────────────────

/**
 * Webhook payloads are only ever a TRIGGER (the deposit pattern):
 * these extractors pull candidate ids out of a payouts event
 * resource, and finalization always re-reads the truth from
 * PayPal's API. PAYMENT.PAYOUTSBATCH.* resources nest the id under
 * batch_header; PAYMENT.PAYOUTS-ITEM.* resources carry
 * payout_batch_id / payout_item_id at the top level.
 */
export function payoutBatchIdFromWebhookResource(resource: unknown): string | null {
  const record = asRecord(resource);
  if (!record) return null;
  const header = asRecord(record.batch_header);
  return (
    (header ? stringOrNull(header.payout_batch_id) : null) ??
    stringOrNull(record.payout_batch_id)
  );
}

export function payoutItemIdFromWebhookResource(resource: unknown): string | null {
  const record = asRecord(resource);
  if (!record) return null;
  return stringOrNull(record.payout_item_id) ?? stringOrNull(record.id);
}

/**
 * Item events carry the full payout_item, whose sender_item_id is
 * OUR withdrawal id (see buildPayoutRequest). This is the recovery
 * path for a creation POST whose response never reached us: the
 * first webhook event reattaches the withdrawal to its PayPal batch.
 */
export function payoutSenderItemIdFromWebhookResource(resource: unknown): string | null {
  const record = asRecord(resource);
  if (!record) return null;
  const item = asRecord(record.payout_item);
  return item ? stringOrNull(item.sender_item_id) : null;
}

/** Event types that can finalize a withdrawal. */
export const PAYOUT_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
]);
