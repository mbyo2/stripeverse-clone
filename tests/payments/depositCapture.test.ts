// Unit tests for supabase/functions/_shared/deposit-capture.ts — the
// pure decision logic shared by the paypal-deposit-capture edge
// function (return flow) and the paypal-webhook deposit backstop. The
// module has no imports, so this suite loads the exact file Deno runs.
//
// The property under test is exactly-once, verified credit: a wallet
// deposit may complete ONLY from a COMPLETED PayPal capture whose
// amount and currency match the pending row recorded at order
// creation, and a replayed completion must be a no-op, never a
// second credit.

import { describe, it, expect } from "vitest";
import {
  extractCompletedCapture,
  moneyEquals,
  orderIdFromWebhookEvent,
  parseMoney,
  paypalErrorTrace,
  paypalOrderStatus,
  planCancellation,
  planCompletion,
  verifyCapture,
  type CapturedPayment,
  type PendingDeposit,
} from "../../supabase/functions/_shared/deposit-capture";

const pending: PendingDeposit = {
  amount: 40,
  currency: "ZMW",
  status: "pending",
  captureId: null,
};

const completedCapture: CapturedPayment = {
  id: "CAPTURE123",
  status: "COMPLETED",
  amount: 40,
  currency: "ZMW",
};

function orderWithCapture(capture: Record<string, unknown>, orderStatus = "COMPLETED") {
  return {
    id: "ORDER123",
    status: orderStatus,
    purchase_units: [
      {
        amount: { currency_code: "ZMW", value: "40.00" },
        payments: { captures: [capture] },
      },
    ],
  };
}

describe("parseMoney / moneyEquals", () => {
  it("parses PayPal string amounts and plain numbers", () => {
    expect(parseMoney("40.00")).toBe(40);
    expect(parseMoney("40.5")).toBe(40.5);
    expect(parseMoney(40)).toBe(40);
    expect(parseMoney("not-a-number")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("compares money in minor units without float drift", () => {
    expect(moneyEquals(40, 40.0)).toBe(true);
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(40, 40.01)).toBe(false);
    expect(moneyEquals(40, 39.99)).toBe(false);
  });
});

describe("extractCompletedCapture", () => {
  it("extracts a COMPLETED capture from an order payload", () => {
    const order = orderWithCapture({
      id: "CAPTURE123",
      status: "COMPLETED",
      amount: { value: "40.00", currency_code: "zmw" },
    });
    expect(extractCompletedCapture(order)).toEqual({
      id: "CAPTURE123",
      status: "COMPLETED",
      amount: 40,
      currency: "ZMW",
    });
  });

  it("returns null for an APPROVED order with no captures yet", () => {
    const order = { id: "ORDER123", status: "APPROVED", purchase_units: [{ amount: {} }] };
    expect(extractCompletedCapture(order)).toBeNull();
  });

  it("returns null when the only capture is still PENDING at PayPal", () => {
    const order = orderWithCapture({
      id: "CAPTURE123",
      status: "PENDING",
      amount: { value: "40.00", currency_code: "ZMW" },
    });
    expect(extractCompletedCapture(order)).toBeNull();
  });

  it("skips non-completed captures and finds a later completed one", () => {
    const order = {
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              { id: "C1", status: "DECLINED", amount: { value: "40.00", currency_code: "ZMW" } },
              { id: "C2", status: "COMPLETED", amount: { value: "40.00", currency_code: "ZMW" } },
            ],
          },
        },
      ],
    };
    expect(extractCompletedCapture(order)?.id).toBe("C2");
  });

  it("survives malformed payloads", () => {
    expect(extractCompletedCapture(null)).toBeNull();
    expect(extractCompletedCapture("junk")).toBeNull();
    expect(extractCompletedCapture({ purchase_units: "nope" })).toBeNull();
    expect(extractCompletedCapture({ purchase_units: [{ payments: { captures: [{}] } }] })).toBeNull();
  });
});

describe("paypalOrderStatus", () => {
  it("reads the order status and tolerates junk", () => {
    expect(paypalOrderStatus({ status: "APPROVED" })).toBe("APPROVED");
    expect(paypalOrderStatus({})).toBeNull();
    expect(paypalOrderStatus(null)).toBeNull();
  });
});

describe("orderIdFromWebhookEvent", () => {
  it("takes the resource id for CHECKOUT.ORDER.APPROVED", () => {
    expect(orderIdFromWebhookEvent("CHECKOUT.ORDER.APPROVED", { id: "ORDER123" })).toBe("ORDER123");
  });

  it("takes the related order id for PAYMENT.CAPTURE.COMPLETED", () => {
    const resource = {
      id: "CAPTURE123",
      supplementary_data: { related_ids: { order_id: "ORDER123" } },
    };
    expect(orderIdFromWebhookEvent("PAYMENT.CAPTURE.COMPLETED", resource)).toBe("ORDER123");
  });

  it("returns null for unrelated events and missing ids", () => {
    expect(orderIdFromWebhookEvent("BILLING.SUBSCRIPTION.ACTIVATED", { id: "SUB1" })).toBeNull();
    expect(orderIdFromWebhookEvent("PAYMENT.CAPTURE.COMPLETED", { id: "CAPTURE123" })).toBeNull();
    expect(orderIdFromWebhookEvent("CHECKOUT.ORDER.APPROVED", null)).toBeNull();
  });
});

