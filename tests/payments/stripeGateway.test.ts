// Unit tests for supabase/functions/_shared/stripe-gateway.ts — the
// pure decision logic shared by the stripe-gateway-checkout and
// stripe-gateway-webhook edge functions. The module has no imports,
// so this suite loads the exact file Deno runs.
//
// The properties under test:
//   - The rail fails CLOSED: an absent/malformed gateway key is
//     "not configured", a bad webhook signature never verifies, and
//     a session settles only when it is re-queried 'paid' with the
//     exact amount, currency and ledger id of the pending row.
//   - Settlement is exactly-once at the decision layer: a replayed
//     session plans as already_completed, never as a second credit.
//   - ZMW is attempted as a first-class two-decimal currency; only a
//     genuine Stripe currency rejection may trigger the USD fallback.

import { describe, it, expect } from "vitest";
import {
  buildCheckoutSessionParams,
  canUseStripeGateway,
  fromMinorUnits,
  isStripeCurrencyRejection,
  moneyEquals,
  parseMoney,
  parseStripeSignatureHeader,
  paymentIntentIdFromChargeEvent,
  planStripeSettlement,
  sessionIdFromEvent,
  stripeErrorTrace,
  stripeEventAction,
  stripeGatewayConfig,
  stripeKeyMode,
  timingSafeEqualHex,
  toMinorUnits,
  validateStripeTopUp,
  verifyStripeSession,
  verifyStripeSignature,
  type PendingStripeDeposit,
  type StripeSessionLike,
} from "../../supabase/functions/_shared/stripe-gateway";

