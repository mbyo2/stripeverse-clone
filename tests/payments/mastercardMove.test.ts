// Unit tests for supabase/functions/_shared/mastercard-move.ts and
// mastercard-encryption.ts, plus source pins for the edge function's
// admin gate and idempotency ordering.
//
// The properties under test are the money-safety ones:
//   * Idempotency — a retry resolves to the SAME transaction
//     reference (existing row wins, then the supplied reference,
//     then a deterministic derivation from the idempotency key);
//     the generator only runs for a genuinely new payment.
//   * Admin gate — only admin / super_admin pass; every other role
//     (user, business, beta_tester, feature roles, empty) is refused.
//   * Provider URLs — the exact sandbox/production shapes from the
//     gateway brief (§1.2 Send static sandbox; §1.2A XBS hosts).
//   * Crafted errors — provider failures map to plain language and
//     never echo a raw provider body.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_REFUSAL_MESSAGE,
  SANDBOX_PARTNER_ID,
  appendStatusHistory,
  buildSendDisbursementBody,
  buildXbsPaymentBody,
  buildXbsQuoteBody,
  craftedProviderError,
  deriveReferenceFromIdempotencyKey,
  hasMastercardAdmin,
  isMastercardAdminRole,
  isValidTransactionReference,
  normaliseProviderStatus,
  redactRecipientAccount,
  resolvePartnerId,
  resolveTransactionReference,
  sendDisbursementUrl,
  sendStatusUrl,
  xbsAccountsUrl,
  xbsPaymentStatusUrl,
  xbsPaymentUrl,
  xbsQuotesUrl,
  type MastercardMoveConfig,
} from "../../supabase/functions/_shared/mastercard-move";
import {
  decryptXbsPayload,
  encryptXbsPayload,
} from "../../supabase/functions/_shared/mastercard-encryption";
import * as nodeCrypto from "node:crypto";

const sandboxConfig: MastercardMoveConfig = {
  env: "sandbox",
  consumerKey: "ck",
  signingKeyPem: "pem",
  sendPartnerId: null,
  xbsPartnerId: null,
};
const prodConfig: MastercardMoveConfig = { ...sandboxConfig, env: "production" };

describe("provider URLs (brief §1.2 / §1.2A)", () => {
  it("Send sandbox uses the static sandbox on the Move domain", () => {
    expect(sendDisbursementUrl(sandboxConfig, "P1")).toBe(
      "https://sandbox.api.move.mastercard.com/send/static/v1/partners/P1/disbursements/payment",
    );
  });
  it("Send production uses api.move.mastercard.com without /static", () => {
    expect(sendDisbursementUrl(prodConfig, "P1")).toBe(
      "https://api.move.mastercard.com/send/v1/partners/P1/disbursements/payment",
    );
  });
  it("Send status retrieves by disbursement_reference", () => {
    expect(sendStatusUrl(sandboxConfig, "P1", "bmg-abc")).toContain("disbursement_reference=bmg-abc");
  });
  it("XBS quote / payment / status / accounts match the brief endpoints", () => {
    expect(xbsQuotesUrl(sandboxConfig, "P1")).toBe(
      "https://sandbox.api.mastercard.com/send/v1/partners/P1/crossborder/quotes",
    );
    expect(xbsPaymentUrl(sandboxConfig, "P1")).toBe(
      "https://sandbox.api.mastercard.com/send/v1/partners/P1/crossborder/payment",
    );
    expect(xbsPaymentStatusUrl(sandboxConfig, "P1", "pay-9")).toBe(
      "https://sandbox.api.mastercard.com/send/v1/partners/P1/crossborder/pay-9",
    );
    expect(xbsAccountsUrl(sandboxConfig, "P1")).toBe(
      "https://sandbox.api.mastercard.com/send/partners/P1/crossborder/accounts?include_balance=true",
    );
    expect(xbsQuotesUrl(prodConfig, "P1")).toContain("https://api.mastercard.com/");
  });
});

describe("partner id resolution", () => {
  it("sandbox falls back to the 32-char placeholder", () => {
    expect(SANDBOX_PARTNER_ID).toHaveLength(32);
    expect(resolvePartnerId(sandboxConfig, "send")).toBe(SANDBOX_PARTNER_ID);
    expect(resolvePartnerId(sandboxConfig, "xbs")).toBe(SANDBOX_PARTNER_ID);
  });
  it("production without an issued ID is not configured (null)", () => {
    expect(resolvePartnerId(prodConfig, "xbs")).toBeNull();
  });
  it("an issued ID always wins", () => {
    expect(resolvePartnerId({ ...prodConfig, xbsPartnerId: "issued-1" }, "xbs")).toBe("issued-1");
  });
});

