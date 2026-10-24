// Unit tests for supabase/functions/_shared/moonpay.ts — the pure
// decision logic shared by the moonpay-session, moonpay-webhook and
// moonpay-admin edge functions. The module has no imports, so this
// suite loads the exact file Deno runs.
//
// The properties under test:
//   - The DOCUMENTED MoonPay signing vector reproduces exactly
//     (contract: moonpay-api-contract.md, verified 2026-10-24).
//   - The rail fails CLOSED: missing keys are "not configured", a
//     bad webhook signature never verifies.
//   - Webhook status application is terminal-sticky: MoonPay
//     delivery is at-least-once and unordered, so a late event can
//     never regress a completed / failed purchase.
//   - ZMW is never a MoonPay fiat here: the config carries no ZMW
//     path and sessions default to USD (asserted via the URL build).

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildMoonpayBuyUrl,
  buildSignedMoonpayBuyUrl,
  canApplyMoonpayStatus,
  canUseMoonpay,
  isMoonpayBuyEvent,
  isTerminalMoonpayStatus,
  mapMoonpayStatus,
  moonpayBuyHost,
  moonpayConfig,
  moonpayEnvironmentFromKey,
  MOONPAY_BUY_HOST,
  parseMoonpaySignatureHeader,
  parseMoonpayWebhookEvent,
  signMoonpayUrl,
  verifyMoonpayWebhookSignature,
} from "../../supabase/functions/_shared/moonpay";

const SANDBOX = moonpayConfig({
  publishableKey: "pk_test_example123",
  secretKey: "sk_test_example123",
  webhookKey: "wk_test_example123",
});
const PRODUCTION = moonpayConfig({
  publishableKey: "pk_live_example123",
  secretKey: "sk_live_example123",
  webhookKey: "wk_live_example123",
});

// ── Config ───────────────────────────────────────────────────────────

describe("moonpayConfig (the not_configured gate)", () => {
  it("is configured only with both the publishable and secret keys", () => {
    expect(SANDBOX.configured).toBe(true);
    expect(moonpayConfig({ publishableKey: "pk_test_x" }).configured).toBe(false);
    expect(moonpayConfig({ secretKey: "sk_test_x" }).configured).toBe(false);
    expect(moonpayConfig({ publishableKey: "", secretKey: "" }).configured).toBe(false);
    expect(moonpayConfig({}).configured).toBe(false);
    expect(moonpayConfig({ publishableKey: null, secretKey: null }).configured).toBe(false);
  });

  it("tracks the webhook key separately", () => {
    expect(SANDBOX.hasWebhookKey).toBe(true);
    expect(moonpayConfig({ publishableKey: "pk_test_x", secretKey: "sk_test_x" }).hasWebhookKey)
      .toBe(false);
  });

  it("detects environment from the key prefix", () => {
    expect(moonpayEnvironmentFromKey("pk_test_x")).toBe("sandbox");
    expect(moonpayEnvironmentFromKey("sk_test_x")).toBe("sandbox");
    expect(moonpayEnvironmentFromKey("pk_live_x")).toBe("production");
    expect(moonpayEnvironmentFromKey("sk_live_x")).toBe("production");
    expect(moonpayEnvironmentFromKey(null)).toBe("sandbox");
    expect(moonpayEnvironmentFromKey("garbage")).toBe("sandbox");
    expect(SANDBOX.environment).toBe("sandbox");
    expect(PRODUCTION.environment).toBe("production");
  });

  it("maps environments to the documented hosts", () => {
    expect(MOONPAY_BUY_HOST.sandbox).toBe("https://buy-sandbox.moonpay.com");
    expect(MOONPAY_BUY_HOST.production).toBe("https://buy.moonpay.com");
    expect(moonpayBuyHost("sandbox")).toBe("https://buy-sandbox.moonpay.com");
    expect(moonpayBuyHost("production")).toBe("https://buy.moonpay.com");
  });
});

// ── URL signing: the documented vector ───────────────────────────────

describe("signMoonpayUrl (documented signing vector)", () => {
  it("reproduces MoonPay's documented test vector exactly", async () => {
    const url =
      "https://buy-sandbox.moonpay.com/?apiKey=pk_test_DocsVector00&currencyCode=eth&walletAddress=0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
    const signed = await signMoonpayUrl(url, "sk_test_DocsVector00");
    // Expected base64: oIJxSghyzll/BLhUFdQZhkxf7DAS8REFaWr/ibO+K8Q=
    // appended URL-encoded:
    expect(signed).toBe(
      url + "&signature=oIJxSghyzll%2FBLhUFdQZhkxf7DAS8REFaWr%2FibO%2BK8Q%3D",
    );
  });

  it("signs over the query string including the leading '?'", async () => {
    // Independent recomputation with node crypto.
    const url = buildMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qexampleaddress000000000000000000000",
      externalTransactionId: "11111111-2222-3333-4444-555555555555",
    });
    const signed = await signMoonpayUrl(url, "sk_test_example123");
    const query = url.slice(url.indexOf("?"));
    const expected = createHmac("sha256", "sk_test_example123").update(query).digest("base64");
    expect(signed).toBe(`${url}&signature=${encodeURIComponent(expected)}`);
  });
});

