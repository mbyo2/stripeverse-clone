// Server-side Airtel Money operations (Deno) — the fetch half of
// the direct connection whose pure logic lives in ./airtel-money.ts.
//
// STATUS: WIRED behind the airtel_money_enabled kill switch
// (mobile-money edge function + shared telco ledger, migration
// 20261237), but the Zambia wire shapes are ADAPTER HYPOTHESES:
// Airtel's implementation-grade documentation is login-gated and
// the CEO has ordered us to wait on using his developer account.
// Until AIRTEL_API_SHAPES_CONFIRMED is set from the gated Zambia
// docs, the gate in ./airtel-money.ts refuses EVERY operation
// before any network call — this client cannot guess a money wire
// format live.
//
// Money rules (identical to the MTN rail):
//   - LEDGER FIRST: callers persist their row (with our reference
//     as the idempotency anchor) before any payment call.
//   - STATUS ONLY FROM RE-QUERY: callbacks are hints; settlement
//     state comes from the transaction status enquiry.
//   - A duplicate-reference refusal means the original request
//     exists — re-query it, never mint a second reference.

import {
  airtelMoneyCollectionPath,
  airtelMoneyConfig,
  airtelMoneyDisbursementPath,
  airtelMoneyDisbursementStatusPath,
  airtelMoneyHeaders,
  airtelMoneyRailGate,
  airtelMoneyTokenPath,
  airtelMoneyTransactionStatusPath,
  buildAirtelMoneyTokenRequest,
  classifyAirtelMoneyError,
  parseAirtelMoneyToken,
  parseAirtelMoneyTransaction,
  AIRTEL_ADAPTER,
  AIRTEL_MONEY_DISABLED_MESSAGE,
  AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE,
  AIRTEL_MONEY_UNCONFIRMED_MESSAGE,
  type AirtelMoneyConfig,
  type AirtelMoneyEnvValues,
  type ParsedAirtelMoneyTransaction,
} from "./airtel-money.ts";

/** Minimal fetch shape (Deno/Node global fetch both satisfy it). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export class AirtelMoneyNotConfiguredError extends Error {
  constructor() {
    super(AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE);
    this.name = "AirtelMoneyNotConfiguredError";
  }
}

export class AirtelMoneyDisabledError extends Error {
  constructor() {
    super(AIRTEL_MONEY_DISABLED_MESSAGE);
    this.name = "AirtelMoneyDisabledError";
  }
}

/** The Zambia adapter shapes have not been confirmed from gated docs. */
export class AirtelMoneyAdapterUnconfirmedError extends Error {
  constructor() {
    super(AIRTEL_MONEY_UNCONFIRMED_MESSAGE);
    this.name = "AirtelMoneyAdapterUnconfirmedError";
  }
}

export class AirtelMoneyApiError extends Error {
  readonly status: number;
  readonly kind: ReturnType<typeof classifyAirtelMoneyError>;
  constructor(status: number) {
    super(`Airtel Money request failed (HTTP ${status})`);
    this.name = "AirtelMoneyApiError";
    this.status = status;
    this.kind = classifyAirtelMoneyError(status);
  }
}

