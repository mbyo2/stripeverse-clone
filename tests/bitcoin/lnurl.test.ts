// Unit tests for supabase/functions/_shared/lnurl.ts — the LNURL
// layer behind lightning-service's lnurl_pay_resolve / lnurl_pay /
// lnurl_withdraw actions (close-out B2), plus source proofs for the
// edge actions and the LnurlSend UI.
//
// The module is dependency-free (its own bech32 decoder included),
// so it is imported directly — same pattern as
// tests/bitcoin/lightning-provider.test.ts. Fetch is stubbed; no
// network is touched.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LnurlUpstreamError,
  LnurlUserError,
  assertSafeLnurlUrl,
  bech32Decode,
  buildLnurlPayCallbackUrl,
  buildLnurlWithdrawCallbackUrl,
  classifyLnurlInput,
  decodeLnurlToUrl,
  fetchLnurlJson,
  fetchLnurlPayInvoice,
  isLightningAddress,
  isPrivateIpv4Octets,
  isPrivateIpv6,
  lightningAddressToUrl,
  lnurlFlowKind,
  lnurlInputToUrl,
  parseLnurlMetadata,
  parseLnurlParams,
  parseLnurlPayCallbackResponse,
  parseLnurlPayParams,
  parseLnurlWithdrawCallbackResponse,
  parseLnurlWithdrawParams,
  resolveLnurlParams,
  submitLnurlWithdraw,
  validateLnurlComment,
  validateLnurlPayAmount,
  validateLnurlWithdrawAmount,
} from "../../supabase/functions/_shared/lnurl";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// Generated with @scure/base bech32 over the UTF-8 of the URL (the
// canonical LNURL encoding) and pinned here as a literal, so the
// decoder is tested against a value known outside this module:
//   lnurl1dp68…vq  ⇔  https://example.com/.well-known/lnurlp/alice
const LNURL_ALICE =
  "lnurl1dp68gurn8ghj7etcv9khqmr99e3k7mf09emk2mrv944kummhdchkcmn4wfk8qtmpd35kxeg9saevq";
const LNURL_ALICE_URL = "https://example.com/.well-known/lnurlp/alice";

const METADATA = JSON.stringify([
  ["text/plain", "Pay Alice"],
  ["text/identifier", "alice@example.com"],
]);

function payPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag: "payRequest",
    callback: "https://example.com/lnurl-pay/callback",
    minSendable: 1_000,
    maxSendable: 100_000_000,
    metadata: METADATA,
    commentAllowed: 140,
    ...overrides,
  };
}

function withdrawPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag: "withdrawRequest",
    callback: "https://example.com/lnurl-withdraw/callback",
    k1: "a".repeat(64),
    minWithdrawable: 1_000,
    maxWithdrawable: 50_000_000,
    defaultDescription: "Withdraw from Example",
    ...overrides,
  };
}

const FETCHED = new URL("https://example.com/.well-known/lnurlp/alice");

function stubFetchJson(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  }));
  return fetchMock as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bech32 decode (LNURL)", () => {
  it("decodes the pinned LNURL vector to its URL", () => {
    expect(decodeLnurlToUrl(LNURL_ALICE)).toBe(LNURL_ALICE_URL);
  });

  it("accepts the all-uppercase form (BIP-173) and a lightning: prefix is the classifier's job", () => {
    expect(decodeLnurlToUrl(LNURL_ALICE.toUpperCase())).toBe(LNURL_ALICE_URL);
  });

  it("rejects a corrupted checksum", () => {
    const corrupted = LNURL_ALICE.slice(0, -1) + (LNURL_ALICE.endsWith("q") ? "p" : "q");
    expect(decodeLnurlToUrl(corrupted)).toBeNull();
    expect(bech32Decode(corrupted)).toBeNull();
  });

  it("rejects mixed case, wrong HRP, and non-bech32 input", () => {
    expect(decodeLnurlToUrl("Lnurl1dp68gurn8ghj7etc")).toBeNull();
    expect(decodeLnurlToUrl("lnbc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9qy9qsq")).toBeNull();
    expect(decodeLnurlToUrl("not-a-lnurl")).toBeNull();
    expect(decodeLnurlToUrl("")).toBeNull();
  });
});

