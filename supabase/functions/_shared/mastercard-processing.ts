// Mastercard Processing Core — pure request / decision logic shared
// by the `mastercard-processing` edge function, the provider branch
// inside `create-virtual-card`, and the vitest suite.
//
// Deliberately pure (no imports, no Deno APIs, no fetch) so tests
// exercise the exact code the edge functions run — the repo pattern
// from _shared/mastercard-move.ts.
//
// What this module encodes (gateway brief §1.1 + the official
// Processing Core API reference / sandbox test cases on
// developer.mastercard.com):
//
//   * The resource model: POST /clients → POST /accounts →
//     POST /cards, then GET /cards/{card_contract_id} for status /
//     details and GET /contracts/{contract_id}/transactions for the
//     transaction list. Base URLs are the reference's published
//     environment domains:
//       sandbox    https://sandbox.api.mastercard.com/global-processing/core
//       production https://api.mastercard.com/global-processing/core
//
//   * The documented SANDBOX test values (from the official sandbox
//     test cases for "Order a Virtual Card"): clientType "PR",
//     account productCode "STD-DEBCH-EUR", card productCode
//     "STD-MCDEBVF-EUR". These resolve ONLY in sandbox. Production
//     has NO defaults: clientType and the product codes are agreed
//     with Mastercard Processing at onboarding and must be supplied
//     via the MC_PROCESSING_* secrets, or the layer reports itself
//     not configured. Inventing production values would be a lie.
//
//   * Response shapes from the same test cases: creation returns
//     201 with { clientId } / { accountContractId } /
//     { cardContractId } and a Location header; failures use the
//     envelope { Errors: { Error: [{ Source, ReasonCode,
//     Description, Recoverable }] } }.
//
//   * PAN hygiene: a provider card-contract payload may carry the
//     full cardContractNumber (ISO-0 issuers). Nothing in this
//     module logs; the redaction helpers exist so callers can scrub
//     anything before it touches a log line or a stored record. The
//     full PAN is never persisted by the platform — only the masked
//     form (same "**** **** **** 1234" shape as the
//     mask_card_number RPC) and the provider contract ids are.

export type ProcessingEnv = "sandbox" | "production";

export interface MastercardProcessingConfig {
  env: ProcessingEnv;
  /** OAuth project credentials (shared with the Move project key). */
  consumerKey: string | null;
  signingKeyPem: string | null;
  /** Onboarding-agreed values; null → sandbox default / unconfigured. */
  clientType: string | null;
  accountProductCode: string | null;
  cardProductCode: string | null;
}

// ---------------------------------------------------------------------------
// Documented sandbox test values (official sandbox test cases,
// "Order a Virtual Card — Create Client, Account Contract, and Card
// Contract"). Sandbox ONLY — see the resolvers below.
// ---------------------------------------------------------------------------

export const SANDBOX_CLIENT_TYPE = "PR";
export const SANDBOX_ACCOUNT_PRODUCT_CODE = "STD-DEBCH-EUR";
export const SANDBOX_CARD_PRODUCT_CODE = "STD-MCDEBVF-EUR";

export function resolveClientType(config: MastercardProcessingConfig): string | null {
  if (config.clientType && config.clientType.trim().length > 0) {
    return config.clientType.trim();
  }
  return config.env === "sandbox" ? SANDBOX_CLIENT_TYPE : null;
}

export function resolveAccountProductCode(config: MastercardProcessingConfig): string | null {
  if (config.accountProductCode && config.accountProductCode.trim().length > 0) {
    return config.accountProductCode.trim();
  }
  return config.env === "sandbox" ? SANDBOX_ACCOUNT_PRODUCT_CODE : null;
}

export function resolveCardProductCode(config: MastercardProcessingConfig): string | null {
  if (config.cardProductCode && config.cardProductCode.trim().length > 0) {
    return config.cardProductCode.trim();
  }
  return config.env === "sandbox" ? SANDBOX_CARD_PRODUCT_CODE : null;
}

