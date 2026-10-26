// Tests for the PayPal provider-connections audit fixes (D1–D10,
// 2026-10-26). Layers, mirroring the repo's existing suites:
//   1. The pure modules the edge functions run — the capture-reversal
//      planner (_shared/paypal-reversal.ts), the order-currency
//      allowlist (_shared/payment-providers.ts), and the payout
//      duplicate classification (_shared/paypal-payout.ts).
//   2. The reversal RPC at source level (migration 20261227): the
//      exactly-once discipline — row lock, per-key no-op, cumulative
//      cap, non-negative wallet clamp, provenance symmetry — pinned
//      in order, plus a guard that the 20261213 float bodies of
//      reserve/refund_paypal_withdrawal are NOT redefined here.
//   3. Wiring pins for the webhook cases, the deprecated legacy
//      functions, and the client hooks.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureIdFromRefundLinks,
  captureStateFromApi,
  planCaptureReversal,
  refundStateFromApi,
  refundsFromOrderApi,
  reversalCaptureIdFromResource,
  type CaptureState,
  type RefundState,
} from "../../supabase/functions/_shared/paypal-reversal.ts";
import {
  PAYPAL_ORDER_CURRENCIES,
  paypalOrderCurrencyRefusal,
} from "../../supabase/functions/_shared/payment-providers.ts";
import {
  classifyPayoutPostFailure,
  PAYOUT_WEBHOOK_EVENT_TYPES,
  payoutFailureReason,
  planPayoutFinalization,
} from "../../supabase/functions/_shared/paypal-payout.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8");

const REFUND_LINKS = [
  { href: "https://api.paypal.com/v2/payments/refunds/RF-1", rel: "self", method: "GET" },
  { href: "https://api.paypal.com/v2/payments/captures/CAP-9", rel: "up", method: "GET" },
];

describe("paypal-reversal extractors", () => {
  it("reads the capture id from a refund's up link", () => {
    expect(captureIdFromRefundLinks({ id: "RF-1", links: REFUND_LINKS })).toBe("CAP-9");
    expect(captureIdFromRefundLinks({ id: "RF-1", links: [] })).toBeNull();
    expect(captureIdFromRefundLinks(null)).toBeNull();
  });

  it("locates the capture for every reversal event family", () => {
    expect(
      reversalCaptureIdFromResource("PAYMENT.CAPTURE.REFUNDED", { id: "RF-1", links: REFUND_LINKS }),
    ).toBe("CAP-9");
    expect(reversalCaptureIdFromResource("PAYMENT.CAPTURE.REVERSED", { id: "CAP-9" })).toBe("CAP-9");
    expect(reversalCaptureIdFromResource("PAYMENT.CAPTURE.DENIED", { id: "CAP-9" })).toBe("CAP-9");
    expect(reversalCaptureIdFromResource("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-9" })).toBeNull();
  });

  it("parses authoritative capture and refund states", () => {
    const capture = captureStateFromApi({
      id: "CAP-9",
      status: "REFUNDED",
      amount: { value: "100.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "ORD-1" } },
    });
    expect(capture).toEqual({
      id: "CAP-9",
      status: "REFUNDED",
      amount: 100,
      currency: "USD",
      orderId: "ORD-1",
    });

    const refund = refundStateFromApi({
      id: "RF-1",
      status: "COMPLETED",
      amount: { value: "40.00", currency_code: "USD" },
      seller_payable_breakdown: {
        total_refunded_amount: { value: "40.00", currency_code: "USD" },
      },
      links: REFUND_LINKS,
    });
    expect(refund?.totalRefunded).toBe(40);
    expect(refund?.captureId).toBe("CAP-9");
  });

  it("collects refunds across an order's purchase units", () => {
    const refunds = refundsFromOrderApi({
      purchase_units: [{
        payments: {
          refunds: [
            { id: "RF-1", status: "COMPLETED", amount: { value: "40.00", currency_code: "USD" } },
            { id: "RF-2", status: "PENDING", amount: { value: "10.00", currency_code: "USD" } },
          ],
        },
      }],
    });
    expect(refunds.map((r) => r.id)).toEqual(["RF-1", "RF-2"]);
  });
});

