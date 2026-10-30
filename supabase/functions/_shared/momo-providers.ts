/**
 * Provider adapter layer for Zambian mobile money rails.
 *
 * MTN reference: https://momodeveloper.mtn.com/api-documentation
 *
 * Documented MTN behaviour this layer is built around:
 *  - /requesttopay (collection) and /transfer (disbursement) are ASYNCHRONOUS.
 *    They return 202 Accepted; the final result arrives later.
 *  - Callbacks are NOT cryptographically signed. Authenticity comes from
 *    registering `providerCallbackHost` and, critically, from re-fetching the
 *    authoritative status server-to-server. We therefore treat an MTN callback
 *    as a TRIGGER ONLY and never trust its body.
 *  - "The Wallet Platform sends the callback only once. There is no retry
 *    mechanism." So status polling is mandatory, not optional -> getStatus()
 *    plus the momo-reconcile cron function.
 *  - Sandbox transacts in EUR regardless of the local production currency.
 *
 * Airtel and Zamtel do sign their callbacks, so those adapters verify an
 * HMAC-SHA256 signature instead of re-fetching.
 *
 * When a provider's credentials are absent the adapter runs in SANDBOX mode:
 * it returns a `pending` intent and NEVER returns `completed`. Only a verified
 * callback or a verified status poll can settle money, exactly like live.
 */

export type ProviderId = 'mtn' | 'airtel' | 'zamtel';
export type Flow = 'collect' | 'disburse';

/** How an inbound callback from this provider is authenticated. */
export type CallbackTrust =
  /** Provider signs the payload; verify the HMAC and trust the body. */
  | 'signature'
  /** Provider does not sign; ignore the body and re-fetch authoritative status. */
  | 'refetch';

export interface ProviderRequest {
  amount: number;
  currency: string;
  phone: string;
  reference: string;
  narration?: string;
  callbackUrl: string;
}

export interface ProviderResult {
  /** Provider-side identifier we later match callbacks and polls against. */
  providerReference: string;
  status: 'pending' | 'failed';
  sandbox: boolean;
  failureReason?: string;
}

export type SettlementStatus = 'pending' | 'completed' | 'failed' | 'unknown';

export interface StatusResult {
  status: SettlementStatus;
  reason?: string;
  raw?: unknown;
}

export interface ProviderAdapter {
  id: ProviderId;
  callbackTrust: CallbackTrust;
  isConfigured(): boolean;
  collect(req: ProviderRequest): Promise<ProviderResult>;
  disburse(req: ProviderRequest): Promise<ProviderResult>;
  /** Authoritative server-to-server status lookup. */
  getStatus(flow: Flow, providerReference: string): Promise<StatusResult>;
  /** Verify a signed callback. Returns null when valid, else a reason. */
  verifyCallback(rawBody: string, headers: Headers): Promise<string | null>;
}

const env = (k: string) => Deno.env.get(k) ?? '';

function sandboxResult(prefix: string, reference: string): ProviderResult {
  return { providerReference: `${prefix}-SBX-${reference}`, status: 'pending', sandbox: true };
}

const isSandboxReference = (ref: string) => /-SBX-/.test(ref);

/** Shared HMAC-SHA256 callback verification (Airtel / Zamtel). */
async function hmacVerify(
  rawBody: string,
  headers: Headers,
  headerNames: string[],
): Promise<string | null> {
  const secret = env('MOMO_CALLBACK_SECRET');
  if (!secret) return 'callback_secret_not_configured';

  let provided = '';
  for (const name of headerNames) {
    provided = headers.get(name) || provided;
  }
  if (!provided) return 'missing_signature_header';

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const a = new TextEncoder().encode(expected.toLowerCase());
  const b = new TextEncoder().encode(provided.replace(/^sha256=/i, '').toLowerCase());
  if (a.length !== b.length) return 'signature_mismatch';
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? null : 'signature_mismatch';
}

/** Map a provider status string onto our settlement states. */
function normaliseStatus(raw: string): SettlementStatus {
  const s = raw.toUpperCase();
  if (['SUCCESSFUL', 'SUCCESS', 'COMPLETED', 'TS'].includes(s)) return 'completed';
  if (['FAILED', 'FAILURE', 'REJECTED', 'EXPIRED', 'TIMEOUT', 'TF'].includes(s)) return 'failed';
  if (['PENDING', 'ONGOING', 'IN_PROGRESS', 'TIP', 'TIN', 'TA'].includes(s)) return 'pending';
  return 'unknown';
}

// ============================================================== MTN MoMo
//
// Products: `collection` (Get Paid / requesttopay) and `disbursement`
// (Pay / transfer). Both share the same token + header conventions.