describe("admin gate", () => {
  it.each(["admin", "super_admin"])("allows %s", (role) => {
    expect(isMastercardAdminRole(role)).toBe(true);
    expect(hasMastercardAdmin([role])).toBe(true);
  });
  it.each(["user", "business", "beta_tester", "p2p_admin", "support_admin", "", null, undefined])(
    "refuses %s",
    (role) => {
      expect(isMastercardAdminRole(role as string)).toBe(false);
      expect(hasMastercardAdmin([role as string])).toBe(false);
    },
  );
  it("allows a user holding admin among other roles", () => {
    expect(hasMastercardAdmin(["user", "admin"])).toBe(true);
    expect(hasMastercardAdmin([])).toBe(false);
  });
});

describe("idempotency — resolveTransactionReference", () => {
  const generate = () => {
    throw new Error("generator must not run");
  };
  it("reuses the persisted row's reference on retry (generator never runs)", () => {
    expect(
      resolveTransactionReference({
        existingReference: "bmg-existing123",
        suppliedReference: "bmg-other",
        idempotencyKey: "key-1",
        generate,
      }),
    ).toBe("bmg-existing123");
  });
  it("reuses the reference the caller is retrying with", () => {
    expect(
      resolveTransactionReference({
        existingReference: null,
        suppliedReference: "bmg-retry123",
        idempotencyKey: null,
        generate,
      }),
    ).toBe("bmg-retry123");
  });
  it("derives the SAME reference from the same idempotency key, every time", () => {
    const a = resolveTransactionReference({ existingReference: null, suppliedReference: null, idempotencyKey: "intent-42", generate });
    const b = resolveTransactionReference({ existingReference: null, suppliedReference: null, idempotencyKey: "intent-42", generate });
    expect(a).toBe(b);
    expect(a).toBe(deriveReferenceFromIdempotencyKey("intent-42"));
    expect(isValidTransactionReference(a)).toBe(true);
  });
  it("derives different references for different idempotency keys", () => {
    expect(deriveReferenceFromIdempotencyKey("intent-1")).not.toBe(deriveReferenceFromIdempotencyKey("intent-2"));
  });
  it("only generates for a genuinely new payment", () => {
    let calls = 0;
    const ref = resolveTransactionReference({
      existingReference: null,
      suppliedReference: null,
      idempotencyKey: null,
      generate: () => `bmg-gen${++calls}`,
    });
    expect(ref).toBe("bmg-gen1");
    expect(calls).toBe(1);
  });
  it("validates the Send disbursement_reference shape (6–40 URL-safe chars)", () => {
    expect(isValidTransactionReference("bmg-abc123")).toBe(true);
    expect(isValidTransactionReference("short")).toBe(false);
    expect(isValidTransactionReference("has spaces in it")).toBe(false);
    expect(isValidTransactionReference("x".repeat(41))).toBe(false);
  });
});

describe("request bodies", () => {
  const payment = {
    amount: 25,
    sourceCurrency: "usd",
    destinationCurrency: "zmw",
    destinationCountry: "zm",
    destinationType: "mobile_money" as const,
    transactionReference: "bmg-ref123",
    proposalId: "prop-1",
    recipientName: "Test Recipient",
    recipientAccount: "+260971234567",
  };
  it("XBS payment carries our transaction_reference and the proposal id", () => {
    const body = buildXbsPaymentBody(payment);
    expect(body.transaction_reference).toBe("bmg-ref123");
    expect(body.proposal_id).toBe("prop-1");
    expect(body.destination_payment_instrument).toBe("MOBILE_MONEY");
  });
  it("XBS quote upper-cases corridor fields and formats the amount", () => {
    const body = buildXbsQuoteBody(payment) as Record<string, unknown>;
    expect(body.destination_country).toBe("ZM");
    expect((body.sender_amount as Record<string, unknown>).amount).toBe("25.00");
  });
  it("Send disbursement wraps the reference as disbursement_reference", () => {
    const body = buildSendDisbursementBody(payment) as Record<string, unknown>;
    const inner = body.payment_disbursement as Record<string, unknown>;
    expect(inner.disbursement_reference).toBe("bmg-ref123");
  });
});

