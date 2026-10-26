// Pure decision logic for the MTN MoMo DIRECT connection
// (Collections + Disbursements). Import-free on purpose: the exact
// file Deno runs is loaded by the vitest suite in
// tests/payments/mtnMomo.test.ts.
//
// STATUS: SKELETON — UNPROVEN until MTN Zambia merchant onboarding.
// CEO decision 2026-10-26: BMaGlass Pay connects DIRECTLY to the
// mobile money providers (MTN MoMo, Airtel Money, Zamtel) — no
// aggregator, no Lenco (Lenco belongs to Doc'O Clock). This module
// is built against MTN's PUBLIC developer documentation
// (momodeveloper.mtn.com) and its public sandbox contract:
//
//   - Developer portal: momodeveloper.mtn.com — self-serve signup;
//     each product (Collection, Disbursement, Remittance) is
//     subscribed separately and carries its OWN subscription key,
//     sent as the `Ocp-Apim-Subscription-Key` header on every call.
//   - Sandbox host: https://sandbox.momodeveloper.mtn.com with
//     X-Target-Environment: sandbox. In the sandbox, API users are
//     SELF-provisioned: POST /v1_0/apiuser (X-Reference-Id = the
//     API-user UUID we choose, body { providerCallbackHost }) → 201,
//     then POST /v1_0/apiuser/{apiUserId}/apikey → { apiKey }.
//     Sandbox transactions settle in EUR only (documented sandbox
//     rule) — ZMW exists only in production target environments.
//   - Tokens: POST /collection/token/ (resp. /disbursement/token/)
//     with HTTP Basic base64(apiUserId:apiKey) + the product's
//     subscription key → { access_token, expires_in ~3600 }.
//   - RequestToPay: POST /collection/v1_0/requesttopay → 202, with
//     header X-Reference-Id = a UUID WE generate — that UUID is the
//     idempotency anchor (a duplicate reference is refused with
//     HTTP 409) and the status-lookup key:
//     GET /collection/v1_0/requesttopay/{referenceId} →
//     { amount, currency, financialTransactionId, externalId,
//       payer, status: PENDING | SUCCESSFUL | FAILED, reason }.
//     Body: { amount (STRING), currency, externalId,
//       payer: { partyIdType: "MSISDN", partyId }, payerMessage,
//       payeeNote }.
//   - Disbursement: POST /disbursement/v1_0/transfer (same header
//     contract; body names `payee` instead of `payer`) → 202;
//     GET /disbursement/v1_0/transfer/{referenceId}.
//   - Balance: GET /{product}/v1_0/account/balance →
//     { availableBalance, currency }.
//   - Callbacks: MTN POSTs the final status to the callback URL
//     (X-Callback-Url header at request time, else the API user's
//     providerCallbackHost) with the same shape as the status GET.
//     House doctrine: a callback is a HINT — settlement state is
//     only ever taken from a re-queried status GET.
//
// PRODUCTION (CONFIRM-AT-ONBOARDING): production API user ID + API
// key are NOT self-provisioned — MTN issues them through the MoMo
// merchant/OVA dashboard after the merchant account + KYC are
// approved (company documents to MTN Zambia). The production base
// URL and X-Target-Environment (expected "mtnzambia") are assigned
// per market at onboarding; both are configuration here, never
// hard-coded truths.
//
// Secrets (Supabase, names only): MTN_MOMO_ENV ('production' selects
// production; anything else is sandbox),
// MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY,
// MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY, MTN_MOMO_API_USER_ID,
// MTN_MOMO_API_KEY, MTN_MOMO_TARGET_ENVIRONMENT,
// MTN_MOMO_CALLBACK_URL, MTN_MOMO_PRODUCTION_BASE_URL.

// ── Configuration ────────────────────────────────────────────────────

export type MtnMomoEnvName = "sandbox" | "production";
export type MtnMomoProduct = "collection" | "disbursement";

export const MTN_MOMO_SANDBOX_BASE_URL = "https://sandbox.momodeveloper.mtn.com";

/**
 * Default production APIM host. CONFIRM-AT-ONBOARDING: MTN assigns
 * the market's production host (and target environment) when the
 * merchant account is approved — MTN_MOMO_PRODUCTION_BASE_URL
 * overrides this without a code change.
 */
export const MTN_MOMO_DEFAULT_PRODUCTION_BASE_URL = "https://momodeveloper.mtn.com";

/** Expected production target environment for Zambia. CONFIRM-AT-ONBOARDING. */
export const MTN_MOMO_ZAMBIA_TARGET_ENVIRONMENT = "mtnzambia";