/**
 * The layer is configured when the OAuth pair exists AND every
 * onboarding value resolves (explicitly, or via a sandbox default).
 */
export function isProcessingConfigured(config: MastercardProcessingConfig): boolean {
  return Boolean(
    config.consumerKey &&
      config.signingKeyPem &&
      resolveClientType(config) &&
      resolveAccountProductCode(config) &&
      resolveCardProductCode(config),
  );
}

// ---------------------------------------------------------------------------
// Admin gate — admin OR super_admin, the platform-wide Mastercard
// surface rule (same decision as _shared/mastercard-move.ts).
// ---------------------------------------------------------------------------

export function isProcessingAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

export function hasProcessingAdmin(roles: Array<string | null | undefined>): boolean {
  return roles.some((r) => isProcessingAdminRole(r));
}

export const PROCESSING_ADMIN_REFUSAL_MESSAGE =
  "Virtual cards are coming soon — they're not available yet.";

export const PROCESSING_NOT_CONFIGURED_MESSAGE =
  "Card issuing is not configured on this platform yet. Please try again later.";

// ---------------------------------------------------------------------------
// Provider URLs (official API reference environment domains)
// ---------------------------------------------------------------------------

export function processingBaseUrl(config: MastercardProcessingConfig): string {
  return config.env === "production"
    ? "https://api.mastercard.com/global-processing/core"
    : "https://sandbox.api.mastercard.com/global-processing/core";
}

export function clientsUrl(config: MastercardProcessingConfig): string {
  return `${processingBaseUrl(config)}/clients`;
}

export function accountsUrl(config: MastercardProcessingConfig): string {
  return `${processingBaseUrl(config)}/accounts`;
}

export function cardsUrl(config: MastercardProcessingConfig): string {
  return `${processingBaseUrl(config)}/cards`;
}

export function cardContractUrl(
  config: MastercardProcessingConfig,
  cardContractId: string,
): string {
  return `${cardsUrl(config)}/${encodeURIComponent(cardContractId)}`;
}

export function cardContractStatusUrl(
  config: MastercardProcessingConfig,
  cardContractId: string,
): string {
  return `${cardContractUrl(config, cardContractId)}/status`;
}

export function contractTransactionsUrl(
  config: MastercardProcessingConfig,
  contractId: string,
): string {
  return `${processingBaseUrl(config)}/contracts/${encodeURIComponent(contractId)}/transactions`;
}

// ---------------------------------------------------------------------------
// Our-side identifiers. The CMS requires a unique clientNumber per
// client and a unique accountContractNumber per account contract.
// Both are derived deterministically from platform ids so a retry
// names the SAME CMS objects instead of minting duplicates — the
// CMS answers a re-used clientNumber with DUPLICATED_CLIENT_NUMBER,
// which the callers treat as "already created", never as success
// to be re-claimed.
// ---------------------------------------------------------------------------

