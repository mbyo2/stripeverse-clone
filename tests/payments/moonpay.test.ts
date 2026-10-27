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
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import {
  buildMoonpayBuyUrl,
  buildSignedMoonpayBuyUrl,
  canApplyMoonpayStatus,
  canonicaliseIpAddress,
  canUseMoonpay,
  computeMoonpayAllowedIpAddress,
  extractMoonpayClientIp,
  isMoonpayBuyEvent,
  isStaleMoonpayTransaction,
  isTerminalMoonpayStatus,
  mapMoonpayStatus,
  moonpayAmountRejection,
  moonpayBuyHost,
  moonpayConfig,
  moonpayDeclaredKeyEnvironment,
  moonpayEnvironmentFromKey,
  MOONPAY_BUY_HOST,
  MOONPAY_COMING_SOON_MESSAGE,
  MOONPAY_NON_TERMINAL_STATUSES,
  MOONPAY_RECONCILE_STALE_MS,
  parseMoonpaySignatureHeader,
  parseMoonpayTransactionLookup,
  parseMoonpayWebhookEvent,
  planMoonpayEventApplication,
  selectStaleMoonpayTransactions,
  shouldApplyMoonpayEvent,
  signMoonpayUrl,
  verifyMoonpayWebhookSignature,
} from "../../supabase/functions/_shared/moonpay";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

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

  it("flags a pk/sk environment-prefix mismatch (audit M-4)", () => {
    expect(
      moonpayConfig({ publishableKey: "pk_live_x", secretKey: "sk_test_x" })
        .keyEnvironmentMismatch,
    ).toBe(true);
    expect(
      moonpayConfig({ publishableKey: "pk_test_x", secretKey: "sk_live_x" })
        .keyEnvironmentMismatch,
    ).toBe(true);
    expect(SANDBOX.keyEnvironmentMismatch).toBe(false);
    expect(PRODUCTION.keyEnvironmentMismatch).toBe(false);
    // A single key, or a prefix that declares nothing, cannot mismatch.
    expect(moonpayConfig({ publishableKey: "pk_live_x" }).keyEnvironmentMismatch).toBe(false);
    expect(
      moonpayConfig({ publishableKey: "garbage", secretKey: "sk_live_x" })
        .keyEnvironmentMismatch,
    ).toBe(false);
    expect(moonpayDeclaredKeyEnvironment("pk_live_x")).toBe("production");
    expect(moonpayDeclaredKeyEnvironment("sk_test_x")).toBe("sandbox");
    expect(moonpayDeclaredKeyEnvironment("wk_live_x")).toBeNull();
    expect(moonpayDeclaredKeyEnvironment(null)).toBeNull();
  });
});