describe("money helpers", () => {
  it("parses numbers and numeric strings, rejects junk", () => {
    expect(parseMoney(40)).toBe(40);
    expect(parseMoney("40.50")).toBe(40.5);
    expect(parseMoney("not-a-number")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("compares money in minor units without float drift", () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(moneyEquals(40, 40.01)).toBe(false);
  });

  it("converts minor units two-decimal style, ZMW included", () => {
    expect(toMinorUnits(40)).toBe(4000);
    expect(toMinorUnits(10.5)).toBe(1050);
    expect(toMinorUnits(0.01)).toBe(1);
    expect(fromMinorUnits(4000)).toBe(40);
    expect(fromMinorUnits(1050)).toBe(10.5);
  });
});

describe("stripeKeyMode / stripeGatewayConfig (the not_configured gate)", () => {
  it("classifies test and live secret/restricted keys", () => {
    expect(stripeKeyMode("sk_test_abc123")).toBe("test");
    expect(stripeKeyMode("rk_test_abc123")).toBe("test");
    expect(stripeKeyMode("sk_live_abc123")).toBe("live");
    expect(stripeKeyMode("rk_live_abc123")).toBe("live");
  });

  it("treats absent, empty and wrong-kind values as not configured", () => {
    expect(stripeKeyMode(null)).toBeNull();
    expect(stripeKeyMode(undefined)).toBeNull();
    expect(stripeKeyMode("")).toBeNull();
    expect(stripeKeyMode("pk_test_abc123")).toBeNull(); // publishable in the secret slot
    expect(stripeKeyMode("whsec_abc123")).toBeNull(); // webhook secret in the API slot
    expect(stripeGatewayConfig(null)).toEqual({ configured: false, mode: null });
    expect(stripeGatewayConfig("")).toEqual({ configured: false, mode: null });
    expect(stripeGatewayConfig("sk_test_abc123")).toEqual({ configured: true, mode: "test" });
  });
});

describe("canUseStripeGateway (superadmin-only rail)", () => {
  it("admits admin and super_admin, refuses everyone else", () => {
    expect(canUseStripeGateway(["admin"])).toBe(true);
    expect(canUseStripeGateway(["super_admin"])).toBe(true);
    expect(canUseStripeGateway(["user", "super_admin"])).toBe(true);
    expect(canUseStripeGateway(["user"])).toBe(false);
    expect(canUseStripeGateway(["business"])).toBe(false);
    expect(canUseStripeGateway([])).toBe(false);
  });
});

describe("validateStripeTopUp (server-side price guard)", () => {
  it("accepts amounts inside the per-currency band", () => {
    expect(validateStripeTopUp(10, "ZMW")).toEqual({ ok: true });
    expect(validateStripeTopUp(100_000, "ZMW")).toEqual({ ok: true });
    expect(validateStripeTopUp(1, "USD")).toEqual({ ok: true });
    expect(validateStripeTopUp("25", "usd")).toEqual({ ok: true });
  });

  it("refuses out-of-band and malformed amounts", () => {
    expect(validateStripeTopUp(9.99, "ZMW")).toEqual({ ok: false, reason: "below_minimum" });
    expect(validateStripeTopUp(100_000.01, "ZMW")).toEqual({ ok: false, reason: "above_maximum" });
    expect(validateStripeTopUp(0.5, "USD")).toEqual({ ok: false, reason: "below_minimum" });
    expect(validateStripeTopUp(0, "USD")).toEqual({ ok: false, reason: "invalid_amount" });
    expect(validateStripeTopUp("abc", "USD")).toEqual({ ok: false, reason: "invalid_amount" });
    expect(validateStripeTopUp(10, "BTC")).toEqual({ ok: false, reason: "unsupported_currency" });
  });
});

describe("buildCheckoutSessionParams (the session-create contract)", () => {
  const params = buildCheckoutSessionParams({
    ledgerId: "ledger-123",
    userId: "user-456",
    amount: 250.5,
    currency: "ZMW",
    successUrl: "https://bmaglasspay.online/wallet?stripe_return=success",
    cancelUrl: "https://bmaglasspay.online/wallet?stripe_return=cancelled",
    customerEmail: "admin@example.com",
  });

  it("pins the ledger id as client_reference_id and mirrored metadata", () => {
    expect(params["client_reference_id"]).toBe("ledger-123");
    expect(params["metadata[ledger_id]"]).toBe("ledger-123");
    expect(params["metadata[user_id]"]).toBe("user-456");
    expect(params["payment_intent_data[metadata][ledger_id]"]).toBe("ledger-123");
    expect(params["payment_intent_data[metadata][user_id]"]).toBe("user-456");
  });

  it("encodes a card-only payment session in minor units, lowercase currency", () => {
    expect(params["mode"]).toBe("payment");
    expect(params["payment_method_types[0]"]).toBe("card");
    expect(params["line_items[0][price_data][currency]"]).toBe("zmw");
    expect(params["line_items[0][price_data][unit_amount]"]).toBe("25050");
    expect(params["line_items[0][quantity]"]).toBe("1");
    expect(params["customer_email"]).toBe("admin@example.com");
  });

  it("omits customer_email when none is known", () => {
    const bare = buildCheckoutSessionParams({
      ledgerId: "l", userId: "u", amount: 1, currency: "USD",
      successUrl: "https://x/s", cancelUrl: "https://x/c",
    });
    expect("customer_email" in bare).toBe(false);
  });
});

describe("isStripeCurrencyRejection (USD fallback trigger)", () => {
  it("recognises a genuine currency rejection", () => {
    expect(isStripeCurrencyRejection({
      type: "invalid_request_error",
      message: "The currency provided (zmw) is not supported.",
    })).toBe(true);
    expect(isStripeCurrencyRejection({
      type: "invalid_request_error", param: "line_items[0][price_data][currency]",
    })).toBe(true);
    expect(isStripeCurrencyRejection({ code: "currency_not_supported" })).toBe(true);
  });

  it("never treats other failures as a currency rejection", () => {
    expect(isStripeCurrencyRejection({
      type: "invalid_request_error", message: "Your card was declined.",
    })).toBe(false);
    expect(isStripeCurrencyRejection({ type: "api_error", message: "currency service down" })).toBe(false);
    expect(isStripeCurrencyRejection(null)).toBe(false);
    expect(isStripeCurrencyRejection(undefined)).toBe(false);
  });
});

describe("stripeErrorTrace (logs carry trace fields only)", () => {
  it("extracts status, type and code — never the message", () => {
    const body = JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "parameter_invalid",
        message: "Echo of a secret-looking value sk_test_abc",
      },
    });
    const trace = stripeErrorTrace(400, body);
    expect(trace).toEqual({ status: 400, type: "invalid_request_error", code: "parameter_invalid" });
    expect(JSON.stringify(trace)).not.toContain("sk_test_abc");
  });

  it("falls back to status alone for non-JSON bodies", () => {
    expect(stripeErrorTrace(500, "Internal Server Error")).toEqual({
      status: 500, type: null, code: null,
    });
  });
});

// ── Signature verification ─────────────────────────────────────────
// Vector computed with Node's HMAC-SHA256 over `${t}.${payload}`
// for the secret below; the exact bytes matter.
const WEBHOOK_SECRET = "whsec_unit_test_secret_not_real";
const SIGNED_PAYLOAD =
  '{"id":"evt_unit_test","type":"checkout.session.completed","data":{"object":{"id":"cs_test_unit","object":"checkout.session"}}}';
