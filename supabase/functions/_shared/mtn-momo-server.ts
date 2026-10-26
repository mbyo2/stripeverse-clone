// Server-side MTN MoMo operations (Deno) — the fetch half of the
// direct-connection skeleton whose pure logic lives in ./mtn-momo.ts.
//
// STATUS: SKELETON — UNPROVEN until MTN Zambia merchant onboarding.
// Nothing in the live money path calls this module yet: the
// `mobile-money` edge function still answers `not_configured` for
// every provider action (via _shared/payment-providers.ts), and it
// keeps doing so until (a) MTN issues production credentials through
// the merchant account, (b) the sandbox contract below is exercised
// end-to-end with a real MoMo developer-portal account, and (c) the
// collection/disbursement ledger integration is built and proven
// the way the PayPal rail was. Wiring this module into a money path
// before all three would repeat the simulated-gateway failure this
// platform already removed once.
//
// Money rules encoded here (for the day it is wired):
//   - LEDGER FIRST: callers persist their row (with the reference
//     UUID as the idempotency anchor) before requestToPay/transfer.
//   - STATUS ONLY FROM RE-QUERY: callbacks are hints; settlement
//     state comes from getRequestToPayStatus / getTransferStatus.
//   - 409 duplicate_reference means the original request exists —
//     re-query it, never mint a second reference for the same row.

import {
  buildMtnMomoApiUserBody,
  classifyMtnMomoError,
  mtnMomoApiKeyPath,
  mtnMomoApiUserPath,
  mtnMomoBalancePath,
  mtnMomoBasicAuthHeader,
  mtnMomoConfig,
  mtnMomoMoneyCallHeaders,
  mtnMomoReadHeaders,
  mtnMomoRequestToPayPath,
  mtnMomoRequestToPayStatusPath,
  mtnMomoSubscriptionHeaders,
  mtnMomoSubscriptionKey,
  mtnMomoTokenPath,
  mtnMomoTransferPath,
  mtnMomoTransferStatusPath,
  parseMtnMomoBalance,
  parseMtnMomoTransaction,
  MTN_MOMO_NOT_CONFIGURED_MESSAGE,
  type MtnMomoConfig,
  type MtnMomoEnvValues,
  type MtnMomoProduct,
  type ParsedMtnMomoTransaction,
} from "./mtn-momo.ts";

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

export class MtnMomoNotConfiguredError extends Error {
  constructor() {
    super(MTN_MOMO_NOT_CONFIGURED_MESSAGE);
    this.name = "MtnMomoNotConfiguredError";
  }
}

export class MtnMomoApiError extends Error {
  readonly status: number;
  readonly kind: ReturnType<typeof classifyMtnMomoError>;
  constructor(status: number) {
    super(`MTN MoMo request failed (HTTP ${status})`);
    this.name = "MtnMomoApiError";
    this.status = status;
    this.kind = classifyMtnMomoError(status);
  }
}

export interface MtnMomoClient {
  config: MtnMomoConfig;
  /** Sandbox only: create the API user (returns the user id used). */
  provisionSandboxApiUser(apiUserId: string): Promise<void>;
  /** Sandbox only: generate the API key for a provisioned user. */
  provisionSandboxApiKey(apiUserId: string): Promise<string>;
  getAccessToken(product: MtnMomoProduct): Promise<string>;
  requestToPay(referenceId: string, body: Record<string, unknown>): Promise<void>;
  getRequestToPayStatus(referenceId: string): Promise<ParsedMtnMomoTransaction>;
  transfer(referenceId: string, body: Record<string, unknown>): Promise<void>;
  getTransferStatus(referenceId: string): Promise<ParsedMtnMomoTransaction>;
  getBalance(product: MtnMomoProduct): Promise<{ availableBalance: string | null; currency: string | null }>;
}

interface CachedToken {
  token: string;
  /** Epoch ms at which the token is treated as expired (skewed). */
  expiresAtMs: number;
}

/**
 * Build a client from raw env values. Token responses are cached
 * per product with a 60-second safety skew (documented lifetime is
 * ~3600s). All provider traffic goes through the injected fetch so
 * the vitest suite can pin the exact wire contract offline.
 */
