// Unit tests for supabase/functions/_shared/mtn-momo.ts and
// mtn-momo-server.ts — the MTN MoMo DIRECT-connection skeleton
// (CEO decision 2026-10-26: direct telco connections, no
// aggregator). Built against MTN's public developer documentation
// (momodeveloper.mtn.com); UNPROVEN until MTN Zambia merchant
// onboarding issues production credentials and the sandbox
// contract is exercised with a real developer-portal account.
//
// The properties under test:
//   - Configuration fails CLOSED: no subscription key (or, in
//     production, no MTN-issued API user/key) = not configured,
//     and the server client refuses before any network call.
//   - The wire contract matches the documented shapes: per-product
//     subscription-key header, Basic-auth token endpoints per
//     product, requestToPay/transfer bodies with amounts as
//     STRINGS and MSISDN parties, X-Reference-Id idempotency anchor.
//   - Status application is terminal-sticky (callbacks and polls
//     race; SUCCESSFUL/FAILED never regress).
//   - A 409 classifies as duplicate_reference — the caller must
//     re-query the original reference, never mint a new one.

import { describe, it, expect, vi } from "vitest";
import {
  buildMtnMomoRequestToPayBody,
  buildMtnMomoTransferBody,
  canApplyMtnMomoStatus,
  classifyMtnMomoError,
  mapMtnMomoStatus,
  mtnMomoAmountString,
  mtnMomoBasicAuthHeader,
  mtnMomoConfig,
  mtnMomoMoneyCallHeaders,
  mtnMomoRailEnabled,
  mtnMomoRailGate,
  mtnMomoRequestToPayStatusPath,
  mtnMomoSettlementCurrency,
  mtnMomoTokenPath,
  mtnMomoCallbackHint,
  normaliseMsisdn,
  parseMtnMomoAccountHolderActive,
  parseMtnMomoBalance,
  parseMtnMomoTransaction,
  MTN_MOMO_DEFAULT_PRODUCTION_BASE_URL,
  MTN_MOMO_DISABLED_MESSAGE,
  MTN_MOMO_NOT_CONFIGURED_MESSAGE,
  MTN_MOMO_SANDBOX_BASE_URL,
} from "../../supabase/functions/_shared/mtn-momo";
import {
  createMtnMomoClient,
  MtnMomoApiError,
  MtnMomoDisabledError,
  MtnMomoNotConfiguredError,
  type FetchLike,
} from "../../supabase/functions/_shared/mtn-momo-server";

const SANDBOX_VALUES = {
  env: "sandbox",
  collectionSubscriptionKey: "coll-sub-key",
  disbursementSubscriptionKey: "disb-sub-key",
  apiUserId: "api-user-uuid",
  apiKey: "api-key-123",
  callbackUrl: "https://example.test/callback",
  // The fully-wired fixture: kill switch ON (platform_settings
  // .mtn_momo_enabled resolved by the caller). Absent/false = OFF.
  railEnabled: true,
};

describe("mtnMomoConfig", () => {
  it("fails closed with no keys at all", () => {
    const cfg = mtnMomoConfig({});
    expect(cfg.configured).toBe(false);
    expect(cfg.collectionConfigured).toBe(false);
    expect(cfg.disbursementConfigured).toBe(false);
    expect(cfg.env).toBe("sandbox");
    expect(cfg.baseUrl).toBe(MTN_MOMO_SANDBOX_BASE_URL);
    expect(cfg.targetEnvironment).toBe("sandbox");
  });

  it("sandbox needs only the per-product subscription key per product", () => {
    const cfg = mtnMomoConfig({ collectionSubscriptionKey: "k" });
    expect(cfg.collectionConfigured).toBe(true);
    expect(cfg.disbursementConfigured).toBe(false);
    expect(cfg.hasApiCredentials).toBe(false);
  });

  it("production refuses to be configured without MTN-issued API credentials", () => {
    const cfg = mtnMomoConfig({
      env: "production",
      collectionSubscriptionKey: "k",
    });
    expect(cfg.collectionConfigured).toBe(false);
    const full = mtnMomoConfig({
      env: "production",
      collectionSubscriptionKey: "k",
      apiUserId: "issued-user",
      apiKey: "issued-key",
    });
    expect(full.collectionConfigured).toBe(true);
    expect(full.targetEnvironment).toBe("mtnzambia");
  });

  it("only the exact string 'production' selects production", () => {
    expect(mtnMomoConfig({ env: "prod" }).env).toBe("sandbox");
    expect(mtnMomoConfig({ env: " production " }).env).toBe("production");
  });
});

