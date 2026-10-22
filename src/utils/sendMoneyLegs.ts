// Send-money fee math + call planning — the client-side mirror of the
// /send-money flow's server-side settlement.
//
// History: Send Money used to charge a flat K5 planned HERE, as a
// second atomic-transfer leg with to_user_id null (debit-only — the
// fee was burned, credited to no wallet, and a client could omit the
// leg entirely). CEO decision (2026-10-22): the fee is 2.5% of the
// amount, charged to the sender ON TOP (the recipient still receives
// exactly the entered amount), and CREDITED to the platform.
//
// The authoritative implementation is the execute_send_money_transfer
// RPC (supabase/migrations/20261023_send_money_platform_fee.sql): the
// atomic-transfer edge function routes reference_type "send_money" to
// it, and the RPC computes the fee from
// platform_settings.send_money_fee_percent and credits the platform
// operator's Main wallet in the same transaction as the send. This
// module exists so the Send Money page can preview the exact same
// arithmetic and build the single call — the server never trusts the
// preview: it recomputes the fee itself.
//
// The phone-number Transfer flow is a different product surface and
// stays fee-free by the same CEO decision: it keeps calling
// atomic-transfer with reference_type "transfer" (the generic
// execute_atomic_transfer RPC) and never comes near this module.

import { roundMoney } from "./splitPayments";

/** Launch send-fee rate (%), used until platform_settings loads and as
 *  the fallback when the settings row cannot be read — mirrors the
 *  RPC's defensive fallback of 2.5. */
export const SEND_MONEY_FEE_PERCENT_DEFAULT = 2.5;

/** The platform identity the fee is addressed to in the ledger. */
export const SEND_FEE_PAYEE_NAME = "BMaGlass Pay";

/**
 * The Send Money fee on `amount` at `ratePercent`:
 * round(amount * rate / 100, 2) — half-up, mirroring Postgres
 * round(numeric, 2). The fee rides ON TOP of the amount (it is NOT
 * capped at the amount and never comes out of what the recipient
 * receives). A rate of 0 (or less) means no fee; tiny amounts can
 * honestly round to a 0.00 fee.
 */
export function computeSendFee(amount: number, ratePercent: number): number {
  if (!(amount > 0) || !(ratePercent > 0)) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

export interface SendMoneyPlanInput {
  /** The entered amount — the recipient is credited exactly this. */
  amount: number;
  /** Fee rate in percent (platform_settings.send_money_fee_percent). */
  feeRatePercent: number;
  senderUserId: string;
  recipientUserId: string;
  recipientName: string;
  currency: string;
  /** The send's public reference (shared by the amount and fee rows). */
  referenceId: string;
  /** The send's idempotency key (the RPC derives the fee rows' keys). */
  idempotencyKey: string;
}

export interface SendMoneyPlan {
  /** Body for the single atomic-transfer invoke, verbatim. The
   *  reference_type "send_money" is what routes the call to the
   *  fee-charging RPC on the server. */
  body: {
    from_user_id: string;
    to_user_id: string;
    amount: number;
    currency: string;
    reference_type: string;
    reference_id: string;
    idempotency_key: string;
    description: string;
    recipient_name: string;
    payment_method: string;
  };
  /** The fee the server will charge at this rate (display mirror). */
  fee: number;
  /** Total the sender is debited: amount + fee. */
  total: number;
}

/**
 * Plan the one server call behind a Send Money send. Returns null for
 * a non-positive amount. The recipient leg is ALWAYS exactly the
 * entered amount — the fee never travels inside it (the regression
 * this module originally pinned: amount + fee credited to the
 * recipient, K15 landing on a K10 send).
 */
export function planSendMoneyCall(input: SendMoneyPlanInput): SendMoneyPlan | null {
  const {
    amount,
    feeRatePercent,
    senderUserId,
    recipientUserId,
    recipientName,
    currency,
    referenceId,
    idempotencyKey,
  } = input;

  if (!(amount > 0)) return null;

  const fee = computeSendFee(amount, feeRatePercent);

  return {
    body: {
      from_user_id: senderUserId,
      to_user_id: recipientUserId,
      amount,
      currency,
      reference_type: "send_money",
      reference_id: referenceId,
      idempotency_key: idempotencyKey,
      description: `Send money to ${recipientName}`,
      recipient_name: recipientName,
      payment_method: "wallet",
    },
    fee,
    total: roundMoney(amount + fee),
  };
}
