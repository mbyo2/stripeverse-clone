// Pure decision logic for the Airtel Money DIRECT connection
// (Collections + Disbursements, Zambia OpCo). Import-free on purpose:
// the exact file Deno runs is loaded by the vitest suite in
// tests/payments/airtelMoney.test.ts.
//
// HONESTY LEDGER — read before touching this file.
// Airtel publishes almost NO implementation-grade API detail
// publicly: the official portal (developers.airtel.africa) is
// country-gated, then login-gated, and the Zambia OpCo's endpoint /
// header / body / webhook documentation sits behind that login
// (verified by direct fetch, 2026-10-27). The CEO holds an Airtel
// developer account and has ordered us to WAIT on using it, so the
// gated Zambia shapes have deliberately NOT been read.
//
// CONFIRMED from official public sources:
//   - The portal is per-OpCo; Zambia is a listed OpCo (ZM).
//   - The programme offers merchant Collections AND Disbursements
//     into Airtel Money wallets (Airtel Africa press release).
//   - Registration flow is sign-up → register application → add
//     products per country → onboarding → go live; documentation
//     exploration is a post-login step.
//   - Zambia currency/country for this deployment: ZMW / ZM.
//
// EVERYTHING ELSE in this file — endpoint paths, the OAuth2 token
// body encoding, request body nesting, status vocabulary, callback
// payload shape, amount scale, MSISDN format, disbursement PIN
// handling, balance path — comes from consistent THIRD-PARTY public
// SDKs (mostly other markets) and is an ADAPTER HYPOTHESIS, isolated
// in AIRTEL_ADAPTER below and behind AIRTEL_API_SHAPES_CONFIRMED.
// The rail cannot make a network call until that flag is set from
// the gated Zambia documentation ("confirm on account access").
// Tests pin the adapter exactly as written so the confirmation diff
// is small and reviewable — they do NOT assert Airtel conformance.
//
// Secrets (Supabase, names only): AIRTEL_ENV ('production' selects
// production; anything else is staging), AIRTEL_CLIENT_ID,
// AIRTEL_CLIENT_SECRET, AIRTEL_PUBLIC_KEY_PEM (disbursement PIN
// encryption key from Key Management — adapter), AIRTEL_CALLBACK_URL,
// AIRTEL_BASE_URL (override), AIRTEL_API_SHAPES_CONFIRMED ('true'
// only after the Zambia gated docs are read and this adapter is
// reconciled with them).

// ── Configuration ────────────────────────────────────────────────────

export type AirtelMoneyEnvName = "staging" | "production";

/** Adapter-default hosts (third-party SDK consensus; CONFIRM in portal). */
export const AIRTEL_STAGING_BASE_URL = "https://openapiuat.airtel.africa";
export const AIRTEL_PRODUCTION_BASE_URL = "https://openapi.airtel.africa";

export const AIRTEL_COUNTRY = "ZM";
export const AIRTEL_CURRENCY = "ZMW";

/**
 * THE ADAPTER — every unverified Zambia shape lives here and only
 * here. When the gated Zambia documentation is read, this object
 * (plus AIRTEL_API_SHAPES_CONFIRMED) is the entire reconciliation
 * surface.
 */