describe("status handling and crafted errors", () => {
  it("normalises provider statuses", () => {
    expect(normaliseProviderStatus("APPROVED")).toBe("completed");
    expect(normaliseProviderStatus("DECLINED")).toBe("failed");
    expect(normaliseProviderStatus("PENDING")).toBe("pending");
    expect(normaliseProviderStatus(undefined)).toBe("unknown");
  });
  it("appends history without mutating the prior array", () => {
    const prior = [{ event: "created" }];
    const next = appendStatusHistory(prior, { event: "submitted" });
    expect(next).toHaveLength(2);
    expect(prior).toHaveLength(1);
    expect(appendStatusHistory(null, { event: "created" })).toHaveLength(1);
  });
  it("crafted errors are plain language and never raw", () => {
    for (const status of [400, 401, 404, 500]) {
      const msg = craftedProviderError(status);
      expect(msg).not.toMatch(/http|oauth|sql|stack/i);
      expect(msg.length).toBeGreaterThan(20);
    }
    expect(craftedProviderError(500)).toContain("not sent twice");
  });
  it("redacts card PANs but keeps mobile numbers reconcilable", () => {
    expect(redactRecipientAccount("pan:5399999999999999;exp=2030-01")).toContain("****9999");
    expect(redactRecipientAccount("5399999999999999")).toBe("****9999");
    expect(redactRecipientAccount("+260971234567")).toBe("+260971234567");
  });
});

describe("XBS payload encryption (JWE round-trip)", () => {
  it("encrypts and decrypts back to the original payload", async () => {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const payload = { transaction_reference: "bmg-ref123", amount: "25.00" };
    const jwe = await encryptXbsPayload(payload, pubPem);
    expect(jwe.split(".")).toHaveLength(5);
    expect(jwe).not.toContain("bmg-ref123");
    await expect(decryptXbsPayload(jwe, privPem)).resolves.toEqual(payload);
  });
  it("refuses a non-public key for encryption", async () => {
    await expect(encryptXbsPayload({}, "not a key")).rejects.toThrow("not configured");
  });
});

// Source pins: the edge function's money-safety wiring. Deno code
// cannot run under vitest, so — the repo's established pattern —
// these pin the properties that must not regress.
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const edgeFn = read("../../supabase/functions/mastercard-move/index.ts");
const config = read("../../supabase/config.toml");
const migration = read("../../supabase/migrations/20261029_mastercard_move_payments.sql");
const page = read("../../src/pages/AdminMastercardMove.tsx");
const routes = read("../../src/components/AnimatedRoutes.tsx");

describe("mastercard-move edge function — source pins", () => {
  it("enforces the admin gate before any provider work", () => {
    const gateIdx = edgeFn.indexOf("hasMastercardAdmin(roles)");
    const providerIdx = edgeFn.indexOf("providerCall(config");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(providerIdx).toBeGreaterThan(gateIdx);
    expect(edgeFn).toContain("ADMIN_REFUSAL_MESSAGE");
    expect(edgeFn).toContain("json(403,");
    expect(ADMIN_REFUSAL_MESSAGE).toContain("administrators only");
  });
  it("persists the payment row BEFORE the provider call", () => {
    const insertIdx = edgeFn.indexOf('.from("mastercard_move_payments")\n          .insert({');
    const callIdx = edgeFn.indexOf('const result = await providerCall(config, "POST", url, payload');
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(insertIdx);
  });
  it("short-circuits idempotent replays for already-submitted payments", () => {
    expect(edgeFn).toContain("idempotent_replay: true");
    expect(edgeFn).toContain('["submitted", "pending", "completed"].includes(existing.status)');
  });
  it("labels sandbox in responses and never hardcodes a secret value", () => {
    expect(edgeFn).toContain("sandbox: config.env === \"sandbox\"");
    expect(edgeFn).toContain('Deno.env.get("MASTERCARD_SIGNING_KEY_PEM")');
    expect(edgeFn).not.toMatch(/MASTERCARD_CONSUMER_KEY\s*=\s*"/);
  });
  it("is registered verify_jwt = true", () => {
    expect(config).toContain("[functions.mastercard-move]\nverify_jwt = true");
  });
});

describe("mastercard_move_payments migration — source pins", () => {
  it("anchors idempotency on a UNIQUE transaction_reference", () => {
    expect(migration).toContain("transaction_reference TEXT NOT NULL UNIQUE");
    expect(migration).toContain("env TEXT NOT NULL DEFAULT 'sandbox'");
    expect(migration).toContain("status_history JSONB");
  });
  it("gives admins read and NO client write policies", () => {
    expect(migration).toContain("FOR SELECT");
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
    expect(migration).toContain("'admin', 'super_admin'");
  });
});

describe("admin UI — source pins", () => {
  it("the route is guarded to admin / super_admin only", () => {
    expect(routes).toContain('path="/admin/mastercard-move"');
    expect(routes).toContain("roles={['admin', 'super_admin']}");
  });
  it("always shows the sandbox banner", () => {
    expect(page).toContain("Sandbox — no real money moves");
    expect(page).toContain("Cross-Border Payouts (Mastercard — Sandbox)");
  });
  it("reuses one idempotency key per payment intent", () => {
    expect(page).toContain("idempotencyKeyRef");
    expect(page).toContain("idempotency_key: idempotencyKey()");
  });
});