export interface AirtelMoneyClient {
  config: AirtelMoneyConfig;
  getAccessToken(): Promise<string>;
  /** Collections USSD push. Returns the parsed acceptance response. */
  requestPayment(body: Record<string, unknown>): Promise<ParsedAirtelMoneyTransaction>;
  /** Status enquiry by provider transaction id or our reference. */
  getTransactionStatus(idOrReference: string): Promise<ParsedAirtelMoneyTransaction>;
  /** Disbursement (body must already carry a pre-encrypted PIN). */
  disbursement(body: Record<string, unknown>): Promise<ParsedAirtelMoneyTransaction>;
  getDisbursementStatus(idOrReference: string): Promise<ParsedAirtelMoneyTransaction>;
  /** Balance enquiry — adapter path is null until confirmed. */
  getBalance(): Promise<{ availableBalance: string | null; currency: string | null }>;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Optional request-signing hook (adapter point): Zambia's
 * x-signature / x-key requirement is not publicly verifiable, so
 * signing is INJECTED once the gated docs confirm the recipe —
 * never fabricated here.
 */
export interface AirtelMoneyClientHooks {
  signRequest?: (path: string, body: string | null) => Record<string, string>;
}

export function createAirtelMoneyClient(
  values: AirtelMoneyEnvValues,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
  hooks: AirtelMoneyClientHooks = {},
): AirtelMoneyClient {
  const config = airtelMoneyConfig(values);
  let cached: CachedToken | null = null;

  const gate = airtelMoneyRailGate(config, values.railEnabled === true);

  function requireReady(): void {
    if (gate.status === "not_configured") throw new AirtelMoneyNotConfiguredError();
    if (gate.status === "disabled") throw new AirtelMoneyDisabledError();
    if (gate.status === "adapter_unconfirmed") {
      throw new AirtelMoneyAdapterUnconfirmedError();
    }
  }

  async function call(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; text: string }> {
    const signed = hooks.signRequest?.(path, init.body ?? null) ?? {};
    const res = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...signed },
    });
    const text = await res.text();
    if (!res.ok) throw new AirtelMoneyApiError(res.status);
    return { status: res.status, text };
  }

  function parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new AirtelMoneyApiError(502);
    }
  }

  const client: AirtelMoneyClient = {
    config,

    async getAccessToken(): Promise<string> {
      requireReady();
      if (cached && now() < cached.expiresAtMs) return cached.token;
      const tokenRequest = buildAirtelMoneyTokenRequest(config);
      const { text } = await call(airtelMoneyTokenPath(), {
        method: "POST",
        headers: { "Content-Type": tokenRequest.contentType },
        body: tokenRequest.body,
      });
      const parsed = parseAirtelMoneyToken(parseJson(text));
      if (!parsed) throw new AirtelMoneyApiError(502);
      cached = {
        token: parsed.accessToken,
        expiresAtMs: now() + Math.max(0, parsed.expiresInSec - 60) * 1000,
      };
      return parsed.accessToken;
    },

    async requestPayment(body: Record<string, unknown>) {
      const token = await client.getAccessToken();
      const { text } = await call(airtelMoneyCollectionPath(), {
        method: "POST",
        headers: airtelMoneyHeaders(token),
        body: JSON.stringify(body),
      });
      return parseAirtelMoneyTransaction(parseJson(text));
    },

    async getTransactionStatus(idOrReference: string) {
      const token = await client.getAccessToken();
      const { text } = await call(airtelMoneyTransactionStatusPath(idOrReference), {
        method: "GET",
        headers: airtelMoneyHeaders(token),
      });
      return parseAirtelMoneyTransaction(parseJson(text));
    },

    async disbursement(body: Record<string, unknown>) {
      const token = await client.getAccessToken();
      const { text } = await call(airtelMoneyDisbursementPath(), {
        method: "POST",
        headers: airtelMoneyHeaders(token),
        body: JSON.stringify(body),
      });
      return parseAirtelMoneyTransaction(parseJson(text));
    },

    async getDisbursementStatus(idOrReference: string) {
      const token = await client.getAccessToken();
      const { text } = await call(airtelMoneyDisbursementStatusPath(idOrReference), {
        method: "GET",
        headers: airtelMoneyHeaders(token),
      });
      return parseAirtelMoneyTransaction(parseJson(text));
    },

    async getBalance() {
      requireReady();
      if (!AIRTEL_ADAPTER.balancePath) {
        // No publicly documented balance path exists; refuse rather
        // than guess an endpoint with money visibility.
        throw new AirtelMoneyAdapterUnconfirmedError();
      }
      const token = await client.getAccessToken();
      const { text } = await call(AIRTEL_ADAPTER.balancePath, {
        method: "GET",
        headers: airtelMoneyHeaders(token),
      });
      const parsed = parseAirtelMoneyTransaction(parseJson(text));
      return { availableBalance: null, currency: parsed.currency };
    },
  };

  return client;
}
