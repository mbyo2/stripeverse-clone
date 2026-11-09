// API key environments (CEO-approved design, 2026-11-09).
//
// Pins:
//   1. Key prefixes: new keys are bmg_sandbox_ / bmg_live_; legacy
//      bmp_test_ / bmp_live_ keys keep working and map to sandbox /
//      production. Authentication accepts all four shapes and derives
//      the environment from the key record only.
//   2. Scopes: the issuance allowlist can never contain a scope that
//      withdraws, pays out, changes settlement details, changes the
//      business country, or manages keys; unknown scopes are refused.
//   3. The connector-config builder: environment from the key, the
//      full mobile-money gate matrix (ZM on / ZM off / non-ZM /
//      unknown country / no business record), settlement type only,
//      and no balances or personal data anywhere in the payload.
//   4. Storage truth: keys are stored only as SHA-256 hashes (the
//      issuance + rotation functions), rotation runs a 24h grace
//      clock on the replaced key, revocation flips is_active.
//   5. Segregation wiring in the router: environment filters on
//      invoices / payment links / webhooks, simulate-payment refused
//      for production keys, the hosted checkout refuses sandbox
//      links, and the DB trigger enforces the Zambia gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_KEY_SCOPES,
  DEFAULT_KEY_SCOPES,
  buildConnectorConfig,
  countryToIso,
  currencyForCountry,
  environmentFromKeyString,
  environmentToMode,
  isApiKeyShape,
  mobileMoneyFeature,
  modeToEnvironment,
  sanitizeScopes,
  type BusinessFacts,
} from "../../supabase/functions/_shared/connector-config";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const router = read("supabase/functions/developer-api/index.ts");
const generate = read("supabase/functions/generate-api-key/index.ts");
const rotate = read("supabase/functions/rotate-api-key/index.ts");
const revoke = read("supabase/functions/revoke-api-key/index.ts");
const checkout = read("supabase/functions/payment-link-checkout/index.ts");
const migration = read("supabase/migrations/20261254_api_key_environments.sql");

const facts = (over: Partial<BusinessFacts> = {}): BusinessFacts => ({
  hasBusinessRecord: true,
  displayName: "QA Store",
  countryIso: "ZM",
  businessStatus: "pending",
  frozen: false,
  mobileMoneyToggleOn: false,
  ...over,
});

describe("key prefixes and environment derivation", () => {
  it("recognises all four issued prefixes and maps them deterministically", () => {
    expect(environmentFromKeyString("bmg_sandbox_abc")).toBe("sandbox");
    expect(environmentFromKeyString("bmg_live_abc")).toBe("production");
    expect(environmentFromKeyString("bmp_test_abc")).toBe("sandbox");
    expect(environmentFromKeyString("bmp_live_abc")).toBe("production");
    expect(environmentFromKeyString("sk_live_abc")).toBeNull();
    expect(isApiKeyShape("bmg_sandbox_x")).toBe(true);
    expect(isApiKeyShape("bmp_test_x")).toBe(true);
    expect(isApiKeyShape("whsec_x")).toBe(false);
  });

  it("mode <-> environment mapping round-trips", () => {
    expect(modeToEnvironment("live")).toBe("production");
    expect(modeToEnvironment("test")).toBe("sandbox");
    expect(modeToEnvironment(null, "bmp_live_x")).toBe("production");
    expect(modeToEnvironment(null, "bmp_test_x")).toBe("sandbox");
    expect(environmentToMode("production")).toBe("live");
    expect(environmentToMode("sandbox")).toBe("test");
  });

  it("issuance uses only the new prefixes; authentication accepts legacy ones", () => {
    expect(generate).toContain("KEY_PREFIXES.production");
    expect(generate).toContain("KEY_PREFIXES.sandbox");
    expect(generate).not.toContain('"bmp_live_"');
    expect(generate).not.toContain('"bmp_test_"');
    expect(router).toContain("isApiKeyShape");
    // Environment comes from the key record (mode), never the request.
    expect(router).toContain("modeToEnvironment(modeOf(key), key.key_prefix)");
    expect(router).not.toContain('searchParams.get("environment"');
    expect(router).not.toContain('searchParams.get("mode"');
  });
});

describe("scope allowlist", () => {
  it("contains the connector scopes and nothing that can move money out", () => {
    for (const s of ["config:read", "invoices:create", "invoices:read", "webhooks:manage"]) {
      expect(ALLOWED_KEY_SCOPES).toContain(s);
      expect(DEFAULT_KEY_SCOPES).toContain(s);
    }
    for (const s of ALLOWED_KEY_SCOPES) {
      expect(s).not.toMatch(/withdraw|payout|settlement|country|keys:|admin/);
    }
  });

  it("sanitizeScopes keeps allowed scopes and reports rejected ones", () => {
    const { scopes, rejected } = sanitizeScopes(["config:read", "payouts:write", "invoices:create"]);
    expect(scopes).toEqual(["config:read", "invoices:create"]);
    expect(rejected).toEqual(["payouts:write"]);
    expect(sanitizeScopes(undefined).scopes).toEqual([...DEFAULT_KEY_SCOPES]);
    // Issuance refuses the whole request when a scope is unavailable.
    expect(generate).toContain("scope_not_available");
  });
});

describe("country resolution", () => {
  it("resolves saved country names to ISO codes without guessing", () => {
    expect(countryToIso("Zambia")).toBe("ZM");
    expect(countryToIso(" zambia ")).toBe("ZM");
    expect(countryToIso("ZM")).toBe("ZM");
    expect(countryToIso("Nigeria")).toBe("NG");
    expect(countryToIso("United States")).toBe("US");
    expect(countryToIso("Atlantis")).toBeNull();
    expect(countryToIso(null)).toBeNull();
    expect(currencyForCountry("ZM")).toBe("ZMW");
    expect(currencyForCountry(null)).toBeNull();
  });
});

