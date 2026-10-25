// Role visibility (CEO directive 2026-10-25): every role sees only
// its own things and nobody hits an "Access Denied" wall. These tests
// pin (1) the role-home resolution matrix in src/lib/roleVisibility.ts
// — where a signed-in user is quietly redirected when they land on a
// route outside their role — and (2) the wiring: the route guard
// redirects instead of rendering a wall, the business guard admits
// its sibling-gate roles and redirects the rest home, and the menus
// and in-page role links are rendered only for the roles that own
// them.
//
// Presentation only: the database (RLS, in-DB-checked RPCs) and the
// edge functions remain the enforcement layer. Nothing here loosens
// a single backend rule.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_CONSOLE_HOME,
  DEFAULT_ROLE_HOME,
  P2P_CONSOLE_HOME,
  holdsAnyRole,
  isAdminTier,
  roleHomePath,
} from "../../src/lib/roleVisibility";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// ---------------------------------------------------------------------
// roleHomePath — the redirect destination per held roles. The home's
// own gate must always be satisfied by the roles that selected it,
// so a redirect can never bounce.
// ---------------------------------------------------------------------

describe("roleHomePath — every role lands on its own home", () => {
  it("admin tier lands on the admin console home", () => {
    expect(roleHomePath(["admin"])).toBe(ADMIN_CONSOLE_HOME);
    expect(roleHomePath(["super_admin"])).toBe(ADMIN_CONSOLE_HOME);
    expect(roleHomePath(["user", "admin"])).toBe(ADMIN_CONSOLE_HOME);
    expect(roleHomePath(["user", "super_admin"])).toBe(ADMIN_CONSOLE_HOME);
    expect(roleHomePath(["business", "super_admin"])).toBe(ADMIN_CONSOLE_HOME);
  });

  it("staff admin beats the p2p console when both are held", () => {
    expect(roleHomePath(["p2p_admin", "admin"])).toBe(ADMIN_CONSOLE_HOME);
    expect(roleHomePath(["p2p_admin", "super_admin"])).toBe(ADMIN_CONSOLE_HOME);
  });

  it("a lone p2p_admin lands on the P2P console, its own area", () => {
    expect(roleHomePath(["p2p_admin"])).toBe(P2P_CONSOLE_HOME);
    expect(roleHomePath(["user", "p2p_admin"])).toBe(P2P_CONSOLE_HOME);
    expect(roleHomePath(["business", "p2p_admin"])).toBe(P2P_CONSOLE_HOME);
  });

  it("everyone else lands on the dashboard they already get at login", () => {
    expect(roleHomePath(["user"])).toBe(DEFAULT_ROLE_HOME);
    expect(roleHomePath(["business"])).toBe(DEFAULT_ROLE_HOME);
    expect(roleHomePath(["beta_tester"])).toBe(DEFAULT_ROLE_HOME);
    expect(roleHomePath([])).toBe(DEFAULT_ROLE_HOME);
  });

  it("per-feature roles without a console today land on the dashboard", () => {
    // support_admin / compliance_admin / finance_admin own no routes
    // yet — the dashboard is their home until a console exists.
    expect(roleHomePath(["support_admin"])).toBe(DEFAULT_ROLE_HOME);
    expect(roleHomePath(["compliance_admin"])).toBe(DEFAULT_ROLE_HOME);
    expect(roleHomePath(["finance_admin"])).toBe(DEFAULT_ROLE_HOME);
  });

  it("homes are the routes the roles already use", () => {
    expect(ADMIN_CONSOLE_HOME).toBe("/admin/users");
    expect(P2P_CONSOLE_HOME).toBe("/admin/p2p");
    expect(DEFAULT_ROLE_HOME).toBe("/dashboard");
  });
});