const SIGNATURE_T = 1760000000;
const SIGNATURE_V1 = "d4501a1ae7d3b277bcf58fd6dddc6ffba8af9e14e888067623c4e827ded96a5a";
const SIGNATURE_HEADER = `t=${SIGNATURE_T},v1=${SIGNATURE_V1}`;

describe("parseStripeSignatureHeader", () => {
  it("parses timestamp and every v1 candidate (rotation)", () => {
    expect(parseStripeSignatureHeader(`t=${SIGNATURE_T},v1=aaaa,v1=${SIGNATURE_V1}`)).toEqual({
      timestamp: SIGNATURE_T,
      signatures: ["aaaa", SIGNATURE_V1],
    });
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseStripeSignatureHeader(null)).toBeNull();
    expect(parseStripeSignatureHeader("")).toBeNull();
    expect(parseStripeSignatureHeader("v1=abc")).toBeNull();
    expect(parseStripeSignatureHeader(`t=${SIGNATURE_T}`)).toBeNull();
    expect(parseStripeSignatureHeader("t=notanumber,v1=abc")).toBeNull();
  });
});

describe("timingSafeEqualHex", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
  });
});

describe("verifyStripeSignature (fails closed)", () => {
  it("accepts a correctly signed payload inside the tolerance", async () => {
    await expect(
      verifyStripeSignature(SIGNED_PAYLOAD, SIGNATURE_HEADER, WEBHOOK_SECRET, 300, SIGNATURE_T + 60),
    ).resolves.toBe(true);
  });

  it("accepts when any rotated v1 candidate matches", async () => {
    await expect(
      verifyStripeSignature(
        SIGNED_PAYLOAD,
        `t=${SIGNATURE_T},v1=${"0".repeat(64)},v1=${SIGNATURE_V1}`,
        WEBHOOK_SECRET, 300, SIGNATURE_T,
      ),
    ).resolves.toBe(true);
  });

  it("rejects a tampered payload, a wrong secret and a stale timestamp", async () => {
    await expect(
      verifyStripeSignature(SIGNED_PAYLOAD.replace("cs_test_unit", "cs_test_evil"), SIGNATURE_HEADER, WEBHOOK_SECRET, 300, SIGNATURE_T),
    ).resolves.toBe(false);
    await expect(
      verifyStripeSignature(SIGNED_PAYLOAD, SIGNATURE_HEADER, "whsec_some_other_secret", 300, SIGNATURE_T),
    ).resolves.toBe(false);
    await expect(
      verifyStripeSignature(SIGNED_PAYLOAD, SIGNATURE_HEADER, WEBHOOK_SECRET, 300, SIGNATURE_T + 10_000),
    ).resolves.toBe(false);
  });

  it("rejects missing header and missing secret", async () => {
    await expect(verifyStripeSignature(SIGNED_PAYLOAD, null, WEBHOOK_SECRET, 300, SIGNATURE_T)).resolves.toBe(false);
    await expect(verifyStripeSignature(SIGNED_PAYLOAD, SIGNATURE_HEADER, null, 300, SIGNATURE_T)).resolves.toBe(false);
    await expect(verifyStripeSignature(SIGNED_PAYLOAD, SIGNATURE_HEADER, "", 300, SIGNATURE_T)).resolves.toBe(false);
  });
});

// ── Event routing ──────────────────────────────────────────────────

describe("stripeEventAction", () => {
  it("routes settlement, closure, refund and ignore", () => {
    expect(stripeEventAction("checkout.session.completed")).toBe("settle");
    expect(stripeEventAction("checkout.session.async_payment_succeeded")).toBe("settle");
    expect(stripeEventAction("checkout.session.async_payment_failed")).toBe("close_unsettled");
    expect(stripeEventAction("checkout.session.expired")).toBe("close_unsettled");
    expect(stripeEventAction("charge.refunded")).toBe("refund");
    expect(stripeEventAction("payment_intent.created")).toBe("ignore");
    expect(stripeEventAction(null)).toBe("ignore");
    expect(stripeEventAction(undefined)).toBe("ignore");
  });
});