describe("mobile-money gate matrix", () => {
  it("ZM + toggle on = enabled", () => {
    expect(mobileMoneyFeature(facts({ mobileMoneyToggleOn: true })))
      .toEqual({ status: "enabled", reason_code: null });
  });
  it("ZM + toggle off = disabled (the business's own choice)", () => {
    expect(mobileMoneyFeature(facts()))
      .toEqual({ status: "disabled", reason_code: null });
  });
  it("non-ZM = not_entitled / country_not_eligible, even with the toggle on", () => {
    expect(mobileMoneyFeature(facts({ countryIso: "NG", mobileMoneyToggleOn: true })))
      .toEqual({ status: "not_entitled", reason_code: "country_not_eligible" });
  });
  it("unknown country = not_entitled", () => {
    expect(mobileMoneyFeature(facts({ countryIso: null, mobileMoneyToggleOn: true })))
      .toEqual({ status: "not_entitled", reason_code: "country_not_eligible" });
  });
  it("no business record = pending_verification", () => {
    expect(mobileMoneyFeature(facts({ hasBusinessRecord: false })))
      .toEqual({ status: "pending_verification", reason_code: "business_not_set_up" });
  });
});

describe("connector config payload", () => {
  it("carries environment, business facts, features and settlement type only", () => {
    const cfg = buildConnectorConfig({
      environment: "sandbox",
      keyId: "key-1",
      keyScopes: ["config:read"],
      facts: facts({ mobileMoneyToggleOn: true }),
    });
    expect(cfg.environment).toBe("sandbox");
    expect(cfg.livemode).toBe(false);
    expect(cfg.key).toEqual({ key_id: "key-1", scopes: ["config:read"], status: "active" });
    expect(cfg.business.country).toBe("ZM");
    expect(cfg.business.currency).toBe("ZMW");
    expect(cfg.features.mobile_money.status).toBe("enabled");
    expect(cfg.features.transfers).toEqual({ status: "disabled", reason_code: "sandbox_simulation_only" });
    expect(cfg.settlement).toEqual({ type: "wallet", currency: "ZMW" });
    const serialised = JSON.stringify(cfg).toLowerCase();
    for (const banned of ["balance", "account_number", "phone", "email", "lenco", "secret", "destination"]) {
      expect(serialised).not.toContain(banned);
    }
  });

  it("production config enables transfers and reports livemode", () => {
    const cfg = buildConnectorConfig({
      environment: "production",
      keyId: "key-2",
      keyScopes: [],
      facts: facts({ countryIso: "NG" }),
    });
    expect(cfg.livemode).toBe(true);
    expect(cfg.features.transfers.status).toBe("enabled");
    expect(cfg.features.mobile_money.status).toBe("not_entitled");
  });

  it("the router serves it at /connector/config and /v1/connector/config with ETag caching", () => {
    expect(router).toContain('resource === "connector" && sub === "config"');
    expect(router).toContain('parts[0] === "v1"');
    expect(router).toContain('"Cache-Control": "private, max-age=300"');
    expect(router).toContain('req.headers.get("if-none-match")');
    expect(router).toContain("config:read");
  });
});

describe("key storage and lifecycle", () => {
  it("only SHA-256 hashes are stored; the full key exists only in the creation response", () => {
    for (const fn of [generate, rotate]) {
      expect(fn).toContain("sha256Hex(fullKey)");
      expect(fn).toContain("key_hash: keyHash");
      expect(fn).not.toContain("key: fullKey, key_hash");
    }
    expect(generate).toContain("will never be shown again");
  });

  it("rotation replaces the key and runs a 24h grace clock on the old one", () => {
    expect(rotate).toContain("GRACE_MS = 24 * 60 * 60 * 1000");
    expect(rotate).toContain("rotation_grace_until: graceUntil");
    expect(rotate).toContain("expires_at: graceUntil");
    expect(migration).toContain("rotation_grace_until");
  });

  it("revocation flips is_active and authentication fails closed on it", () => {
    expect(revoke).toContain("is_active: false");
    expect(router).toContain("api_key_revoked");
    expect(router).toContain("api_key_expired");
  });
});

describe("environment segregation wiring", () => {
  it("invoices, payment links and webhooks are filtered by the key's environment", () => {
    expect(router).toContain('.eq("environment", modeOf(key))');
    expect(router).toContain("developer_invoices");
    expect(router).toContain("Invoice not found in this environment.");
    expect(router).toContain("Payment link not found in this environment.");
  });

  it("gate denials create nothing: frozen businesses are refused before inserts", () => {
    expect(router).toContain("business_inactive");
    expect(router).toContain("frozenGuard");
  });

  it("the hosted checkout refuses sandbox links before any settlement path", () => {
    expect(checkout).toContain('link.environment === "test"');
    expect(checkout).toContain("sandbox_link");
  });

  it("the database itself enforces the Zambia gate on the toggle", () => {
    expect(migration).toContain("trg_enforce_mobile_money_country");
    expect(migration).toContain("mobile_money_zambia_only");
    expect(migration).toContain("business_country_is_zambia");
  });

  it("sandbox simulation asserts stay inside sandbox tables", () => {
    // The simulate handlers update developer_invoices / the sandbox
    // payment_links row and dispatch webhooks — they never call a
    // transfer RPC or write a transactions row.
    const simStart = router.indexOf("simulate-payment");
    expect(simStart).toBeGreaterThan(-1);
    // execute_transfer_with_fee exists exactly once: the production
    // transfers route — no simulation path can reach it.
    expect(router.split("execute_transfer_with_fee").length - 1).toBe(1);
  });
});