const capture = (over: Partial<CaptureState> = {}): CaptureState => ({
  id: "CAP-9",
  status: "COMPLETED",
  amount: 100,
  currency: "USD",
  orderId: "ORD-1",
  ...over,
});
const refund = (over: Partial<RefundState> = {}): RefundState => ({
  id: "RF-1",
  status: "COMPLETED",
  amount: 40,
  currency: "USD",
  totalRefunded: 40,
  captureId: "CAP-9",
  ...over,
});

describe("planCaptureReversal", () => {
  it("reverses a completed refund to its cumulative total, keyed by the refund id", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      capture: capture({ status: "PARTIALLY_REFUNDED" }),
      refund: refund(),
      orderRefunds: [refund()],
    });
    expect(plan).toEqual({
      action: "reverse",
      captureId: "CAP-9",
      key: "RF-1",
      targetTotal: 40,
      currency: "USD",
    });
  });

  it("falls back to the order's completed-refund sum without a breakdown total", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      capture: capture({ status: "PARTIALLY_REFUNDED" }),
      refund: refund({ totalRefunded: null }),
      orderRefunds: [refund(), refund({ id: "RF-2", amount: 25, status: "PENDING" })],
    });
    expect(plan.action).toBe("reverse");
    if (plan.action === "reverse") expect(plan.targetTotal).toBe(40);
  });

  it("does not reverse for a pending refund", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      capture: capture(),
      refund: refund({ status: "PENDING" }),
      orderRefunds: [],
    });
    expect(plan).toEqual({ action: "none", reason: "refund_pending", retryable: false });
  });

  it("reverses a chargeback to the sum of the order's completed refunds", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REVERSED",
      capture: capture({ status: "REFUNDED" }),
      refund: null,
      orderRefunds: [refund({ amount: 100, totalRefunded: 100 })],
    });
    expect(plan.action).toBe("reverse");
    if (plan.action === "reverse") {
      expect(plan.targetTotal).toBe(100);
      expect(plan.key).toBe("capture-reversal:CAP-9");
    }
  });

  it("reverses a full capture when a reversal shows REFUNDED with no refund list", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REVERSED",
      capture: capture({ status: "REFUNDED" }),
      refund: null,
      orderRefunds: [],
    });
    expect(plan.action).toBe("reverse");
    if (plan.action === "reverse") expect(plan.targetTotal).toBe(100);
  });

  it("asks for a retry when the reversal is not visible in PayPal's state yet", () => {
    const plan = planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.REVERSED",
      capture: capture({ status: "COMPLETED" }),
      refund: null,
      orderRefunds: [],
    });
    expect(plan).toEqual({ action: "none", reason: "reversal_not_visible_yet", retryable: true });
  });

  it("never reverses for denied or pending captures", () => {
    expect(planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.DENIED",
      capture: capture({ status: "DECLINED" }),
      refund: null,
      orderRefunds: [],
    })).toEqual({ action: "none", reason: "capture_declined", retryable: false });
    expect(planCaptureReversal({
      eventType: "PAYMENT.CAPTURE.PENDING",
      capture: capture({ status: "PENDING" }),
      refund: null,
      orderRefunds: [],
    })).toEqual({ action: "none", reason: "capture_pending", retryable: false });
  });
});