describe("sessionIdFromEvent / paymentIntentIdFromChargeEvent", () => {
  it("extracts the session id from a well-formed session event", () => {
    const event = { type: "checkout.session.completed", data: { object: { id: "cs_test_1", object: "checkout.session" } } };
    expect(sessionIdFromEvent(event)).toBe("cs_test_1");
  });

  it("refuses non-session objects and malformed events", () => {
    expect(sessionIdFromEvent({ data: { object: { id: "ch_1", object: "charge" } } })).toBeNull();
    expect(sessionIdFromEvent({ data: { object: { id: "nope", object: "checkout.session" } } })).toBeNull();
    expect(sessionIdFromEvent(null)).toBeNull();
    expect(sessionIdFromEvent({})).toBeNull();
    expect(sessionIdFromEvent("junk")).toBeNull();
  });

  it("extracts the payment intent from a charge event", () => {
    const event = { type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_123" } } };
    expect(paymentIntentIdFromChargeEvent(event)).toBe("pi_123");
    expect(paymentIntentIdFromChargeEvent({ data: { object: { id: "ch_1" } } })).toBeNull();
    expect(paymentIntentIdFromChargeEvent(null)).toBeNull();
  });
});

// ── Settlement verification ────────────────────────────────────────

const pending: PendingStripeDeposit = {
  id: "ledger-123",
  amount: 40,
  currency: "ZMW",
  status: "pending",
  sessionId: "cs_test_1",
};

const paidSession: StripeSessionLike = {
  id: "cs_test_1",
  payment_status: "paid",
  status: "complete",
  amount_total: 4000,
  currency: "zmw",
  client_reference_id: "ledger-123",
  payment_intent: "pi_123",
  metadata: { ledger_id: "ledger-123", user_id: "user-456" },
};

describe("verifyStripeSession", () => {
  it("accepts a paid session matching amount, currency and ledger", () => {
    expect(verifyStripeSession(paidSession, pending)).toEqual({
      ok: true, paymentIntentId: "pi_123",
    });
  });

  it("accepts the ledger match via mirrored metadata alone", () => {
    const session = { ...paidSession, client_reference_id: null };
    expect(verifyStripeSession(session, pending)).toEqual({ ok: true, paymentIntentId: "pi_123" });
  });

  it("rejects an unpaid session (async methods still clearing)", () => {
    expect(verifyStripeSession({ ...paidSession, payment_status: "unpaid" }, pending)).toEqual({
      ok: false, reason: "not_paid",
    });
  });

  it("rejects amount mismatches — even one minor unit", () => {
    expect(verifyStripeSession({ ...paidSession, amount_total: 4001 }, pending)).toEqual({
      ok: false, reason: "amount_mismatch",
    });
    expect(verifyStripeSession({ ...paidSession, amount_total: 3999 }, pending)).toEqual({
      ok: false, reason: "amount_mismatch",
    });
    expect(verifyStripeSession({ ...paidSession, amount_total: null }, pending)).toEqual({
      ok: false, reason: "amount_mismatch",
    });
  });

  it("rejects currency mismatches and foreign sessions", () => {
    expect(verifyStripeSession({ ...paidSession, currency: "usd" }, pending)).toEqual({
      ok: false, reason: "currency_mismatch",
    });
    // A session from the subscription checkout (same Stripe account)
    // names a different ledger — it must never settle a deposit.
    expect(verifyStripeSession({ ...paidSession, client_reference_id: "sub_999", metadata: {} }, pending)).toEqual({
      ok: false, reason: "ledger_mismatch",
    });
    expect(verifyStripeSession({ ...paidSession, id: "cs_other" }, pending)).toEqual({
      ok: false, reason: "session_mismatch",
    });
    expect(verifyStripeSession(null, pending)).toEqual({ ok: false, reason: "missing_session" });
  });
});

describe("planStripeSettlement (exactly-once decision)", () => {
  it("allows a pending deposit to proceed to credit", () => {
    expect(planStripeSettlement(pending, "cs_test_1")).toBe("credit");
  });

  it("treats a replay of the same session as already completed", () => {
    const done: PendingStripeDeposit = { ...pending, status: "completed" };
    expect(planStripeSettlement(done, "cs_test_1")).toBe("already_completed");
  });

  it("flags a completed row carrying a different session as a conflict", () => {
    const done: PendingStripeDeposit = { ...pending, status: "completed" };
    expect(planStripeSettlement(done, "cs_other")).toBe("conflict");
  });

  it("refuses deposits that are no longer pending", () => {
    expect(planStripeSettlement({ ...pending, status: "failed" }, "cs_test_1")).toBe("not_pending");
    expect(planStripeSettlement({ ...pending, status: "cancelled" }, "cs_test_1")).toBe("not_pending");
  });
});
