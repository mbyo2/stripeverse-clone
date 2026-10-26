// Developer-platform truth tests (Workstream A, 2026-10-26).
// Pins: the OpenAPI spec matches the developer-api router's routes, the
// docs pages describe only the shipped surface, and the playground makes
// real calls (no mock-response fiction).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const spec = JSON.parse(read("sdk/openapi.json"));
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

  it("public/openapi.json is identical to sdk/openapi.json", () => {
    expect(read("public/openapi.json")).toBe(read("sdk/openapi.json"));
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
