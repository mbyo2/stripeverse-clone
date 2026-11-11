// Merchant mobile-money rail (CEO decisions 2026-11-09; build
// ordered 2026-11-11). Pins:
//   1. Pure rail rules: Zambian phone normalisation + operator
//      detection, collection-reference charset (the gateway's own
//      idempotency mechanism), provider-status mapping ('pay-offline'
//      is NOT paid), and the platform charge (1%, rounded to the
//      ngwee, recorded separately — the settlement is credited in
//      full and never netted).
//   2. Webhook signature: HMAC-SHA512 keyed by SHA256(the merchant's
//      own API token) — a correctly signed payload verifies, a
//      forged one never does.
//   3. Credential vault: AES-256-GCM round-trip; the saved secret is
//      never recoverable from its last-4 hint.
//   4. Connector config: mobile_money now also reports whether the
//      merchant's own account is connected (additive — the gate
//      matrix itself is unchanged).
//   5. Storage/wiring truth: migration creates the three tables,
//      the exactly-once RPCs, service-role-only function grants, the
//      merchant-read policies, and the requery cron; the collect and
//      checkout paths re-check the Zambia gate server-side; the
//      webhook refuses unverifiable traffic with 401.
//   6. WHITE-LABEL: the rail's name appears in NO frontend source,
//      and in the new edge functions only inside the gateway base
//      URL and the signature header name (protocol positions a user
//      never sees).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  detectOperator,
  generateCollectionReference,
  isValidCollectionReference,
  isValidZmPhone,
  mapProviderStatus,
  normalizeZmPhone,
  platformChargeFor,
  railBaseUrl,
  signatureMatches,
  verifyWebhookSignature,
  webhookSignatureFor,
} from "../../supabase/functions/_shared/momo-rail";
import {
  decryptSecret,
  encryptSecret,
  secretHint,
} from "../../supabase/functions/_shared/secret-vault";
import {
  buildConnectorConfig,
  type BusinessFacts,
} from "../../supabase/functions/_shared/connector-config";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("phone + operator rules", () => {
  it("normalises Zambian numbers to the local 0 format", () => {
    expect(normalizeZmPhone("+260 961 111 111")).toBe("0961111111");
    expect(normalizeZmPhone("260971111111")).toBe("0971111111");
    expect(normalizeZmPhone("0971-111-111")).toBe("0971111111");
    expect(normalizeZmPhone("0955111111")).toBe("0955111111");
  });
  it("validates Zambian numbers", () => {
    expect(isValidZmPhone("0961111111")).toBe(true);
    expect(isValidZmPhone("+260 97 111 1111")).toBe(true);
    expect(isValidZmPhone("12345")).toBe(false);
    // Shape alone passes for unknown prefixes; the operator check is
    // what refuses them on the money paths.
    expect(isValidZmPhone("0811111111")).toBe(true);
    expect(detectOperator("0811111111")).toBe(null);
  });
  it("detects the operator from the prefix", () => {
    expect(detectOperator("0961111111")).toBe("mtn");
    expect(detectOperator("0761111111")).toBe("mtn");
    expect(detectOperator("0971111111")).toBe("airtel");
    expect(detectOperator("0771111111")).toBe("airtel");
    expect(detectOperator("0951111111")).toBe("zamtel");
    expect(detectOperator("+260961111111")).toBe("mtn");
    expect(detectOperator("0991111111")).toBe(null);
  });
});

describe("references + status mapping", () => {
  it("generates gateway-legal references", () => {
    for (let i = 0; i < 50; i++) {
      const ref = generateCollectionReference(Date.now() + i, Math.random());
      expect(isValidCollectionReference(ref)).toBe(true);
      expect(ref).toMatch(/^BMG-/);
    }
    expect(isValidCollectionReference("has space")).toBe(false);
    expect(isValidCollectionReference("short")).toBe(false);
  });
  it("maps provider statuses — pay-offline is still pending", () => {
    expect(mapProviderStatus("successful")).toBe("successful");
    expect(mapProviderStatus("failed")).toBe("failed");
    expect(mapProviderStatus("pay-offline")).toBe("pending");
    expect(mapProviderStatus("pending")).toBe("pending");
    expect(mapProviderStatus("")).toBe("pending");
    expect(mapProviderStatus(null)).toBe("pending");
  });
  it("routes environments to the right gateway host", () => {
    expect(railBaseUrl("sandbox")).toContain("sandbox");
    expect(railBaseUrl("production")).not.toContain("sandbox");
    expect(railBaseUrl("production", "https://example.test/v2/")).toBe("https://example.test/v2");
    expect(railBaseUrl("production", "http://insecure.test")).not.toContain("insecure");
  });
});