/** Raw secret VALUES as read from the environment (never logged). */
export interface MtnMomoEnvValues {
  /** MTN_MOMO_ENV: 'production' selects production; anything else is sandbox. */
  env?: string | null;
  collectionSubscriptionKey?: string | null;
  disbursementSubscriptionKey?: string | null;
  /** MTN-provisioned in production; self-provisioned in sandbox. */
  apiUserId?: string | null;
  apiKey?: string | null;
  /** X-Target-Environment override (production market name). */
  targetEnvironment?: string | null;
  /** Public callback host/URL MTN posts status hints to. */
  callbackUrl?: string | null;
  productionBaseUrl?: string | null;
}

export interface MtnMomoConfig {
  env: MtnMomoEnvName;
  baseUrl: string;
  targetEnvironment: string;
  collectionSubscriptionKey: string | null;
  disbursementSubscriptionKey: string | null;
  apiUserId: string | null;
  apiKey: string | null;
  callbackUrl: string | null;
  /** True when token credentials (API user + key) already exist. */
  hasApiCredentials: boolean;
  /**
   * Collections can run: a collection subscription key exists AND
   * (sandbox — API credentials are self-provisionable — OR the
   * MTN-provisioned API user + key are present).
   */
  collectionConfigured: boolean;
  /** Disbursements can run (same rule, disbursement key). */
  disbursementConfigured: boolean;
  /** Either product can run. */
  configured: boolean;
}

function present(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function mtnMomoConfig(values: MtnMomoEnvValues): MtnMomoConfig {
  const env: MtnMomoEnvName =
    values.env?.trim() === "production" ? "production" : "sandbox";
  const apiUserId = present(values.apiUserId);
  const apiKey = present(values.apiKey);
  const hasApiCredentials = apiUserId !== null && apiKey !== null;
  const collectionSubscriptionKey = present(values.collectionSubscriptionKey);
  const disbursementSubscriptionKey = present(values.disbursementSubscriptionKey);
  // Sandbox API credentials are self-provisioned from a subscription
  // key alone (see provision paths below); production credentials
  // are issued by MTN, so production refuses to call itself
  // configured without them.
  const credentialsReady = env === "sandbox" ? true : hasApiCredentials;
  const targetEnvironment =
    present(values.targetEnvironment) ??
    (env === "sandbox" ? "sandbox" : MTN_MOMO_ZAMBIA_TARGET_ENVIRONMENT);
  return {
    env,
    baseUrl:
      env === "sandbox"
        ? MTN_MOMO_SANDBOX_BASE_URL
        : present(values.productionBaseUrl) ?? MTN_MOMO_DEFAULT_PRODUCTION_BASE_URL,
    targetEnvironment,
    collectionSubscriptionKey,
    disbursementSubscriptionKey,
    apiUserId,
    apiKey,
    callbackUrl: present(values.callbackUrl),
    hasApiCredentials,
    collectionConfigured: collectionSubscriptionKey !== null && credentialsReady,
    disbursementConfigured: disbursementSubscriptionKey !== null && credentialsReady,
    configured:
      (collectionSubscriptionKey !== null || disbursementSubscriptionKey !== null) &&
      credentialsReady,
  };
}

// ── Plain-language messages (CEO error rule) ─────────────────────────

export const MTN_MOMO_NOT_CONFIGURED_MESSAGE =
  "MTN MoMo isn't connected yet — BMaGlass connects directly to MTN, and the merchant account with MTN Zambia is still being set up. No money has moved.";

export const MTN_MOMO_INVALID_PHONE_MESSAGE =
  "Enter the MTN number in international format (for example 2607XXXXXXXX).";

export const MTN_MOMO_INVALID_AMOUNT_MESSAGE =
  "Enter an amount greater than zero.";

// ── Paths (documented) ───────────────────────────────────────────────

export function mtnMomoSubscriptionKey(
  config: MtnMomoConfig,
  product: MtnMomoProduct,
): string | null {
  return product === "collection"
    ? config.collectionSubscriptionKey
    : config.disbursementSubscriptionKey;
}

/** Sandbox provisioning: create the API user (201, empty body). */
export function mtnMomoApiUserPath(): string {
  return "/v1_0/apiuser";
}

/** Sandbox provisioning: generate the API key for an API user. */
export function mtnMomoApiKeyPath(apiUserId: string): string {
  return `/v1_0/apiuser/${encodeURIComponent(apiUserId)}/apikey`;
}

/** OAuth token endpoint per product. */
export function mtnMomoTokenPath(product: MtnMomoProduct): string {
  return `/${product}/token/`;
}

export function mtnMomoRequestToPayPath(): string {
  return "/collection/v1_0/requesttopay";
}

export function mtnMomoRequestToPayStatusPath(referenceId: string): string {
  return `/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`;
}

export function mtnMomoTransferPath(): string {
  return "/disbursement/v1_0/transfer";
}

export function mtnMomoTransferStatusPath(referenceId: string): string {
  return `/disbursement/v1_0/transfer/${encodeURIComponent(referenceId)}`;
}

export function mtnMomoBalancePath(product: MtnMomoProduct): string {
  return `/${product}/v1_0/account/balance`;
}

export function mtnMomoAccountHolderActivePath(msisdn: string): string {
  return `/collection/v1_0/accountholder/msisdn/${encodeURIComponent(msisdn)}/active`;
}

// ── Headers / auth ───────────────────────────────────────────────────

/** Every MoMo call carries the product's subscription key. */
export function mtnMomoSubscriptionHeaders(
  config: MtnMomoConfig,
  product: MtnMomoProduct,
): Record<string, string> {
  const key = mtnMomoSubscriptionKey(config, product);
  return key ? { "Ocp-Apim-Subscription-Key": key } : {};
}

/** HTTP Basic credential for the token endpoints: base64(user:key). */
export function mtnMomoBasicAuthHeader(apiUserId: string, apiKey: string): string {
  return `Basic ${btoa(`${apiUserId}:${apiKey}`)}`;
}

/**
 * Headers for a money call (requestToPay / transfer): bearer token,
 * OUR reference UUID (idempotency anchor + status key), the target
 * environment, the subscription key, and the callback URL when one
 * is configured.
 */
export function mtnMomoMoneyCallHeaders(
  config: MtnMomoConfig,
  product: MtnMomoProduct,
  accessToken: string,
  referenceId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...mtnMomoSubscriptionHeaders(config, product),
    Authorization: `Bearer ${accessToken}`,
    "X-Reference-Id": referenceId,
    "X-Target-Environment": config.targetEnvironment,
    "Content-Type": "application/json",
  };
  if (config.callbackUrl) headers["X-Callback-Url"] = config.callbackUrl;
  return headers;
}