describe("paypalOrderCurrencyRefusal (D3)", () => {
  it("allows the major two-decimal currencies and refuses the rest up front", () => {
    for (const c of PAYPAL_ORDER_CURRENCIES) {
      expect(paypalOrderCurrencyRefusal(c)).toBeNull();
    }
    expect(paypalOrderCurrencyRefusal("usd")).toBeNull();
    expect(paypalOrderCurrencyRefusal("ZMW")).toMatch(/kwacha/i);
    expect(paypalOrderCurrencyRefusal("JPY")).toMatch(/aren't supported/);
    expect(paypalOrderCurrencyRefusal("")).toMatch(/Choose a currency/);
  });
});

describe("payout duplicate classification (D9) and CANCELED finalization (D6)", () => {
  it("classifies a duplicate sender_batch_id rejection as already_submitted and recovers the batch id", () => {
    const body = {
      name: "VALIDATION_ERROR",
      message: "The sender_batch_id value has already been used in the last 30 days.",
      links: [{ href: "https://api.paypal.com/v1/payments/payouts/BATCH-77?page_size=1000", rel: "self" }],
    };
    expect(classifyPayoutPostFailure(400, body)).toEqual({
      kind: "already_submitted",
      batchId: "BATCH-77",
    });
  });

  it("keeps the not_enabled and insufficient-funds classifications ahead of the generic rejection", () => {
    expect(classifyPayoutPostFailure(403, { name: "AUTHORIZATION_ERROR" }).kind).toBe("not_enabled");
    expect(classifyPayoutPostFailure(422, { name: "INSUFFICIENT_FUNDS" }).kind).toBe("insufficient_funds");
    expect(classifyPayoutPostFailure(400, { name: "VALIDATION_ERROR", message: "Bad receiver" })).toEqual({
      kind: "rejected",
      message: "Bad receiver",
    });
  });

  it("finalizes a CANCELED payout item as a refund with plain-language copy", () => {
    expect(planPayoutFinalization("processing", "CANCELED")).toBe("refund");
    expect(payoutFailureReason({
      payoutItemId: "ITEM-1",
      transactionStatus: "CANCELED",
      transactionId: null,
      errorName: null,
      errorMessage: null,
    })).toMatch(/canceled/i);
  });

  it("routes the DENIED / CANCELED / REFUNDED item webhook events to finalization", () => {
    for (const t of [
      "PAYMENT.PAYOUTS-ITEM.DENIED",
      "PAYMENT.PAYOUTS-ITEM.CANCELED",
      "PAYMENT.PAYOUTS-ITEM.REFUNDED",
    ]) {
      expect(PAYOUT_WEBHOOK_EVENT_TYPES.has(t)).toBe(true);
    }
  });
});

describe("migration 20261227 pins", () => {
  const sql = read("../../supabase/migrations/20261227_paypal_capture_reversals.sql");

  it("reversal is keyed and locked before any money moves", () => {
    const keyCheck = sql.indexOf("e ->> 'key' = p_reversal_key");
    const walletDebit = sql.indexOf("UPDATE public.wallets w");
    expect(keyCheck).toBeGreaterThan(-1);
    expect(walletDebit).toBeGreaterThan(keyCheck);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("LEAST(round(p_target_amount, 2), round(v_tx.amount, 2))");
  });

  it("clamps the debit at the wallet balance and records provenance symmetry", () => {
    expect(sql).toContain("LEAST(v_delta, v_wallet.balance)");
    expect(sql).toContain("reversed_with_shortfall");
    expect(sql).toContain("public.paypal_taint_debit(v_tx.user_id, v_tx.currency, v_delta)");
  });

  it("is service-role only", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) TO service_role",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) FROM PUBLIC",
    );
  });

  it("does NOT touch the 20261213 float bodies", () => {
    expect(sql).not.toContain("FUNCTION public.reserve_paypal_withdrawal");
    expect(sql).not.toContain("FUNCTION public.refund_paypal_withdrawal");
  });

  it("creates the billing-plan catalogue keyed by price point", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.paypal_billing_plans");
    expect(sql).toContain("UNIQUE (tier, currency, amount)");
    expect(sql).toContain("paypal_subscription_product_id");
  });
});

