// Pins for workstream E (security audit 2026-11-15) — AI-adjacent abuse
// and rate-limit fixes.
//
// Live-proven before the fix (bounded probes, QA users only):
//   - generate-api-key: 25 keys minted in 34s, 0x429, no cap.
//   - verify-totp: 12/12 wrong guesses in ~4s, 0x429, no lockout; the
//     ±1 time-window check was dead code; attempted/valid codes were
//     written to the audit log.
//   - developer-api: 30/30 invalid-key calls in 27s, 0x429 (the
//     per-key 600/hr limiter only sees authenticated calls).
//   - webhook test delivery: 8/8 in 15s, 0x429, and each delivery
//     fanned out to EVERY active endpoint (spam cannon); webhook
//     registrations were uncapped.
//   - paypal-webhook / transaction-webhook / mobile-money-callback /
//     momo-webhook / Doc lenco-webhook: 10/10 invalid-signature
//     deliveries, 0x429.
// Edge-function pins assert on the deployed source (the functions run
// on Deno, so behaviour is pinned by source contract + the live
// behaviour probes in the mission report, not by importing them).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const fn = (p: string) => read(`supabase/functions/${p}`);

describe("workstream E — key minting", () => {
  it("generate-api-key rate-limits mints and caps active keys", () => {
    const src = fn("generate-api-key/index.ts");
    expect(src).toContain('"generate_api_key"');
    expect(src).toContain("withinLimit(");
    expect(src).toContain("MAX_ACTIVE_KEYS_PER_USER");
    expect(src).toContain("key_limit_reached");
    expect(src).toContain("429");
  });
});

describe("workstream E — TOTP guessing", () => {
  it("verify-totp rate-limits attempts per user", () => {
    const src = fn("verify-totp/index.ts");
    expect(src).toContain('"verify_totp"');
    expect(src).toContain("withinLimit(");
    expect(src).toContain("429");
  });

  it("verify-totp genuinely checks the ±1 time windows", () => {
    const src = fn("verify-totp/index.ts");
    expect(src).toContain("totpAt(");
    expect(src).toContain("currentTime + i");
    // The old dead-code call recomputed the current counter every time.
    expect(src).not.toMatch(/for \(let i = -1; i <= 1; i\+\+\) \{\s*\n\s*const timeStep = currentTime \+ i;\s*\n\s*const expectedToken = await totp\(/);
  });

  it("verify-totp never logs token values", () => {
    const src = fn("verify-totp/index.ts");
    expect(src).not.toContain("token_used");
    expect(src).not.toContain("token_attempted");
  });
});

describe("workstream E — developer API auth + webhooks", () => {
  it("developer-api throttles failed key authentications per IP", () => {
    const src = fn("developer-api/index.ts");
    expect(src).toContain("developer_api_auth_fail");
    expect(src).toContain("authFail(");
    expect(src).toContain("check_advanced_rate_limit");
  });

  it("developer-api caps webhook registrations per user", () => {
    const src = fn("developer-api/index.ts");
    expect(src).toContain("webhook_limit_reached");
    expect(src).toContain('eq("is_active", true)');
  });

  it("developer-api test deliveries are rate-limited and single-target", () => {
    const src = fn("developer-api/index.ts");
    expect(src).toContain('"webhook_test"');
    expect(src).toContain("withinLimit(");
    expect(src).toContain("modeOf(key), sub)");
    const shared = fn("_shared/developer-webhooks.ts");
    expect(shared).toContain("onlyWebhookId");
  });
});

describe("workstream E — inbound webhook floods", () => {
  it("every public provider webhook enforces a per-IP limit", () => {
    for (const f of [
      "paypal-webhook/index.ts",
      "transaction-webhook/index.ts",
      "mobile-money-callback/index.ts",
      "momo-webhook/index.ts",
    ]) {
      const src = fn(f);
      expect(src).toContain("ipRateLimitResponse");
    }
  });

  it("the shared limiter is fail-open and IP-aware", () => {
    const src = fn("_shared/rate-limit.ts");
    expect(src).toContain("check_advanced_rate_limit");
    expect(src).toContain("clientIp");
    expect(src).toContain("x-forwarded-for");
    expect(src).toContain("data !== false");
  });
});