/** Headers for a status / balance GET. */
export function mtnMomoReadHeaders(
  config: MtnMomoConfig,
  product: MtnMomoProduct,
  accessToken: string,
): Record<string, string> {
  return {
    ...mtnMomoSubscriptionHeaders(config, product),
    Authorization: `Bearer ${accessToken}`,
    "X-Target-Environment": config.targetEnvironment,
  };
}

/** Body for sandbox API-user provisioning. */
export function buildMtnMomoApiUserBody(callbackHost: string): { providerCallbackHost: string } {
  return { providerCallbackHost: callbackHost };
}

// ── Money bodies ─────────────────────────────────────────────────────

/**
 * Normalise a phone number to digits-only international format.
 * Accepts Zambian local form (0XXXXXXXXX → 260XXXXXXXXX) and full
 * international form; returns null for anything that cannot be an
 * MSISDN (MoMo addresses parties by MSISDN without a leading '+').
 */
export function normaliseMsisdn(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00260")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `260${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/**
 * MoMo amounts travel as STRINGS. Validate a major-unit amount and
 * render it as the documented string form (no exponent, no float
 * drift); null when the amount is not a positive finite number.
 */
export function mtnMomoAmountString(amount: unknown): string | null {
  const value =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return String(Math.round(value * 100) / 100);
}

export interface MtnMomoRequestToPayInput {
  amount: unknown;
  /** ISO currency. Sandbox settles EUR only; production Zambia = ZMW. */
  currency: string;
  /** OUR transaction reference (stored on our ledger row). */
  externalId: string;
  payerMsisdn: string;
  payerMessage?: string;
  payeeNote?: string;
}

export type MtnMomoBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

/** Build the documented requestToPay body (amount as string). */
export function buildMtnMomoRequestToPayBody(
  input: MtnMomoRequestToPayInput,
): MtnMomoBodyResult {
  const amount = mtnMomoAmountString(input.amount);
  if (amount === null) return { ok: false, error: MTN_MOMO_INVALID_AMOUNT_MESSAGE };
  const msisdn = normaliseMsisdn(input.payerMsisdn);
  if (msisdn === null) return { ok: false, error: MTN_MOMO_INVALID_PHONE_MESSAGE };
  const currency = (input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Choose a valid currency for the payment." };
  }
  if (!input.externalId || typeof input.externalId !== "string") {
    return { ok: false, error: "A payment reference is required." };
  }
  return {
    ok: true,
    body: {
      amount,
      currency,
      externalId: input.externalId,
      payer: { partyIdType: "MSISDN", partyId: msisdn },
      payerMessage: input.payerMessage ?? "Payment to BMaGlass Pay",
      payeeNote: input.payeeNote ?? "BMaGlass Pay collection",
    },
  };
}

export interface MtnMomoTransferInput {
  amount: unknown;
  currency: string;
  externalId: string;
  payeeMsisdn: string;
  payerMessage?: string;
  payeeNote?: string;
}

/** Build the documented disbursement transfer body (`payee`, not `payer`). */
export function buildMtnMomoTransferBody(input: MtnMomoTransferInput): MtnMomoBodyResult {
  const amount = mtnMomoAmountString(input.amount);
  if (amount === null) return { ok: false, error: MTN_MOMO_INVALID_AMOUNT_MESSAGE };
  const msisdn = normaliseMsisdn(input.payeeMsisdn);
  if (msisdn === null) return { ok: false, error: MTN_MOMO_INVALID_PHONE_MESSAGE };
  const currency = (input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Choose a valid currency for the payment." };
  }
  if (!input.externalId || typeof input.externalId !== "string") {
    return { ok: false, error: "A payment reference is required." };
  }
  return {
    ok: true,
    body: {
      amount,
      currency,
      externalId: input.externalId,
      payee: { partyIdType: "MSISDN", partyId: msisdn },
      payerMessage: input.payerMessage ?? "Payment from BMaGlass Pay",
      payeeNote: input.payeeNote ?? "BMaGlass Pay disbursement",
    },
  };
}

// ── Status machine ───────────────────────────────────────────────────

export type MtnMomoTxStatus = "pending" | "successful" | "failed";

/** Map a MoMo raw status onto our lifecycle; unknown → null. */
export function mapMtnMomoStatus(raw: string | null | undefined): MtnMomoTxStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim().toUpperCase()) {
    case "PENDING":
      return "pending";
    case "SUCCESSFUL":
      return "successful";
    case "FAILED":
      return "failed";
    default:
      return null;
  }
}

