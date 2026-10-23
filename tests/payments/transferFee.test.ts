// Source-level + unit tests for the Transfer fee (CEO decision,
// 2026-10-23): 1.5% on user-to-user Transfer AND QR pay, computed
// and collected by the server, credited to the platform. This
// supersedes the 2026-10-22 decision that kept Transfer free.
//
// There is no live database in this suite, so these tests pin the
// contract at the level the repo can prove: the migration clones
// the live-proven execute_send_money_transfer as a dedicated
// execute_transfer_with_fee reading transfer_fee_percent, the edge
// function routes "transfer" and "qr_payment" (and nothing else
// new) to it, and both confirmation screens preview the fee and
// the amount + fee total before the user confirms. (Same
// readFileSync approach as tests/payments/sendMoneyFee.test.ts.)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeTransferFee,
  transferTotal,
  TRANSFER_FEE_PERCENT_DEFAULT,
} from "../../src/utils/transferFee";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read(
  "../../supabase/migrations/20261027_transfer_fee.sql",
);
const atomicTransferFn = read(
  "../../supabase/functions/atomic-transfer/index.ts",
);
const transferForm = read("../../src/components/TransferForm.tsx");
const qrPayments = read("../../src/pages/QrPayments.tsx");
const transferUtil = read("../../src/utils/transferFee.ts");

describe("execute_transfer_with_fee migration", () => {
  it("defines the dedicated Transfer-fee RPC", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.execute_transfer_with_fee(",
    );
    expect(migration).toContain("SECURITY DEFINER");
  });

  it("stores the rate in platform_settings, seeded at 1.5", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS transfer_fee_percent numeric NOT NULL DEFAULT 1.5",
    );
    expect(migration).toContain("transfer_fee_percent");
  });

  it("computes the fee as round(amount × rate / 100, 2)", () => {
    expect(migration).toContain("round(p_amount * v_fee_rate / 100, 2)");
  });

  it("charges the fee ON TOP: the balance check covers amount + fee", () => {
    expect(migration).toContain("v_sender_balance < p_amount + v_fee");
    expect(migration).toContain(
      "new_sender_balance := v_sender_balance - p_amount - v_fee",
    );
  });

  it("credits the fee to the earliest-created admin's Main wallet", () => {
    expect(migration).toContain("FROM public.user_roles ur");
    expect(migration).toContain("ur.role = 'admin'");
    expect(migration).toContain("ORDER BY ur.created_at, ur.user_id");
    // Main wallet scope (account_id NULL) + on-demand creation.
    expect(migration).toContain("w.account_id IS NULL");
    expect(migration).toContain(
      "INSERT INTO public.wallets (user_id, currency, balance, status)",
    );
    // The fee is CREDITED (added), never burned.
    expect(migration).toContain("SET balance = balance + v_fee, updated_at = now()");
  });

  it("writes honest, labelled fee rows for both sides", () => {
    expect(migration).toContain("'transfer_fee'");
    expect(migration).toContain("'BMaGlass Pay'");
    expect(migration).toContain("'Transfer fee for transfer to '");
    expect(migration).toContain("p_idempotency_key || ':fee'");
    expect(migration).toContain("p_idempotency_key || ':fee:in'");
  });

  it("keeps the amount rows labelled 'transfer', like the generic path did", () => {
    expect(migration).toContain("'transfer', p_idempotency_key || ':in')");
    expect(migration).toContain("'transfer', p_idempotency_key)");
  });

  it("grants execution to service_role only", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.execute_transfer_with_fee",
    );
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("FROM authenticated");
    expect(migration).toContain("FROM anon");
  });

  it("does not redefine the send RPC or the generic RPC", () => {
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.execute_send_money_transfer/,
    );
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.execute_atomic_transfer/,
    );
    // The send rate is a separate setting and stays 2.5's own column.
    expect(migration).not.toContain("send_money_fee_percent numeric");
  });
});