describe("verifyCapture", () => {
  it("accepts a completed capture matching amount and currency", () => {
    expect(verifyCapture(completedCapture, pending)).toEqual({ ok: true });
  });

  it("matches currency case-insensitively", () => {
    expect(verifyCapture({ ...completedCapture, currency: "zmw" }, pending)).toEqual({ ok: true });
  });

  it("rejects a missing capture", () => {
    expect(verifyCapture(null, pending)).toEqual({ ok: false, reason: "missing_capture" });
  });

  it("rejects a capture that is not COMPLETED", () => {
    expect(verifyCapture({ ...completedCapture, status: "PENDING" }, pending)).toEqual({
      ok: false,
      reason: "capture_not_completed",
    });
  });

  it("rejects amount mismatches — even one ngwee", () => {
    expect(verifyCapture({ ...completedCapture, amount: 40.01 }, pending)).toEqual({
      ok: false,
      reason: "amount_mismatch",
    });
    expect(verifyCapture({ ...completedCapture, amount: 39.99 }, pending)).toEqual({
      ok: false,
      reason: "amount_mismatch",
    });
  });

  it("rejects currency mismatches", () => {
    expect(verifyCapture({ ...completedCapture, currency: "USD" }, pending)).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
  });
});

describe("planCompletion", () => {
  it("allows a pending deposit to proceed to credit", () => {
    expect(planCompletion(pending, "CAPTURE123")).toBe("credit");
  });

  it("treats a replay of the same capture as already completed (no second credit)", () => {
    const done: PendingDeposit = { ...pending, status: "completed", captureId: "CAPTURE123" };
    expect(planCompletion(done, "CAPTURE123")).toBe("already_completed");
  });

  it("flags a completed row carrying a different capture as a conflict", () => {
    const done: PendingDeposit = { ...pending, status: "completed", captureId: "OTHER999" };
    expect(planCompletion(done, "CAPTURE123")).toBe("conflict");
    const doneNoId: PendingDeposit = { ...pending, status: "completed", captureId: null };
    expect(planCompletion(doneNoId, "CAPTURE123")).toBe("conflict");
  });

  it("refuses deposits that are no longer pending", () => {
    expect(planCompletion({ ...pending, status: "failed" }, "CAPTURE123")).toBe("not_pending");
    expect(planCompletion({ ...pending, status: "cancelled" }, "CAPTURE123")).toBe("not_pending");
  });
});

describe("paypalErrorTrace (audit L1: logs carry trace fields, never raw bodies)", () => {
  it("extracts only status, error name and debug_id from a PayPal error body", () => {
    const body = JSON.stringify({
      name: "UNPROCESSABLE_ENTITY_ERROR",
      message: "The requested action could not be performed.",
      debug_id: "deadbeef1234",
      details: [{ issue: "INVALID_EMAIL", value: "payer@example.com" }],
    });
    const trace = paypalErrorTrace(422, body);
    expect(trace).toEqual({
      status: 422,
      name: "UNPROCESSABLE_ENTITY_ERROR",
      debugId: "deadbeef1234",
    });
    // The whole point: nothing else from the body survives — no
    // message, no details, no echoed field values.
    expect(JSON.stringify(trace)).not.toContain("payer@example.com");
    expect(JSON.stringify(trace)).not.toContain("requested action");
  });

  it("falls back to status alone for non-JSON or field-less bodies", () => {
    expect(paypalErrorTrace(500, "Internal Server Error")).toEqual({
      status: 500, name: null, debugId: null,
    });
    expect(paypalErrorTrace(400, "")).toEqual({
      status: 400, name: null, debugId: null,
    });
    expect(paypalErrorTrace(403, JSON.stringify({ error: "forbidden" }))).toEqual({
      status: 403, name: null, debugId: null,
    });
  });
});

describe("planCancellation (payer-cancel return: flip only on PayPal's verified word)", () => {
  const neverApproved = { orderStatus: "CREATED", hasCompletedCapture: false };

  it("flips a still-pending row when PayPal shows the order was never approved", () => {
    expect(planCancellation("pending", neverApproved)).toBe("mark_cancelled");
    expect(
      planCancellation("pending", { orderStatus: "PAYER_ACTION_REQUIRED", hasCompletedCapture: false }),
    ).toBe("mark_cancelled");
    expect(
      planCancellation("pending", { orderStatus: "SAVED", hasCompletedCapture: false }),
    ).toBe("mark_cancelled");
    expect(
      planCancellation("pending", { orderStatus: "VOIDED", hasCompletedCapture: false }),
    ).toBe("mark_cancelled");
  });

  it("never flips when a completed capture exists — the confirmation path governs", () => {
    expect(
      planCancellation("pending", { orderStatus: "CREATED", hasCompletedCapture: true }),
    ).toBe("confirm_instead");
    expect(
      planCancellation("pending", { orderStatus: "COMPLETED", hasCompletedCapture: true }),
    ).toBe("confirm_instead");
  });

  it("never flips an approved order — approval means money is in flight", () => {
    expect(
      planCancellation("pending", { orderStatus: "APPROVED", hasCompletedCapture: false }),
    ).toBe("confirm_instead");
    expect(
      planCancellation("pending", { orderStatus: "COMPLETED", hasCompletedCapture: false }),
    ).toBe("confirm_instead");
  });

  it("fails closed on an unknown or missing PayPal status", () => {
    expect(
      planCancellation("pending", { orderStatus: "SOMETHING_NEW", hasCompletedCapture: false }),
    ).toBe("confirm_instead");
    expect(
      planCancellation("pending", { orderStatus: null, hasCompletedCapture: false }),
    ).toBe("confirm_instead");
  });

  it("never touches a completed row, and reports replays truthfully", () => {
    expect(planCancellation("completed", neverApproved)).toBe("already_completed");
    expect(
      planCancellation("completed", { orderStatus: "COMPLETED", hasCompletedCapture: true }),
    ).toBe("already_completed");
    expect(planCancellation("cancelled", neverApproved)).toBe("already_cancelled");
    expect(planCancellation("failed", neverApproved)).toBe("not_pending");
  });
});