describe("shouldApplyMoonpayEvent (audit M-1 order guard)", () => {
  const t = Date.parse("2026-10-26T10:00:00.000Z");

  it("applies only events newer than the row's applied stamp", () => {
    expect(shouldApplyMoonpayEvent(t, t + 1000)).toBe(true);
    expect(shouldApplyMoonpayEvent(t, t)).toBe(false); // duplicate redelivery
    expect(shouldApplyMoonpayEvent(t, t - 1000)).toBe(false); // stale
  });

  it("applies when either side carries no stamp (unorderable)", () => {
    expect(shouldApplyMoonpayEvent(null, t)).toBe(true);
    expect(shouldApplyMoonpayEvent(t, null)).toBe(true);
    expect(shouldApplyMoonpayEvent(null, null)).toBe(true);
    expect(shouldApplyMoonpayEvent(undefined, undefined)).toBe(true);
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
      externalCustomerId: "user-123",
      moonpayTransactionId: "mp_tx_42",
      updatedAt: null,
      updatedAtMs: null,
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

  it("carries the top-level externalCustomerId and data.updatedAt (audit M-1/M-2)", () => {
    const parsed = parseMoonpayWebhookEvent({
      type: "transaction_updated",
      externalCustomerId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      data: {
        id: "mp_tx_7",
        externalTransactionId: "our-ref-7",
        status: "pending",
        updatedAt: "2026-10-26T10:15:30.000Z",
      },
    });
    expect(parsed.externalCustomerId).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
    expect(parsed.updatedAt).toBe("2026-10-26T10:15:30.000Z");
    expect(parsed.updatedAtMs).toBe(Date.parse("2026-10-26T10:15:30.000Z"));
    // Missing / unparseable stamps stay null — the event is then
    // unorderable and still applies (bounded by the status machine).
    const noStamp = parseMoonpayWebhookEvent({ type: "transaction_updated", data: {} });
    expect(noStamp.externalCustomerId).toBeNull();
    expect(noStamp.updatedAtMs).toBeNull();
    const badStamp = parseMoonpayWebhookEvent({
      type: "transaction_updated",
      data: { updatedAt: "not-a-date" },
    });
    expect(badStamp.updatedAtMs).toBeNull();
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

// ── Source pins: the M-1/M-2/M-4 wiring in the functions ────────────

describe("source pins (audit M-1/M-2/M-4 wiring)", () => {
  const webhookFn = read("../../supabase/functions/moonpay-webhook/index.ts");
  const sessionFn = read("../../supabase/functions/moonpay-session/index.ts");
  const adminFn = read("../../supabase/functions/moonpay-admin/index.ts");
  const migration = read("../../supabase/migrations/20261226_moonpay_event_order_guard.sql");

  it("migration adds the applied-event stamp column", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS last_event_updated_at TIMESTAMPTZ",
    );
  });

  it("webhook orders events by updatedAt and links unmatched rows by customer id", () => {
    expect(webhookFn).toContain("planMoonpayEventApplication");
    expect(webhookFn).toContain("last_event_updated_at");
    expect(webhookFn).toContain("parsed.externalCustomerId");
    // The shared plan (which runs the order guard first) is computed
    // BEFORE the row update is written.
    expect(webhookFn.indexOf("planMoonpayEventApplication("))
      .toBeLessThan(webhookFn.indexOf(".update(plan.update)"));
    // The guard itself lives in the shared module, inside the plan.
    const shared = read("../../supabase/functions/_shared/moonpay.ts");
    const planBody = shared.slice(shared.indexOf("export function planMoonpayEventApplication"));
    expect(planBody.indexOf("shouldApplyMoonpayEvent("))
      .toBeLessThan(planBody.indexOf("const update"));
    // Tracking only, still: the webhook never writes a money table.
    expect(webhookFn).not.toContain("wallets");
  });

  it("session refuses a mismatched key pair; admin status reports it", () => {
    expect(sessionFn).toContain("config.keyEnvironmentMismatch");
    expect(sessionFn).toContain("MOONPAY_MISCONFIGURED_MESSAGE");
    expect(adminFn).toContain("keyEnvironmentMismatch: config.keyEnvironmentMismatch");
  });
});

// ── Gap closure 2026-10-27 #2: whole-amount fiat ─────────────────────

describe("moonpayAmountRejection (baseCurrencyAmount is a positive integer)", () => {
  it("accepts positive whole amounts", () => {
    expect(moonpayAmountRejection(1)).toBeNull();
    expect(moonpayAmountRejection(50)).toBeNull();
    expect(moonpayAmountRejection(10000)).toBeNull();
  });

  it("refuses fractional amounts as 'fractional' — never rounds them", () => {
    expect(moonpayAmountRejection(50.5)).toBe("fractional");
    expect(moonpayAmountRejection(0.01)).toBe("fractional");
    expect(moonpayAmountRejection(99.999)).toBe("fractional");
  });

  it("keeps the existing invalid refusals for non-positive / non-finite amounts", () => {
    expect(moonpayAmountRejection(0)).toBe("invalid");
    expect(moonpayAmountRejection(-5)).toBe("invalid");
    expect(moonpayAmountRejection(Number.NaN)).toBe("invalid");
    expect(moonpayAmountRejection(Number.POSITIVE_INFINITY)).toBe("invalid");
  });
});

// ── Gap closure 2026-10-27 #1: IP matching ───────────────────────────

describe("canonicaliseIpAddress (MoonPay's canonicalisation rules)", () => {
  it("passes a plain IPv4 through and strips leading zeros", () => {
    expect(canonicaliseIpAddress("203.0.113.42")).toBe("203.0.113.42");
    expect(canonicaliseIpAddress("203.000.113.042")).toBe("203.0.113.42");
    expect(canonicaliseIpAddress(" 198.51.100.7 ")).toBe("198.51.100.7");
  });

  it("strips ports and brackets before hashing", () => {
    expect(canonicaliseIpAddress("203.0.113.42:8443")).toBe("203.0.113.42");
    expect(canonicaliseIpAddress("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(canonicaliseIpAddress("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("canonicalises IPv6 per RFC 5952 (the docs' own example)", () => {
    expect(canonicaliseIpAddress("2001:0DB8:0000:0000:0000:0000:0000:0001"))
      .toBe("2001:db8::1");
    expect(canonicaliseIpAddress("2001:0db8:0000:0000:0000:ff00:0042:8329"))
      .toBe("2001:db8::ff00:42:8329");
    expect(canonicaliseIpAddress("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(canonicaliseIpAddress("0:0:0:0:0:0:0:0")).toBe("::");
  });

  it("compresses the FIRST of two equal zero runs, and never a single zero group", () => {
    expect(canonicaliseIpAddress("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(canonicaliseIpAddress("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
  });

  it("unmaps IPv4-mapped IPv6 to plain IPv4, dotted or hex form", () => {
    expect(canonicaliseIpAddress("::ffff:203.0.113.42")).toBe("203.0.113.42");
    expect(canonicaliseIpAddress("::ffff:cb00:712a")).toBe("203.0.113.42");
    expect(canonicaliseIpAddress("0:0:0:0:0:ffff:203.0.113.42")).toBe("203.0.113.42");
  });

  it("rejects anything that is not a usable address", () => {
    expect(canonicaliseIpAddress("999.1.1.1")).toBeNull();
    expect(canonicaliseIpAddress("1.2.3")).toBeNull();
    expect(canonicaliseIpAddress("hello")).toBeNull();
    expect(canonicaliseIpAddress("")).toBeNull();
    expect(canonicaliseIpAddress(null)).toBeNull();
    expect(canonicaliseIpAddress(undefined)).toBeNull();
    expect(canonicaliseIpAddress("2001:db8:::1")).toBeNull();
    expect(canonicaliseIpAddress("1::2::3")).toBeNull();
    expect(canonicaliseIpAddress("12345::")).toBeNull();
  });
});

describe("extractMoonpayClientIp (documented header first, gateway reality after)", () => {
  const headersOf = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });

  it("prefers True-Client-IP (MoonPay's documented source), canonicalised", () => {
    const headers = headersOf({
      "true-client-ip": "2001:0DB8:0000:0000:0000:0000:0000:0001",
      "x-forwarded-for": "198.51.100.7",
    });
    expect(extractMoonpayClientIp(headers)).toBe("2001:db8::1");
  });

  it("falls through an unusable True-Client-IP to the first X-Forwarded-For hop", () => {
    const headers = headersOf({
      "true-client-ip": "not-an-ip",
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
    });
    expect(extractMoonpayClientIp(headers)).toBe("198.51.100.7");
  });

  it("uses CF-Connecting-IP when present, honouring the pseudo-IPv4 rule", () => {
    expect(extractMoonpayClientIp(headersOf({
      "cf-connecting-ip": "198.51.100.9",
      "x-forwarded-for": "203.0.113.1",
    }))).toBe("198.51.100.9");
    // 240.0.0.0/4 placeholder → the real address is CF-Connecting-IPv6.
    expect(extractMoonpayClientIp(headersOf({
      "cf-connecting-ip": "240.0.0.9",
      "cf-connecting-ipv6": "2001:db8::5",
      "x-forwarded-for": "203.0.113.1",
    }))).toBe("2001:db8::5");
  });

  it("returns null when no header carries a usable address", () => {
    expect(extractMoonpayClientIp(headersOf({}))).toBeNull();
    expect(extractMoonpayClientIp(headersOf({ "x-forwarded-for": "unknown" }))).toBeNull();
  });
});

describe("computeMoonpayAllowedIpAddress + URL wiring", () => {
  it("matches independently computed HMAC-SHA256 vectors (node crypto)", async () => {
    // Expected values computed with node:crypto createHmac over the
    // canonical IP strings — never via the module under test.
    expect(await computeMoonpayAllowedIpAddress("203.0.113.42", "sk_test_example123"))
      .toBe("EILpZqnQwh3KV+WM/6fj05CfYomr7l+wiiUrJzMy6QE=");
    expect(await computeMoonpayAllowedIpAddress("2001:db8::1", "sk_test_example123"))
      .toBe("K5BuCD0X6Rzmi1uEzuUXbLDXoO6xLTLK8OldvcvdZhA=");
    const ip = "198.51.100.7";
    const expected = createHmac("sha256", "sk_test_example123").update(ip).digest("base64");
    expect(await computeMoonpayAllowedIpAddress(ip, "sk_test_example123")).toBe(expected);
  });

  it("places allowedIpAddress inside the signed query when given, omits it otherwise", async () => {
    const hash = "EILpZqnQwh3KV+WM/6fj05CfYomr7l+wiiUrJzMy6QE=";
    const url = buildMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-ip",
      externalCustomerId: "user-1",
      allowedIpAddress: hash,
    });
    expect(url).toContain(`&allowedIpAddress=${encodeURIComponent(hash)}`);
    expect(url.indexOf("&allowedIpAddress=")).toBeLessThan(url.indexOf("&baseCurrencyCode="));

    const bare = buildMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-ip",
    });
    expect(bare).not.toContain("allowedIpAddress");

    // The signature covers the query INCLUDING allowedIpAddress.
    const signed = await buildSignedMoonpayBuyUrl(SANDBOX, {
      walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      externalTransactionId: "ref-ip",
      externalCustomerId: "user-1",
      allowedIpAddress: hash,
    });
    const unsigned = signed.slice(0, signed.indexOf("&signature="));
    const query = unsigned.slice(unsigned.indexOf("?"));
    const expectedSig = createHmac("sha256", "sk_test_example123").update(query).digest("base64");
    expect(signed).toBe(`${unsigned}&signature=${encodeURIComponent(expectedSig)}`);
  });
});

// ── Gap closure 2026-10-27 #3: reconciliation poller ─────────────────

describe("moonpay reconcile staleness (the poller's candidate rule)", () => {
  const now = 1_800_000_000_000;
  const staleRow = {
    status: "pending",
    moonpayTransactionId: "mp_tx_1",
    updatedAtMs: now - MOONPAY_RECONCILE_STALE_MS,
  };

  it("sets the staleness threshold at 15 minutes", () => {
    expect(MOONPAY_RECONCILE_STALE_MS).toBe(15 * 60 * 1000);
    expect(MOONPAY_NON_TERMINAL_STATUSES).toEqual([
      "initiated",
      "waiting_payment",
      "pending",
      "waiting_authorization",
    ]);
  });

  it("selects stale non-terminal rows that carry a MoonPay id", () => {
    expect(isStaleMoonpayTransaction(staleRow, now)).toBe(true);
    expect(isStaleMoonpayTransaction(
      { ...staleRow, status: "initiated", updatedAtMs: null }, now,
    )).toBe(true);
    expect(isStaleMoonpayTransaction(
      { ...staleRow, updatedAtMs: now - MOONPAY_RECONCILE_STALE_MS + 1 }, now,
    )).toBe(false);
  });

  it("never selects terminal rows or rows MoonPay cannot be asked about", () => {
    expect(isStaleMoonpayTransaction({ ...staleRow, status: "completed" }, now)).toBe(false);
    expect(isStaleMoonpayTransaction({ ...staleRow, status: "failed" }, now)).toBe(false);
    expect(isStaleMoonpayTransaction(
      { ...staleRow, moonpayTransactionId: null }, now,
    )).toBe(false);
  });

  it("selectStaleMoonpayTransactions filters a mixed batch", () => {
    const rows = [
      staleRow,
      { ...staleRow, status: "completed" },
      { ...staleRow, updatedAtMs: now },
      { status: "waiting_payment", moonpayTransactionId: "mp_tx_2", updatedAtMs: now - 60 * 60 * 1000 },
    ];
    expect(selectStaleMoonpayTransactions(rows, now)).toEqual([rows[0], rows[3]]);
  });
});

describe("parseMoonpayTransactionLookup (GET /v1/transactions/{id} shape)", () => {
  const lookupPayload = {
    id: "defb7c52-7bd3-422b-9052-374df50cc51a",
    createdAt: "2026-10-27T10:00:00.000Z",
    updatedAt: "2026-10-27T10:20:00.000Z",
    baseCurrencyAmount: 50,
    quoteCurrencyAmount: 0.0008,
    feeAmount: 2.25,
    status: "completed",
    failureReason: null,
    walletAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    cryptoTransactionId: "onchain-tx-9",
    baseCurrency: { code: "usd" },
    externalCustomerId: "user-uuid-1",
    externalTransactionId: "our-ref-9",
  };

  it("parses the bare transaction object through the one webhook parser", () => {
    const parsed = parseMoonpayTransactionLookup(lookupPayload);
    expect(parsed.type).toBe("transaction_updated");
    expect(parsed.moonpayTransactionId).toBe("defb7c52-7bd3-422b-9052-374df50cc51a");
    expect(parsed.externalReference).toBe("our-ref-9");
    expect(parsed.externalCustomerId).toBe("user-uuid-1");
    expect(parsed.status).toBe("completed");
    expect(parsed.updatedAt).toBe("2026-10-27T10:20:00.000Z");
    expect(parsed.updatedAtMs).toBe(Date.parse("2026-10-27T10:20:00.000Z"));
    expect(parsed.fiatAmount).toBe(50);
    expect(parsed.fiatCurrency).toBe("USD");
    expect(parsed.cryptoAmount).toBe(0.0008);
    expect(parsed.feeAmount).toBe(2.25);
    expect(parsed.cryptoTransactionId).toBe("onchain-tx-9");
  });

  it("tolerates junk payloads like the webhook parser does", () => {
    expect(parseMoonpayTransactionLookup(null).status).toBeNull();
    expect(parseMoonpayTransactionLookup("junk").moonpayTransactionId).toBeNull();
  });
});

describe("planMoonpayEventApplication (the one application plan)", () => {
  const t0 = Date.parse("2026-10-27T10:00:00.000Z");
  const t1 = Date.parse("2026-10-27T10:20:00.000Z");
  const nowIso = "2026-10-27T10:35:00.000Z";
  const completedEvent = parseMoonpayTransactionLookup({
    id: "mp_tx_1",
    updatedAt: "2026-10-27T10:20:00.000Z",
    status: "completed",
    baseCurrencyAmount: 50,
    baseCurrency: { code: "usd" },
    externalTransactionId: "our-ref-1",
  });

  it("applies a newer event with the same update the webhook writes", () => {
    const plan = planMoonpayEventApplication(
      { status: "pending", lastEventUpdatedAtMs: t0 },
      completedEvent,
      { id: "mp_tx_1" },
      nowIso,
    );
    expect(plan.apply).toBe(true);
    expect(plan.update).toMatchObject({
      raw_status: "completed",
      last_webhook_event: "transaction_updated",
      last_event_updated_at: "2026-10-27T10:20:00.000Z",
      status: "completed",
      moonpay_transaction_id: "mp_tx_1",
      fiat_amount: 50,
      fiat_currency: "USD",
      updated_at: nowIso,
    });
  });

  it("refuses a duplicate or stale event (the order guard)", () => {
    expect(planMoonpayEventApplication(
      { status: "completed", lastEventUpdatedAtMs: t1 }, completedEvent, {}, nowIso,
    ).apply).toBe(false);
    expect(planMoonpayEventApplication(
      { status: "completed", lastEventUpdatedAtMs: t1 + 1000 }, completedEvent, {}, nowIso,
    ).apply).toBe(false);
  });

  it("never moves a terminal row's status, even for a newer event", () => {
    const latePending = parseMoonpayTransactionLookup({
      id: "mp_tx_1",
      updatedAt: "2026-10-27T10:25:00.000Z",
      status: "pending",
    });
    const plan = planMoonpayEventApplication(
      { status: "completed", lastEventUpdatedAtMs: t1 }, latePending, {}, nowIso,
    );
    expect(plan.apply).toBe(true);
    expect(plan.update?.status).toBeUndefined();
  });

  it("makes an idempotent re-poll a no-op (second application refused)", () => {
    const first = planMoonpayEventApplication(
      { status: "pending", lastEventUpdatedAtMs: t0 }, completedEvent, {}, nowIso,
    );
    expect(first.apply).toBe(true);
    // The row as the first application left it:
    const rowAfter = {
      status: (first.update?.status as string) ?? "pending",
      lastEventUpdatedAtMs: Date.parse(first.update?.last_event_updated_at as string),
    };
    const second = planMoonpayEventApplication(rowAfter, completedEvent, {}, nowIso);
    expect(second.apply).toBe(false);
    expect(second.update).toBeNull();
  });

  it("labels poller applications so the audit trail can tell them apart", () => {
    const plan = planMoonpayEventApplication(
      { status: "pending", lastEventUpdatedAtMs: t0 },
      completedEvent,
      { id: "mp_tx_1" },
      nowIso,
      "reconcile_poll",
    );
    expect(plan.update?.last_webhook_event).toBe("reconcile_poll");
  });
});

// ── Wallet-mode messaging (CEO directive 2026-10-27) ────────────────

describe("wallet-mode messaging (custodial available soon, self-custody live)", () => {
  it("the custodial off-state message names both modes truthfully", () => {
    expect(MOONPAY_COMING_SOON_MESSAGE).toContain("available soon");
    expect(MOONPAY_COMING_SOON_MESSAGE).toContain("custodial wallet");
    expect(MOONPAY_COMING_SOON_MESSAGE).toContain("self-custody wallet");
    expect(MOONPAY_COMING_SOON_MESSAGE).toContain("No money has moved");
  });

  it("the self-custody kill-switch migration defaults ON (the rail is already live)", () => {
    const migration = read("../../supabase/migrations/20261239_moonpay_selfcustody_flag.sql");
    expect(migration).toContain("moonpay_selfcustody_enabled");
    expect(migration).toContain("DEFAULT true");
  });

  it("moonpay-session has no self-custody mode and never takes a caller address", () => {
    const sessionFn = read("../../supabase/functions/moonpay-session/index.ts");
    // The delivery address always comes from the platform assignment…
    expect(sessionFn).toContain("getOrAssignDepositAddress");
    expect(sessionFn).toContain("walletAddress: depositAddress");
    // …never from the request body.
    expect(sessionFn).not.toContain("body.walletAddress");
    expect(sessionFn).not.toContain("body.deliveryAddress");
  });
});

// ── Source pins: the gap-closure wiring ──────────────────────────────

describe("source pins (gap closure 2026-10-27 wiring)", () => {
  const sessionFn = read("../../supabase/functions/moonpay-session/index.ts");
  const reconcileFn = read("../../supabase/functions/moonpay-reconcile/index.ts");
  const cronMigration = read("../../supabase/migrations/20261238_moonpay_reconcile_cron.sql");
  const configToml = read("../../supabase/config.toml");

  it("session validates whole amounts and binds the caller IP into the signed URL", () => {
    expect(sessionFn).toContain("moonpayAmountRejection");
    expect(sessionFn).toContain("MOONPAY_WHOLE_AMOUNT_MESSAGE");
    expect(sessionFn).toContain("extractMoonpayClientIp(req.headers)");
    expect(sessionFn).toContain("computeMoonpayAllowedIpAddress");
    expect(sessionFn).toContain("MOONPAY_IP_UNVERIFIED_MESSAGE");
    expect(sessionFn).toContain("allowedIpAddress");
  });

  it("reconcile is scheduler-gated and reuses the shared plan, parser and selector", () => {
    expect(reconcileFn).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(reconcileFn).toContain("selectStaleMoonpayTransactions");
    expect(reconcileFn).toContain("parseMoonpayTransactionLookup");
    expect(reconcileFn).toContain("planMoonpayEventApplication");
    expect(reconcileFn).toContain("api.moonpay.com/v1/transactions");
    // Tracking only, like the webhook: never a money table.
    expect(reconcileFn).not.toContain("wallets");
  });

  it("the cron migration schedules the poller with the Vault service key", () => {
    expect(cronMigration).toContain("cron.schedule(");
    expect(cronMigration).toContain("'moonpay-reconcile'");
    expect(cronMigration).toContain("'*/15 * * * *'");
    expect(cronMigration).toContain("functions/v1/moonpay-reconcile");
    expect(cronMigration).toContain("service_role_key");
  });

  it("the reconcile function keeps gateway JWT verification on", () => {
    expect(configToml).toContain("[functions.moonpay-reconcile]\nverify_jwt = true");
  });
});