describe("auth + paths", () => {
  it("builds the Basic header as base64(apiUserId:apiKey)", () => {
    expect(mtnMomoBasicAuthHeader("user", "key")).toBe(
      `Basic ${Buffer.from("user:key").toString("base64")}`,
    );
  });

  it("token paths are per-product", () => {
    expect(mtnMomoTokenPath("collection")).toBe("/collection/token/");
    expect(mtnMomoTokenPath("disbursement")).toBe("/disbursement/token/");
  });

  it("money-call headers carry subscription key, bearer, reference + target env", () => {
    const cfg = mtnMomoConfig(SANDBOX_VALUES);
    const headers = mtnMomoMoneyCallHeaders(cfg, "collection", "tok", "ref-uuid");
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("coll-sub-key");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Reference-Id"]).toBe("ref-uuid");
    expect(headers["X-Target-Environment"]).toBe("sandbox");
    expect(headers["X-Callback-Url"]).toBe("https://example.test/callback");
  });

  it("status path keys on our reference id", () => {
    expect(mtnMomoRequestToPayStatusPath("abc-123")).toBe(
      "/collection/v1_0/requesttopay/abc-123",
    );
  });
});

describe("bodies", () => {
  it("normalises Zambian numbers to MSISDN digits", () => {
    expect(normaliseMsisdn("0771234567")).toBe("260771234567");
    expect(normaliseMsisdn("+260 771 234 567")).toBe("260771234567");
    expect(normaliseMsisdn("123")).toBeNull();
    expect(normaliseMsisdn(null)).toBeNull();
  });

  it("amounts travel as strings without float drift", () => {
    expect(mtnMomoAmountString(100)).toBe("100");
    expect(mtnMomoAmountString("25.50")).toBe("25.5");
    expect(mtnMomoAmountString(0)).toBeNull();
    expect(mtnMomoAmountString(-5)).toBeNull();
    expect(mtnMomoAmountString("abc")).toBeNull();
  });

  it("requestToPay body uses payer + string amount; transfer uses payee", () => {
    const rtp = buildMtnMomoRequestToPayBody({
      amount: 42.5,
      currency: "zmw",
      externalId: "ledger-1",
      payerMsisdn: "0771234567",
    });
    expect(rtp.ok).toBe(true);
    if (rtp.ok) {
      expect(rtp.body.amount).toBe("42.5");
      expect(rtp.body.currency).toBe("ZMW");
      expect(rtp.body.payer).toEqual({ partyIdType: "MSISDN", partyId: "260771234567" });
      expect(rtp.body.externalId).toBe("ledger-1");
    }
    const tr = buildMtnMomoTransferBody({
      amount: 10,
      currency: "ZMW",
      externalId: "ledger-2",
      payeeMsisdn: "260771234567",
    });
    expect(tr.ok).toBe(true);
    if (tr.ok) {
      expect(tr.body.payee).toEqual({ partyIdType: "MSISDN", partyId: "260771234567" });
      expect(tr.body.payer).toBeUndefined();
    }
  });

  it("refuses bad phone / amount plainly", () => {
    const bad = buildMtnMomoRequestToPayBody({
      amount: 10,
      currency: "ZMW",
      externalId: "x",
      payerMsisdn: "nope",
    });
    expect(bad.ok).toBe(false);
  });
});