// ── Buy URL building ─────────────────────────────────────────────────

describe("buildMoonpayBuyUrl", () => {
  it("emits parameters in the fixed documented order, values encoded", () => {
    const url = buildMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      email: "buyer@example.com",
      externalTransactionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      externalCustomerId: "user-123",
      baseCurrencyCode: "USD",
      baseCurrencyAmount: 50,
      redirectUrl: "https://bmaglasspay.online/bitcoin",
    });
    expect(url).toBe(
      "https://buy-sandbox.moonpay.com/?apiKey=pk_test_example123" +
        "&currencyCode=btc" +
        "&walletAddress=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" +
        "&email=buyer%40example.com" +
        "&externalTransactionId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" +
        "&externalCustomerId=user-123" +
        "&baseCurrencyCode=usd" +
        "&baseCurrencyAmount=50" +
        "&redirectURL=https%3A%2F%2Fbmaglasspay.online%2Fbitcoin",
    );
  });

  it("omits optional parameters that were not given", () => {
    const url = buildMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-1",
    });
    expect(url).not.toContain("email=");
    expect(url).not.toContain("externalCustomerId=");
    expect(url).not.toContain("baseCurrencyAmount=");
    expect(url).not.toContain("redirectURL=");
    // Default fiat is USD — never ZMW.
    expect(url).toContain("baseCurrencyCode=usd");
    expect(url.toLowerCase()).not.toContain("zmw");
  });

  it("uses the production host for live keys", () => {
    const url = buildMoonpayBuyUrl(PRODUCTION, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-1",
    });
    expect(url.startsWith("https://buy.moonpay.com/?apiKey=pk_live_example123")).toBe(true);
  });

  it("builds a signed URL end to end", async () => {
    const signed = await buildSignedMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-9",
    });
    expect(signed).toContain("&signature=");
    const unsigned = signed.slice(0, signed.indexOf("&signature="));
    const query = unsigned.slice(unsigned.indexOf("?"));
    const expected = createHmac("sha256", "sk_test_example123").update(query).digest("base64");
    expect(signed).toBe(`${unsigned}&signature=${encodeURIComponent(expected)}`);
  });
});

// ── Roles ────────────────────────────────────────────────────────────

describe("canUseMoonpay (admin role set)", () => {
  it("admits admin and super_admin, refuses everyone else", () => {
    expect(canUseMoonpay(["admin"])).toBe(true);
    expect(canUseMoonpay(["super_admin"])).toBe(true);
    expect(canUseMoonpay(["user"])).toBe(false);
    expect(canUseMoonpay([])).toBe(false);
  });
});

// ── Webhook signature verification ───────────────────────────────────

describe("verifyMoonpayWebhookSignature", () => {
  const webhookKey = "wk_test_example123";
  const body = JSON.stringify({
    type: "transaction_updated",
    data: { id: "mp_tx_1", status: "pending", externalTransactionId: "ref-1" },
  });
  // Independent implementation: node crypto, never the module under test.
  const headerFor = (rawBody: string, t = "1700000000") => {
    const s = createHmac("sha256", webhookKey).update(`${t}.${rawBody}`).digest("hex");
    return `t=${t},s=${s}`;
  };

  it("accepts a correctly signed payload", async () => {
    expect(await verifyMoonpayWebhookSignature(body, headerFor(body), webhookKey)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const tampered = body.replace("pending", "completed");
    expect(await verifyMoonpayWebhookSignature(tampered, headerFor(body), webhookKey)).toBe(false);
  });

  it("rejects missing or garbage headers and a missing key", async () => {
    expect(await verifyMoonpayWebhookSignature(body, null, webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, undefined, webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, "", webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, "garbage", webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, "t=123", webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, "s=abc", webhookKey)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, headerFor(body), null)).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, headerFor(body), "")).toBe(false);
    expect(await verifyMoonpayWebhookSignature(body, headerFor(body), "wrong-key")).toBe(false);
  });

  it("parses the t=/s= header shape", () => {
    expect(parseMoonpaySignatureHeader("t=1700000000,s=abcdef")).toEqual({
      timestamp: "1700000000",
      signature: "abcdef",
    });
    expect(parseMoonpaySignatureHeader(null)).toBeNull();
    expect(parseMoonpaySignatureHeader("nope")).toBeNull();
  });
});

