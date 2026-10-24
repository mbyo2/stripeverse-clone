// Wave C QA fixes (verified live 2026-10-24):
//   1. /audit-logs errored for everyone — the audit query embedded
//      `profiles:user_id(...)`, but audit_logs has NO FK to profiles,
//      so PostgREST failed every load. Names now merge in a second
//      step (unit-tested below) and the embed is pinned out.
//   2. The account menu's "Role Management" item led to an
//      admin-gated route even though RoleManagement is the
//      self-service role page — the route is now open to every
//      signed-in user.
//   3. /admin, /admin/analytics, /admin/compliance, /admin/disputes,
//      /terms, /privacy 404'd — they now redirect to the real pages.
//   4. /developers hero kept its cream background in dark mode while
//      its text flipped light (white-on-cream). It now follows the
//      landing hero's dark:bg-background pattern.
//   5. /business, /api, /help, /support bounced logged-out visitors
//      to /login despite being public-nav destinations — the routes
//      are public now, with account-specific sections gated inside
//      the pages.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachProfileNames,
  auditActorIds,
} from "../../src/utils/auditLogProfiles";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const routes = read("../../src/components/AnimatedRoutes.tsx");
const auditHook = read("../../src/hooks/useAuditLogs.ts");

// ---------------------------------------------------------------------
// 1. Audit-log actor names: the second-step merge
// ---------------------------------------------------------------------

describe("auditActorIds", () => {
  it("returns the distinct non-null actor ids", () => {
    const logs = [
      { user_id: "u1" },
      { user_id: "u2" },
      { user_id: "u1" },
      { user_id: null },
    ];
    expect(auditActorIds(logs)).toEqual(["u1", "u2"]);
  });

  it("is empty when no log has an actor", () => {
    expect(auditActorIds([{ user_id: null }, { user_id: null }])).toEqual([]);
  });
});

describe("attachProfileNames", () => {
  const profiles = [
    { id: "u1", first_name: "Mabvuto", last_name: "Banda" },
    { id: "u2", first_name: null, last_name: null },
  ];

  it("attaches the matching profile to each log", () => {
    const merged = attachProfileNames(
      [
        { id: "l1", user_id: "u1" },
        { id: "l2", user_id: "u2" },
      ],
      profiles
    );
    expect(merged[0].profiles).toEqual(profiles[0]);
    expect(merged[1].profiles).toEqual(profiles[1]);
    // Original fields are preserved untouched.
    expect(merged[0].id).toBe("l1");
  });

  it("yields null for unknown actors and actor-less logs", () => {
    const merged = attachProfileNames(
      [
        { id: "l1", user_id: "ghost" },
        { id: "l2", user_id: null },
      ],
      profiles
    );
    expect(merged[0].profiles).toBeNull();
    expect(merged[1].profiles).toBeNull();
  });

  it("loads the trail with no names when the profile list is empty", () => {
    const merged = attachProfileNames([{ id: "l1", user_id: "u1" }], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].profiles).toBeNull();
  });
});

describe("audit-logs query shape", () => {
  it("never embeds profiles through the nonexistent FK again", () => {
    expect(auditHook).not.toContain("profiles:user_id");
  });

  it("merges actor names from a separate profiles read", () => {
    expect(auditHook).toContain("attachProfileNames");
    expect(auditHook).toContain(".from('profiles')");
  });
});

// ---------------------------------------------------------------------
// 2 + 3. Routes: role management reachable, natural URLs redirect
// ---------------------------------------------------------------------

describe("role-management route", () => {
  it("is open to every signed-in user, not just admins", () => {
    expect(routes).toContain(
      '<Route path="/role-management" element={<ProtectedPage><RoleManagement /></ProtectedPage>} />'
    );
    expect(routes).not.toContain(
      '<Route path="/role-management" element={<RoleGuardedPage roles={ADMIN_ROLES}>'
    );
  });

  it("the account menu still links to it (now a working destination)", () => {
    const header = read("../../src/components/Header.tsx");
    expect(header).toContain('<Link to="/role-management"');
  });
});

describe("natural-URL redirects", () => {
  const cases: [string, string][] = [
    ["/admin", "/admin/users"],
    ["/admin/analytics", "/analytics"],
    ["/admin/compliance", "/compliance"],
    ["/admin/disputes", "/admin/p2p"],
    ["/terms", "/terms-of-service"],
    ["/privacy", "/privacy-policy"],
  ];

  for (const [from, to] of cases) {
    it(`${from} redirects to ${to}`, () => {
      expect(routes).toContain(
        `<Route path="${from}" element={<Navigate to="${to}" replace />} />`
      );
    });
  }
});

// ---------------------------------------------------------------------
// 5. Public content pages are public; the dashboard stays gated
// ---------------------------------------------------------------------

describe("public content routes", () => {
  it("/business renders without a login or role guard", () => {
    expect(routes).toContain(
      '<Route path="/business" element={<PageTransition><Business /></PageTransition>} />'
    );
  });

  it("/api renders without the business_tools feature gate", () => {
    expect(routes).toContain(
      '<Route path="/api" element={<PageTransition><API /></PageTransition>} />'
    );
    expect(routes).not.toContain('path="/api" element={<ProtectedRoute');
  });

  it("/support and /help render for logged-out visitors", () => {
    expect(routes).toContain(
      '<Route path="/support" element={<PageTransition><Support /></PageTransition>} />'
    );
    expect(routes).toContain(
      '<Route path="/help" element={<PageTransition><Help /></PageTransition>} />'
    );
  });

  it("/business-dashboard stays behind auth + the business guard", () => {
    expect(routes).toContain(
      '<Route path="/business-dashboard" element={\n          <ProtectedRoute><BusinessRouteGuard>'
    );
  });
});

describe("in-page gating for the newly public pages", () => {
  it("Business gates the merchant portal on the business role", () => {
    const business = read("../../src/pages/Business.tsx");
    expect(business).toContain("if (!hasRole('business'))");
    expect(business).toContain("BusinessPublicView");
  });

  it("API shows only the documentation tab when logged out", () => {
    const api = read("../../src/pages/API.tsx");
    expect(api).toContain('defaultValue={user ? "keys" : "docs"}');
    expect(api).toContain('{user && <TabsTrigger value="keys">API Keys</TabsTrigger>}');
    expect(api).toContain('{user && <TabsTrigger value="webhooks">Webhooks</TabsTrigger>}');
  });

  it("Support asks logged-out visitors for name and email", () => {
    const support = read("../../src/pages/Support.tsx");
    expect(support).toContain("Your Name");
    expect(support).toContain("Your Email");
    expect(support).toContain("ticketForm.email");
  });
});

// ---------------------------------------------------------------------
// 4. Developers hero dark mode
// ---------------------------------------------------------------------

describe("developers hero dark mode", () => {
  it("the cream hero band switches to the dark background token", () => {
    const developers = read("../../src/pages/Developers.tsx");
    expect(developers).toContain(
      'className="bg-[#FEF3E2] dark:bg-background border-b border-[#CFD3D8]/70 dark:border-border"'
    );
  });
});