export const MTN_SANDBOX_HOST = 'https://sandbox.momodeveloper.mtn.com';
export const MTN_PRODUCTION_HOST = 'https://proxy.momoapi.mtn.com';

const mtnTargetEnvironment = () => env('MTN_MOMO_ENV') || 'sandbox';
const mtnIsSandboxEnv = () => mtnTargetEnvironment() === 'sandbox';
const mtnHost = () =>
  env('MTN_MOMO_BASE_URL') || (mtnIsSandboxEnv() ? MTN_SANDBOX_HOST : MTN_PRODUCTION_HOST);

/**
 * The sandbox wallet only holds EUR, so a ZMW request would be rejected there.
 * Production Zambia uses ZMW.
 */
const mtnCurrency = (currency: string) => (mtnIsSandboxEnv() ? 'EUR' : currency);

const mtnProduct = (flow: Flow) => (flow === 'collect' ? 'collection' : 'disbursement');
const mtnOperation = (flow: Flow) => (flow === 'collect' ? 'requesttopay' : 'transfer');

/** OAuth token for a given MTN product. Tokens are valid for ~1 hour. */
async function mtnToken(product: 'collection' | 'disbursement'): Promise<string | null> {
  const basic = btoa(`${env('MTN_MOMO_API_USER')}:${env('MTN_MOMO_API_KEY')}`);
  const res = await fetch(`${mtnHost()}/${product}/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY'),
    },
  });
  if (!res.ok) {
    console.error('MTN token failed', res.status, await res.text());
    return null;
  }
  const body = await res.json();
  return body?.access_token ?? null;
}

async function mtnRequest(flow: Flow, req: ProviderRequest): Promise<ProviderResult> {
  const product = mtnProduct(flow);
  const token = await mtnToken(product);
  if (!token) {
    return {
      providerReference: req.reference,
      status: 'failed',
      sandbox: false,
      failureReason: 'provider_auth_failed',
    };
  }

  // X-Reference-Id IS the transaction identifier we poll and match on later.
  const referenceId = crypto.randomUUID();
  const party = { partyIdType: 'MSISDN', partyId: req.phone.replace(/\D/g, '') };
  const message = req.narration || 'BMaGlass Pay';

  const body =
    flow === 'collect'
      ? {
          amount: String(req.amount),
          currency: mtnCurrency(req.currency),
          externalId: req.reference,
          payer: party,
          payerMessage: message,
          payeeNote: message,
        }
      : {
          amount: String(req.amount),
          currency: mtnCurrency(req.currency),
          externalId: req.reference,
          payee: party,
          payerMessage: message,
          payeeNote: message,
        };

  const res = await fetch(`${mtnHost()}/${product}/v1_0/${mtnOperation(flow)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': mtnTargetEnvironment(),
      // Must be hosted on the domain registered as providerCallbackHost.
      'X-Callback-Url': req.callbackUrl,
      'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // Documented success for these async operations is exactly 202 Accepted.
  if (res.status !== 202) {
    console.error('MTN request failed', flow, res.status, await res.text());
    return {
      providerReference: referenceId,
      status: 'failed',
      sandbox: false,
      failureReason: 'provider_rejected',
    };
  }
  return { providerReference: referenceId, status: 'pending', sandbox: false };
}

async function mtnStatus(flow: Flow, providerReference: string): Promise<StatusResult> {
  if (isSandboxReference(providerReference)) return { status: 'pending' };

  const product = mtnProduct(flow);
  const token = await mtnToken(product);
  if (!token) return { status: 'unknown', reason: 'provider_auth_failed' };

  const res = await fetch(
    `${mtnHost()}/${product}/v1_0/${mtnOperation(flow)}/${providerReference}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': mtnTargetEnvironment(),
        'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY'),
      },
    },
  );

  if (!res.ok) {
    console.error('MTN status lookup failed', res.status, await res.text());
    return { status: 'unknown', reason: `status_lookup_${res.status}` };
  }

  const payload = await res.json();
  return {
    status: normaliseStatus(String(payload?.status ?? '')),
    reason: payload?.reason ? String(payload.reason) : undefined,
    raw: payload,
  };
}

const mtn: ProviderAdapter = {
  id: 'mtn',
  // MTN does not sign callbacks, so authenticity comes from re-fetching.
  callbackTrust: 'refetch',
  isConfigured: () =>
    !!env('MTN_MOMO_SUBSCRIPTION_KEY') && !!env('MTN_MOMO_API_USER') && !!env('MTN_MOMO_API_KEY'),
  collect: (req) =>
    mtn.isConfigured() ? mtnRequest('collect', req) : Promise.resolve(sandboxResult('MTN', req.reference)),
  disburse: (req) =>
    mtn.isConfigured() ? mtnRequest('disburse', req) : Promise.resolve(sandboxResult('MTN', req.reference)),
  getStatus: (flow, ref) =>
    mtn.isConfigured() ? mtnStatus(flow, ref) : Promise.resolve({ status: 'pending' }),
  // Never called for MTN (callbackTrust is 'refetch'); fails closed if it is.
  verifyCallback: () => Promise.resolve('mtn_callbacks_are_not_signed'),
};

/**
 * Sandbox-only self-service provisioning, per the "API User & API Key
 * Management" docs. Creates an API user bound to your callback host and
 * generates its API key. Production credentials are issued through the MTN
 * Account Portal after KYC and cannot be created this way.
 */
export async function mtnProvisionSandboxUser(providerCallbackHost: string) {
  const subscriptionKey = env('MTN_MOMO_SUBSCRIPTION_KEY');
  if (!subscriptionKey) return { error: 'MTN_MOMO_SUBSCRIPTION_KEY is not configured' };

  const apiUser = crypto.randomUUID();
  const headers = {
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    'Content-Type': 'application/json',
  };

  // 1. Create the API user. X-Reference-Id becomes the API user id.
  const createRes = await fetch(`${MTN_SANDBOX_HOST}/v1_0/apiuser`, {
    method: 'POST',
    headers: { ...headers, 'X-Reference-Id': apiUser },
    body: JSON.stringify({ providerCallbackHost }),
  });
  if (createRes.status !== 201) {
    console.error('MTN apiuser create failed', createRes.status, await createRes.text());
    return { error: `Could not create API user (status ${createRes.status})` };
  }

  // 2. Generate its API key. This value is shown once and cannot be re-read.
  const keyRes = await fetch(`${MTN_SANDBOX_HOST}/v1_0/apiuser/${apiUser}/apikey`, {
    method: 'POST',
    headers,
  });
  if (keyRes.status !== 201) {
    console.error('MTN apikey create failed', keyRes.status, await keyRes.text());
    return { error: `Could not create API key (status ${keyRes.status})` };
  }
  const { apiKey } = await keyRes.json();

  return { apiUser, apiKey, providerCallbackHost, targetEnvironment: 'sandbox' };
}

// =========================================================== Airtel Money
//
// Docs: https://developers.airtel.africa
//  - Auth: POST /auth/oauth2/token (OAuth2 client_credentials, JSON body).
//  - Collections: POST /merchant/v2/payments/ -> USSD push to the payer.
//    Result is ASYNCHRONOUS; the POST only acknowledges the request.
//  - Collection status: GET /standard/v1/payments/{transaction_id}
//  - Disbursements: POST /standard/v2/disbursements/ with an RSA-encrypted PIN.
//  - Disbursement status: GET /standard/v1/disbursements/{transaction_id}
//  - Status codes: TS = success, TF = failed, TIP/TA = in progress.
//  - Payload encryption (required on production for v2 endpoints):
//    a random AES-256 key + IV encrypts the JSON body (AES-256-CBC, base64) into
//    `x-signature`; `key:iv` is RSA (PKCS#1 v1.5) encrypted with Airtel's public
//    key into `x-key`. Enabled by setting AIRTEL_ENCRYPTION_PUBLIC_KEY.

import { publicEncrypt, constants as cryptoConstants } from 'node:crypto';

const airtelBase = () => env('AIRTEL_BASE_URL') || 'https://openapiuat.airtel.africa';
const airtelCountry = () => env('AIRTEL_COUNTRY') || 'ZM';
const airtelCurrency = (currency?: string) => currency || env('AIRTEL_CURRENCY') || 'ZMW';

/** Normalise the Airtel public key into PEM form. */
function airtelPublicKeyPem(): string | null {
  const raw = env('AIRTEL_ENCRYPTION_PUBLIC_KEY').trim();
  if (!raw) return null;
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  const body = raw.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? raw;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** RSA/ECB/PKCS1Padding encrypt, as Airtel's documentation specifies. */
function airtelRsaEncrypt(plain: string): string | null {
  const pem = airtelPublicKeyPem();
  if (!pem) return null;
  try {
    return publicEncrypt(
      { key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING },
      new TextEncoder().encode(plain),
    ).toString('base64');
  } catch (e) {
    console.error('Airtel RSA encryption failed', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Build the `x-signature` / `x-key` pair for an Airtel request body.
 * Returns an empty object when encryption is not configured (UAT default).
 */
async function airtelEncryptionHeaders(payload: string): Promise<Record<string, string>> {
  if (!airtelPublicKeyPem()) return {};

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, [
    'encrypt',
  ]);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      aesKey,
      new TextEncoder().encode(payload),
    ),
  );
  const wrapped = airtelRsaEncrypt(`${b64(keyBytes)}:${b64(iv)}`);
  if (!wrapped) return {};
  return { 'x-signature': b64(cipher), 'x-key': wrapped };
}

async function airtelToken(): Promise<string | null> {
  const base = airtelBase();
  const res = await fetch(`${base}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: env('AIRTEL_CLIENT_ID'),
      client_secret: env('AIRTEL_CLIENT_SECRET'),
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    console.error('Airtel token failed', res.status, await res.text());
    return null;
  }
  return (await res.json())?.access_token ?? null;
}

async function airtelRequest(flow: Flow, req: ProviderRequest): Promise<ProviderResult> {
  const base = airtelBase();
  const country = airtelCountry();
  const currency = airtelCurrency(req.currency);
  const token = await airtelToken();
  if (!token) {
    return {
      providerReference: req.reference,
      status: 'failed',
      sandbox: false,
      failureReason: 'provider_auth_failed',
    };
  }

  // Airtel expects the national subscriber number, without country code.
  const msisdn = req.phone.replace(/\D/g, '').slice(-9);
  const narration = (req.narration || 'BMaGlass Pay').slice(0, 30);

  let path: string;
  let payload: Record<string, unknown>;

  if (flow === 'collect') {
    path = '/merchant/v2/payments/';
    payload = {
      reference: narration,
      subscriber: { country, currency, msisdn },
      transaction: { amount: req.amount, country, currency, id: req.reference },
    };
  } else {
    // Disbursement requires the merchant PIN, RSA-encrypted with Airtel's key.
    const pin = env('AIRTEL_DISBURSEMENT_PIN');
    const encryptedPin = pin ? airtelRsaEncrypt(pin) : null;
    if (pin && !encryptedPin) {
      return {
        providerReference: req.reference,
        status: 'failed',
        sandbox: false,
        failureReason: 'pin_encryption_unavailable',
      };
    }
    path = '/standard/v2/disbursements/';
    payload = {
      payee: { currency, msisdn },
      reference: narration,
      ...(encryptedPin ? { pin: encryptedPin } : {}),
      transaction: { amount: req.amount, id: req.reference, type: 'B2C' },
    };
  }

  const body = JSON.stringify(payload);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Country': country,
      'X-Currency': currency,
      'Content-Type': 'application/json',
      Accept: '*/*',
      ...(await airtelEncryptionHeaders(body)),
    },
    body,
  });

  const raw = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // non-JSON error body
  }

  // Airtel can return HTTP 200 with success=false, so check both.
  if (!res.ok || parsed?.status?.success === false) {
    console.error('Airtel request failed', flow, res.status, raw);
    return {
      providerReference: req.reference,
      status: 'failed',
      sandbox: false,
      failureReason: parsed?.status?.code ? `provider_rejected_${parsed.status.code}` : 'provider_rejected',
    };
  }

  // Airtel echoes our transaction.id back; keep ours when absent so polling works.
  const providerReference = parsed?.data?.transaction?.id || req.reference;
  return { providerReference, status: 'pending', sandbox: false };
}