describe("input classification + address resolution", () => {
  it("classifies each input family", () => {
    expect(classifyLnurlInput("alice@example.com")).toBe("lightning_address");
    expect(classifyLnurlInput(LNURL_ALICE)).toBe("lnurl_bech32");
    expect(classifyLnurlInput(`lightning:${LNURL_ALICE}`)).toBe("lnurl_bech32");
    expect(classifyLnurlInput("lightning:alice@example.com")).toBe("lightning_address");
    expect(classifyLnurlInput("https://example.com/some-lnurl-endpoint")).toBe("lnurl_url");
    expect(classifyLnurlInput("lnbc1000n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9qy9qsq")).toBe("bolt11");
    expect(classifyLnurlInput("http://example.com/insecure")).toBe("unknown");
    expect(classifyLnurlInput("hello world")).toBe("unknown");
    expect(classifyLnurlInput("")).toBe("unknown");
  });

  it("maps a Lightning address to its .well-known URL (LUD-16)", () => {
    expect(lightningAddressToUrl("alice@example.com")).toBe(LNURL_ALICE_URL);
    expect(lightningAddressToUrl("Alice@Example.COM")).toBe(LNURL_ALICE_URL);
    expect(isLightningAddress("alice@example.com")).toBe(true);
    expect(isLightningAddress("alice@nodot")).toBe(false);
    expect(isLightningAddress("@example.com")).toBe(false);
  });

  it("resolves every family to a fetch URL, and refuses a bolt11 as LNURL", () => {
    expect(lnurlInputToUrl("alice@example.com")).toBe(LNURL_ALICE_URL);
    expect(lnurlInputToUrl(LNURL_ALICE)).toBe(LNURL_ALICE_URL);
    expect(() => lnurlInputToUrl("lnbc1000n1qqqqqq")).toThrow(LnurlUserError);
    expect(() => lnurlInputToUrl("???")).toThrow(LnurlUserError);
  });
});

describe("SSRF guards", () => {
  it("accepts an ordinary public https URL", () => {
    expect(assertSafeLnurlUrl("https://example.com/path?x=1").hostname).toBe("example.com");
  });

  it("refuses http, credentials, localhost, and empty hosts", () => {
    expect(() => assertSafeLnurlUrl("http://example.com/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://user:pass@example.com/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://localhost/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://foo.localhost/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("not a url")).toThrow(LnurlUserError);
  });

  it("refuses private / loopback / link-local IPv4 literals", () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0"]) {
      expect(() => assertSafeLnurlUrl(`https://${host}/`)).toThrow(LnurlUserError);
    }
    // Public ranges just outside the private blocks stay allowed.
    expect(assertSafeLnurlUrl("https://172.32.0.1/").hostname).toBe("172.32.0.1");
    expect(assertSafeLnurlUrl("https://8.8.8.8/").hostname).toBe("8.8.8.8");
    expect(isPrivateIpv4Octets([172, 15, 0, 1])).toBe(false);
    expect(isPrivateIpv4Octets([172, 16, 0, 1])).toBe(true);
  });

  it("refuses private IPv6 literals incl. v4-mapped loopback", () => {
    expect(() => assertSafeLnurlUrl("https://[::1]/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://[fe80::1]/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://[fd00::1]/")).toThrow(LnurlUserError);
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
  });

  it("refuses numeric-obfuscated IP hostnames", () => {
    expect(() => assertSafeLnurlUrl("https://2130706433/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://0x7f000001/")).toThrow(LnurlUserError);
    expect(() => assertSafeLnurlUrl("https://0177.0.0.1/")).toThrow(LnurlUserError);
  });

  it("a redirect to a private address is refused, never followed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 302,
      headers: { get: (n: string) => (n === "location" ? "https://169.254.169.254/latest" : null) },
      text: async () => "",
      json: async () => ({}),
    }));
    await expect(
      fetchLnurlJson("https://example.com/start", { fetchFn: fetchMock as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(LnurlUserError);
    // Exactly one fetch happened: the redirect target was validated
    // BEFORE any request to it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an oversized response is refused as an upstream failure", async () => {
    const big = "x".repeat(70_000);
    await expect(
      fetchLnurlJson("https://example.com/big", { fetchFn: stubFetchJson(big) }),
    ).rejects.toBeInstanceOf(LnurlUpstreamError);
  });

  it("a non-JSON response is an upstream failure, not user copy", async () => {
    await expect(
      fetchLnurlJson("https://example.com/html", { fetchFn: stubFetchJson("<html>nope</html>") }),
    ).rejects.toBeInstanceOf(LnurlUpstreamError);
  });
});