describe("atomic-transfer edge function routing", () => {
  it("routes 'transfer' and 'qr_payment' to the transfer-fee RPC", () => {
    expect(atomicTransferFn).toContain('reference_type === "transfer"');
    expect(atomicTransferFn).toContain('reference_type === "qr_payment"');
    expect(atomicTransferFn).toContain(
      'admin.rpc("execute_transfer_with_fee"',
    );
  });

  it("returns the server-charged fee to the caller", () => {
    // Both fee branches (send + transfer) adapt the response the
    // same way: fee_amount rides alongside transaction_id and the
    // new sender balance.
    const feeReturns = atomicTransferFn.match(/fee_amount/g);
    expect(feeReturns!.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the send routing and the generic path intact", () => {
    expect(atomicTransferFn).toContain('reference_type === "send_money"');
    expect(atomicTransferFn).toContain(
      'admin.rpc("execute_send_money_transfer"',
    );
    expect(atomicTransferFn).toContain('admin.rpc("execute_atomic_transfer"');
  });

  it("routes no other marker to a fee RPC", () => {
    for (const marker of [
      "bill_payment",
      "bnpl_installment",
      "bulk_payment",
      "escrow_hold",
      "refund",
    ]) {
      expect(atomicTransferFn).not.toContain(`reference_type === "${marker}"`);
    }
  });
});

describe("Transfer form (phone-number path)", () => {
  it("keeps its own 'transfer' marker — the marker is what routes it", () => {
    expect(transferForm).toContain('reference_type: "transfer"');
    // The invoke body itself stays free of fee fields: the server
    // computes and collects the fee, the client only previews it.
    expect(transferForm).toContain("amount: numAmount");
  });

  it("previews the fee from platform settings before confirming", () => {
    expect(transferForm).toContain("transfer_fee_percent");
    expect(transferForm).toContain("computeTransferFee");
    expect(transferForm).toContain("Transfer fee ({feeRate}%)");
    expect(transferForm).toContain("{formatCurrency(fee)}");
    expect(transferForm).toContain("{formatCurrency(total)}");
  });

  it("never claims the transfer is free", () => {
    expect(transferForm).not.toContain("K 0.00");
  });

  it("checks the balance against amount + fee, not the amount alone", () => {
    expect(transferForm).toContain("total > walletBalance");
  });
});

describe("QR pay", () => {
  it("keeps its own 'qr_payment' marker, routed server-side to the fee RPC", () => {
    expect(qrPayments).toContain("reference_type: 'qr_payment'");
  });

  it("shows the fee and the true total before the payer confirms", () => {
    expect(qrPayments).toContain("transfer_fee_percent");
    expect(qrPayments).toContain("computeTransferFee");
    expect(qrPayments).toContain("Transfer fee ({feeRate}%)");
    expect(qrPayments).toContain("Pay ZMW {payTotal.toFixed(2)}");
  });
});

describe("computeTransferFee (client preview mirror)", () => {
  it("uses 1.5 as the launch/default rate", () => {
    expect(TRANSFER_FEE_PERCENT_DEFAULT).toBe(1.5);
  });

  it("charges 1.5% of the amount: the K10 proof case", () => {
    // Live-proof arithmetic: a K10 transfer debits the sender
    // K10.15, credits the recipient exactly K10.00, and credits
    // the platform K0.15.
    expect(computeTransferFee(10, 1.5)).toBe(0.15);
    expect(transferTotal(10, 1.5)).toBe(10.15);
  });

  it("scales with the amount (no flat fee anywhere)", () => {
    expect(computeTransferFee(1000, 1.5)).toBe(15);
    expect(transferTotal(1000, 1.5)).toBe(1015);
  });

  it("rounds half-up to cents like Postgres round(numeric, 2)", () => {
    expect(computeTransferFee(33.33, 1.5)).toBe(0.5);
  });

  it("never takes the fee out of the recipient's amount", () => {
    // Fee + amount always reconstructs the sender's total debit;
    // the recipient leg is the entered amount by construction.
    const amount = 250;
    expect(transferTotal(amount, 1.5) - computeTransferFee(amount, 1.5)).toBe(amount);
  });

  it("charges nothing at a zero rate or on a zero amount", () => {
    expect(computeTransferFee(10, 0)).toBe(0);
    expect(computeTransferFee(0, 1.5)).toBe(0);
    expect(transferTotal(10, 0)).toBe(10);
  });

  it("honestly rounds tiny fees to zero", () => {
    expect(computeTransferFee(0.1, 1.5)).toBe(0);
  });

  it("is a separate rate from Send Money's 2.5%", () => {
    expect(computeTransferFee(10, TRANSFER_FEE_PERCENT_DEFAULT)).not.toBe(0.25);
    expect(transferUtil).not.toContain("SEND_MONEY_FEE_PERCENT_DEFAULT");
    expect(transferUtil).not.toContain("send_money_fee_percent");
  });
});