describe("the platform charge — 1%, separate, never netted", () => {
  it("computes 1% rounded to the ngwee", () => {
    expect(platformChargeFor(10)).toBe(0.1);
    expect(platformChargeFor(100)).toBe(1);
    expect(platformChargeFor(33.33)).toBe(0.33);
    expect(platformChargeFor(0)).toBe(0);
    expect(platformChargeFor(-5)).toBe(0);
  });
  it("is recorded by the settle RPC, not deducted from the credit", () => {
    const migration = read("supabase/migrations/20261259_mobile_money_rail.sql");
    expect(migration).toContain("momo_platform_charges");
    // Credit first, in full…
    expect(migration).toMatch(/SET balance = balance \+ v_collection\.amount/);
    // …charge second, as its own row.
    expect(migration).toContain("round(v_collection.amount * 0.01, 2)");
  });
});

describe("webhook signature — HMAC-SHA512 keyed by SHA256(token)", () => {
  const body = JSON.stringify({ event: "collection.successful", data: { reference: "BMG-TEST-1" } });
  const token = "merchant-secret-token-0123456789abcdef";
  it("verifies a correctly signed payload", async () => {
    const sig = await webhookSignatureFor(body, token);
    expect(await verifyWebhookSignature(body, token, sig)).toBe(true);
    expect(signatureMatches(sig, sig)).toBe(true);
  });
  it("rejects forgeries, tampering and other merchants' keys", async () => {
    const sig = await webhookSignatureFor(body, token);
    expect(await verifyWebhookSignature(body, token, "0".repeat(128))).toBe(false);
    expect(await verifyWebhookSignature(body + " ", token, sig)).toBe(false);
    expect(await verifyWebhookSignature(body, "another-merchants-token-9876543210", sig)).toBe(false);
    expect(await verifyWebhookSignature(body, token, null)).toBe(false);
    expect(await verifyWebhookSignature(body, token, "")).toBe(false);
  });
});