describe("status machine", () => {
  it("maps the documented vocabulary only", () => {
    expect(mapMtnMomoStatus("PENDING")).toBe("pending");
    expect(mapMtnMomoStatus("SUCCESSFUL")).toBe("successful");
    expect(mapMtnMomoStatus("FAILED")).toBe("failed");
    expect(mapMtnMomoStatus("REJECTED")).toBeNull();
    expect(mapMtnMomoStatus(undefined)).toBeNull();
  });

  it("terminal states never regress", () => {
    expect(canApplyMtnMomoStatus("successful", "pending")).toBe(false);
    expect(canApplyMtnMomoStatus("failed", "successful")).toBe(false);
    expect(canApplyMtnMomoStatus("pending", "successful")).toBe(true);
    expect(canApplyMtnMomoStatus(null, "pending")).toBe(true);
    expect(canApplyMtnMomoStatus("pending", null)).toBe(false);
  });

  it("parses a status body incl. reason + financialTransactionId", () => {
    const parsed = parseMtnMomoTransaction({
      amount: "42.5",
      currency: "ZMW",
      financialTransactionId: "fin-123",
      externalId: "ledger-1",
      status: "FAILED",
      reason: { code: "PAYER_NOT_FOUND", message: "Payer not found" },
    });
    expect(parsed.status).toBe("failed");
    expect(parsed.financialTransactionId).toBe("fin-123");
    expect(parsed.reasonCode).toBe("PAYER_NOT_FOUND");
    expect(parseMtnMomoBalance({ availableBalance: "900.00", currency: "ZMW" }))
      .toEqual({ availableBalance: "900.00", currency: "ZMW" });
  });

  it("classifies 409 as duplicate_reference (the idempotency signal)", () => {
    expect(classifyMtnMomoError(409)).toBe("duplicate_reference");
    expect(classifyMtnMomoError(401)).toBe("auth");
    expect(classifyMtnMomoError(500)).toBe("provider");
  });
});

describe("server client (stubbed fetch)", () => {
  function stubFetch(handler: (url: string, init?: unknown) => { status: number; body: string }) {
    const calls: Array<{ url: string; init: { headers?: Record<string, string>; body?: string; method?: string } }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init: init ?? {} });
      const { status, body } = handler(url, init);
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    };
    return { calls, fetchImpl };
  }

  it("refuses every money call when not configured — and never fetches", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const client = createMtnMomoClient({}, fetchImpl);
    await expect(client.requestToPay("ref", {})).rejects.toBeInstanceOf(
      MtnMomoNotConfiguredError,
    );
    await expect(client.getBalance("collection")).rejects.toBeInstanceOf(
      MtnMomoNotConfiguredError,
    );
  });

  it("runs token → requestToPay with the documented wire shape and caches the token", async () => {
    const { calls, fetchImpl } = stubFetch((url) => {
      if (url.endsWith("/collection/token/") || url.endsWith("/disbursement/token/")) {
        return { status: 200, body: JSON.stringify({ access_token: "tok-1", expires_in: 3600 }) };
      }
      if (url.endsWith("/collection/v1_0/requesttopay")) return { status: 202, body: "" };
      if (url.includes("/collection/v1_0/requesttopay/")) {
        return {
          status: 200,
          body: JSON.stringify({ status: "SUCCESSFUL", financialTransactionId: "f1", amount: "5", currency: "EUR" }),
        };
      }
      return { status: 404, body: "" };
    });
    const client = createMtnMomoClient(SANDBOX_VALUES, fetchImpl);
    await client.requestToPay("ref-uuid", { amount: "5" });
    await client.requestToPay("ref-uuid-2", { amount: "6" });
    const tokenCalls = calls.filter((c) => c.url.endsWith("/collection/token/"));
    expect(tokenCalls).toHaveLength(1); // cached across both calls
    expect(tokenCalls[0].init.headers?.Authorization).toBe(
      `Basic ${Buffer.from("api-user-uuid:api-key-123").toString("base64")}`,
    );
    expect(tokenCalls[0].init.headers?.["Ocp-Apim-Subscription-Key"]).toBe("coll-sub-key");
    const rtp = calls.find((c) => c.url.endsWith("/requesttopay"));
    expect(rtp?.init.headers?.["X-Reference-Id"]).toBe("ref-uuid");
    const status = await client.getRequestToPayStatus("ref-uuid");
    expect(status.status).toBe("successful");
    expect(status.financialTransactionId).toBe("f1");
  });

  it("surfaces a 409 as duplicate_reference so callers re-query instead of re-minting", async () => {
    const { fetchImpl } = stubFetch((url) => {
      if (url.endsWith("/collection/token/") || url.endsWith("/disbursement/token/")) {
        return { status: 200, body: JSON.stringify({ access_token: "t", expires_in: 3600 }) };
      }
      return { status: 409, body: "" };
    });
    const client = createMtnMomoClient(SANDBOX_VALUES, fetchImpl);
    const err = await client.requestToPay("ref", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MtnMomoApiError);
    expect((err as MtnMomoApiError).kind).toBe("duplicate_reference");
  });
});

