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

  it("public/openapi.json is the complete served contract (13 path templates)", () => {
    // This replaces the old sdk-copy byte-identity pin: the second copy
    // moved to the bmaglasspay-connectors repo, so the guard now pins
    // the served copy itself — complete and self-contained.
    // /payment-links/{id}/attempts joined with Pay-with-Bitcoin
    // (2026-10-26): a link's Bitcoin payment attempts, read-only.
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/bitcoin/balance",
      "/bitcoin/deposit-address",
      "/bitcoin/quote",
      "/payment-links",
      "/payment-links/{id}/attempts",
      "/settings",
      "/transactions",
      "/transfers",
      "/wallets",
      "/webhook-deliveries",
      "/webhooks",
      "/webhooks/{id}",
      "/webhooks/{id}/test",
    ]);
    expect(router).toContain('resource === "settings"');
  });
});

describe("fee-bearer choice (CEO order, 2026-10-26)", () => {
  it("the merchant's account default is readable over the API and drives link resolution", () => {
    // GET /settings exposes the dashboard-set default (fee_payer_default).
    expect(router).toContain("fee_payer_default");
    expect(router).toContain("payment_link_fee_payer");
    // Link create accepts fee_payer, validates it, and resolves
    // explicit > account default; reads carry the computed amounts.
    expect(router).toContain("fee_payer must be 'seller' or 'buyer'");
    expect(router).toContain("paymentLinkAmounts");
    expect(spec.paths["/settings"]).toBeDefined();
    expect(spec.paths["/payment-links"].post.requestBody.content["application/json"].schema.properties.fee_payer.enum)
      .toEqual(["seller", "buyer"]);
  });

  it("settlement is enforced from the link's stored fee_payer, with the fee truth in the paid payload", () => {
    const migration = read("supabase/migrations/20261216_payment_link_fee_payer.sql");
    expect(migration).toContain("payment_links_fee_payer_check");
    expect(migration).toContain("profiles_payment_link_fee_payer_check");
    expect(migration).toContain("v_fee_payer = 'buyer'");
    const checkout = read("supabase/functions/payment-link-checkout/index.ts");
    expect(checkout).toContain("fee_payer");
    expect(checkout).toContain("total_charged");
    const shared = read("supabase/functions/_shared/developer-webhooks.ts");
    expect(shared).toContain("fee_payer: settlement.feePayer");
    expect(shared).toContain("total_charged: settlement.totalCharged");
    expect(JSON.stringify(spec)).toContain("total_charged");
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
