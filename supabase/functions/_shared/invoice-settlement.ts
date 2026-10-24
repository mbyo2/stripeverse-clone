// invoice-settlement: pure decision logic for the invoice / payment
// request checkout rail (Final-QA FIX-2). Import-free so the vitest
// suite can transpile-test the byte-identical source (pos-core /
// fiat-amount pattern); the invoice-checkout edge function imports it.
//
// Money itself moves ONLY in the Postgres RPCs
// (execute_invoice_settlement / execute_payment_request_settlement —
// row-locked, exactly-once, full amount, NO platform fee). Everything
// here is the pre-flight classification the function and the public
// pages share: what "payable" means, and which plain-language refusal
// a non-payable state earns. The RPC re-checks all of it server-side;
// these helpers exist so the refusal the user sees is identical
// whichever layer answers first.

export type SettlementKind = "invoice" | "request";

export const INVOICE_PAYABLE_STATUSES = ["draft", "sent", "pending"] as const;

/** Plain-language refusal for an invoice status, or null if payable. */
export function invoicePayableError(status: string | null | undefined): string | null {
  if (status === "paid") return "This invoice has already been paid.";
  if (status && (INVOICE_PAYABLE_STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  return "This invoice is no longer payable.";
}

/** Plain-language refusal for a payment-request status, or null if payable. */
export function requestPayableError(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (status === "paid") return "This payment request has already been paid.";
  if (status !== "pending") return "This payment request is no longer payable.";
  if (expiresAt && new Date(expiresAt) <= now) {
    return "This payment request has expired.";
  }
  return null;
}

/** The payer must never be the person who issued the invoice/request. */
export function selfPayError(
  kind: SettlementKind,
  payerId: string,
  ownerId: string,
): string | null {
  if (payerId !== ownerId) return null;
  return kind === "invoice"
    ? "You cannot pay your own invoice."
    : "You cannot pay your own payment request.";
}

/**
 * Map an RPC failure onto the plain-language error the user should
 * see. Known business refusals pass through verbatim (they are
 * already plain language); anything else becomes a generic refusal —
 * raw database errors never reach the client.
 */
export function mapSettlementError(message: string, kind: SettlementKind): string {
  const known = [
    "already been paid",
    "no longer payable",
    "has expired",
    "cannot pay your own",
    "Insufficient balance",
    "No wallet found for this payment",
    "not active right now",
    "cannot receive payments right now",
    "whole ngwee",
  ];
  if (known.some((k) => message.includes(k))) return message;
  return kind === "invoice"
    ? "This invoice could not be paid. No money was charged."
    : "This payment request could not be paid. No money was charged.";
}
