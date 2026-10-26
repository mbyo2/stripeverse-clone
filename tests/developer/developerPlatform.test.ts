// Developer-platform truth tests (Workstream A, 2026-10-26).
// Pins: the OpenAPI spec matches the developer-api router's routes, the
// docs pages describe only the shipped surface, and the playground makes
// real calls (no mock-response fiction).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// The spec's canonical in-repo copy is the one the site serves
// (public/openapi.json). The SDKs/connectors — and their own copy of the
// spec — live in the public bmaglasspay-connectors repository.
const spec = JSON.parse(read("public/openapi.json"));
const router = read("supabase/functions/developer-api/index.ts");

describe("developer-api contract", () => {
  it("OpenAPI documents exactly the resources the router serves", () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toContain("/wallets");
    expect(paths).toContain("/transactions");
    expect(paths).toContain("/transfers");
    expect(paths).toContain("/payment-links");
    expect(paths).toContain("/bitcoin/balance");
    expect(paths).toContain("/bitcoin/deposit-address");
    expect(paths).toContain("/bitcoin/quote");
    expect(paths).toContain("/webhooks");
    expect(paths).toContain("/webhook-deliveries");
    for (const route of ['resource === "wallets"', 'resource === "transactions"', 'resource === "transfers"',
      'resource === "payment-links"', 'resource === "bitcoin"', 'resource === "webhooks"',
      'resource === "webhook-deliveries"']) {
      expect(router).toContain(route);
    }
  });

  it("test mode is honestly read-only in the router", () => {
    expect(router).toContain("test_mode_read_only");
    expect(router).toContain("execute_transfer_with_fee");
  });

  it("payment_link.paid is a real, subscribable event dispatched from settlement", () => {
    const shared = read("supabase/functions/_shared/developer-webhooks.ts");
    const checkout = read("supabase/functions/payment-link-checkout/index.ts");
    // One shared dispatcher + event list, used by both functions.
    expect(shared).toContain('"payment_link.paid"');
    expect(shared).toContain("payment_link_paid_dispatches");
    expect(router).toContain("KNOWN_DEVELOPER_EVENTS");
    expect(router).toContain("_shared/developer-webhooks");
    // The settlement path emits it (exactly-once helper), it is not
    // dispatched from the API router itself.
    expect(checkout).toContain("dispatchPaymentLinkPaid");
    expect(checkout).toContain("execute_payment_link_settlement");
    expect(router).not.toContain("dispatchPaymentLinkPaid(");
    // The merchant-facing surfaces offer the event.
    expect(read("src/pages/API.tsx")).toContain('"payment_link.paid"');
    expect(read("src/pages/Developers.tsx")).toContain('"payment_link.paid"');
    // The OpenAPI contract names it among the webhook events.
    expect(JSON.stringify(spec)).toContain("payment_link.paid");
  });

  it("public/openapi.json is the complete served contract (11 path templates)", () => {
    // This replaces the old sdk-copy byte-identity pin: the second copy
    // moved to the bmaglasspay-connectors repo, so the guard now pins
    // the served copy itself — complete and self-contained.
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/bitcoin/balance",
      "/bitcoin/deposit-address",
      "/bitcoin/quote",
      "/payment-links",
      "/transactions",
      "/transfers",
      "/wallets",
      "/webhook-deliveries",
      "/webhooks",
      "/webhooks/{id}",
      "/webhooks/{id}/test",
    ]);
  });
});

describe("docs truth pass", () => {
  const pages = [
    "src/pages/Developers.tsx",
    "src/pages/API.tsx",
    "src/pages/SdkDocs.tsx",
    "src/components/developers/ApiPlayground.tsx",
    "src/components/business/docs/ApiReference.tsx",
    "src/components/business/docs/SdkDocs.tsx",
    "src/components/business/docs/WebhookDocs.tsx",
    "src/components/business/docs/TestingGuide.tsx",
  ];
  const fiction = ["api.bmaglasspay.com", "/v1/payments", "/v1/invoices", "/v1/customers",
    "/v1/subscriptions", "/v1/cards", "@bmaglasspay/sdk", "pip install bmaglasspay",
    "composer require", "lightning-service", "process-payment"];

  it.each(pages)("%s contains no fictional API claims", (p) => {
    const src = read(p);
    for (const f of fiction) expect(src, `${p} must not mention ${f}`).not.toContain(f);
  });

  it("playground calls the real developer-api with a user-supplied key", () => {
    const pg = read("src/components/developers/ApiPlayground.tsx");
    expect(pg).toContain("developer-api");
    expect(pg).toContain("X-Api-Key");
    expect(pg).not.toContain("mock");
  });

  it("API page offers the real scopes and events", () => {
    const api = read("src/pages/API.tsx");
    expect(api).toContain("transfers:write");
    expect(api).toContain("transaction.completed");
    expect(api).toContain("developer_webhooks");
    expect(api).toContain("developer_webhook_deliveries");
  });
});