describe("credential vault", () => {
  const key = Buffer.from(new Uint8Array(32).map((_, i) => i + 1)).toString("base64");
  it("round-trips a secret and never leaks it into the hint", async () => {
    const secret = "sk-live-merchant-secret-abcdef123456";
    const env = await encryptSecret(secret, key);
    expect(env.ciphertext).not.toContain(secret);
    expect(await decryptSecret(env, key)).toBe(secret);
    expect(secretHint(secret)).toBe("3456");
    expect(secretHint(secret)).not.toContain(secret.slice(0, 12));
  });
  it("uses a fresh IV per encryption", async () => {
    const a = await encryptSecret("same-secret-value-123456", key);
    const b = await encryptSecret("same-secret-value-123456", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe("connector config exposure", () => {
  const facts = (over: Partial<BusinessFacts>): BusinessFacts => ({
    hasBusinessRecord: true,
    displayName: "QA Store",
    countryIso: "ZM",
    businessStatus: "active",
    frozen: false,
    mobileMoneyToggleOn: true,
    ...over,
  });
  it("reports connected state additively; the gate matrix is unchanged", () => {
    const on = buildConnectorConfig({
      environment: "production", keyId: "k1", keyScopes: ["config:read"],
      facts: facts({ mobileMoneyConnected: true }),
    });
    expect(on.features.mobile_money.status).toBe("enabled");
    expect(on.features.mobile_money.connected).toBe(true);
    const off = buildConnectorConfig({
      environment: "production", keyId: "k1", keyScopes: ["config:read"],
      facts: facts({}),
    });
    expect(off.features.mobile_money.status).toBe("enabled");
    expect(off.features.mobile_money.connected).toBe(false);
    const ke = buildConnectorConfig({
      environment: "production", keyId: "k1", keyScopes: ["config:read"],
      facts: facts({ countryIso: "KE", mobileMoneyConnected: true }),
    });
    expect(ke.features.mobile_money.status).toBe("not_entitled");
  });
});

describe("storage + wiring truth", () => {
  const migration = read("supabase/migrations/20261259_mobile_money_rail.sql");
  it("creates the three tables with merchant-read RLS on the ledger", () => {
    expect(migration).toContain("merchant_momo_connections");
    expect(migration).toContain("momo_collections");
    expect(migration).toContain("momo_platform_charges");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain('CREATE POLICY "Merchants view own mobile money collections"');
    expect(migration).toContain('CREATE POLICY "Merchants view own mobile money charges"');
    expect(migration).toContain("GRANT SELECT ON public.momo_collections TO authenticated");
    // The connections table is service-role only — no authenticated grant.
    expect(migration).not.toMatch(/GRANT[^;]*ON public\.merchant_momo_connections TO authenticated/);
  });
  it("settles exactly once: row lock, terminal guard, amount match", () => {
    expect(migration).toContain("begin_momo_collection");
    expect(migration).toContain("settle_momo_collection");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("already_terminal");
    expect(migration).toContain("amount_mismatch");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("#variable_conflict use_column");
  });
  it("keeps the RPCs service-role only and schedules the poller", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.begin_momo_collection[^;]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.settle_momo_collection[^;]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toContain("cron.schedule(");
    expect(migration).toContain("'momo-requery'");
    expect(migration).toContain("momo-requery");
  });
  it("re-checks the Zambia gate server-side on the money paths", () => {
    const collect = read("supabase/functions/momo-collections/index.ts");
    expect(collect).toContain("countryToIso");
    expect(collect).toContain('"ZM"');
    expect(collect).toContain("mobile_money_enabled");
    const checkout = read("supabase/functions/payment-link-checkout/index.ts");
    expect(checkout).toContain("mobile_money_available");
    expect(checkout).toContain("momo_create");
    expect(checkout).toContain("momo_status");
    const settings = read("supabase/functions/momo-settings/index.ts");
    expect(settings).toContain("validateRailCredential");
    expect(settings).toContain("encryptSecret");
  });
  it("webhook refuses the unverifiable with 401 and settles from a requery", () => {
    const hook = read("supabase/functions/momo-webhook/index.ts");
    expect(hook).toContain("verifyWebhookSignature");
    expect(hook).toContain("401");
    expect(hook).toContain("refreshCollectionFromRail");
  });
  it("merchant + checkout UI are wired", () => {
    const business = read("src/pages/Business.tsx");
    expect(business).toContain("MobileMoneySettings");
    const page = read("src/pages/PublicCheckout.tsx");
    expect(page).toContain("mobile_money_available");
    expect(page).toContain("MobileMoneyLinkPayment");
    const panel = read("src/components/payments/MobileMoneyLinkPayment.tsx");
    expect(panel).toContain("momo_create");
    expect(panel).toContain("momo_status");
  });
});

describe("white-label: the rail's name is never user-visible", () => {
  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (/\.(ts|tsx)$/.test(entry)) yield p;
    }
  }
  it("appears nowhere in the frontend source", () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      if (/lenco/i.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
  it("appears in the new edge functions only in protocol positions", () => {
    const files = [
      "supabase/functions/_shared/momo-rail.ts",
      "supabase/functions/_shared/momo-rail-server.ts",
      "supabase/functions/momo-settings/index.ts",
      "supabase/functions/momo-collections/index.ts",
      "supabase/functions/momo-webhook/index.ts",
      "supabase/functions/momo-requery/index.ts",
      "supabase/functions/payment-link-checkout/index.ts",
    ];
    for (const f of files) {
      for (const line of read(f).split("\n")) {
        if (/lenco/i.test(line)) {
          // Protocol positions only: the gateway host, the signature
          // header name, and the gateway's own payload field name —
          // none of these ever reach a user-visible string.
          expect(line, `${f}: ${line.trim()}`).toMatch(/lenco\.co|x-lenco-signature|lencoReference/);
        }
      }
    }
  });
  it("the exported customer/merchant messages are rail-free", async () => {
    const rail = await import("../../supabase/functions/_shared/momo-rail");
    for (const value of Object.values(rail)) {
      if (typeof value === "string") expect(value.toLowerCase()).not.toContain("lenco");
    }
    expect(rail.MOMO_NOT_CONFIGURED_MESSAGE).toContain("Mobile money");
    expect(rail.MOMO_PENDING_MESSAGE).toContain("phone");
  });
});