describe("kill switch (platform_settings.mtn_momo_enabled)", () => {
  const configured = mtnMomoConfig(SANDBOX_VALUES);
  const unconfigured = mtnMomoConfig({});

  it("resolves the settings row exactly like moonpay_enabled: only literal true is ON", () => {
    expect(mtnMomoRailEnabled({ mtn_momo_enabled: true })).toBe(true);
    expect(mtnMomoRailEnabled({ mtn_momo_enabled: false })).toBe(false);
    expect(mtnMomoRailEnabled({ mtn_momo_enabled: null })).toBe(false);
    expect(mtnMomoRailEnabled({})).toBe(false);
    expect(mtnMomoRailEnabled(null)).toBe(false);
    expect(mtnMomoRailEnabled(undefined)).toBe(false);
  });

  it("flag OFF + secrets present → refused as disabled (rail stoppable without unsetting secrets)", () => {
    const gate = mtnMomoRailGate(configured, false);
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe("disabled");
    expect(gate.error).toBe(MTN_MOMO_DISABLED_MESSAGE);
  });

  it("flag OFF + no secrets → refused with the UNCHANGED not_configured copy", () => {
    const gate = mtnMomoRailGate(unconfigured, false);
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe("not_configured");
    expect(gate.error).toBe(MTN_MOMO_NOT_CONFIGURED_MESSAGE);
  });

  it("flag ON + no secrets → not_configured, as before the switch existed", () => {
    const gate = mtnMomoRailGate(unconfigured, true);
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe("not_configured");
    expect(gate.error).toBe(MTN_MOMO_NOT_CONFIGURED_MESSAGE);
  });

  it("flag ON + secrets present → allowed (existing secret-presence logic decides the rest)", () => {
    const gate = mtnMomoRailGate(configured, true);
    expect(gate.allowed).toBe(true);
    expect(gate.status).toBe("ready");
    expect(gate.error).toBe(null);
  });

  it("server client: configured but switched OFF refuses before ANY network call", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const client = createMtnMomoClient(
      { ...SANDBOX_VALUES, railEnabled: false },
      fetchImpl,
    );
    await expect(client.requestToPay("ref", {})).rejects.toBeInstanceOf(
      MtnMomoDisabledError,
    );
    await expect(client.transfer("ref", {})).rejects.toBeInstanceOf(
      MtnMomoDisabledError,
    );
    await expect(client.getBalance("collection")).rejects.toBeInstanceOf(
      MtnMomoDisabledError,
    );
    await expect(
      client.provisionSandboxApiUser("api-user-uuid"),
    ).rejects.toBeInstanceOf(MtnMomoDisabledError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("server client: flag value absent is OFF (fail-closed default)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const { railEnabled: _omit, ...noFlag } = SANDBOX_VALUES;
    const client = createMtnMomoClient(noFlag, fetchImpl);
    await expect(client.requestToPay("ref", {})).rejects.toBeInstanceOf(
      MtnMomoDisabledError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("server client: no secrets keeps the not-configured refusal whatever the flag says", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const offClient = createMtnMomoClient({ railEnabled: false }, fetchImpl);
    await expect(offClient.requestToPay("ref", {})).rejects.toBeInstanceOf(
      MtnMomoNotConfiguredError,
    );
    const onClient = createMtnMomoClient({ railEnabled: true }, fetchImpl);
    await expect(onClient.requestToPay("ref", {})).rejects.toBeInstanceOf(
      MtnMomoNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("docs-complete additions (2026-10-27)", () => {
  it("production base URL defaults to MTN's documented production API host", () => {
    // MTN's official production-configuration guidance: production
    // API traffic goes to proxy.momoapi.mtn.com; momodeveloper is
    // the portal. The env override still wins.
    expect(MTN_MOMO_DEFAULT_PRODUCTION_BASE_URL).toBe("https://proxy.momoapi.mtn.com");
    const cfg = mtnMomoConfig({
      env: "production",
      collectionSubscriptionKey: "k",
      apiUserId: "u",
      apiKey: "key",
    });
    expect(cfg.baseUrl).toBe("https://proxy.momoapi.mtn.com");
    const overridden = mtnMomoConfig({
      env: "production",
      collectionSubscriptionKey: "k",
      apiUserId: "u",
      apiKey: "key",
      productionBaseUrl: "https://example.test",
    });
    expect(overridden.baseUrl).toBe("https://example.test");
  });

  it("settlement currency is EUR in sandbox and ZMW in production", () => {
    expect(mtnMomoSettlementCurrency(mtnMomoConfig({}))).toBe("EUR");
    expect(
      mtnMomoSettlementCurrency(mtnMomoConfig({ env: "production" })),
    ).toBe("ZMW");
  });

  it("refuses payer messages / payee notes over MTN's 128-character limit", () => {
    const long = "x".repeat(129);
    const rtp = buildMtnMomoRequestToPayBody({
      amount: 10, currency: "ZMW", externalId: "e",
      payerMsisdn: "0771234567", payerMessage: long,
    });
    expect(rtp.ok).toBe(false);
    const tr = buildMtnMomoTransferBody({
      amount: 10, currency: "ZMW", externalId: "e",
      payeeMsisdn: "0771234567", payeeNote: long,
    });
    expect(tr.ok).toBe(false);
  });

  it("parses the account-holder-active response (bare boolean, string, object)", () => {
    expect(parseMtnMomoAccountHolderActive(true)).toBe(true);
    expect(parseMtnMomoAccountHolderActive("false")).toBe(false);
    expect(parseMtnMomoAccountHolderActive({ active: true })).toBe(true);
    expect(parseMtnMomoAccountHolderActive({ isActive: false })).toBe(false);
    expect(parseMtnMomoAccountHolderActive({})).toBeNull();
    expect(parseMtnMomoAccountHolderActive("yes")).toBeNull();
  });

  it("callback hint identifies by externalId and exposes the CLAIMED status only", () => {
    const hint = mtnMomoCallbackHint({
      amount: "10",
      currency: "ZMW",
      externalId: "ledger-txn-uuid",
      financialTransactionId: "fin-9",
      status: "SUCCESSFUL",
    });
    expect(hint.externalId).toBe("ledger-txn-uuid");
    expect(hint.claimedStatus).toBe("successful");
    expect(hint.financialTransactionId).toBe("fin-9");
  });

  it("server client: account-holder check + product-routed status re-query", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push({ url });
      if (url.endsWith("/collection/token/") || url.endsWith("/disbursement/token/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "t", expires_in: 3600 }) };
      }
      if (url.includes("/accountholder/msisdn/")) {
        return { ok: true, status: 200, text: async () => "true" };
      }
      if (url.includes("/disbursement/v1_0/transfer/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: "PENDING", amount: "3", currency: "EUR" }) };
      }
      return { ok: false, status: 404, text: async () => "" };
    };
    const client = createMtnMomoClient(SANDBOX_VALUES, fetchImpl);
    await expect(client.isAccountHolderActive("260771234567")).resolves.toBe(true);
    expect(calls.some((c) => c.url.includes("/collection/v1_0/accountholder/msisdn/260771234567/active"))).toBe(true);
    const status = await client.getStatus("disbursement", "ref-7");
    expect(status.status).toBe("pending");
  });
});