export const AIRTEL_ADAPTER = {
  /** OAuth2 client-credentials token path. */
  tokenPath: "/auth/oauth2/token",
  /** Token body encoding: "json" (adapter default) or "form". */
  tokenContentType: "json" as "json" | "form",
  /** Collections USSD-push payment path (v1 per third-party SDKs). */
  collectionPath: "/merchant/v1/payments/",
  /** Transaction status enquiry path; `{id}` = provider txn id or reference. */
  transactionStatusPath: "/standard/v1/payments/{id}",
  /** Disbursement path (third-party SDK consensus). */
  disbursementPath: "/standard/v1/disbursements/",
  /** Disbursement status enquiry path. */
  disbursementStatusPath: "/standard/v1/disbursements/{id}",
  /** Balance enquiry path — NOT publicly documented; null = unavailable. */
  balancePath: null as string | null,
  /** MSISDN format the API expects: digits with country code. */
  msisdnFormat: "international" as "international" | "national",
  /** Amount scale in request bodies: major units (adapter default). */
  amountScale: "major" as "major" | "minor",
  /** Status vocabulary → our lifecycle (see mapAirtelMoneyStatus). */
  statusCodes: {
    successful: ["TS", "SUCCESS", "SUCCESSFUL", "COMPLETED"],
    failed: ["TF", "FAILED", "FAILURE", "REJECTED"],
    pending: ["TIP", "PENDING", "IN_PROGRESS", "INITIATED"],
  },
} as const;

export interface AirtelMoneyEnvValues {
  /** AIRTEL_ENV: 'production' selects production; anything else is staging. */
  env?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  /** RSA public key (PEM) for disbursement PIN encryption — adapter. */
  publicKeyPem?: string | null;
  callbackUrl?: string | null;
  baseUrl?: string | null;
  /**
   * AIRTEL_API_SHAPES_CONFIRMED: 'true' only after the gated Zambia
   * portal documentation has been read and AIRTEL_ADAPTER reconciled
   * with it. Anything else = adapter unconfirmed = no network calls.
   */
  shapesConfirmed?: string | boolean | null;
  /**
   * Kill switch, resolved by the caller from
   * platform_settings.airtel_money_enabled (migration 20261237).
   * Anything other than literal `true` means the rail is OFF.
   */
  railEnabled?: boolean | null;
}

export interface AirtelMoneyConfig {
  env: AirtelMoneyEnvName;
  baseUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  publicKeyPem: string | null;
  callbackUrl: string | null;
  /** Credentials exist (client id + secret). */
  configured: boolean;
  /** The Zambia adapter shapes have been confirmed from gated docs. */
  shapesConfirmed: boolean;
  /** Collections can run: configured AND shapes confirmed. */
  ready: boolean;
}

