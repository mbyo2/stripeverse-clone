// Mobile money through the developer API (Mission B, 2026-11-12).
//
// Pins:
//   1. The mobile_money scopes exist in the allowlist AND the default
//      set (so every newly issued key can use the connectors), and
//      sanitizeScopes round-trips them — while the dangerous-scope
//      refusals stay intact.
//   2. The router wires POST/GET /mobile-money/collections to the
//      shared rail helpers (startCollection / refreshCollectionFromRail
//      / loadConnection) — the API never reimplements rail calls and
//      never writes momo_collections or wallets directly.
//   3. The gate matrix is in the route, in order: scope → frozen →
//      no business (business_not_set_up) → non-Zambian or toggle off
//      (not_entitled) → no connection for the key's environment
//      (not_configured). The environment comes from the key only.
//   4. API collections carry source 'direct' (the ledger enum) and
//      are told apart by the per-merchant idempotency namespace
//      api:<userId>:<reference> — never a bare client key, which
//      would collide across merchants on the global unique index.
//   5. Settlement announces mobile_money.collection.completed exactly
//      once (developer_event_dispatches claim on the transaction id),
//      and the event is a known developer event. The collection
//      funnel (begin/settle RPCs, momo-* functions) is NOT touched by
//      the router — wiring lives only in developer-api.
//   6. Connector config connection truth is per environment:
//      businessFacts filters merchant_momo_connections by the key's
//      environment, so a sandbox-only connection can no longer make
//      a production key claim mobile money is connected.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_KEY_SCOPES,
  DEFAULT_KEY_SCOPES,
  sanitizeScopes,
} from "../../supabase/functions/_shared/connector-config";
import { KNOWN_DEVELOPER_EVENTS } from "../../supabase/functions/_shared/developer-webhooks";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const router = read("supabase/functions/developer-api/index.ts");

describe("mobile money scopes", () => {
  it("are issuable and in the default set", () => {
    expect(ALLOWED_KEY_SCOPES).toContain("mobile_money:create");
    expect(ALLOWED_KEY_SCOPES).toContain("mobile_money:read");
    expect(DEFAULT_KEY_SCOPES).toContain("mobile_money:create");
    expect(DEFAULT_KEY_SCOPES).toContain("mobile_money:read");
    expect(sanitizeScopes(["mobile_money:create", "mobile_money:read"]).scopes)
      .toEqual(["mobile_money:create", "mobile_money:read"]);
    // The money-out refusals are untouched by the new scopes.
    for (const s of ["withdrawals:write", "payouts:write", "settlement:write"]) {
      expect(sanitizeScopes([s]).rejected).toEqual([s]);
    }
  });
});

describe("mobile money routes", () => {
  it("exist for create + status and gate on the narrow scopes", () => {
    expect(router).toContain('resource === "mobile-money" && sub === "collections" && method === "POST"');
    expect(router).toContain('resource === "mobile-money" && sub === "collections" && parts[2] && method === "GET"');
    expect(router).toContain('requireScope(key, "mobile_money:create")');
    expect(router).toContain('requireScope(key, "mobile_money:read")');
  });

  it("run through the shared rail helpers, never a reimplementation", () => {
    expect(router).toContain("startCollection");
    expect(router).toContain("refreshCollectionFromRail");
    expect(router).toContain("loadConnection");
    expect(router).toContain('from "../_shared/momo-rail-server.ts"');
    // No direct ledger writes from the router: settlement is the
    // shared funnel's job (begin/settle RPCs), full stop.
    expect(router).not.toContain('rpc("settle_momo_collection"');
    expect(router).not.toContain('rpc("begin_momo_collection"');
    expect(router).not.toMatch(/from\("momo_collections"\)\s*\.insert/);
    expect(router).not.toMatch(/from\("wallets"\)\s*\.update/);
  });

  it("derive the environment from the key and use it for the connection", () => {
    const create = router.slice(router.indexOf('resource === "mobile-money"'));
    expect(create).toContain("const environment = envOf(key);");
    expect(create).toContain("loadConnection(db, userId, environment)");
    expect(create).not.toContain("body.environment");
  });

  it("apply the truthful gate matrix in order", () => {
    const create = router.slice(
      router.indexOf('resource === "mobile-money"'),
      router.indexOf("// ── Webhooks (registered per environment"),
    );
    const order = [
      'requireScope(key, "mobile_money:create")',
      "frozenGuard(db, userId)",
      '"business_not_set_up"',
      '"not_entitled"',
      '"not_configured"',
      "startCollection",
    ];
    let last = -1;
    for (const marker of order) {
      const idx = create.indexOf(marker);
      expect(idx, `gate marker missing: ${marker}`).toBeGreaterThan(last);
      last = idx;
    }
    // Both not_entitled causes are present: non-Zambian business and
    // the mobile-money toggle being off.
    expect(create).toContain('!== "ZM"');
    expect(create).toContain("!merchant.mobile_money_enabled");
  });

  it("validate amount, phone and operator before starting anything", () => {
    expect(router).toContain("validateFiatAmount(body.amount)");
    expect(router).toContain("isValidZmPhone(phone)");
    expect(router).toContain("detectOperator(phone)");
  });

  it("namespace the idempotency key per merchant and keep source 'direct'", () => {
    expect(router).toContain("`api:${userId}:${clientKey || reference}`");
    expect(router).toContain('source: "direct"');
    // The merchant-reference read-back strips the same namespace.
    expect(router).toContain("`api:${userId}:`");
  });

  it("answer conflicts and start failures in the API envelope", () => {
    expect(router).toContain('err(409, "idempotency_conflict"');
    expect(router).toContain('err(422, "collection_failed"');
    expect(router).toContain('err(404, "not_found"');
    expect(router).toContain('err(502, "collection_status_unavailable"');
  });
});

describe("mobile money settlement webhook", () => {
  it("is a known developer event", () => {
    expect(KNOWN_DEVELOPER_EVENTS).toContain("mobile_money.collection.completed");
  });

  it("is claimed exactly once on the settlement transaction id", () => {
    expect(router).toContain("`${MOMO_COLLECTION_EVENT}:${txId}`");
    expect(router).toContain('"developer_event_dispatches"');
    expect(router).toContain("outcome.just_settled");
    // Dispatched only to endpoints of the collection's environment.
    expect(router).toContain('row.environment === "production" ? "live" : "test"');
  });
});

describe("connector config per-environment truth", () => {
  it("filters the mobile-money connection by the key's environment", () => {
    expect(router).toContain("businessFacts(db, userId, envOf(key))");
    const facts = router.slice(router.indexOf("async function businessFacts"), router.indexOf("async function frozenGuard"));
    expect(facts).toContain('from("merchant_momo_connections")');
    expect(facts).toContain('.eq("environment", environment)');
  });

  it("advertises the mobile-money resource in the meta route", () => {
    expect(router).toContain('"mobile-money"');
  });
});

describe("openapi spec", () => {
  it("documents both mobile-money paths", () => {
    const spec = JSON.parse(read("public/openapi.json"));
    expect(spec.paths["/mobile-money/collections"]?.post).toBeTruthy();
    expect(spec.paths["/mobile-money/collections/{reference}"]?.get).toBeTruthy();
    expect(spec.paths["/mobile-money/collections"].post.description).toContain("mobile_money:create");
    expect(spec.paths["/mobile-money/collections/{reference}"].get.description).toContain("mobile_money:read");
  });
});