/** One CMS client per platform user: "BMG-<uuid hex, 32>". */
export function deriveClientNumber(userId: string): string {
  const compact = String(userId ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `BMG-${compact.slice(0, 32)}`;
}

/** One CMS account contract per issued card: "BMG-A-<seed hex, 24>". */
export function deriveAccountContractNumber(seed: string): string {
  const compact = String(seed ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `BMG-A-${compact.slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Request bodies (official sandbox test-case shapes)
// ---------------------------------------------------------------------------

export interface CreateClientInput {
  clientNumber: string;
  clientType: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phoneNumberMobile?: string | null;
}

export function buildCreateClientBody(input: CreateClientInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    clientNumber: input.clientNumber,
    clientType: input.clientType,
    clientPersonalData: {
      firstName: input.firstName,
      lastName: input.lastName,
    },
    // The order-a-virtual-card use case is explicit: if embossedData
    // is not sent at client creation it MUST be sent at card
    // creation or the card request is rejected. We send it here
    // (and again on the card), upper-cased as embossing expects.
    embossedData: {
      firstName: input.firstName.toUpperCase(),
      lastName: input.lastName.toUpperCase(),
    },
  };
  const contact: Record<string, unknown> = {};
  if (input.email) contact.email = input.email;
  if (input.phoneNumberMobile) contact.phoneNumberMobile = input.phoneNumberMobile;
  if (Object.keys(contact).length > 0) body.clientContactData = contact;
  return body;
}

export interface CreateAccountInput {
  accountContractNumber: string;
  clientId: string;
  productCode: string;
  currency: string;
}

export function buildCreateAccountBody(input: CreateAccountInput): Record<string, unknown> {
  return {
    accountContractData: {
      accountContractNumber: input.accountContractNumber,
      // The CMS ids are numeric in the reference (clientId 40000 in
      // the test cases). Send a number when the id is numeric, the
      // string otherwise — never a NaN.
      clientId: numericId(input.clientId),
      productCode: input.productCode,
      currency: input.currency.toUpperCase(),
    },
  };
}

export interface CreateCardInput {
  accountContractId: string;
  clientId: string;
  productCode: string;
  currency: string;
  firstName: string;
  lastName: string;
}

export function buildCreateCardBody(input: CreateCardInput): Record<string, unknown> {
  return {
    accountContractId: numericId(input.accountContractId),
    clientId: numericId(input.clientId),
    cardContract: {
      productCode: input.productCode,
      currency: input.currency.toUpperCase(),
      embossedData: {
        firstName: input.firstName.toUpperCase(),
        lastName: input.lastName.toUpperCase(),
      },
    },
  };
}

/** CMS ids are integers in the reference; keep them numeric in bodies. */
export function numericId(id: string): string | number {
  const trimmed = String(id ?? "").trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

// ---------------------------------------------------------------------------
// Response extraction. Creation responses are { clientId } /
// { accountContractId } / { cardContractId } (numbers in the test
// cases); ids are normalised to strings for storage in the
// provider-reference columns. The Location header (/clients/40000)
// is the documented fallback when a body is empty.
// ---------------------------------------------------------------------------

function idFromPayload(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!payload) return null;
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

export function clientIdFrom(payload: Record<string, unknown> | null): string | null {
  return idFromPayload(payload, "clientId");
}

export function accountContractIdFrom(
  payload: Record<string, unknown> | null,
): string | null {
  return idFromPayload(payload, "accountContractId");
}

export function cardContractIdFrom(
  payload: Record<string, unknown> | null,
): string | null {
  return idFromPayload(payload, "cardContractId");
}

/** "/clients/40000" → "40000" for the matching resource. */
export function idFromLocationHeader(
  location: string | null,
  resource: "clients" | "accounts" | "cards",
): string | null {
  if (!location) return null;
  const match = location.match(new RegExp(`/${resource}/([^/?#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The card contract object, flat or nested under `cardContract`. */
export function cardContractFrom(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload) return null;
  const nested = asRecord(payload.cardContract);
  if (nested) return nested;
  // A getCardContract response IS the contract object itself.
  if (
    "cardContractId" in payload ||
    "cardContractNumber" in payload ||
    "cardExpiryDate" in payload ||
    "cardContractStatusData" in payload
  ) {
    return payload;
  }
  return null;
}

/**
 * The card number from a card-contract payload, when the CMS returns
 * one (ISO-0 issuers). May be the full PAN — callers must treat the
 * return value as a secret: mask it for storage, reveal at most
 * once, never log it.
 */
export function cardNumberFrom(payload: Record<string, unknown> | null): string | null {
  const contract = cardContractFrom(payload);
  if (!contract) return null;
  const value = contract.cardContractNumber;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** Raw CMS expiry ("YYMM", e.g. "3004") from a card-contract payload. */
export function cardExpiryFrom(payload: Record<string, unknown> | null): string | null {
  const contract = cardContractFrom(payload);
  if (!contract) return null;
  const value = contract.cardExpiryDate;
  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) return value.trim();
  return null;
}

/** "3004" (YYMM) → ISO date of the last day of that month ("2030-04-30"). */
export function expiryDateFromYymm(yymm: string | null): string | null {
  if (!yymm || !/^\d{4}$/.test(yymm)) return null;
  const year = 2000 + Number(yymm.slice(0, 2));
  const month = Number(yymm.slice(2, 4));
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/** "3004" (YYMM) → display form "04/30". */
export function expiryDisplayFromYymm(yymm: string | null): string | null {
  if (!yymm || !/^\d{4}$/.test(yymm)) return null;
  return `${yymm.slice(2, 4)}/${yymm.slice(0, 2)}`;
}

/**
 * Map a CMS card-contract status onto the platform vocabulary
 * ('active' | 'frozen' | 'cancelled'). Accepts the raw payload (the
 * status lives in cardContractStatusData / baseCardContractStatusData
 * / status depending on the operation) or a bare status string.
 * Unknown values map to "unknown" — never guessed into a state.
 */
export function normaliseCardStatus(raw: unknown): string {
  let value: unknown = raw;
  const payload = asRecord(raw);
  if (payload) {
    const contract = cardContractFrom(payload) ?? payload;
    const statusData =
      asRecord(contract.cardContractStatusData) ??
      asRecord(contract.baseCardContractStatusData) ??
      asRecord(payload.cardContractStatusData);
    value =
      statusData?.status ??
      statusData?.code ??
      contract.status ??
      payload.status ??
      null;
  }
  if (typeof value !== "string") return "unknown";
  const s = value.trim().toUpperCase();
  if (["ACTIVE", "ISSUED", "OPEN", "NORMAL", "00"].includes(s)) return "active";
  if (
    ["BLOCKED", "SUSPENDED", "LOCKED", "FROZEN", "TEMPORARY_BLOCKED", "LOST", "STOLEN"].includes(s)
  ) {
    return "frozen";
  }
  if (["CLOSED", "CANCELLED", "CANCELED", "TERMINATED", "EXPIRED"].includes(s)) {
    return "cancelled";
  }
  return "unknown";
}

export interface ProcessingTransaction {
  id: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
  status: string | null;
}

/**
 * Normalise a CMS transactions payload into a flat list. The
 * reference returns the list under `transactions` (paged shapes use
 * `items`); individual entries carry their amount under `amount` or
 * `transactionAmount`. Unknown fields stay null — nothing invented.
 */
export function normaliseTransactions(
  payload: Record<string, unknown> | null,
): ProcessingTransaction[] {
  if (!payload) return [];
  const list = Array.isArray(payload)
    ? (payload as unknown[])
    : Array.isArray(payload.transactions)
      ? payload.transactions
      : Array.isArray(payload.items)
        ? payload.items
        : [];
  return list.map((entry) => {
    const rec = asRecord(entry) ?? {};
    const amountRaw = rec.amount ?? rec.transactionAmount;
    const amount =
      typeof amountRaw === "number"
        ? amountRaw
        : typeof amountRaw === "string" && amountRaw.trim() !== ""
          ? Number(amountRaw)
          : null;
    return {
      id:
        typeof rec.transactionId === "string" || typeof rec.transactionId === "number"
          ? String(rec.transactionId)
          : typeof rec.id === "string" || typeof rec.id === "number"
            ? String(rec.id)
            : null,
      date:
        typeof rec.transactionDate === "string"
          ? rec.transactionDate
          : typeof rec.date === "string"
            ? rec.date
            : typeof rec.postingDate === "string"
              ? rec.postingDate
              : null,
      amount: Number.isFinite(amount as number) ? (amount as number) : null,
      currency: typeof rec.currency === "string" ? rec.currency : null,
      description:
        typeof rec.description === "string"
          ? rec.description
          : typeof rec.merchantName === "string"
            ? rec.merchantName
            : null,
      status: typeof rec.status === "string" ? rec.status : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Provider errors. The CMS failure envelope is
//   { Errors: { Error: [{ Source, ReasonCode, Description,
//                          Recoverable }] } }
// ReasonCode is machine-stable and safe to hand to an admin; the
// Description is provider prose and is NEVER surfaced to users
// (crafted copy only — CEO error-presentation rule).
// ---------------------------------------------------------------------------

export function providerReasonCode(
  payload: Record<string, unknown> | null,
): string | null {
  const errors = asRecord(payload?.Errors);
  const list = errors && Array.isArray(errors.Error) ? errors.Error : [];
  const first = list.length > 0 ? asRecord(list[0]) : null;
  return first && typeof first.ReasonCode === "string" ? first.ReasonCode : null;
}

/**
 * The refusal class of a provider failure, for truthful surfacing:
 *   "credentials_refused" — 401: the OAuth pair was rejected.
 *   "not_provisioned"     — 403: authenticated, but this platform
 *                           has no Processing access provisioned
 *                           (the expected sandbox answer until the
 *                           implementation project provisions it).
 *   "duplicate"           — the CMS object already exists.
 *   "not_found"           — 404.
 *   "validation"          — 400/422 request data refused.
 *   "provider_error"      — everything else.
 */
export function classifyProviderRefusal(
  httpStatus: number,
  payload: Record<string, unknown> | null,
): string {
  const reason = providerReasonCode(payload);
  if (reason && reason.startsWith("DUPLICATED")) return "duplicate";
  if (httpStatus === 401) return "credentials_refused";
  if (httpStatus === 403) return "not_provisioned";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 400 || httpStatus === 422) return "validation";
  return "provider_error";
}

/** Crafted, plain-language message for a provider failure. */
export function craftedProcessingError(
  httpStatus: number,
  payload: Record<string, unknown> | null,
): string {
  switch (classifyProviderRefusal(httpStatus, payload)) {
    case "credentials_refused":
      return "Mastercard refused our platform credentials for card issuing. No card was created — please let an administrator know.";
    case "not_provisioned":
      return "Card issuing is not provisioned for this platform yet. No card was created — the Mastercard Processing onboarding has to be completed first.";
    case "duplicate":
      return "Mastercard already has a matching record for this cardholder. No new card was created — an administrator needs to link the existing record first.";
    case "not_found":
      return "Mastercard could not find that card record. It may not have been created — check the card details and try again.";
    case "validation":
      return "Mastercard could not accept those card details. Check the cardholder name and details, then try again.";
    default:
      return httpStatus >= 500
        ? "Mastercard is having trouble right now. No card was created — please try again in a little while."
        : "The card request could not be completed. No card was created — please try again.";
  }
}

// ---------------------------------------------------------------------------
// PAN / secret hygiene for logs. `maskPan` matches the
// mask_card_number RPC's output shape exactly. `redactSensitive`
// deep-copies a payload with every PAN-shaped string and every
// secret-named field scrubbed — the only form of a provider payload
// that may be logged or stored.
// ---------------------------------------------------------------------------

/** "5399 1111 2222 3456" → "**** **** **** 3456" (mask_card_number shape). */
export function maskPan(pan: string | null | undefined): string | null {
  if (!pan) return null;
  const digits = String(pan).replace(/\s+/g, "");
  if (digits.length < 4) return null;
  return `**** **** **** ${digits.slice(-4)}`;
}

/** Replace every 12–19 digit run in a string with its masked form. */
export function redactPanInText(text: string): string {
  return String(text).replace(/\d[\d -]{10,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 19) return match;
    return `****${digits.slice(-4)}`;
  });
}

const SECRET_FIELD = /pan|cardcontractnumber|card_number|cvv|cvc|pin|encryptedcardcontractnumber/i;

/** Deep-copy a payload with secrets scrubbed — safe to log/store. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v));
  const rec = asRecord(value);
  if (rec) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(rec)) {
      if (SECRET_FIELD.test(key)) {
        // Only a full-length PAN may survive in masked form; a
        // short secret (CVV, PIN) masked "**** + itself" would
        // reveal it entirely, so those are dropped outright.
        const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
        out[key] = digits.length >= 12 ? maskPan(v as string) : "[redacted]";
      } else {
        out[key] = redactSensitive(v);
      }
    }
    return out;
  }
  if (typeof value === "string") return redactPanInText(value);
  return value;
}