function present(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function airtelMoneyConfig(values: AirtelMoneyEnvValues): AirtelMoneyConfig {
  const env: AirtelMoneyEnvName =
    values.env?.trim() === "production" ? "production" : "staging";
  const clientId = present(values.clientId);
  const clientSecret = present(values.clientSecret);
  const configured = clientId !== null && clientSecret !== null;
  const shapesConfirmed = values.shapesConfirmed === true || values.shapesConfirmed === "true";
  return {
    env,
    baseUrl:
      present(values.baseUrl) ??
      (env === "production" ? AIRTEL_PRODUCTION_BASE_URL : AIRTEL_STAGING_BASE_URL),
    clientId,
    clientSecret,
    publicKeyPem: present(values.publicKeyPem),
    callbackUrl: present(values.callbackUrl),
    configured,
    shapesConfirmed,
    ready: configured && shapesConfirmed,
  };
}

// ── Plain-language messages (CEO error rule) ─────────────────────────

export const AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE =
  "Airtel Money isn't connected yet — BMaGlass connects directly to Airtel, and the merchant account with Airtel Zambia is still being set up. No money has moved.";

export const AIRTEL_MONEY_DISABLED_MESSAGE =
  "Airtel Money is switched off on this platform right now. No money has moved — please try again later.";

export const AIRTEL_MONEY_UNCONFIRMED_MESSAGE =
  "Airtel Money is still being connected — we're finishing the final checks with Airtel before it can take payments. No money has moved.";

export const AIRTEL_MONEY_INVALID_PHONE_MESSAGE =
  "Enter the Airtel number in international format (for example 2607XXXXXXXX).";

export const AIRTEL_MONEY_INVALID_AMOUNT_MESSAGE =
  "Enter an amount greater than zero.";

// ── Kill switch (platform_settings.airtel_money_enabled) ─────────────

export function airtelMoneyRailEnabled(
  settings: { airtel_money_enabled?: boolean | null } | null | undefined,
): boolean {
  return settings?.airtel_money_enabled === true;
}

export interface AirtelMoneyRailGate {
  allowed: boolean;
  status: "ready" | "not_configured" | "disabled" | "adapter_unconfirmed";
  error: string | null;
}

/**
 * The rail gate every Airtel money path must pass BEFORE any network
 * call. Precedence mirrors the MTN gate, plus the adapter rule:
 *   1. No credentials → `not_configured` (unchanged answer).
 *   2. Credentials + kill switch OFF → `disabled`.
 *   3. Credentials + switch ON + shapes unconfirmed →
 *      `adapter_unconfirmed` — we never guess a money wire format.
 *   4. All three satisfied → allowed.
 */
export function airtelMoneyRailGate(
  config: AirtelMoneyConfig,
  railEnabled: boolean,
): AirtelMoneyRailGate {
  if (!config.configured) {
    return { allowed: false, status: "not_configured", error: AIRTEL_MONEY_NOT_CONFIGURED_MESSAGE };
  }
  if (!railEnabled) {
    return { allowed: false, status: "disabled", error: AIRTEL_MONEY_DISABLED_MESSAGE };
  }
  if (!config.shapesConfirmed) {
    return { allowed: false, status: "adapter_unconfirmed", error: AIRTEL_MONEY_UNCONFIRMED_MESSAGE };
  }
  return { allowed: true, status: "ready", error: null };
}

// ── Paths (ADAPTER — see header) ─────────────────────────────────────

export function airtelMoneyTokenPath(): string {
  return AIRTEL_ADAPTER.tokenPath;
}

export function airtelMoneyCollectionPath(): string {
  return AIRTEL_ADAPTER.collectionPath;
}

export function airtelMoneyTransactionStatusPath(idOrReference: string): string {
  return AIRTEL_ADAPTER.transactionStatusPath.replace(
    "{id}",
    encodeURIComponent(idOrReference),
  );
}

export function airtelMoneyDisbursementPath(): string {
  return AIRTEL_ADAPTER.disbursementPath;
}

export function airtelMoneyDisbursementStatusPath(idOrReference: string): string {
  return AIRTEL_ADAPTER.disbursementStatusPath.replace(
    "{id}",
    encodeURIComponent(idOrReference),
  );
}

// ── Headers (ADAPTER — X-Country / X-Currency per public SDKs) ──────

export function airtelMoneyHeaders(
  accessToken: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Country": AIRTEL_COUNTRY,
    "X-Currency": AIRTEL_CURRENCY,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

// ── Money helpers ────────────────────────────────────────────────────

/** Normalise to digits-only international MSISDN (adapter format). */
export function normaliseAirtelMsisdn(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00260")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `260${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** Apply the adapter MSISDN format to a normalised number. */
export function airtelMsisdnForApi(msisdn: string): string {
  return AIRTEL_ADAPTER.msisdnFormat === "national" && msisdn.startsWith("260")
    ? msisdn.slice(3)
    : msisdn;
}

/** Render a major-unit amount per the adapter amount scale. */
export function airtelMoneyAmount(amount: unknown): number | null {
  const value =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  const major = Math.round(value * 100) / 100;
  return AIRTEL_ADAPTER.amountScale === "minor" ? Math.round(major * 100) : major;
}

// ── Bodies (ADAPTER shapes — third-party SDK consensus) ─────────────

export type AirtelMoneyBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string };

export interface AirtelMoneyCollectionInput {
  amount: unknown;
  /** OUR provider reference (ledger anchor). */
  reference: string;
  /** OUR ledger transaction id. */
  transactionId: string;
  payerMsisdn: string;
}

/**
 * ADAPTER collection body: top-level merchant `reference` plus a
 * nested `transaction` carrying BOTH the reference and our
 * transaction id — the two identifiers third-party SDKs distinguish.
 * Reconcile against the gated Zambia docs before activation.
 */
export function buildAirtelMoneyCollectionBody(
  input: AirtelMoneyCollectionInput,
): AirtelMoneyBodyResult {
  const amount = airtelMoneyAmount(input.amount);
  if (amount === null) return { ok: false, error: AIRTEL_MONEY_INVALID_AMOUNT_MESSAGE };
  const msisdn = normaliseAirtelMsisdn(input.payerMsisdn);
  if (msisdn === null) return { ok: false, error: AIRTEL_MONEY_INVALID_PHONE_MESSAGE };
  if (!input.reference) return { ok: false, error: "A payment reference is required." };
  return {
    ok: true,
    body: {
      reference: input.reference,
      subscriber: {
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
        msisdn: airtelMsisdnForApi(msisdn),
      },
      transaction: {
        amount,
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
        reference: input.reference,
        id: input.transactionId,
      },
    },
  };
}

export interface AirtelMoneyDisbursementInput {
  amount: unknown;
  reference: string;
  transactionId: string;
  payeeMsisdn: string;
  /**
   * The merchant PIN, ALREADY RSA-encrypted by the confirmed
   * encryption helper. PIN encryption (key source, padding) is an
   * adapter point: until the gated docs confirm it, no caller can
   * produce this value and disbursements refuse — by design.
   */
  encryptedPin?: string | null;
}

/** ADAPTER disbursement body; refuses without a pre-encrypted PIN. */
export function buildAirtelMoneyDisbursementBody(
  input: AirtelMoneyDisbursementInput,
): AirtelMoneyBodyResult {
  const amount = airtelMoneyAmount(input.amount);
  if (amount === null) return { ok: false, error: AIRTEL_MONEY_INVALID_AMOUNT_MESSAGE };
  const msisdn = normaliseAirtelMsisdn(input.payeeMsisdn);
  if (msisdn === null) return { ok: false, error: AIRTEL_MONEY_INVALID_PHONE_MESSAGE };
  if (!input.reference) return { ok: false, error: "A payment reference is required." };
  if (!input.encryptedPin) {
    return {
      ok: false,
      error:
        "Airtel Money payouts aren't available yet — the final payout checks with Airtel aren't complete. No money has moved.",
    };
  }
  return {
    ok: true,
    body: {
      reference: input.reference,
      payee: {
        msisdn: airtelMsisdnForApi(msisdn),
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
      },
      transaction: {
        amount,
        country: AIRTEL_COUNTRY,
        currency: AIRTEL_CURRENCY,
        reference: input.reference,
        id: input.transactionId,
      },
      pin: input.encryptedPin,
    },
  };
}

/** OAuth2 client-credentials token body (ADAPTER encoding). */
export function buildAirtelMoneyTokenRequest(
  config: AirtelMoneyConfig,
): { contentType: string; body: string } {
  const fields = {
    client_id: config.clientId ?? "",
    client_secret: config.clientSecret ?? "",
    grant_type: "client_credentials",
  };
  if (AIRTEL_ADAPTER.tokenContentType === "form") {
    return {
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams(fields).toString(),
    };
  }
  return { contentType: "application/json", body: JSON.stringify(fields) };
}

/** Parse an OAuth2 token response; null when it carries no token. */
export function parseAirtelMoneyToken(body: unknown): {
  accessToken: string;
  expiresInSec: number;
} | null {
  const root = asRecord(body);
  if (!root || typeof root.access_token !== "string" || !root.access_token) return null;
  return {
    accessToken: root.access_token,
    expiresInSec:
      typeof root.expires_in === "number" && root.expires_in > 0 ? root.expires_in : 3600,
  };
}

// ── Status machine (ADAPTER vocabulary) ──────────────────────────────

export type AirtelMoneyTxStatus = "pending" | "successful" | "failed";

export function mapAirtelMoneyStatus(raw: string | null | undefined): AirtelMoneyTxStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if ((AIRTEL_ADAPTER.statusCodes.successful as readonly string[]).includes(v)) return "successful";
  if ((AIRTEL_ADAPTER.statusCodes.failed as readonly string[]).includes(v)) return "failed";
  if ((AIRTEL_ADAPTER.statusCodes.pending as readonly string[]).includes(v)) return "pending";
  return null;
}

const TERMINAL: ReadonlySet<string> = new Set(["successful", "failed"]);

export function canApplyAirtelMoneyStatus(
  current: string | null | undefined,
  next: AirtelMoneyTxStatus | null | undefined,
): boolean {
  if (!next) return false;
  if (current && TERMINAL.has(current)) return false;
  return true;
}

export interface ParsedAirtelMoneyTransaction {
  status: AirtelMoneyTxStatus | null;
  rawStatus: string | null;
  /** Airtel's own transaction id. */
  providerTransactionId: string | null;
  /** OUR reference, echoed when the response carries it. */
  reference: string | null;
  amount: number | null;
  currency: string | null;
  /** DP-series response code when present (adapter). */
  responseCode: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function transactionRecord(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  if (!root) return null;
  const data = asRecord(root.data);
  return asRecord(data?.transaction) ?? asRecord(root.transaction) ?? data ?? root;
}

/** Parse a payment / status-enquiry response (ADAPTER nesting). */
export function parseAirtelMoneyTransaction(body: unknown): ParsedAirtelMoneyTransaction {
  const root = asRecord(body) ?? {};
  const tx = transactionRecord(body) ?? {};
  const statusObj = asRecord(root.status);
  const rawStatus = stringOrNull(tx.status) ?? stringOrNull(root.status as unknown);
  const amountRaw = tx.amount;
  return {
    status: mapAirtelMoneyStatus(rawStatus),
    rawStatus,
    providerTransactionId: stringOrNull(tx.id),
    reference: stringOrNull(tx.reference) ?? stringOrNull(root.reference as unknown),
    amount:
      typeof amountRaw === "number"
        ? amountRaw
        : typeof amountRaw === "string" && Number.isFinite(Number(amountRaw))
          ? Number(amountRaw)
          : null,
    currency: stringOrNull(tx.currency),
    responseCode:
      stringOrNull(statusObj?.code) ?? stringOrNull(tx.code) ?? null,
  };
}

export interface AirtelMoneyCallbackHint {
  /** OUR reference as echoed in the callback (adapter field name). */
  providerReference: string | null;
  providerTransactionId: string | null;
  /** The status the callback CLAIMS — never settled from. */
  claimedStatus: AirtelMoneyTxStatus | null;
}

/**
 * Extract the lookup hint from a callback body (ADAPTER shape: a
 * `transaction` object carrying transaction_reference /
 * transaction_id / status — third-party Zambia example). Callback
 * SIGNATURE rules for Zambia are not publicly verifiable and
 * third-party sources conflict, so callbacks are treated as
 * unauthenticated hints: identification only, settlement always
 * from a re-queried status enquiry.
 */
export function airtelMoneyCallbackHint(body: unknown): AirtelMoneyCallbackHint {
  const tx = transactionRecord(body) ?? {};
  const rawStatus = stringOrNull(tx.status);
  return {
    providerReference:
      stringOrNull(tx.transaction_reference) ?? stringOrNull(tx.reference),
    providerTransactionId:
      stringOrNull(tx.transaction_id) ?? stringOrNull(tx.id),
    claimedStatus: mapAirtelMoneyStatus(rawStatus),
  };
}

// ── Error classification ─────────────────────────────────────────────

export type AirtelMoneyErrorKind =
  | "duplicate_reference"
  | "auth"
  | "not_found"
  | "validation"
  | "provider"
  | "unknown";

export function classifyAirtelMoneyError(status: number): AirtelMoneyErrorKind {
  if (status === 409) return "duplicate_reference";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status >= 500) return "provider";
  return "unknown";
}