async function airtelStatus(flow: Flow, providerReference: string): Promise<StatusResult> {
  if (isSandboxReference(providerReference)) return { status: 'pending' };

  const base = airtelBase();
  const country = airtelCountry();
  const token = await airtelToken();
  if (!token) return { status: 'unknown', reason: 'provider_auth_failed' };

  const path =
    flow === 'collect'
      ? `/standard/v1/payments/${providerReference}`
      : `/standard/v1/disbursements/${providerReference}`;
  const res = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Country': country,
      'X-Currency': airtelCurrency(),
      Accept: '*/*',
    },
  });
  if (!res.ok) {
    console.error('Airtel status lookup failed', res.status, await res.text());
    return { status: 'unknown', reason: `status_lookup_${res.status}` };
  }
  const payload = await res.json();
  const t = payload?.data?.transaction ?? {};
  const raw = t.status ?? payload?.status?.code ?? '';
  return {
    status: normaliseStatus(String(raw)),
    reason: payload?.status?.message ? String(payload.status.message) : undefined,
    raw: payload,
  };
}

const airtel: ProviderAdapter = {
  id: 'airtel',
  // Airtel's callback body is not signed for Zambia collections, so the callback
  // is only a trigger: we always re-fetch authoritative status server-to-server.
  callbackTrust: 'refetch',
  isConfigured: () => !!env('AIRTEL_CLIENT_ID') && !!env('AIRTEL_CLIENT_SECRET'),
  collect: (req) =>
    airtel.isConfigured() ? airtelRequest('collect', req) : Promise.resolve(sandboxResult('AIRTEL', req.reference)),
  disburse: (req) =>
    airtel.isConfigured() ? airtelRequest('disburse', req) : Promise.resolve(sandboxResult('AIRTEL', req.reference)),
  getStatus: (flow, ref) =>
    airtel.isConfigured() ? airtelStatus(flow, ref) : Promise.resolve({ status: 'pending' }),
  verifyCallback: (rawBody, headers) =>
    hmacVerify(rawBody, headers, ['x-auth-signature', 'x-signature']),
};