const TERMINAL: ReadonlySet<string> = new Set(["successful", "failed"]);

export function isTerminalMtnMomoStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL.has(status);
}

/**
 * May `next` replace `current`? Callbacks and polls race; a terminal
 * state (SUCCESSFUL / FAILED) never regresses — the same doctrine as
 * the MoonPay rail.
 */
export function canApplyMtnMomoStatus(
  current: string | null | undefined,
  next: MtnMomoTxStatus | null | undefined,
): boolean {
  if (!next) return false;
  if (current && TERMINAL.has(current)) return false;
  return true;
}

export interface ParsedMtnMomoTransaction {
  status: MtnMomoTxStatus | null;
  rawStatus: string | null;
  /** MoMo's own transaction id (present once processed). */
  financialTransactionId: string | null;
  externalId: string | null;
  amount: string | null;
  currency: string | null;
  reasonCode: string | null;
  reasonMessage: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a status-GET / callback body (identical documented shape). */
export function parseMtnMomoTransaction(body: unknown): ParsedMtnMomoTransaction {
  const root = asRecord(body) ?? {};
  const reason = asRecord(root.reason);
  const rawStatus = stringOrNull(root.status);
  return {
    status: mapMtnMomoStatus(rawStatus),
    rawStatus,
    financialTransactionId: stringOrNull(root.financialTransactionId),
    externalId: stringOrNull(root.externalId),
    amount: typeof root.amount === "string" ? root.amount : null,
    currency: stringOrNull(root.currency),
    reasonCode: stringOrNull(reason?.code),
    reasonMessage: stringOrNull(reason?.message),
  };
}

/** Parse an account-balance body. */
export function parseMtnMomoBalance(body: unknown): {
  availableBalance: string | null;
  currency: string | null;
} {
  const root = asRecord(body) ?? {};
  return {
    availableBalance:
      typeof root.availableBalance === "string" ? root.availableBalance : null,
    currency: stringOrNull(root.currency),
  };
}

// ── Error classification ─────────────────────────────────────────────

export type MtnMomoErrorKind =
  | "duplicate_reference"
  | "auth"
  | "not_found"
  | "validation"
  | "provider"
  | "unknown";

/**
 * Classify an HTTP failure from the MoMo APIM gateway. The one
 * money-critical case is 409: MTN refuses a reused X-Reference-Id,
 * which is exactly what makes a retried request safe — the caller
 * must re-query the ORIGINAL reference's status rather than mint a
 * new reference and risk a double collection.
 */
export function classifyMtnMomoError(status: number): MtnMomoErrorKind {
  if (status === 409) return "duplicate_reference";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status >= 500) return "provider";
  return "unknown";
}
