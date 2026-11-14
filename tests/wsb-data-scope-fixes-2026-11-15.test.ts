// WSB security audit 2026-11-15 (Workstream B: Data, RLS & grants).
// Live-proven before the fix, then re-probed after (probe ids B11/E13/E17/
// E19 in workspace/audit-wsb/probes/):
//  - calculate_merchant_fee returned a merchant's fee for an arbitrary
//    user_id to anon / any authenticated caller.
//  - sub_account_cap returned another user's tier cap (3 = free tier).
//  - Direct PostgREST INSERT into api_keys minted a live key with arbitrary
//    scopes (incl. "bogus:scope") and the key authenticated at
//    developer-api, bypassing the live generate-api-key allowlist.
// Source pins: the migration is the fix; these assertions keep a later
// migration from silently dropping the guards.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const sql = fs.readFileSync(
  path.resolve(here, "../supabase/migrations/20261269_wsb_data_scope_fixes.sql"),
  "utf8",
);

describe("WSB 2026-11-15 · merchant fee reads are self-or-admin", () => {
  it("calculate_merchant_fee refuses other merchants for non-admins", () => {
    // The migration escapes apostrophes (merchant''s / user''s) inside SQL
    // string literals, so assert on the apostrophe-free prefixes.
    expect(sql).toContain("Not authorized to read another merchant");
    expect(sql).toContain("p_user_id IS DISTINCT FROM auth.uid()");
    expect(sql).toContain("has_role(auth.uid(), 'admin'::public.app_role)");
  });

  it("sub_account_cap carries the same scoping", () => {
    expect(sql).toContain("Not authorized to read another user");
  });

  it("both keep the service-role path", () => {
    const occurrences = sql.split("COALESCE(auth.role(), '') <> 'service_role'").length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("WSB 2026-11-15 · API-key scopes are enforced in the database", () => {
  it("restores client INSERT (the mint edge fn inserts as authenticated) and pins the allowlist in a trigger", () => {
    expect(sql).toContain("GRANT INSERT ON public.api_keys TO authenticated");
    expect(sql).toContain("enforce_api_key_scope_allowlist");
    expect(sql).toContain("CREATE TRIGGER trg_api_key_scope_allowlist");
    expect(sql).toContain("'wallets:read', 'transactions:read'");
    expect(sql).toContain("'transfers:write', 'bitcoin:read'");
    expect(sql).toContain("'webhooks:read', 'webhooks:write'");
  });

  it("only blocks scope changes, so legacy keys keep working and stay revocable", () => {
    expect(sql).toContain("NEW.scopes IS DISTINCT FROM OLD.scopes");
  });
});