export function createMtnMomoClient(
  values: MtnMomoEnvValues,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): MtnMomoClient {
  const config = mtnMomoConfig(values);
  const tokens = new Map<MtnMomoProduct, CachedToken>();

  function requireProduct(product: MtnMomoProduct): void {
    const ready =
      product === "collection" ? config.collectionConfigured : config.disbursementConfigured;
    if (!ready || !mtnMomoSubscriptionKey(config, product)) {
      throw new MtnMomoNotConfiguredError();
    }
  }

  async function call(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; text: string }> {
    const res = await fetchImpl(`${config.baseUrl}${path}`, init);
    const text = await res.text();
    if (!res.ok) throw new MtnMomoApiError(res.status);
    return { status: res.status, text };
  }

  const client: MtnMomoClient = {
    config,

    async provisionSandboxApiUser(apiUserId: string): Promise<void> {
      if (config.env !== "sandbox" || !config.collectionSubscriptionKey) {
        throw new MtnMomoNotConfiguredError();
      }
      await call(mtnMomoApiUserPath(), {
        method: "POST",
        headers: {
          ...mtnMomoSubscriptionHeaders(config, "collection"),
          "X-Reference-Id": apiUserId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildMtnMomoApiUserBody(config.callbackUrl ?? "localhost"),
        ),
      });
    },

    async provisionSandboxApiKey(apiUserId: string): Promise<string> {
      if (config.env !== "sandbox" || !config.collectionSubscriptionKey) {
        throw new MtnMomoNotConfiguredError();
      }
      const { text } = await call(mtnMomoApiKeyPath(apiUserId), {
        method: "POST",
        headers: {
          ...mtnMomoSubscriptionHeaders(config, "collection"),
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const parsed = JSON.parse(text) as { apiKey?: unknown };
      if (typeof parsed.apiKey !== "string" || !parsed.apiKey) {
        throw new MtnMomoApiError(502);
      }
      return parsed.apiKey;
    },

    async getAccessToken(product: MtnMomoProduct): Promise<string> {
      requireProduct(product);
      if (!config.apiUserId || !config.apiKey) {
        // Production credentials are MTN-issued; sandbox credentials
        // come from provisionSandboxApiUser/Key + a rebuilt client.
        throw new MtnMomoNotConfiguredError();
      }
      const cached = tokens.get(product);
      if (cached && now() < cached.expiresAtMs) return cached.token;
      const { text } = await call(mtnMomoTokenPath(product), {
        method: "POST",
        headers: {
          ...mtnMomoSubscriptionHeaders(config, product),
          Authorization: mtnMomoBasicAuthHeader(config.apiUserId, config.apiKey),
        },
      });
      const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
      if (typeof parsed.access_token !== "string" || !parsed.access_token) {
        throw new MtnMomoApiError(502);
      }
      const lifetimeSec =
        typeof parsed.expires_in === "number" && parsed.expires_in > 0
          ? parsed.expires_in
          : 3600;
      tokens.set(product, {
        token: parsed.access_token,
        expiresAtMs: now() + Math.max(0, lifetimeSec - 60) * 1000,
      });
      return parsed.access_token;
    },

    async requestToPay(referenceId: string, body: Record<string, unknown>): Promise<void> {
      const token = await client.getAccessToken("collection");
      await call(mtnMomoRequestToPayPath(), {
        method: "POST",
        headers: mtnMomoMoneyCallHeaders(config, "collection", token, referenceId),
        body: JSON.stringify(body),
      });
    },

    async getRequestToPayStatus(referenceId: string): Promise<ParsedMtnMomoTransaction> {
      const token = await client.getAccessToken("collection");
      const { text } = await call(mtnMomoRequestToPayStatusPath(referenceId), {
        method: "GET",
        headers: mtnMomoReadHeaders(config, "collection", token),
      });
      return parseMtnMomoTransaction(JSON.parse(text));
    },

    async transfer(referenceId: string, body: Record<string, unknown>): Promise<void> {
      const token = await client.getAccessToken("disbursement");
      await call(mtnMomoTransferPath(), {
        method: "POST",
        headers: mtnMomoMoneyCallHeaders(config, "disbursement", token, referenceId),
        body: JSON.stringify(body),
      });
    },

    async getTransferStatus(referenceId: string): Promise<ParsedMtnMomoTransaction> {
      const token = await client.getAccessToken("disbursement");
      const { text } = await call(mtnMomoTransferStatusPath(referenceId), {
        method: "GET",
        headers: mtnMomoReadHeaders(config, "disbursement", token),
      });
      return parseMtnMomoTransaction(JSON.parse(text));
    },

    async getBalance(product: MtnMomoProduct) {
      const token = await client.getAccessToken(product);
      const { text } = await call(mtnMomoBalancePath(product), {
        method: "GET",
        headers: mtnMomoReadHeaders(config, product, token),
      });
      return parseMtnMomoBalance(JSON.parse(text));
    },
  };

  return client;
}
