// Unit tests for supabase/functions/_shared/airtel-money.ts and
// airtel-money-server.ts — the Airtel Money DIRECT connection
// (Zambia OpCo), built 2026-10-27 in the docs-complete pass.
//
// HONESTY NOTE (mirrors the module header): Airtel's
// implementation-grade documentation is LOGIN-GATED; the Zambia
// shapes below are ADAPTER HYPOTHESES from consistent third-party
// public SDKs, NOT verified Airtel conformance. These tests pin:
//   - Configuration fails CLOSED: no credentials = not configured;
//     credentials + kill switch OFF = disabled; credentials + ON +
//     shapes unconfirmed = adapter_unconfirmed, and the server
//     client refuses EVERY operation before any network call.
//   - The adapter wire shapes exactly as written, so reconciling
//     them against the gated Zambia docs is a one-object diff
//     (AIRTEL_ADAPTER in airtel-money.ts).
//   - Status application is terminal-sticky; callbacks parse as
//     identification hints only.

import { describe, it, expect, vi } from "vitest";
import {
  airtelMoneyConfig,
  airtelMoneyRailEnabled,
  airtelMoneyRailGate,
  airtelMoneyCallbackHint,
  airtelMoneyAmount,
  airtelMoneyCollectionPath,
  airtelMoneyHeaders,
  airtelMoneyTokenPath,
  airtelMoneyTransactionStatusPath,
  buildAirtelMoneyCollectionBody,
  buildAirtelMoneyDisbursementBody,
  buildAirtelMoneyTokenRequest,
  canApplyAirtelMoneyStatus,
  classifyAirtelMoneyError,
  mapAirtelMoneyStatus,
  normaliseAirtelMsisdn,
  parseAirtelMoneyToken,
  parseAirtelMoneyTransaction,
  AIRTEL_MONEY_DISABLED_MESSAGE,
  AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE,
  AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
  AIRTEL_PRODUCTION_BASE_URL,
  AIRTEL_STAGING_BASE_URL,
} from "../../supabase/functions/_shared/airtel-money";
import {
  createAirtelMoneyClient,
  AirtelMoneyAdapterUnconfirmedError,
  AirtelMoneyApiError,
  AirtelMoneyDisabledError,
  AirtelMoneyNotConfiguredError,
  type FetchLike,
} from "../../supabase/functions/_shared/airtel-money-server";

const CONFIRMED_VALUES = {
  env: "staging",
  clientId: "client-id-1",
  clientSecret: "client-secret-1",
  shapesConfirmed: "true",
  railEnabled: true,
};

describe("airtelMoneyConfig", () => {
  it("fails closed with no credentials", () => {
    const cfg = airtelMoneyConfig({});
    expect(cfg.configured).toBe(false);
    expect(cfg.ready).toBe(false);
    expect(cfg.env).toBe("staging");
    expect(cfg.baseUrl).toBe(AIRTEL_STAGING_BASE_URL);
  });

  it("credentials without shape confirmation are configured but NOT ready", () => {
    const cfg = airtelMoneyConfig({ clientId: "id", clientSecret: "secret" });
    expect(cfg.configured).toBe(true);
    expect(cfg.shapesConfirmed).toBe(false);
    expect(cfg.ready).toBe(false);
  });

  it("only the exact 'true' confirms the adapter shapes", () => {
    expect(airtelMoneyConfig({ shapesConfirmed: "true" }).shapesConfirmed).toBe(true);
    expect(airtelMoneyConfig({ shapesConfirmed: true }).shapesConfirmed).toBe(true);
    expect(airtelMoneyConfig({ shapesConfirmed: "yes" }).shapesConfirmed).toBe(false);
    expect(airtelMoneyConfig({ shapesConfirmed: 1 as unknown as string }).shapesConfirmed).toBe(false);
  });

  it("only the exact string 'production' selects production", () => {
    expect(airtelMoneyConfig({ env: "production" }).baseUrl).toBe(AIRTEL_PRODUCTION_BASE_URL);
    expect(airtelMoneyConfig({ env: "prod" }).env).toBe("staging");
    expect(airtelMoneyConfig({ env: "staging", baseUrl: "https://example.test" }).baseUrl)
      .toBe("https://example.test");
  });
});