// ========================================================== Zamtel Kwacha

const zamtelHeaders = () => ({
  'X-API-Key': env('ZAMTEL_API_KEY'),
  'X-API-Secret': env('ZAMTEL_API_SECRET'),
  'Content-Type': 'application/json',
});

async function zamtelRequest(flow: Flow, req: ProviderRequest): Promise<ProviderResult> {
  const base = env('ZAMTEL_BASE_URL') || 'https://api.zamtel.co.zm/money/v1';
  const res = await fetch(`${base}/${flow}`, {
    method: 'POST',
    headers: zamtelHeaders(),
    body: JSON.stringify({
      msisdn: req.phone.replace(/\D/g, ''),
      amount: req.amount,
      currency: req.currency,
      externalReference: req.reference,
      narration: req.narration || 'BMaGlass Pay',
      callbackUrl: req.callbackUrl,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error('Zamtel request failed', flow, res.status, raw);
    return {
      providerReference: req.reference,
      status: 'failed',
      sandbox: false,
      failureReason: 'provider_rejected',
    };
  }
  let providerReference = req.reference;
  try {
    providerReference = JSON.parse(raw)?.transactionId || providerReference;
  } catch {
    // fall back to our own reference
  }
  return { providerReference, status: 'pending', sandbox: false };
}

async function zamtelStatus(_flow: Flow, providerReference: string): Promise<StatusResult> {
  if (isSandboxReference(providerReference)) return { status: 'pending' };

  const base = env('ZAMTEL_BASE_URL') || 'https://api.zamtel.co.zm/money/v1';
  const res = await fetch(`${base}/transaction/${providerReference}`, { headers: zamtelHeaders() });
  if (!res.ok) {
    console.error('Zamtel status lookup failed', res.status, await res.text());
    return { status: 'unknown', reason: `status_lookup_${res.status}` };
  }
  const payload = await res.json();
  return { status: normaliseStatus(String(payload?.status ?? '')), raw: payload };
}

const zamtel: ProviderAdapter = {
  id: 'zamtel',
  callbackTrust: 'signature',
  isConfigured: () => !!env('ZAMTEL_API_KEY') && !!env('ZAMTEL_API_SECRET'),
  collect: (req) =>
    zamtel.isConfigured() ? zamtelRequest('collect', req) : Promise.resolve(sandboxResult('ZAMTEL', req.reference)),
  disburse: (req) =>
    zamtel.isConfigured() ? zamtelRequest('disburse', req) : Promise.resolve(sandboxResult('ZAMTEL', req.reference)),
  getStatus: (flow, ref) =>
    zamtel.isConfigured() ? zamtelStatus(flow, ref) : Promise.resolve({ status: 'pending' }),
  verifyCallback: (rawBody, headers) =>
    hmacVerify(rawBody, headers, ['x-zamtel-signature', 'x-signature']),
};

// ================================================================ registry

const registry: Record<ProviderId, ProviderAdapter> = { mtn, airtel, zamtel };

export function getProvider(id: string): ProviderAdapter | null {
  return registry[id as ProviderId] ?? null;
}

export function listProviderStatus() {
  return (Object.keys(registry) as ProviderId[]).map((id) => ({
    provider: id,
    mode: registry[id].isConfigured() ? 'live' : 'sandbox',
    callback_trust: registry[id].callbackTrust,
  }));
}

/** Platform fee: 1% of amount, minimum 2.00, computed server-side only. */
export function calculateFee(amount: number): number {
  const pct = Number(env('PLATFORM_FEE_PERCENT') || '1') / 100;
  const min = Number(env('PLATFORM_FEE_MINIMUM') || '2');
  return Math.round(Math.max(amount * pct, min) * 100) / 100;
}