// Unit tests for supabase/functions/_shared/paypal-webhook-verify.ts —
// the code that decides whether a PayPal webhook event is genuine,
// exercised by the paypal-webhook edge function. The module is pure
// (fetch is injected), so this suite runs the exact file Deno runs.
//
// The property under test: verification succeeds ONLY when PayPal's
// own verify-webhook-signature API answers HTTP 200 with
// verification_status "SUCCESS" for a correctly shaped request —
// and it fails closed on every other input: missing headers, no
// webhook id, no access token, transport errors, non-200 responses
// and FAILURE verdicts. A webhook that is not verified must never
// settle money, so there is no path here that defaults to true.

import { describe, it, expect, vi } from "vitest";
import {
  buildVerifyWebhookSignatureBody,
  extractPayPalWebhookSignatureHeaders,
  isPayPalVerificationSuccess,
  verifyPayPalWebhookSignature,
  type PayPalWebhookSignatureHeaders,
  type VerifyFetch,
} from "../../supabase/functions/_shared/paypal-webhook-verify";

const headers: PayPalWebhookSignatureHeaders = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.paypal.com/v1/notifications/certs/CERT-360caa42b042f6f8-4a5",
  transmissionId: "6b2e0e80-b7d3-11f0-9c1a-000000000000",
  transmissionSig: "MEUCIQDexampleSIGNATURE==",
  transmissionTime: "2026-10-22T09:15:00Z",
};

const webhookEvent = {
  id: "WH-EXAMPLE123",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAPTURE123", status: "COMPLETED" },
};

function headerReader(values: Record<string, string | null>) {
  return (name: string) => values[name.toUpperCase()] ?? null;
}

const fullHeaderReader = headerReader({
  "PAYPAL-AUTH-ALGO": headers.authAlgo,
  "PAYPAL-CERT-URL": headers.certUrl,
  "PAYPAL-TRANSMISSION-ID": headers.transmissionId,
  "PAYPAL-TRANSMISSION-SIG": headers.transmissionSig,
  "PAYPAL-TRANSMISSION-TIME": headers.transmissionTime,
});

describe("extractPayPalWebhookSignatureHeaders", () => {
  it("returns all five headers when present", () => {
    expect(extractPayPalWebhookSignatureHeaders(fullHeaderReader)).toEqual(headers);
  });

  it("returns null when any single header is missing", () => {
    for (const missing of Object.keys({
      "PAYPAL-AUTH-ALGO": 1,
      "PAYPAL-CERT-URL": 1,
      "PAYPAL-TRANSMISSION-ID": 1,
      "PAYPAL-TRANSMISSION-SIG": 1,
      "PAYPAL-TRANSMISSION-TIME": 1,
    })) {
      const reader = headerReader({
        "PAYPAL-AUTH-ALGO": headers.authAlgo,
        "PAYPAL-CERT-URL": headers.certUrl,
        "PAYPAL-TRANSMISSION-ID": headers.transmissionId,
        "PAYPAL-TRANSMISSION-SIG": headers.transmissionSig,
        "PAYPAL-TRANSMISSION-TIME": headers.transmissionTime,
        [missing]: null,
      });
      expect(extractPayPalWebhookSignatureHeaders(reader)).toBeNull();
    }
  });

  it("returns null when a header is blank or whitespace", () => {
    const reader = headerReader({
      "PAYPAL-AUTH-ALGO": headers.authAlgo,
      "PAYPAL-CERT-URL": "   ",
      "PAYPAL-TRANSMISSION-ID": headers.transmissionId,
      "PAYPAL-TRANSMISSION-SIG": headers.transmissionSig,
      "PAYPAL-TRANSMISSION-TIME": headers.transmissionTime,
    });
    expect(extractPayPalWebhookSignatureHeaders(reader)).toBeNull();
  });
});

