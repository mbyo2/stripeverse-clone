// Transfer fee math — the client-side preview mirror for the
// user-to-user Transfer flow (TransferForm) and QR pay (QrPayments).
//
// CEO decision (2026-10-23): Transfer charges 1.5% — "transfer make
// it 1.5 percent and not zero" — superseding the 2026-10-22 call that
// kept Transfer free while Send Money charged 2.5%. The fee is
// charged to the sender ON TOP (the recipient still receives exactly
// the entered amount) and CREDITED to the platform.
//
// The authoritative implementation is the execute_transfer_with_fee
// RPC (supabase/migrations/20261027_transfer_fee.sql): the
// atomic-transfer edge function routes reference_type "transfer" AND
// "qr_payment" to it, and the RPC computes the fee from
// platform_settings.transfer_fee_percent and credits the platform
// operator's Main wallet in the same transaction as the transfer.
// This module exists so the Transfer and QR confirmation screens can
// preview the exact same arithmetic — the server never trusts the
// preview: it recomputes the fee itself.
//
// The formula is the same one Send Money uses (computeSendFee in
// utils/sendMoneyLegs, over the shared roundMoney): the two flows
// differ only in rate, settings column, and routing marker. Send
// Money keeps its own module and its 2.5% rate — neither flow's
// preview may borrow the other's numbers.

import { roundMoney } from "./splitPayments";

/** Launch transfer-fee rate (%), used until platform_settings loads
 *  and as the fallback when the settings row cannot be read —
 *  mirrors the RPC's defensive fallback of 1.5. */
export const TRANSFER_FEE_PERCENT_DEFAULT = 1.5;

/**
 * The transfer fee on `amount` at `ratePercent`:
 * round(amount * rate / 100, 2) — half-up, mirroring Postgres
 * round(numeric, 2). The fee rides ON TOP of the amount (it is NOT
 * capped at the amount and never comes out of what the recipient
 * receives). A rate of 0 (or less) means no fee; tiny amounts can
 * honestly round to a 0.00 fee.
 */
export function computeTransferFee(amount: number, ratePercent: number): number {
  if (!(amount > 0) || !(ratePercent > 0)) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

/** Total the sender is debited for a transfer of `amount` at
 *  `ratePercent`: the amount plus its fee, rounded to cents. */
export function transferTotal(amount: number, ratePercent: number): number {
  return roundMoney(amount + computeTransferFee(amount, ratePercent));
}
