// Unit tests for src/utils/sendMoneyLegs.ts — the client-side mirror
// of the Send Money fee rules implemented authoritatively in SQL by
// supabase/migrations/20261023_send_money_platform_fee.sql
// (execute_send_money_transfer).
//
// The history these pin:
//   - The original regression (Money QA send re-test, 2026-10-22): a
//     single call carried amount + fee, so the RECIPIENT was credited
//     the total. The plan's amount is still exactly the entered amount.
//   - The flat-K5 era: the fee was a client-planned second leg,
//     debit-only, credited to nobody. The plan is now ONE call whose
//     reference_type ("send_money") routes it to the fee-charging RPC;
//     no fee leg, fee amount, or fee destination appears in the plan —
//     the server computes and collects the fee itself.
//   - CEO decision (2026-10-22): the fee is 2.5% of the amount,
//     charged ON TOP (sender pays amount + fee, recipient receives
//     the amount), credited to the platform.

import { describe, it, expect } from "vitest";
import {
  computeSendFee,
  planSendMoneyCall,
  SEND_MONEY_FEE_PERCENT_DEFAULT,
  SEND_FEE_PAYEE_NAME,
} from "../../src/utils/sendMoneyLegs";

const base = {
  amount: 10,
  feeRatePercent: 2.5,
  senderUserId: "sender-1",
  recipientUserId: "recipient-2",
  recipientName: "QA Business",
  currency: "ZMW",
  referenceId: "BPABC123",
  idempotencyKey: "send-sender-1-1729000000000",
};

describe("computeSendFee", () => {
  it("charges 2.5% of the amount at the launch rate", () => {
    expect(computeSendFee(10, 2.5)).toBe(0.25);
    expect(computeSendFee(100, 2.5)).toBe(2.5);
    expect(computeSendFee(200, 2.5)).toBe(5);
    expect(computeSendFee(1000, 2.5)).toBe(25);
  });

  it("rounds to 2dp, half-up, like Postgres round(numeric, 2)", () => {
    expect(computeSendFee(15, 2.5)).toBe(0.38); // 0.375 → 0.38
    expect(computeSendFee(33.33, 2.5)).toBe(0.83); // 0.83325 → 0.83
    expect(computeSendFee(10.1, 2.5)).toBe(0.25); // 0.2525 → 0.25
    expect(computeSendFee(10.3, 2.5)).toBe(0.26); // 0.2575 → 0.26
  });

  it("honestly rounds tiny amounts to a zero fee", () => {
    expect(computeSendFee(0.1, 2.5)).toBe(0); // 0.0025 → 0.00
    expect(computeSendFee(0.19, 2.5)).toBe(0); // 0.00475 → 0.00
    expect(computeSendFee(0.2, 2.5)).toBe(0.01); // 0.005 → 0.01
  });

  it("is a percentage, not a flat fee — it scales with the amount", () => {
    // The old flat K5 charged K5 on a K10 send (50%) and K5 on a
    // K1,000 send (0.5%). The 2.5% rule must not reproduce either.
    expect(computeSendFee(10, 2.5)).not.toBe(5);
    expect(computeSendFee(1000, 2.5)).not.toBe(5);
    expect(computeSendFee(1000, 2.5)).toBe(25);
  });

  it("respects a configured rate, including 0 = no fee", () => {
    expect(computeSendFee(250, 1)).toBe(2.5);
    expect(computeSendFee(250, 0)).toBe(0);
    expect(computeSendFee(250, -1)).toBe(0);
  });

  it("charges nothing for a non-positive amount", () => {
    expect(computeSendFee(0, 2.5)).toBe(0);
    expect(computeSendFee(-50, 2.5)).toBe(0);
  });

  it("defaults to the 2.5% launch rate constant", () => {
    expect(SEND_MONEY_FEE_PERCENT_DEFAULT).toBe(2.5);
    expect(computeSendFee(80, SEND_MONEY_FEE_PERCENT_DEFAULT)).toBe(2);
  });
});

describe("planSendMoneyCall", () => {
  it("plans ONE call whose amount is exactly the entered amount", () => {
    const plan = planSendMoneyCall(base);
    expect(plan).not.toBeNull();
    // NOT 10.25 — the recipient is credited the amount alone; the fee
    // rides on top and only the sender's total reflects it.
    expect(plan!.body.amount).toBe(10);
    expect(plan!.body.to_user_id).toBe("recipient-2");
    expect(plan!.body.from_user_id).toBe("sender-1");
    expect(plan!.fee).toBe(0.25);
    expect(plan!.total).toBe(10.25);
  });

  it("routes the call to the fee-charging server path", () => {
    const plan = planSendMoneyCall(base)!;
    // "send_money" is the marker the atomic-transfer function routes
    // to execute_send_money_transfer. The generic "transfer" type is
    // the fee-free Transfer path and must never appear here.
    expect(plan.body.reference_type).toBe("send_money");
    expect(plan.body.reference_type).not.toBe("transfer");
  });

  it("contains no client-planned fee leg, fee amount, or fee destination", () => {
    const plan = planSendMoneyCall(base)!;
    const bodyJson = JSON.stringify(plan.body);
    expect(bodyJson).not.toContain("transfer_fee");
    expect(bodyJson).not.toContain(":fee");
    expect(plan.body.idempotency_key).toBe(base.idempotencyKey);
    expect(plan.body.reference_id).toBe(base.referenceId);
    expect(plan.body.recipient_name).toBe("QA Business");
    expect(plan.body.description).toBe("Send money to QA Business");
    expect(plan.body.description).not.toContain("fee");
  });

  it("keeps the platform payee identity for ledger labelling", () => {
    expect(SEND_FEE_PAYEE_NAME).toBe("BMaGlass Pay");
  });

  it("scales the preview fee with the amount (no flat K5 anywhere)", () => {
    const small = planSendMoneyCall({ ...base, amount: 10 })!;
    const large = planSendMoneyCall({ ...base, amount: 1000 })!;
    expect(small.fee).toBe(0.25);
    expect(small.total).toBe(10.25);
    expect(large.fee).toBe(25);
    expect(large.total).toBe(1025);
  });

  it("plans a zero fee at a zero rate, with the total equal to the amount", () => {
    const plan = planSendMoneyCall({ ...base, feeRatePercent: 0 })!;
    expect(plan.fee).toBe(0);
    expect(plan.total).toBe(10);
    expect(plan.body.amount).toBe(10);
  });

  it("plans nothing for a non-positive amount", () => {
    expect(planSendMoneyCall({ ...base, amount: 0 })).toBeNull();
    expect(planSendMoneyCall({ ...base, amount: -5 })).toBeNull();
  });

  it("keeps fractional amounts exact", () => {
    const plan = planSendMoneyCall({ ...base, amount: 10.5 })!;
    expect(plan.body.amount).toBe(10.5);
    expect(plan.fee).toBe(0.26); // 0.2625 → 0.26
    expect(plan.total).toBe(10.76);
  });
});
