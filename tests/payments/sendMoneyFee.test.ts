// Source-level tests for the Send Money fee (CEO decision,
// 2026-10-22): 2.5% on Send Money only, computed and collected by the
// server, credited to the platform — and the phone-number Transfer
// stays fee-free.
//
// There is no live database in this suite, so these tests pin the
// contract at the level the repo can prove: the migration defines the
// fee inside the dedicated RPC with the platform-credit pattern, the
// edge function routes only "send_money" to it, SendMoney carries no
// fee logic of its own beyond the preview mirror, and TransferForm's
// money path contains no fee at all. (Same readFileSync approach as
// tests/bitcoin/btc-core.test.ts.)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read(
  "../../supabase/migrations/20261023_send_money_platform_fee.sql",
);
const atomicTransferFn = read(
  "../../supabase/functions/atomic-transfer/index.ts",
);
const sendMoneyPage = read("../../src/pages/SendMoney.tsx");
const sendMoneyUtil = read("../../src/utils/sendMoneyLegs.ts");
const transferForm = read("../../src/components/TransferForm.tsx");

describe("execute_send_money_transfer migration", () => {
  it("defines the dedicated Send Money RPC", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.execute_send_money_transfer(",
    );
    expect(migration).toContain("SECURITY DEFINER");
  });

  it("stores the rate in platform_settings, seeded at 2.5", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS send_money_fee_percent numeric NOT NULL DEFAULT 2.5",
    );
    expect(migration).toContain("send_money_fee_percent");
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
    // The fee is CREDITED (added), not burned like the old null leg.
    expect(migration).toContain("SET balance = balance + v_fee, updated_at = now()");
  });

  it("writes honest, labelled fee rows for both sides", () => {
    expect(migration).toContain("'transfer_fee'");
    expect(migration).toContain("'BMaGlass Pay'");
    expect(migration).toContain("'Send fee for transfer to '");
    expect(migration).toContain("p_idempotency_key || ':fee'");
    expect(migration).toContain("p_idempotency_key || ':fee:in'");
  });

  it("keeps the amount rows labelled 'transfer', like Transfer", () => {
    expect(migration).toContain("'transfer', p_idempotency_key || ':in')");
    expect(migration).toContain("'transfer', p_idempotency_key)");
  });

  it("grants execution to service_role only", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.execute_send_money_transfer",
    );
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("FROM authenticated");
    expect(migration).toContain("FROM anon");
  });

  it("does not touch execute_atomic_transfer (Transfer's RPC)", () => {
    expect(migration).not.toContain("execute_atomic_transfer(");
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.execute_atomic_transfer/,
    );
  });
});

describe("atomic-transfer edge function routing", () => {
  it("routes only reference_type 'send_money' to the fee RPC", () => {
    expect(atomicTransferFn).toContain('reference_type === "send_money"');
    expect(atomicTransferFn).toContain(
      'admin.rpc("execute_send_money_transfer"',
    );
    // The generic path is preserved for every other flow.
    expect(atomicTransferFn).toContain('admin.rpc("execute_atomic_transfer"');
  });

  it("returns the server-charged fee to the caller", () => {
    expect(atomicTransferFn).toContain("fee_amount");
  });
});

describe("Send Money page", () => {
  it("has no flat K5 fee anymore", () => {
    expect(sendMoneyPage).not.toContain("const fee = 5");
    expect(sendMoneyPage).not.toMatch(/const fee = \d/);
  });

  it("plans through the send-money mirror and shows the 2.5% preview", () => {
    expect(sendMoneyPage).toContain("planSendMoneyCall");
    expect(sendMoneyPage).toContain("computeSendFee");
    expect(sendMoneyPage).toContain("send_money_fee_percent");
    expect(sendMoneyPage).toContain("Send fee ({feeRate}%)");
  });

  it("sends exactly one atomic-transfer call (no client fee leg)", () => {
    const invokes = sendMoneyPage.match(/functions\.invoke\("atomic-transfer"/g);
    expect(invokes).toHaveLength(1);
    expect(sendMoneyPage).not.toContain("to_user_id: null");
  });
});

describe("send-money client mirror", () => {
  it("marks its calls 'send_money' and never 'transfer_fee'", () => {
    expect(sendMoneyUtil).toContain('reference_type: "send_money"');
    // The string transfer_fee must not describe a planned call — it
    // only appears in this file's history comment. Pin the body shape
    // instead: the planned body carries no fee fields at all.
    expect(sendMoneyUtil).not.toContain('reference_type: "transfer_fee"');
    expect(sendMoneyUtil).not.toContain("planSendMoneyLegs");
  });
});

describe("Transfer (phone-number path) stays fee-free", () => {
  it("still sends with the generic 'transfer' reference type", () => {
    expect(transferForm).toContain('reference_type: "transfer"');
  });

  it("shows an honest zero fee on its confirmation screen", () => {
    expect(transferForm).toContain("K 0.00");
  });

  it("contains no send-fee machinery at all", () => {
    expect(transferForm).not.toContain("send_money");
    expect(transferForm).not.toContain("execute_send_money_transfer");
    expect(transferForm).not.toContain("computeSendFee");
    expect(transferForm).not.toContain("send_money_fee_percent");
    expect(transferForm).not.toContain("transfer_fee");
  });

  it("moves exactly the entered amount — total equals amount", () => {
    expect(transferForm).toContain("amount: numAmount");
    expect(transferForm).toContain(
      "{formatCurrency(parseFloat(amount))}",
    );
  });
});