describe("kill switch + adapter gate", () => {
  const configured = airtelMoneyConfig({ clientId: "id", clientSecret: "s" });
  const confirmed = airtelMoneyConfig(CONFIRMED_VALUES);
  const unconfigured = airtelMoneyConfig({});

  it("resolves the settings row exactly like the other rails: only literal true is ON", () => {
    expect(airtelMoneyRailEnabled({ airtel_money_enabled: true })).toBe(true);
    expect(airtelMoneyRailEnabled({ airtel_money_enabled: false })).toBe(false);
    expect(airtelMoneyRailEnabled({ airtel_money_enabled: null })).toBe(false);
    expect(airtelMoneyRailEnabled({})).toBe(false);
    expect(airtelMoneyRailEnabled(null)).toBe(false);
    expect(airtelMoneyRailEnabled(undefined)).toBe(false);
  });

  it("no credentials → unchanged not_configured, whatever the flag says", () => {
    for (const on of [true, false]) {
      const gate = airtelMoneyRailGate(unconfigured, on);
      expect(gate.status).toBe("not_configured");
      expect(gate.error).toBe(AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE);
    }
  });

  it("credentials + flag OFF → disabled", () => {
    const gate = airtelMoneyRailGate(configured, false);
    expect(gate.status).toBe("disabled");
    expect(gate.error).toBe(AIRTEL_MONEY_DISABLED_MESSAGE);
  });

  it("credentials + flag ON + shapes unconfirmed → adapter_unconfirmed (never guess a wire format)", () => {
    const gate = airtelMoneyRailGate(configured, true);
    expect(gate.allowed).toBe(false);
    expect(gate.status).toBe("adapter_unconfirmed");
    expect(gate.error).toBe(AIRTEL_MONEY_UNCONFIRMED_MESSAGE);
  });

  it("credentials + flag ON + shapes confirmed → allowed", () => {
    const gate = airtelMoneyRailGate(confirmed, true);
    expect(gate.allowed).toBe(true);
    expect(gate.status).toBe("ready");
    expect(gate.error).toBe(null);
  });
});

describe("adapter wire shapes (pinned as written — reconcile on account access)", () => {
  it("paths come from the single adapter object", () => {
    expect(airtelMoneyTokenPath()).toBe("/auth/oauth2/token");
    expect(airtelMoneyCollectionPath()).toBe("/merchant/v1/payments/");
    expect(airtelMoneyTransactionStatusPath("ref 1")).toBe("/standard/v1/payments/ref%201");
  });

  it("headers carry the Zambia market markers", () => {
    const headers = airtelMoneyHeaders("tok");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Country"]).toBe("ZM");
    expect(headers["X-Currency"]).toBe("ZMW");
  });

  it("token request is a client-credentials grant; token response parses", () => {
    const req = buildAirtelMoneyTokenRequest(airtelMoneyConfig(CONFIRMED_VALUES));
    expect(req.contentType).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({
      client_id: "client-id-1",
      client_secret: "client-secret-1",
      grant_type: "client_credentials",
    });
    expect(parseAirtelMoneyToken({ access_token: "t", expires_in: 1799 }))
      .toEqual({ accessToken: "t", expiresInSec: 1799 });
    expect(parseAirtelMoneyToken({})).toBeNull();
  });

  it("collection body carries reference + nested transaction with both identifiers", () => {
    const built = buildAirtelMoneyCollectionBody({
      amount: 25.5,
      reference: "our-ref",
      transactionId: "our-txn",
      payerMsisdn: "0977123456",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.body.reference).toBe("our-ref");
      expect(built.body.subscriber).toEqual({
        country: "ZM", currency: "ZMW", msisdn: "260977123456",
      });
      expect(built.body.transaction).toEqual({
        amount: 25.5, country: "ZM", currency: "ZMW",
        reference: "our-ref", id: "our-txn",
      });
    }
  });

  it("disbursement body refuses without a pre-encrypted PIN (adapter point)", () => {
    const built = buildAirtelMoneyDisbursementBody({
      amount: 10, reference: "r", transactionId: "t", payeeMsisdn: "260977123456",
    });
    expect(built.ok).toBe(false);
    const withPin = buildAirtelMoneyDisbursementBody({
      amount: 10, reference: "r", transactionId: "t",
      payeeMsisdn: "260977123456", encryptedPin: "enc-pin",
    });
    expect(withPin.ok).toBe(true);
    if (withPin.ok) expect(withPin.body.pin).toBe("enc-pin");
  });

  it("amounts validate and render in major units per the adapter scale", () => {
    expect(airtelMoneyAmount(10)).toBe(10);
    expect(airtelMoneyAmount("25.50")).toBe(25.5);
    expect(airtelMoneyAmount(0)).toBeNull();
    expect(airtelMoneyAmount(-1)).toBeNull();
    expect(normaliseAirtelMsisdn("0977123456")).toBe("260977123456");
    expect(normaliseAirtelMsisdn("123")).toBeNull();
  });
});