// ── Status machine ───────────────────────────────────────────────────

describe("mapMoonpayStatus", () => {
  it("maps all five documented statuses", () => {
    expect(mapMoonpayStatus("waitingPayment")).toBe("waiting_payment");
    expect(mapMoonpayStatus("pending")).toBe("pending");
    expect(mapMoonpayStatus("waitingAuthorization")).toBe("waiting_authorization");
    expect(mapMoonpayStatus("completed")).toBe("completed");
    expect(mapMoonpayStatus("failed")).toBe("failed");
  });

  it("maps unknown statuses to null", () => {
    expect(mapMoonpayStatus("somethingElse")).toBeNull();
    expect(mapMoonpayStatus("")).toBeNull();
    expect(mapMoonpayStatus(null)).toBeNull();
    expect(mapMoonpayStatus(undefined)).toBeNull();
  });
});

describe("canApplyMoonpayStatus (terminal-sticky)", () => {
  it("lets non-terminal rows move anywhere mapped", () => {
    expect(canApplyMoonpayStatus("initiated", "pending")).toBe(true);
    expect(canApplyMoonpayStatus("initiated", "completed")).toBe(true);
    expect(canApplyMoonpayStatus("waiting_payment", "failed")).toBe(true);
    expect(canApplyMoonpayStatus("pending", "waiting_authorization")).toBe(true);
    expect(canApplyMoonpayStatus("waiting_authorization", "completed")).toBe(true);
  });

  it("never regresses a terminal row", () => {
    expect(canApplyMoonpayStatus("completed", "pending")).toBe(false);
    expect(canApplyMoonpayStatus("completed", "failed")).toBe(false);
    expect(canApplyMoonpayStatus("failed", "completed")).toBe(false);
    expect(canApplyMoonpayStatus("failed", "pending")).toBe(false);
  });

  it("refuses an unmapped next status", () => {
    expect(canApplyMoonpayStatus("initiated", null)).toBe(false);
    expect(canApplyMoonpayStatus("pending", null)).toBe(false);
  });

  it("knows the terminal set", () => {
    expect(isTerminalMoonpayStatus("completed")).toBe(true);
    expect(isTerminalMoonpayStatus("failed")).toBe(true);
    expect(isTerminalMoonpayStatus("pending")).toBe(false);
    expect(isTerminalMoonpayStatus(null)).toBe(false);
  });
});

// ── Webhook event parsing ────────────────────────────────────────────

describe("parseMoonpayWebhookEvent", () => {
  it("extracts the tracking fields from a buy payload", () => {
    const parsed = parseMoonpayWebhookEvent({
      type: "transaction_updated",
      externalCustomerId: "user-123",
      data: {
        id: "mp_tx_42",
        externalTransactionId: "our-ref-1",
        status: "completed",
        baseCurrencyAmount: 100.5,
        baseCurrency: { code: "usd" },
        quoteCurrencyAmount: 0.0015,
        feeAmount: 4.5,
        walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        cryptoTransactionId: "onchain-tx-1",
      },
    });
    expect(parsed).toEqual({
      type: "transaction_updated",
      externalReference: "our-ref-1",
      moonpayTransactionId: "mp_tx_42",
      rawStatus: "completed",
      status: "completed",
      fiatAmount: 100.5,
      fiatCurrency: "USD",
      cryptoAmount: 0.0015,
      feeAmount: 4.5,
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      cryptoTransactionId: "onchain-tx-1",
      failureReason: null,
    });
  });

  it("carries the failure reason on a failed event", () => {
    const parsed = parseMoonpayWebhookEvent({
      type: "transaction_failed",
      data: { id: "mp_tx_9", status: "failed", failureReason: "card_declined" },
    });
    expect(parsed.status).toBe("failed");
    expect(parsed.failureReason).toBe("card_declined");
  });

  it("tolerates missing fields and junk bodies", () => {
    const empty = parseMoonpayWebhookEvent({});
    expect(empty.type).toBeNull();
    expect(empty.externalReference).toBeNull();
    expect(empty.status).toBeNull();
    expect(parseMoonpayWebhookEvent(null).moonpayTransactionId).toBeNull();
    expect(parseMoonpayWebhookEvent("junk").rawStatus).toBeNull();
    expect(parseMoonpayWebhookEvent(undefined).fiatAmount).toBeNull();
  });

  it("recognises exactly the three buy event types", () => {
    expect(isMoonpayBuyEvent("transaction_created")).toBe(true);
    expect(isMoonpayBuyEvent("transaction_updated")).toBe(true);
    expect(isMoonpayBuyEvent("transaction_failed")).toBe(true);
    expect(isMoonpayBuyEvent("sell_transaction_updated")).toBe(false);
    expect(isMoonpayBuyEvent(null)).toBe(false);
  });
});
