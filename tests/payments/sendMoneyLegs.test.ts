// Unit tests for src/utils/sendMoneyLegs.ts — the leg planning behind
// the /send-money fix. The regression being pinned (Money QA send
// re-test, 2026-10-22): a single atomic-transfer call carried
// amount = amount + fee, so the recipient was credited the TOTAL
// (K15 on a K10 send with a K5 fee) — the fee was paid to the
// recipient. These tests pin: the recipient leg is exactly the
// entered amount, the fee is a separate debit-only leg to no user
// wallet, and the legs are planned in execution order.

import { describe, it, expect } from "vitest";
import {
  planSendMoneyLegs,
  plannedSendTotal,
  SEND_FEE_PAYEE_NAME,
} from "../../src/utils/sendMoneyLegs";

const base = {
  amount: 10,
  fee: 5,
  senderUserId: "sender-1",
  recipientUserId: "recipient-2",
  recipientName: "QA Business",
  currency: "ZMW",
  referenceId: "BPABC123",
  idempotencyKey: "send-sender-1-1729000000000",
};

describe("planSendMoneyLegs", () => {
  it("plans the amount leg FIRST with exactly the entered amount to the recipient", () => {
    const legs = planSendMoneyLegs(base);
    expect(legs).toHaveLength(2);
    const [amountLeg] = legs;
    expect(amountLeg.kind).toBe("amount");
    expect(amountLeg.body.amount).toBe(10); // NOT 15 — the QA regression
    expect(amountLeg.body.to_user_id).toBe("recipient-2");
    expect(amountLeg.body.from_user_id).toBe("sender-1");
    expect(amountLeg.body.reference_type).toBe("transfer");
    expect(amountLeg.body.idempotency_key).toBe(base.idempotencyKey);
    expect(amountLeg.body.recipient_name).toBe("QA Business");
    expect(amountLeg.body.description).toBe("Send money to QA Business");
    expect(amountLeg.body.description).not.toContain("fee");
  });

  it("plans the fee leg SECOND as a debit-only external payment that credits no user", () => {
    const [, feeLeg] = planSendMoneyLegs(base);
    expect(feeLeg.kind).toBe("fee");
    expect(feeLeg.body.amount).toBe(5);
    // null to_user_id = external/biller payment in the atomic-transfer
    // contract: debit-only, no wallet is credited.
    expect(feeLeg.body.to_user_id).toBeNull();
    expect(feeLeg.body.from_user_id).toBe("sender-1");
    expect(feeLeg.body.reference_type).toBe("transfer_fee");
    expect(feeLeg.body.recipient_name).toBe(SEND_FEE_PAYEE_NAME);
    expect(feeLeg.body.description).toContain("Send fee");
    expect(feeLeg.body.description).toContain("QA Business");
  });

  it("derives the fee leg's idempotency key from the send's key and shares the reference", () => {
    const [amountLeg, feeLeg] = planSendMoneyLegs(base);
    expect(feeLeg.body.idempotency_key).toBe(`${base.idempotencyKey}:fee`);
    expect(feeLeg.body.idempotency_key).not.toBe(amountLeg.body.idempotency_key);
    expect(feeLeg.body.reference_id).toBe(base.referenceId);
    expect(amountLeg.body.reference_id).toBe(base.referenceId);
  });

  it("debits the sender amount + fee in total, while the recipient leg stays the amount", () => {
    const legs = planSendMoneyLegs(base);
    expect(plannedSendTotal(legs)).toBe(15);
    const credited = legs
      .filter((leg) => leg.body.to_user_id === base.recipientUserId)
      .reduce((sum, leg) => sum + leg.body.amount, 0);
    expect(credited).toBe(10);
  });

  it("plans no fee leg when the fee is zero", () => {
    const legs = planSendMoneyLegs({ ...base, fee: 0 });
    expect(legs).toHaveLength(1);
    expect(legs[0].kind).toBe("amount");
    expect(plannedSendTotal(legs)).toBe(10);
  });

  it("plans nothing for a non-positive amount", () => {
    expect(planSendMoneyLegs({ ...base, amount: 0 })).toEqual([]);
    expect(planSendMoneyLegs({ ...base, amount: -5 })).toEqual([]);
  });

  it("keeps fractional amounts exact on both legs", () => {
    const legs = planSendMoneyLegs({ ...base, amount: 10.5, fee: 5 });
    expect(legs[0].body.amount).toBe(10.5);
    expect(legs[1].body.amount).toBe(5);
    expect(plannedSendTotal(legs)).toBe(15.5);
  });
});
