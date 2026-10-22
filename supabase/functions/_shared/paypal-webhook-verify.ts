// PayPal webhook signature verification via PayPal's own API.
//
// The webhook listener must prove an event really came from PayPal
// before it may trigger any settlement. PayPal signs webhooks with
// RSA-SHA256 over the transmission headers and the raw body, against
// a certificate PayPal hosts — there is no shared "webhook secret"
// to HMAC with, and Deno's Web Crypto has no createHash, so the
// previous in-function attempt (an HMAC keyed by PAYPAL_WEBHOOK_SECRET
// over a SHA-256 hex digest) could never have validated a genuine
// PayPal webhook: every event failed verification and was rejected.
//
// The supported route — and the one this module implements — is
// PayPal's verification API:
//
//   POST {paypal base}/v1/notifications/verify-webhook-signature
//   Authorization: Bearer <client-credentials access token>
//   { auth_algo, cert_url, transmission_id, transmission_sig,
//     transmission_time, webhook_id, webhook_event }
//
// PayPal answers { "verification_status": "SUCCESS" | "FAILURE" }.
// Only an HTTP 200 with verification_status exactly "SUCCESS" counts
// as verified. Everything else — missing headers, no webhook id, no
// access token, a network error, a non-200 response, a malformed
// payload — is NOT verified: verification fails closed, the caller
// answers 401, and no state changes.
//
// This module is deliberately free of imports and Deno APIs so the
// vitest suite exercises the exact code the edge function runs (same
// pattern as _shared/payment-providers.ts and
// _shared/deposit-capture.ts). The caller injects `fetch` and the
// already-resolved PayPal coordinates (base URL, access token,
// webhook id) so request shaping and the fail-closed decision are
// fully testable offline.

/** The five PAYPAL-* headers PayPal sends with every webhook event. */
export interface PayPalWebhookSignatureHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/**
 * Pull the five signature headers off an incoming webhook request.
 * `readHeader` is the request's header getter (case-insensitive, like
 * Headers.get). Returns null when any header is missing or blank —
 * an event without a complete signature envelope is unverifiable.
 */
export function extractPayPalWebhookSignatureHeaders(
  readHeader: (name: string) => string | null,
): PayPalWebhookSignatureHeaders | null {
  const read = (name: string): string | null => {
    const value = readHeader(name);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const authAlgo = read("PAYPAL-AUTH-ALGO");
  const certUrl = read("PAYPAL-CERT-URL");
  const transmissionId = read("PAYPAL-TRANSMISSION-ID");
  const transmissionSig = read("PAYPAL-TRANSMISSION-SIG");
  const transmissionTime = read("PAYPAL-TRANSMISSION-TIME");

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return null;
  }
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/**
 * Shape the JSON body for POST /v1/notifications/verify-webhook-signature.
 * `webhookEvent` is the parsed webhook payload object, passed through
 * unchanged — PayPal re-canonicalises it server-side. Returns null
 * when there is nothing verifiable to send (no webhook id, or the
 * event is not an object).
 */
export function buildVerifyWebhookSignatureBody(
  headers: PayPalWebhookSignatureHeaders,
  webhookId: string,
  webhookEvent: unknown,
): Record<string, unknown> | null {
  if (typeof webhookId !== "string" || webhookId.trim().length === 0) return null;
  if (webhookEvent === null || typeof webhookEvent !== "object" || Array.isArray(webhookEvent)) {
    return null;
  }
  return {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: webhookId,
    webhook_event: webhookEvent,
  };
}

/**
 * Interpret a verify-webhook-signature response. Verified means
 * exactly: HTTP 200 and a JSON payload whose verification_status is
 * the string "SUCCESS". Anything else is not verified.
 */
export function isPayPalVerificationSuccess(httpStatus: number, payload: unknown): boolean {
  if (httpStatus !== 200) return false;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>).verification_status === "SUCCESS";
}

/** The minimal fetch surface the verifier needs (the real `fetch` fits). */
export type VerifyFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface VerifyPayPalWebhookSignatureInput {
  headers: PayPalWebhookSignatureHeaders | null;
  webhookId: string | null;
  webhookEvent: unknown;
  accessToken: string | null;
  baseUrl: string;
}

/**
 * Ask PayPal whether this webhook event's signature is genuine.
 * Fails closed at every step: unverifiable input returns false
 * WITHOUT calling PayPal, and any transport or response anomaly also
 * returns false.
 */
export async function verifyPayPalWebhookSignature(
  input: VerifyPayPalWebhookSignatureInput,
  fetchImpl: VerifyFetch,
): Promise<boolean> {
  if (!input.headers || !input.accessToken) return false;

  const body = buildVerifyWebhookSignatureBody(input.headers, input.webhookId ?? "", input.webhookEvent);
  if (!body) return false;

  try {
    const response = await fetchImpl(`${input.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return isPayPalVerificationSuccess(response.status, payload);
  } catch {
    return false;
  }
}
