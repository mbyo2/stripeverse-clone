// Server-side MTN MoMo operations (Deno) — the fetch half of the
// direct connection whose pure logic lives in ./mtn-momo.ts.
//
// STATUS: WIRED (2026-10-27 docs-complete pass) — the `mobile-money`
// edge function calls this client for collection / disbursement /
// status / balance / account-holder actions, always behind the
// platform_settings.mtn_momo_enabled kill switch and the shared
// telco ledger (migration 20261237). UNPROVEN against a live MTN
// account until MTN Zambia merchant onboarding issues credentials
// and the sandbox contract is exercised end-to-end; with no secrets
// the client refuses before any network call, so the live app's
// truthful not_configured answer is unchanged.
//
// KILL SWITCH: callers resolve platform_settings.mtn_momo_enabled
// (migration 20261236) into MtnMomoEnvValues.railEnabled. Configured
// but switched OFF = MtnMomoDisabledError before any network call —
// see mtnMomoRailGate in ./mtn-momo.ts.
//
// Money rules encoded here:
//   - LEDGER FIRST: callers persist their row (with the reference
//     UUID as the idempotency anchor) before requestToPay/transfer.
//   - STATUS ONLY FROM RE-QUERY: callbacks are hints; settlement
//     state comes from getRequestToPayStatus / getTransferStatus.
//   - 409 duplicate_reference means the original request exists —
//     re-query it, never mint a second reference for the same row.

import {
  buildMtnMomoApiUserBody,
  classifyMtnMomoError,
  mtnMomoAccountHolderActivePath,
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
  mtnMomoRailGate,
  parseMtnMomoAccountHolderActive,
  parseMtnMomoBalance,
  parseMtnMomoTransaction,
  MTN_MOMO_DISABLED_MESSAGE,
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

/**
 * The kill switch (platform_settings.mtn_momo_enabled) is OFF while
 * the rail IS configured — thrown before any network call, so the
 * rail can be stopped without unsetting secrets.
 */
export class MtnMomoDisabledError extends Error {
  constructor() {
    super(MTN_MOMO_DISABLED_MESSAGE);
    this.name = "MtnMomoDisabledError";
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
  /** Collection account-holder check: is this MSISDN an active MoMo account? */
  isAccountHolderActive(msisdn: string): Promise<boolean | null>;
  /** Product-routed status re-query (the ONLY settlement source). */
  getStatus(product: MtnMomoProduct, referenceId: string): Promise<ParsedMtnMomoTransaction>;
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

  // Kill switch (platform_settings.mtn_momo_enabled, resolved by the
  // caller into values.railEnabled): when the rail is configured but
  // switched OFF, every operation refuses with MtnMomoDisabledError
  // BEFORE any network call. When the rail is not configured at all,
  // the not-configured refusal keeps precedence (unchanged answer).
  const gate = mtnMomoRailGate(config, values.railEnabled === true);

  function requireRailEnabled(): void {
    if (gate.status === "disabled") {
      throw new MtnMomoDisabledError();
    }
  }

  function requireProduct(product: MtnMomoProduct): void {
    const ready =
      product === "collection" ? config.collectionConfigured : config.disbursementConfigured;
    if (!ready || !mtnMomoSubscriptionKey(config, product)) {
      throw new MtnMomoNotConfiguredError();
    }
    requireRailEnabled();
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
      requireRailEnabled();
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
      requireRailEnabled();
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

    async isAccountHolderActive(msisdn: string) {
      const token = await client.getAccessToken("collection");
      const { text } = await call(mtnMomoAccountHolderActivePath(msisdn), {
        method: "GET",
        headers: mtnMomoReadHeaders(config, "collection", token),
      });
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // A bare non-JSON body still parses through the string arm.
      }
      return parseMtnMomoAccountHolderActive(body);
    },

    async getStatus(product: MtnMomoProduct, referenceId: string) {
      return product === "collection"
        ? client.getRequestToPayStatus(referenceId)
        : client.getTransferStatus(referenceId);
    },
  };

  return client;
}
