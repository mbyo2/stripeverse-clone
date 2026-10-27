// Shared request/response logic for the DIRECT telco rails in the
// mobile-money edge function (MTN MoMo + Airtel Money). Pure and
// import-free so the vitest suite pins the exact contract the Deno
// function speaks.
//
// Contract (all actions POST paymentMethod: "mobile-money"):
//   provider: "mtn" | "airtel" (aliases mtn_momo / airtel_money …)
//   action:
//     "collection"          — start a deposit (provider prompts the
//                             subscriber; ledger-first, our reference
//                             is the provider idempotency anchor).
//                             Body: amount, phoneNumber,
//                             idempotencyKey (required), wallet_id?
//     "collection-status"   — re-query + settle a collection.
//                             Body: reference.
//     "disbursement"        — start a withdrawal to a subscriber.
//                             Body: amount, phoneNumber,
//                             idempotencyKey (required), wallet_id?
//     "disbursement-status" — re-query + settle a disbursement.
//     "balance"             — merchant account balance (admin only).
//                             Body: product? ("collection" default).
//     "account-holder"      — is a number an active account holder?
//                             Body: phoneNumber. (MTN documented;
//                             Airtel = adapter point, refused.)
//     "callback"            — provider status hint (unauthenticated;
//                             identification only, settlement always
//                             re-queries). Also reachable via query
//                             params ?provider=mtn&action=callback.
//   No action = the legacy probe: the rail answers with its gate
//   state only (not_configured / disabled) and moves nothing.

export type TelcoProvider = "mtn" | "airtel";
export type TelcoProduct = "collection" | "disbursement";
export type TelcoAction =
  | "collection"
  | "collection-status"
  | "disbursement"
  | "disbursement-status"
  | "balance"
  | "account-holder"
  | "callback";

export function normalizeTelcoProvider(raw: unknown): TelcoProvider | "zamtel" | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (p === "mtn" || p === "mtn-momo" || p === "mtn-momo-zambia") return "mtn";
  if (p === "airtel" || p === "airtel-money") return "airtel";
  if (p === "zamtel" || p === "zamtel-kwacha" || p === "zamtel-money") return "zamtel";
  if (p === "mobile-money" || p === "mobile" || p === "mobilemoney") return null;
  return null;
}

export function normalizeTelcoAction(raw: unknown): TelcoAction | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (a) {
    case "collection":
    case "collect":
    case "request-to-pay":
    case "requesttopay":
    case "deposit":
      return "collection";
    case "collection-status":
    case "collect-status":
      return "collection-status";
    case "disbursement":
    case "disburse":
    case "transfer":
    case "withdraw":
    case "withdrawal":
      return "disbursement";
    case "disbursement-status":
    case "transfer-status":
      return "disbursement-status";
    case "balance":
    case "account-balance":
      return "balance";
    case "account-holder":
    case "account-holder-status":
    case "check-account-holder":
      return "account-holder";
    case "callback":
    case "webhook":
    case "notification":
      return "callback";
    default:
      return null;
  }
}

/** Idempotency keys: 8–128 chars of a conservative alphabet. */
export function validateTelcoIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) return null;
  return key;
}

export const TELCO_IDEMPOTENCY_REQUIRED_MESSAGE =
  "This payment needs a unique request reference — please try again from the app.";

export const TELCO_REFERENCE_REQUIRED_MESSAGE =
  "A payment reference is required to check this payment.";

/** Plain-language refusal for each begin_mobile_money_payment outcome. */
export function telcoBeginOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "wallet_not_found":
      return "That wallet could not be found. No money has moved.";
    case "wallet_not_owned":
      return "That wallet does not belong to you. No money has moved.";
    case "currency_mismatch":
      return "That wallet is in a different currency from this payment. No money has moved.";
    case "wallet_not_active":
      return "That wallet can't be used for this payment right now. No money has moved.";
    case "insufficient_funds":
      return "There isn't enough money in that wallet for this payment. No money has moved.";
    case "idempotency_conflict":
      return "That request reference was already used for a different payment. No money has moved.";
    default:
      return "This payment couldn't be started. No money has moved.";
  }
}

export type TelcoPaymentStatus = "pending" | "successful" | "failed";

/** The API status word for a ledger payment status. */
export function telcoApiStatus(status: TelcoPaymentStatus): string {
  return status === "successful" ? "completed" : status;
}

export function telcoPendingMessage(provider: TelcoProvider, product: TelcoProduct): string {
  const name = provider === "mtn" ? "MTN MoMo" : "Airtel Money";
  return product === "collection"
    ? `Your ${name} payment is being confirmed. Your wallet updates as soon as ${name} confirms it.`
    : `Your ${name} payout is being confirmed. You'll see the final result here as soon as ${name} confirms it.`;
}

export function telcoCompletedMessage(provider: TelcoProvider, product: TelcoProduct): string {
  const name = provider === "mtn" ? "MTN MoMo" : "Airtel Money";
  return product === "collection"
    ? `Your ${name} deposit is confirmed and your wallet has been credited.`
    : `Your ${name} payout is confirmed.`;
}

export function telcoFailedMessage(provider: TelcoProvider, product: TelcoProduct): string {
  const name = provider === "mtn" ? "MTN MoMo" : "Airtel Money";
  return product === "collection"
    ? `Your ${name} deposit did not complete. No money was credited.`
    : `Your ${name} payout did not complete. The amount has been returned to your wallet.`;
}

export interface TelcoPaymentView {
  provider: TelcoProvider;
  product: TelcoProduct;
  status: TelcoPaymentStatus;
  transactionId: string;
  reference: string;
}

/** The response body for an initiation / status action. */
export function telcoPaymentResponse(view: TelcoPaymentView): {
  success: boolean;
  status: string;
  provider: TelcoProvider;
  product: TelcoProduct;
  transaction_id: string;
  reference: string;
  message: string;
} {
  const message =
    view.status === "successful"
      ? telcoCompletedMessage(view.provider, view.product)
      : view.status === "failed"
        ? telcoFailedMessage(view.provider, view.product)
        : telcoPendingMessage(view.provider, view.product);
  return {
    success: view.status === "successful",
    status: telcoApiStatus(view.status),
    provider: view.provider,
    product: view.product,
    transaction_id: view.transactionId,
    reference: view.reference,
    message,
  };
}

/** Plain-language message for a provider HTTP failure kind. */
export function telcoProviderFailureMessage(
  provider: TelcoProvider,
  kind: string,
): string {
  const name = provider === "mtn" ? "MTN MoMo" : "Airtel Money";
  switch (kind) {
    case "validation":
      return `${name} couldn't accept those payment details. Check the number and amount, then try again. No money has moved.`;
    case "auth":
      return `The ${name} connection needs attention on our side. Please try again later. No money has moved.`;
    case "not_found":
      return `${name} has no record of this payment yet. If you just started it, give it a moment and check again.`;
    default:
      return `${name} couldn't be reached to finish this. Please try again later — if the payment was already started, check its status instead of starting a new one.`;
  }
}
