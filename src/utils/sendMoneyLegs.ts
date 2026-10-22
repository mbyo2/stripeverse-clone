// Send-money leg planning — the pure decision logic behind the
// /send-money flow's atomic-transfer calls.
//
// The bug this pins (Money QA send re-test, 2026-10-22): SendMoney
// made ONE atomic-transfer call with amount = amount + fee, so the
// RECIPIENT was credited the total — the K5 "fee" was paid to the
// recipient instead of being collected. The sender's debit was right;
// the recipient's credit was wrong.
//
// The fix, planned here and executed by SendMoney.tsx in order:
//   Leg 1 — the amount leg: sender → recipient, amount = EXACTLY the
//           entered amount (same shape as the /transfer route).
//   Leg 2 — the fee leg: sender → platform, amount = the fee alone.
//           to_user_id is null, which the atomic-transfer contract
//           treats as an external/biller payment: debit-only, credits
//           NO user wallet (the same pattern bill payments and escrow
//           holds use). reference_type 'transfer_fee' follows the
//           existing snake_case convention (transfer, bill_payment,
//           escrow_hold, qr_payment) and lands in the transactions
//           category, so the fee is its own labelled ledger row.
//           Its idempotency key derives from the send's key
//           (`${key}:fee`) so a retry of the send can never
//           double-charge either leg independently.
//
// Ordering / failure semantics (enforced by the caller, planned here):
// amount leg first, fee leg second. If the fee leg fails after the
// amount leg succeeded, the send STANDS — the caller must not roll
// back or report a failed send; it surfaces a warning that the fee
// could not be collected. If the amount leg fails, nothing is charged.

export interface SendMoneyLegInput {
  /** The entered amount — the recipient is credited exactly this. */
  amount: number;
  /** Flat send fee (e.g. 5). Zero or negative → no fee leg. */
  fee: number;
  senderUserId: string;
  recipientUserId: string;
  recipientName: string;
  currency: string;
  /** The send's public reference (shared by both legs, grouping them). */
  referenceId: string;
  /** The send's base idempotency key (the fee leg derives `:fee`). */
  idempotencyKey: string;
}

export interface PlannedSendLeg {
  kind: "amount" | "fee";
  /** Body for the atomic-transfer edge-function invoke, verbatim. */
  body: {
    from_user_id: string;
    to_user_id: string | null;
    amount: number;
    currency: string;
    reference_type: string;
    reference_id: string;
    idempotency_key: string;
    description: string;
    recipient_name: string;
    payment_method: string;
  };
}

/** The platform identity the fee leg is addressed to in the ledger. */
export const SEND_FEE_PAYEE_NAME = "BMaGlass Pay";

export function planSendMoneyLegs(input: SendMoneyLegInput): PlannedSendLeg[] {
  const {
    amount,
    fee,
    senderUserId,
    recipientUserId,
    recipientName,
    currency,
    referenceId,
    idempotencyKey,
  } = input;

  if (!(amount > 0)) return [];

  const legs: PlannedSendLeg[] = [
    {
      kind: "amount",
      body: {
        from_user_id: senderUserId,
        to_user_id: recipientUserId,
        amount,
        currency,
        reference_type: "transfer",
        reference_id: referenceId,
        idempotency_key: idempotencyKey,
        // No "(incl. fee)" suffix: the fee no longer travels inside
        // this leg — it is the separate ledger row planned below.
        description: `Send money to ${recipientName}`,
        recipient_name: recipientName,
        payment_method: "wallet",
      },
    },
  ];

  if (fee > 0) {
    legs.push({
      kind: "fee",
      body: {
        from_user_id: senderUserId,
        // null = external/platform payment in the atomic-transfer
        // contract: the sender is debited and NO user wallet is
        // credited. The fee can never reach the recipient.
        to_user_id: null,
        amount: fee,
        currency,
        reference_type: "transfer_fee",
        reference_id: referenceId,
        idempotency_key: `${idempotencyKey}:fee`,
        description: `Send fee for transfer to ${recipientName} (ref ${referenceId})`,
        recipient_name: SEND_FEE_PAYEE_NAME,
        payment_method: "wallet",
      },
    });
  }

  return legs;
}

/** Total the sender is debited across the planned legs. */
export function plannedSendTotal(legs: PlannedSendLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.body.amount, 0);
}