describe("holdsAnyRole / isAdminTier", () => {
  it("holdsAnyRole matches on any overlap", () => {
    expect(holdsAnyRole(["user", "business"], ["business", "admin"])).toBe(true);
    expect(holdsAnyRole(["user"], ["admin", "super_admin"])).toBe(false);
    expect(holdsAnyRole([], ["user"])).toBe(false);
    expect(holdsAnyRole(["admin"], [])).toBe(false);
  });

  it("isAdminTier treats super_admin as the admin tier (additive)", () => {
    expect(isAdminTier(["admin"])).toBe(true);
    expect(isAdminTier(["super_admin"])).toBe(true);
    expect(isAdminTier(["user", "super_admin"])).toBe(true);
    expect(isAdminTier(["p2p_admin"])).toBe(false);
    expect(isAdminTier(["business"])).toBe(false);
    expect(isAdminTier([])).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Wiring pins — structural, in the superadminUi.test.ts pattern.
// ---------------------------------------------------------------------

describe("ProtectedRoute — redirect home, never a wall", () => {
  const src = read("../../src/components/ProtectedRoute.tsx");

  it("redirects role mismatches to the user's role home", () => {
    expect(src).toContain("roleHomePath(roles)");
    expect(src).toContain('from "@/lib/roleVisibility"');
  });

  it("no Access Denied wall remains in the route guard", () => {
    expect(src).not.toContain("Access Denied");
    expect(src).not.toContain("restricted to authorized roles");
    expect(src).not.toContain("Request Access");
  });

  it("the subscription feature upsell is untouched (not a role gate)", () => {
    expect(src).toContain("Access Restricted");
    expect(src).toContain("requiredFeature");
  });
});

describe("route gates — AnimatedRoutes still guards every role route", () => {
  const src = read("../../src/components/AnimatedRoutes.tsx");

  it("admin console routes stay behind the admin role gate", () => {
    expect(src).toContain("const ADMIN_ROLES: Role[] = ['admin', 'super_admin']");
    expect(src).toContain("const P2P_ADMIN_ROLES: Role[] = ['admin', 'super_admin', 'p2p_admin']");
    for (const route of [
      "/admin/users", "/admin/transactions", "/admin/p2p", "/admin/identity",
      "/admin/role-requests", "/admin/refunds", "/tier-management",
      "/feedback-dashboard", "/aml-screening", "/audit-logs", "/backup-export",
    ]) {
      expect(src).toContain(`path="${route}"`);
    }
  });
});

describe("BusinessRouteGuard — business + admin tier in, everyone else home", () => {
  const src = read("../../src/components/business/BusinessRouteGuard.tsx");

  it("redirects non-holders to their role home, not the public landing", () => {
    expect(src).toContain("roleHomePath(roles)");
    expect(src).not.toContain('to="/"');
  });

  it("admits the admin tier alongside business (sibling-gate parity)", () => {
    expect(src).toContain("isAdminTier(roles)");
    expect(src).toContain("hasRole('business')");
  });
});

describe("Header — role-owned menu entries are not rendered for others", () => {
  const src = read("../../src/components/Header.tsx");

  it("derives menu visibility from the console gate", () => {
    expect(src).toContain("canViewAdminConsole(roles)");
    expect(src).toContain("showAdminLinks");
    expect(src).toContain("showFraudRules");
  });

  it("admin destinations are behind the visibility flags (desktop + mobile)", () => {
    // tier-management, audit-logs, backup-export each appear twice
    // (desktop account menu + mobile drawer) and every occurrence is
    // gated: the raw link strings only exist inside gated blocks.
    expect(src).toContain("{showAdminLinks && <MobileNavLink to=\"/audit-logs\"");
    expect(src).toContain("{showAdminLinks && <MobileNavLink to=\"/backup-export\"");
    expect(src).toContain("{showAdminLinks && <MobileNavLink to=\"/tier-management\"");
    expect(src).toContain("{showFraudRules && <MobileNavLink to=\"/fraud-rules\"");
    // Desktop dropdown items are wrapped in the same flags.
    const gatedBlocks = src.match(/showAdminLinks &&/g) ?? [];
    expect(gatedBlocks.length).toBeGreaterThanOrEqual(5);
    const fraudGates = src.match(/showFraudRules &&/g) ?? [];
    expect(fraudGates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("in-page role links — rendered only for their roles", () => {
  it("Feedback page shows the console link to the admin tier only", () => {
    const src = read("../../src/pages/Feedback.tsx");
    expect(src).toContain("canViewAdminConsole(roles)");
    expect(src).toContain("showFeedbackConsoleLink &&");
  });

  it("Compliance page hides the AML tab from non-admin roles", () => {
    const src = read("../../src/pages/Compliance.tsx");
    expect(src).toContain("canViewAdminConsole(roles)");
    expect(src).toContain('showAmlTab && <TabsTrigger value="aml">');
  });

  it("FeatureList does not render the admin-only feedback card for others", () => {
    const src = read("../../src/components/FeatureAccess.tsx");
    expect(src).toContain('feature.id !== "feedback_dashboard" || canViewAdminConsole(roles)');
  });
});

describe("super_admin additive — never sees less than an admin", () => {
  it("virtual card tools admit super_admin alongside admin", () => {
    for (const page of ["VirtualCardNew", "VirtualCardDetails", "VirtualCardFund"]) {
      const src = read(`../../src/pages/${page}.tsx`);
      expect(src).toContain('!hasRole("admin") && !hasRole("super_admin")');
    }
  });

  it("security settings cards admit super_admin alongside admin", () => {
    expect(read("../../src/components/SecurityStatus.tsx")).toContain(
      "hasRole('admin') || hasRole('super_admin')",
    );
    expect(read("../../src/components/security/EnhancedSecuritySettings.tsx")).toContain(
      "hasRole('admin') || hasRole('super_admin')",
    );
  });

  it("the role switcher offers the admin dashboard to super_admin-only holders", () => {
    const src = read("../../src/components/RoleSwitcher.tsx");
    expect(src).toContain('roles.includes("super_admin") && !roles.includes("admin")');
  });
});