describe("status machine + parsers (adapter vocabulary)", () => {
  it("maps the adapter vocabulary only", () => {
    expect(mapAirtelMoneyStatus("TS")).toBe("successful");
    expect(mapAirtelMoneyStatus("SUCCESS")).toBe("successful");
    expect(mapAirtelMoneyStatus("TF")).toBe("failed");
    expect(mapAirtelMoneyStatus("TIP")).toBe("pending");
    expect(mapAirtelMoneyStatus("SOMETHING")).toBeNull();
  });

  it("terminal states never regress", () => {
    expect(canApplyAirtelMoneyStatus("successful", "pending")).toBe(false);
    expect(canApplyAirtelMoneyStatus("failed", "successful")).toBe(false);
    expect(canApplyAirtelMoneyStatus("pending", "successful")).toBe(true);
  });

  it("parses a status-enquiry response from the adapter nesting", () => {
    const parsed = parseAirtelMoneyTransaction({
      data: {
        transaction: { id: "airtel-txn-1", reference: "our-ref", status: "TS", amount: 25.5, currency: "ZMW" },
      },
      status: { code: "DP00800001001", message: "Success" },
    });
    expect(parsed.status).toBe("successful");
    expect(parsed.providerTransactionId).toBe("airtel-txn-1");
    expect(parsed.reference).toBe("our-ref");
    expect(parsed.amount).toBe(25.5);
    expect(parsed.responseCode).toBe("DP00800001001");
  });

  it("callback parsing yields identification only (reference + claimed status)", () => {
    const hint = airtelMoneyCallbackHint({
      transaction: {
        status: "SUCCESS",
        transaction_reference: "our-ref",
        transaction_id: "airtel-txn-9",
        msisdn: "260977123456",
        amount: "5000",
        currency: "ZMW",
      },
    });
    expect(hint.providerReference).toBe("our-ref");
    expect(hint.providerTransactionId).toBe("airtel-txn-9");
    expect(hint.claimedStatus).toBe("successful");
  });

  it("classifies HTTP failures like the MTN rail", () => {
    expect(classifyAirtelMoneyError(409)).toBe("duplicate_reference");
    expect(classifyAirtelMoneyError(401)).toBe("auth");
    expect(classifyAirtelMoneyError(404)).toBe("not_found");
    expect(classifyAirtelMoneyError(503)).toBe("provider");
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

  it("unconfirmed adapter refuses EVERY operation before any network call", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const client = createAirtelMoneyClient(
      { clientId: "id", clientSecret: "s", railEnabled: true },
      fetchImpl,
    );
    await expect(client.requestPayment({})).rejects.toBeInstanceOf(AirtelMoneyAdapterUnconfirmedError);
    await expect(client.getTransactionStatus("x")).rejects.toBeInstanceOf(AirtelMoneyAdapterUnconfirmedError);
    await expect(client.getBalance()).rejects.toBeInstanceOf(AirtelMoneyAdapterUnconfirmedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no credentials → not-configured refusal before any network call", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const client = createAirtelMoneyClient({ railEnabled: true }, fetchImpl);
    await expect(client.requestPayment({})).rejects.toBeInstanceOf(AirtelMoneyNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("kill switch OFF refuses before any network call even when confirmed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("must not be called");
    }) as unknown as FetchLike;
    const client = createAirtelMoneyClient(
      { ...CONFIRMED_VALUES, railEnabled: false },
      fetchImpl,
    );
    await expect(client.requestPayment({})).rejects.toBeInstanceOf(AirtelMoneyDisabledError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("confirmed + on: token → collection → status enquiry wire flow, token cached", async () => {
    const { calls, fetchImpl } = stubFetch((url) => {
      if (url.endsWith("/auth/oauth2/token")) {
        return { status: 200, body: JSON.stringify({ access_token: "tok-1", expires_in: 3600 }) };
      }
      if (url.endsWith("/merchant/v1/payments/")) {
        return {
          status: 200,
          body: JSON.stringify({ data: { transaction: { id: "at-1", status: "TIP" } } }),
        };
      }
      if (url.includes("/standard/v1/payments/")) {
        return {
          status: 200,
          body: JSON.stringify({ data: { transaction: { id: "at-1", status: "TS", amount: 10, currency: "ZMW" } } }),
        };
      }
      return { status: 404, body: "" };
    });
    const client = createAirtelMoneyClient(CONFIRMED_VALUES, fetchImpl);
    const accepted = await client.requestPayment({ reference: "r1" });
    expect(accepted.status).toBe("pending");
    expect(accepted.providerTransactionId).toBe("at-1");
    const status = await client.getTransactionStatus("at-1");
    expect(status.status).toBe("successful");
    const tokenCalls = calls.filter((c) => c.url.endsWith("/auth/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
    const payCall = calls.find((c) => c.url.endsWith("/merchant/v1/payments/"));
    expect(payCall?.init.headers?.["X-Country"]).toBe("ZM");
    expect(payCall?.init.headers?.Authorization).toBe("Bearer tok-1");
  });

  it("balance refuses even when confirmed — no adapter path exists to guess", async () => {
    const { fetchImpl } = stubFetch((url) => {
      if (url.endsWith("/auth/oauth2/token")) {
        return { status: 200, body: JSON.stringify({ access_token: "t", expires_in: 3600 }) };
      }
      return { status: 404, body: "" };
    });
    const client = createAirtelMoneyClient(CONFIRMED_VALUES, fetchImpl);
    await expect(client.getBalance()).rejects.toBeInstanceOf(AirtelMoneyAdapterUnconfirmedError);
  });

  it("surfaces provider HTTP failures as classified API errors", async () => {
    const { fetchImpl } = stubFetch((url) => {
      if (url.endsWith("/auth/oauth2/token")) {
        return { status: 200, body: JSON.stringify({ access_token: "t", expires_in: 3600 }) };
      }
      return { status: 409, body: "" };
    });
    const client = createAirtelMoneyClient(CONFIRMED_VALUES, fetchImpl);
    const err = await client.requestPayment({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AirtelMoneyApiError);
    expect((err as AirtelMoneyApiError).kind).toBe("duplicate_reference");
  });
});