describe("pay parameter parsing (LUD-06/16)", () => {
  it("parses bounds, metadata, and comment allowance", () => {
    const params = parseLnurlPayParams(payPayload(), FETCHED);
    expect(params.kind).toBe("pay");
    expect(params.domain).toBe("example.com");
    expect(params.callbackDomain).toBe("example.com");
    expect(params.minSats).toBe(1);
    expect(params.maxSats).toBe(100_000);
    expect(params.fixedAmountSats).toBeNull();
    expect(params.description).toBe("Pay Alice");
    expect(params.identifier).toBe("alice@example.com");
    expect(params.commentAllowed).toBe(140);
  });

  it("detects a fixed amount only when min == max in whole sats", () => {
    const fixed = parseLnurlPayParams(payPayload({ minSendable: 21_000, maxSendable: 21_000 }), FETCHED);
    expect(fixed.fixedAmountSats).toBe(21);
    const subSat = payPayload({ minSendable: 1_500, maxSendable: 1_500 });
    expect(() => parseLnurlPayParams(subSat, FETCHED)).toThrow(LnurlUserError);
  });

  it("rounds bounds honestly: min up, max down to whole sats", () => {
    const params = parseLnurlPayParams(payPayload({ minSendable: 1_500, maxSendable: 2_500 }), FETCHED);
    expect(params.minSats).toBe(2);
    expect(params.maxSats).toBe(2);
  });

  it("an endpoint ERROR answer becomes crafted user copy (reason never leaks)", () => {
    try {
      parseLnurlPayParams({ status: "ERROR", reason: "raw internal detail xyz" }, FETCHED);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LnurlUserError);
      expect((e as Error).message).toContain("example.com");
      expect((e as Error).message).not.toContain("raw internal detail");
    }
  });

  it("a non-pay tag, missing callback, or unsafe callback is an upstream failure", () => {
    expect(() => parseLnurlPayParams(payPayload({ tag: "channelRequest" }), FETCHED)).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlPayParams(payPayload({ callback: "" }), FETCHED)).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlPayParams(payPayload({ callback: "http://example.com/cb" }), FETCHED)).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlPayParams(payPayload({ callback: "https://127.0.0.1/cb" }), FETCHED)).toThrow(LnurlUpstreamError);
  });

  it("metadata parsing extracts text/plain + identifier and refuses junk", () => {
    expect(parseLnurlMetadata(METADATA)).toEqual({ description: "Pay Alice", identifier: "alice@example.com" });
    expect(() => parseLnurlMetadata("not json")).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlMetadata("")).toThrow(LnurlUpstreamError);
  });
});

