// Mastercard OAuth 1.0a signing (RSA-SHA256 with body hash).
//
// Mastercard's portal APIs — Mastercard Send and Mastercard
// Cross-Border Services (together, Mastercard Move) — authenticate
// every request with OAuth 1.0a: an `Authorization: OAuth …` header
// whose `oauth_signature` is an RSASSA-PKCS1-v1_5 / SHA-256 signature
// over the OAuth signature base string, made with the 2048-bit RSA
// private key from the project's `.p12` keystore. The request body
// is bound into the signature through the `oauth_body_hash`
// extension (base64 SHA-256 of the raw body), as Mastercard's
// developer documentation requires.
//
// This module is deliberately free of Deno-only APIs: it uses only
// WebCrypto (`globalThis.crypto.subtle`), which exists in Deno edge
// functions AND in Node, so the vitest suite exercises the exact code
// the edge function runs (same pattern as _shared/paypal-webhook-
// verify.ts). The caller injects the PEM text (from the
// MASTERCARD_SIGNING_KEY_PEM secret — the `.p12` extracted once with
// `openssl pkcs12 -nocerts -nodes`, per the gateway brief) and, for
// deterministic tests, the nonce and timestamp.
//
// PEM expectation: PKCS#8 ("-----BEGIN PRIVATE KEY-----"), which is
// what OpenSSL 3 produces from the portal keystore. WebCrypto has no
// PKCS#1 import, so a PKCS#1 ("RSA PRIVATE KEY") PEM will fail the
// import with a crafted configuration error at call time — by
// design, so a mis-extracted secret fails loudly, never silently.

export interface MastercardOAuthParams {
  consumerKey: string;
  /** Raw request body exactly as it will be sent ("" for GET). */
  body: string;
  /** Deterministic in tests; random in production calls. */
  nonce: string;
  /** Seconds since epoch, as a string. */
  timestamp: string;
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64 SHA-256 of the raw body — the `oauth_body_hash` value. */
export async function computeBodyHash(body: string): Promise<string> {
  const data = new TextEncoder().encode(body ?? "");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * The OAuth parameter string: every oauth_* parameter (plus any
 * query parameters already on the URL), percent-encoded, sorted by
 * encoded key then encoded value, joined with "&".
 */
export function buildParameterString(
  oauthParams: Record<string, string>,
  queryParams: Record<string, string> = {},
): string {
  const merged: Record<string, string> = { ...queryParams, ...oauthParams };
  const pairs: Array<[string, string]> = Object.entries(merged).map(
    ([k, v]) => [percentEncode(k), percentEncode(v)],
  );
  pairs.sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
  );
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * OAuth 1.0a signature base string:
 *   METHOD & percentEncode(baseUrlWithoutQuery) & percentEncode(parameterString)
 */
export function buildSignatureBaseString(
  method: string,
  url: string,
  oauthParams: Record<string, string>,
): string {
  const parsed = new URL(url);
  const queryParams: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const parameterString = buildParameterString(oauthParams, queryParams);
  return [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(parameterString),
  ].join("&");
}

/** Import the PKCS#8 signing key from PEM text. Throws on bad PEM. */
export async function importSigningKey(pem: string): Promise<CryptoKey> {
  if (typeof pem !== "string" || !pem.includes("PRIVATE KEY")) {
    throw new Error("Mastercard signing key is not configured.");
  }
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  let der: Uint8Array;
  try {
    der = base64ToBytes(b64);
  } catch {
    throw new Error("Mastercard signing key is not configured.");
  }
  try {
    return await globalThis.crypto.subtle.importKey(
      "pkcs8",
      der.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new Error(
      "Mastercard signing key could not be loaded — it must be the PKCS#8 PEM extracted from the project keystore.",
    );
  }
}

/**
 * Sign one request and return the full `Authorization` header value.
 * Deterministic for fixed (key, method, url, body, nonce, timestamp)
 * input — RSASSA-PKCS1-v1_5 has no random component — which is what
 * the test vector in the vitest suite pins.
 */
export async function signMastercardRequest(
  method: string,
  url: string,
  params: MastercardOAuthParams,
  signingKeyPem: string,
): Promise<string> {
  const bodyHash = await computeBodyHash(params.body ?? "");
  const oauthParams: Record<string, string> = {
    oauth_body_hash: bodyHash,
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: params.nonce,
    oauth_signature_method: "RSA-SHA256",
    oauth_timestamp: params.timestamp,
    oauth_version: "1.0",
  };
  const baseString = buildSignatureBaseString(method, url, oauthParams);
  const key = await importSigningKey(signingKeyPem);
  const signatureBytes = await globalThis.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(baseString),
  );
  const signature = bytesToBase64(new Uint8Array(signatureBytes));

  const headerParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  };
  const headerBody = Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
    .join(", ");
  return `OAuth ${headerBody}`;
}

/** Production nonce (tests inject their own). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Current OAuth timestamp (seconds since epoch, as a string). */
export function currentTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}