describe("buildVerifyWebhookSignatureBody", () => {
  it("shapes the exact field set PayPal's API documents", () => {
    const body = buildVerifyWebhookSignatureBody(headers, "WH_ID_123", webhookEvent);
    expect(body).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: "WH_ID_123",
      webhook_event: webhookEvent,
    });
  });

  it("passes the webhook event through unchanged", () => {
    const body = buildVerifyWebhookSignatureBody(headers, "WH_ID_123", webhookEvent);
    expect(body?.webhook_event).toBe(webhookEvent);
  });

  it("returns null without a webhook id or with a non-object event", () => {
    expect(buildVerifyWebhookSignatureBody(headers, "", webhookEvent)).toBeNull();
    expect(buildVerifyWebhookSignatureBody(headers, "  ", webhookEvent)).toBeNull();
    expect(buildVerifyWebhookSignatureBody(headers, "WH_ID_123", null)).toBeNull();
    expect(buildVerifyWebhookSignatureBody(headers, "WH_ID_123", "raw string")).toBeNull();
    expect(buildVerifyWebhookSignatureBody(headers, "WH_ID_123", [1, 2])).toBeNull();
  });
});

describe("isPayPalVerificationSuccess", () => {
  it("accepts only HTTP 200 with verification_status SUCCESS", () => {
    expect(isPayPalVerificationSuccess(200, { verification_status: "SUCCESS" })).toBe(true);
  });

  it("rejects FAILURE, non-200, and malformed payloads", () => {
    expect(isPayPalVerificationSuccess(200, { verification_status: "FAILURE" })).toBe(false);
    expect(isPayPalVerificationSuccess(401, { verification_status: "SUCCESS" })).toBe(false);
    expect(isPayPalVerificationSuccess(500, { verification_status: "SUCCESS" })).toBe(false);
    expect(isPayPalVerificationSuccess(200, {})).toBe(false);
    expect(isPayPalVerificationSuccess(200, null)).toBe(false);
    expect(isPayPalVerificationSuccess(200, "SUCCESS")).toBe(false);
    expect(isPayPalVerificationSuccess(200, { verification_status: "success" })).toBe(false);
  });
});

describe("verifyPayPalWebhookSignature (mocked fetch)", () => {
  const input = {
    headers,
    webhookId: "WH_ID_123",
    webhookEvent,
    accessToken: "ACCESS_TOKEN",
    baseUrl: "https://api-m.paypal.com",
  };

  it("POSTs the shaped body to the live verify endpoint with the bearer token", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => ({
      status: 200,
      json: async () => ({ verification_status: "SUCCESS" }),
    }));

    await expect(verifyPayPalWebhookSignature(input, fetchImpl)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api-m.paypal.com/v1/notifications/verify-webhook-signature");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ACCESS_TOKEN");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: "WH_ID_123",
      webhook_event: webhookEvent,
    });
  });

  it("returns false when PayPal answers FAILURE", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => ({
      status: 200,
      json: async () => ({ verification_status: "FAILURE" }),
    }));
    await expect(verifyPayPalWebhookSignature(input, fetchImpl)).resolves.toBe(false);
  });

  it("returns false on a non-200 response, even with a SUCCESS body", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => ({
      status: 503,
      json: async () => ({ verification_status: "SUCCESS" }),
    }));
    await expect(verifyPayPalWebhookSignature(input, fetchImpl)).resolves.toBe(false);
  });

  it("returns false when the response body is not JSON", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => ({
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    }));
    await expect(verifyPayPalWebhookSignature(input, fetchImpl)).resolves.toBe(false);
  });

  it("returns false when fetch itself throws (network error)", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => {
      throw new Error("connection refused");
    });
    await expect(verifyPayPalWebhookSignature(input, fetchImpl)).resolves.toBe(false);
  });

  it("never calls fetch when headers, token or webhook id are missing", async () => {
    const fetchImpl = vi.fn<VerifyFetch>(async () => ({
      status: 200,
      json: async () => ({ verification_status: "SUCCESS" }),
    }));
    await expect(
      verifyPayPalWebhookSignature({ ...input, headers: null }, fetchImpl),
    ).resolves.toBe(false);
    await expect(
      verifyPayPalWebhookSignature({ ...input, accessToken: null }, fetchImpl),
    ).resolves.toBe(false);
    await expect(
      verifyPayPalWebhookSignature({ ...input, webhookId: null }, fetchImpl),
    ).resolves.toBe(false);
    await expect(
      verifyPayPalWebhookSignature({ ...input, webhookId: "" }, fetchImpl),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