describe("withdraw parameter parsing (LUD-03)", () => {
  it("parses k1, bounds, and the default description", () => {
    const params = parseLnurlWithdrawParams(withdrawPayload(), FETCHED);
    expect(params.kind).toBe("withdraw");
    expect(params.k1).toBe("a".repeat(64));
    expect(params.minSats).toBe(1);
    expect(params.maxSats).toBe(50_000);
    expect(params.defaultDescription).toBe("Withdraw from Example");
  });

  it("a missing k1 or bad bounds is an upstream failure", () => {
    expect(() => parseLnurlWithdrawParams(withdrawPayload({ k1: "" }), FETCHED)).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlWithdrawParams(withdrawPayload({ maxWithdrawable: 10 }), FETCHED)).toThrow(LnurlUpstreamError);
  });

  it("parseLnurlParams dispatches on the tag; flow kind follows", () => {
    expect(parseLnurlParams(payPayload(), FETCHED).kind).toBe("pay");
    expect(parseLnurlParams(withdrawPayload(), FETCHED).kind).toBe("withdraw");
    expect(lnurlFlowKind(parseLnurlParams(payPayload(), FETCHED))).toBe("pay");
    expect(lnurlFlowKind(parseLnurlParams(withdrawPayload(), FETCHED))).toBe("withdraw");
  });
});

