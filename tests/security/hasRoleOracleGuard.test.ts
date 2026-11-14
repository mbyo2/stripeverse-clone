// Workstream A (auth & session audit, 2026-11-15) — role-oracle pins.
//
// Proven live before the fix (anon key only):
//   POST /rest/v1/rpc/has_role {"user_id": "<super_admin id>", "required_role": "super_admin"} -> true
//   POST /rest/v1/rpc/has_role {"user_id": "<random uuid>", "required_role": "super_admin"} -> false
// has_role answered about ANY user id. The oracle closes inside the
// function (migration 20261269): a caller may only ask about themselves,
// unless admin/super_admin or trusted server context (service_role /
// no JWT). The anon/authenticated EXECUTE grants stay on purpose: RLS
// policies evaluated for anon callers need them.
//
// Also pins the validate-card-access fix from the same audit: the
// log_card_access_attempt RPC is EXECUTE-granted to service_role only,
// so calling it through the user-scoped client (which forwards the
// caller's JWT) 42501'd for EVERY user and the control never ran --
// every call 500'd. The function must use the service-role client for
// that RPC (the user id still comes from the verified JWT, never the body).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const fn = (p: string) => read(`supabase/functions/${p}`);

const MIGRATION = "supabase/migrations/20261269_has_role_oracle_guard.sql";

describe("has_role oracle guard (workstream A)", () => {
  it("the guard migration exists and rewrites has_role", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.has_role(user_id uuid, required_role app_role)");
  });

  it("a caller asking about someone else gets the answer about themselves", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("WHEN auth.uid() = user_id THEN user_id");
    expect(sql).toContain("ELSE auth.uid()");
  });

  it("platform admins and trusted server context keep cross-user checks", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("public.is_service_role()");
    expect(sql).toContain("auth.jwt() IS NULL");
    expect(sql).toContain("'admin'::app_role, 'super_admin'::app_role");
  });

  it("the EXECUTE grants are kept (policies evaluated as anon need them)", () => {
    const sql = read(MIGRATION);
    expect(sql).not.toMatch(/REVOKE EXECUTE ON FUNCTION public\.has_role/);
  });

  it("the guard is PL/pgSQL with the subject resolved outside any query", () => {
    // A LANGUAGE sql version referenced the bare parameter `user_id`
    // inside a query over user_roles, where the name resolves to the
    // COLUMN -- the guard then degenerated to "does ANYONE hold this
    // role" for admin/service_role callers and silently opened
    // requireAdmin to every authenticated user (proven live 2026-11-15).
    const sql = read(MIGRATION);
    expect(sql).toContain("LANGUAGE plpgsql");
    expect(sql).toContain("v_target :=");
    expect(sql).toContain("ur.user_id = v_target");
  });
});

describe("security-maintenance calls its RPCs as service role", () => {
  it("uses getServiceRoleClient for the service_role-only RPCs", () => {
    const src = fn("security-maintenance/index.ts");
    expect(src).toContain("getServiceRoleClient");
    expect(src).toContain("const supabase = getServiceRoleClient();");
    expect(src).toContain("supabase.rpc('run_security_maintenance')");
    expect(src).toContain("supabase.rpc('enforce_session_security')");
    expect(src).not.toContain("getSupabaseClient(req)");
  });
});

describe("validate-card-access calls the audit RPC as service role", () => {
  it("uses getServiceRoleClient for log_card_access_attempt", () => {
    const src = fn("validate-card-access/index.ts");
    expect(src).toContain("getServiceRoleClient");
    expect(src).toContain("service.rpc(");
    expect(src).toContain("'log_card_access_attempt'");
  });

  it("does not call the service_role-only RPC through the user client", () => {
    const src = fn("validate-card-access/index.ts");
    expect(src).not.toContain("supabase.rpc(\n      'log_card_access_attempt'");
  });

  it("the user id for the audit still comes from the verified JWT", () => {
    const src = fn("validate-card-access/index.ts");
    expect(src).toContain("await supabase.auth.getUser(authToken)");
    expect(src).toContain("p_user_id: user.id");
  });
});