describe("wiring pins (D1/D2/D4/D5/D7/D8)", () => {
  const webhook = read("../../supabase/functions/paypal-webhook/index.ts");
  const checkout = read("../../supabase/functions/paypal-checkout/index.ts");
  const marketplace = read("../../supabase/functions/paypal-marketplace/index.ts");
  const processPayment = read("../../supabase/functions/process-payment/index.ts");
  const walletDeposit = read("../../supabase/functions/wallet-deposit/index.ts");
  const payoutServer = read("../../supabase/functions/_shared/paypal-payout-server.ts");
  const payoutPure = read("../../supabase/functions/_shared/paypal-payout.ts");
  const useMarketplace = read("../../src/hooks/useMarketplace.ts");

  it("webhook handles the reversal family and the real subscription sale event", () => {
    for (const t of [
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.PENDING",
      "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
      "PAYMENT.SALE.COMPLETED",
      "PAYMENT.PAYOUTS-ITEM.DENIED",
      "PAYMENT.PAYOUTS-ITEM.CANCELED",
      "PAYMENT.PAYOUTS-ITEM.REFUNDED",
    ]) {
      expect(webhook).toContain(`case '${t}'`);
    }
    expect(webhook).not.toContain("case 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED'");
    expect(webhook).toContain("reverse_paypal_credit");
    expect(webhook).toContain("'payment_failed'");
    expect(webhook).not.toContain("30 * 24 * 60 * 60 * 1000");
  });

  it("legacy paypal-checkout refuses one-time payments and, since subscriptions were removed, subscription checkouts too", () => {
    expect(checkout).toContain("ONE_TIME_DEPRECATED_MESSAGE");
    expect(checkout).toContain("SUBSCRIPTIONS_REMOVED_MESSAGE");
    // No subscription can be built any more: no plan catalogue, no
    // product lookup, no PayPal billing calls from this endpoint.
    expect(checkout).not.toContain("paypal_billing_plans");
    expect(checkout).not.toContain("paypal_subscription_product_id");
    expect(checkout).not.toContain("/v1/billing/subscriptions");
    expect(checkout).not.toContain("paypal_plan_id: billingPlanId");
    expect(checkout).not.toContain("product_id: planId");
    expect(checkout).not.toContain("/functions/v1/paypal-webhook");
  });

  it("paypal-marketplace is a refusal stub that creates no orders", () => {
    expect(marketplace).toContain("MARKETPLACE_DEPRECATED_MESSAGE");
    expect(marketplace).not.toContain("/v2/checkout/orders");
    expect(marketplace).not.toContain("Your Platform");
  });

  it("order creates carry PayPal-Request-Id and share the cached token getter (D7/D8)", () => {
    expect(processPayment).toContain("paypalOrderCurrencyRefusal");
    expect(processPayment).toContain("`paypal-order-${input.referenceId}`");
    expect(processPayment).not.toContain("oauth2/token");
    expect(walletDeposit).toContain("wallet-deposit-order-");
    expect(walletDeposit).not.toContain("oauth2/token");
    expect(payoutServer).toContain('"PayPal-Request-Id": row.id');
    expect(checkout).not.toContain("oauth2/token");
  });

  it("the false dedupe claim is gone from the payout module", () => {
    expect(payoutPure).not.toContain("PayPal dedupes");
    expect(payoutPure).not.toContain("deduped by PayPal");
    expect(payoutPure).toContain("REJECTS a");
  });

  it("client hooks no longer reach the deprecated functions for payments", () => {
    expect(useMarketplace).not.toContain("functions.invoke('paypal-marketplace'");
    // The PayPal subscription checkout hook is deleted outright
    // (subscriptions removed, CEO decision 2026-10-26 18:31): no
    // client code can invoke paypal-checkout's subscription path.
    expect(fs.existsSync(path.resolve(here, "../../src/hooks/usePayPalPayments.ts"))).toBe(false);
    expect(fs.existsSync(path.resolve(here, "../../src/components/PayPalCheckout.tsx"))).toBe(false);
  });
});