describe("amount + comment validation", () => {
  const pay = parseLnurlPayParams(payPayload(), FETCHED);
  const withdraw = parseLnurlWithdrawParams(withdrawPayload(), FETCHED);

  it("accepts amounts inside the bounds and converts to msat exactly", () => {
    expect(validateLnurlPayAmount(pay, 21)).toEqual({ amountSats: 21, amountMsat: 21_000 });
    expect(validateLnurlWithdrawAmount(withdraw, 50_000)).toEqual({ amountSats: 50_000, amountMsat: 50_000_000 });
  });

  it("refuses amounts outside the endpoint's bounds with plain language", () => {
    expect(() => validateLnurlPayAmount(pay, 100_001)).toThrow(/at most/);
    expect(() => validateLnurlWithdrawAmount(withdraw, 50_001)).toThrow(/at most/);
    expect(() => validateLnurlPayAmount(pay, null)).toThrow(LnurlUserError);
    expect(() => validateLnurlPayAmount(pay, 0)).toThrow(LnurlUserError);
  });

  it("a fixed-amount endpoint adopts or enforces its amount", () => {
    const fixed = parseLnurlPayParams(payPayload({ minSendable: 21_000, maxSendable: 21_000 }), FETCHED);
    expect(validateLnurlPayAmount(fixed, null)).toEqual({ amountSats: 21, amountMsat: 21_000 });
    expect(validateLnurlPayAmount(fixed, 21).amountSats).toBe(21);
    expect(() => validateLnurlPayAmount(fixed, 22)).toThrow(/fixed at/);
  });

  it("comments are bounded by commentAllowed (LUD-12)", () => {
    expect(validateLnurlComment(pay, "thanks!")).toBe("thanks!");
    expect(validateLnurlComment(pay, "   ")).toBeNull();
    expect(() => validateLnurlComment(pay, "x".repeat(141))).toThrow(/too long/);
    const noComment = parseLnurlPayParams(payPayload({ commentAllowed: 0 }), FETCHED);
    expect(() => validateLnurlComment(noComment, "hi")).toThrow(/doesn't accept a note/);
  });
});

describe("callback URL building + callback answers", () => {
  const pay = parseLnurlPayParams(payPayload({ callback: "https://example.com/cb?session=abc" }), FETCHED);
  const withdraw = parseLnurlWithdrawParams(withdrawPayload(), FETCHED);

  it("the pay callback carries amount in MSAT and the comment, preserving existing params", () => {
    const url = new URL(buildLnurlPayCallbackUrl(pay, 21_000, "for coffee"));
    expect(url.searchParams.get("amount")).toBe("21000");
    expect(url.searchParams.get("comment")).toBe("for coffee");
    expect(url.searchParams.get("session")).toBe("abc");
    const noComment = new URL(buildLnurlPayCallbackUrl(pay, 1_000));
    expect(noComment.searchParams.has("comment")).toBe(false);
  });

  it("the withdraw callback carries k1 and the invoice as pr", () => {
    const url = new URL(buildLnurlWithdrawCallbackUrl(withdraw, "lnbc210n1example"));
    expect(url.searchParams.get("k1")).toBe("a".repeat(64));
    expect(url.searchParams.get("pr")).toBe("lnbc210n1example");
  });

  it("callback answers: pr extraction, ERROR mapping, withdraw OK", () => {
    expect(parseLnurlPayCallbackResponse({ pr: "lnbc1xyz", routes: [] }, "example.com")).toEqual({ bolt11: "lnbc1xyz" });
    expect(() => parseLnurlPayCallbackResponse({ status: "ERROR", reason: "nope" }, "example.com")).toThrow(LnurlUserError);
    expect(() => parseLnurlPayCallbackResponse({}, "example.com")).toThrow(LnurlUpstreamError);
    expect(() => parseLnurlWithdrawCallbackResponse({ status: "OK" }, "example.com")).not.toThrow();
    expect(() => parseLnurlWithdrawCallbackResponse({ status: "ERROR", reason: "no" }, "example.com")).toThrow(LnurlUserError);
    expect(() => parseLnurlWithdrawCallbackResponse({}, "example.com")).toThrow(LnurlUpstreamError);
  });
});

describe("fetch flow (stubbed fetch)", () => {
  it("resolves a Lightning address end-to-end to pay params", async () => {
    const fetchMock = stubFetchJson(payPayload());
    const params = await resolveLnurlParams("alice@example.com", { fetchFn: fetchMock });
    expect(params.kind).toBe("pay");
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(LNURL_ALICE_URL);
  });

  it("resolves a bech32 LNURL to withdraw params by tag", async () => {
    const params = await resolveLnurlParams(LNURL_ALICE, { fetchFn: stubFetchJson(withdrawPayload()) });
    expect(params.kind).toBe("withdraw");
  });

  it("fetchLnurlPayInvoice asks the callback with the msat amount and returns the bolt11", async () => {
    const pay = parseLnurlPayParams(payPayload(), FETCHED);
    const fetchMock = stubFetchJson({ pr: "lnbc210n1issued", routes: [] });
    const { bolt11 } = await fetchLnurlPayInvoice(pay, 21_000, null, { fetchFn: fetchMock });
    expect(bolt11).toBe("lnbc210n1issued");
    const called = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(new URL(called).searchParams.get("amount")).toBe("21000");
  });

  it("submitLnurlWithdraw hands k1 + pr to the callback and accepts OK", async () => {
    const withdraw = parseLnurlWithdrawParams(withdrawPayload(), FETCHED);
    const fetchMock = stubFetchJson({ status: "OK" });
    await expect(submitLnurlWithdraw(withdraw, "lnbc1invoice", { fetchFn: fetchMock })).resolves.toBeUndefined();
    const called = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const url = new URL(called);
    expect(url.searchParams.get("k1")).toBe("a".repeat(64));
    expect(url.searchParams.get("pr")).toBe("lnbc1invoice");
  });

  it("an HTTP failure from the endpoint is an upstream failure", async () => {
    await expect(
      resolveLnurlParams("alice@example.com", { fetchFn: stubFetchJson("boom", 500) }),
    ).rejects.toBeInstanceOf(LnurlUpstreamError);
  });
});

describe("lightning-service LNURL actions (source proof)", () => {
  const service = read("../../supabase/functions/lightning-service/index.ts");

  it("exposes the three LNURL actions with user-JWT posture (after the auth check)", () => {
    const authAt = service.indexOf("auth.getUser");
    for (const action of ["lnurl_pay_resolve", "lnurl_pay", "lnurl_withdraw"]) {
      const at = service.indexOf(`action === "${action}"`);
      expect(at).toBeGreaterThan(authAt);
    }
  });

  it("lnurl_pay re-resolves server-side and never takes a callback from the client", () => {
    const at = service.indexOf('action === "lnurl_pay"');
    const slice = service.slice(at, service.indexOf('action === "lnurl_withdraw"', at));
    expect(slice).toContain("resolveLnurlParams(input.trim())");
    expect(slice).toContain("fetchLnurlPayInvoice");
    expect(slice).not.toContain("body.callback");
    expect(slice).not.toContain("callback_url");
  });

  it("lnurl_pay validates the issued invoice and its amount BEFORE reserving", () => {
    const at = service.indexOf('action === "lnurl_pay"');
    const slice = service.slice(at, service.indexOf('action === "lnurl_withdraw"', at));
    const decodeAt = slice.indexOf("decodeSendInvoice");
    const mismatchAt = slice.indexOf("LNURL_AMOUNT_MISMATCH");
    const reserveAt = slice.indexOf("btc_reserve_lightning_send");
    expect(decodeAt).toBeGreaterThan(-1);
    expect(mismatchAt).toBeGreaterThan(decodeAt);
    expect(reserveAt).toBeGreaterThan(mismatchAt);
  });

  it("lnurl_pay keeps the freeze guard and the reserve-first / read-back doctrine", () => {
    const at = service.indexOf('action === "lnurl_pay"');
    const slice = service.slice(at, service.indexOf('action === "lnurl_withdraw"', at));
    expect(slice.indexOf("assertAccountNotFrozen")).toBeLessThan(slice.indexOf("btc_reserve_lightning_send"));
    expect(slice).toContain("providerPayInvoice");
    expect(slice).toContain("resolveOutboundSend");
    expect(slice).toContain("idempotency_key required");
  });

  it("lnurl_withdraw creates + records the invoice BEFORE submitting it, with no freeze guard", () => {
    const at = service.indexOf('action === "lnurl_withdraw"');
    const slice = service.slice(at);
    expect(slice).not.toContain("assertAccountNotFrozen");
    const createAt = slice.indexOf("providerCreateInvoice");
    const insertAt = slice.indexOf('direction: "inbound"');
    const submitAt = slice.indexOf("submitLnurlWithdraw");
    expect(createAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(createAt);
    expect(submitAt).toBeGreaterThan(insertAt);
  });

  it("LNURL errors map to crafted copy: user errors 400, upstream 503 without leaking", () => {
    expect(service).toContain("e instanceof LnurlUserError");
    expect(service).toContain("e instanceof LnurlUpstreamError");
    expect(service).toContain("LNURL_UNREACHABLE");
  });

  it("no LNURL-auth action exists anywhere in the custodial function", () => {
    expect(service).not.toContain("lnurl_auth");
    expect(service).not.toContain("lnurlAuth");
  });
});

describe("LnurlSend UI (source proof)", () => {
  const ui = read("../../src/components/bitcoin/LnurlSend.tsx");

  it("drives resolve → review → pay/withdraw through the edge actions", () => {
    expect(ui).toContain('action: "lnurl_pay_resolve"');
    expect(ui).toContain('action: "lnurl_pay"');
    expect(ui).toContain('action: "lnurl_withdraw"');
  });

  it("takes a classified intent (qrScan lnurl / lightningAddress kinds)", () => {
    expect(ui).toContain('kind: "lnurl" | "lightningAddress"');
    expect(ui).toContain("intent?: LnurlIntent");
  });

  it("pays with an idempotency key and polls check_status while processing", () => {
    expect(ui).toContain("idempotency_key: idemKeyRef.current");
    expect(ui).toContain('action: "check_status"');
  });

  it("the processing state reuses LightningSend's hold wording: do not pay again, held safely", () => {
    expect(ui).toContain("Your payment is being confirmed");
    expect(ui).toContain("held safely");
    expect(ui).toContain("pay this address again");
  });

  it("states the fee policy plainly and shows the destination domain on review", () => {
    expect(ui).toContain("Exactly the amount you enter leaves your wallet");
    expect(ui).toContain("resolved.domain");
  });

  it("never renders raw internals: no k1, no callback URL, no payment hash or id", () => {
    expect(ui).not.toContain("payment_hash");
    expect(ui).not.toContain("{result.paymentId");
    expect(ui).not.toContain("resolved.k1");
    expect(ui).not.toContain("callback_domain");
  });
});
