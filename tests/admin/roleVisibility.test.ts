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
  adminDashboardVisibility,
  headerMenuVisibility,
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

// ---------------------------------------------------------------------
// headerMenuVisibility — the Header's role-owned entries, as reshaped
// by the CEO's 2026-11-21 order: the console lives in the main nav as
// an Admin category (admin tier) and a Superadmin category
// (super_admin ONLY — absent for plain admins), while the account
// menus keep Subscription (admin tier) and Fraud Rules (business OR
// admin tier — the /fraud-rules route gate admits both, so the menu
// must too; a super_admin-only holder owns no business row and must
// not lose the entry). Audit Logs and Backup & Export moved out of
// the account menus into the two categories; Backup & Export's
// super_admin-only rule (2026-11-19 split) is unchanged, now carried
// by the superadminCategory gate instead of its own flag.
// ---------------------------------------------------------------------

describe("headerMenuVisibility — each role sees its own categories and entries", () => {
  it("admin tier sees the Admin category but NOT the Superadmin category", () => {
    for (const roles of [["admin"], ["user", "admin"], ["business", "admin"]]) {
      expect(headerMenuVisibility(roles)).toEqual({ adminLinks: true, adminCategory: true, superadminCategory: false, fraudRules: true });
    }
  });

  it("super_admin sees BOTH categories without holding business or admin", () => {
    // The owner case: super_admin is additive over admin (so the
    // Admin category renders too), and the Fraud Rules entry must
    // not depend on a business role row.
    expect(headerMenuVisibility(["super_admin"])).toEqual({ adminLinks: true, adminCategory: true, superadminCategory: true, fraudRules: true });
    expect(headerMenuVisibility(["user", "super_admin"])).toEqual({ adminLinks: true, adminCategory: true, superadminCategory: true, fraudRules: true });
    expect(headerMenuVisibility(["admin", "super_admin"])).toEqual({ adminLinks: true, adminCategory: true, superadminCategory: true, fraudRules: true });
  });

  it("the Superadmin category follows super_admin alone, never the admin tier", () => {
    expect(headerMenuVisibility(["admin"]).superadminCategory).toBe(false);
    expect(headerMenuVisibility(["admin", "business"]).superadminCategory).toBe(false);
    expect(headerMenuVisibility(["super_admin"]).superadminCategory).toBe(true);
  });

  it("the Admin category follows the admin tier (admin OR super_admin)", () => {
    expect(headerMenuVisibility(["admin"]).adminCategory).toBe(true);
    expect(headerMenuVisibility(["super_admin"]).adminCategory).toBe(true);
    expect(headerMenuVisibility(["user"]).adminCategory).toBe(false);
    expect(headerMenuVisibility(["business"]).adminCategory).toBe(false);
    expect(headerMenuVisibility(["p2p_admin"]).adminCategory).toBe(false);
  });

  it("plain user sees neither category and none of the entries", () => {
    expect(headerMenuVisibility(["user"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
    expect(headerMenuVisibility([])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
  });

  it("business sees Fraud Rules but neither category nor the admin entries", () => {
    expect(headerMenuVisibility(["business"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: true });
    expect(headerMenuVisibility(["user", "business"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: true });
  });

  it("roles without a stake in either surface see none of the entries", () => {
    expect(headerMenuVisibility(["beta_tester"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
    expect(headerMenuVisibility(["user", "p2p_admin"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
    expect(headerMenuVisibility(["support_admin"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
    expect(headerMenuVisibility(["compliance_admin"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
    expect(headerMenuVisibility(["finance_admin"])).toEqual({ adminLinks: false, adminCategory: false, superadminCategory: false, fraudRules: false });
  });
});

// ---------------------------------------------------------------------
// adminDashboardVisibility — the Admin Dashboard's two role-owned
// treasury surfaces: the Treasury & Reports action card and the
// "Treasury" TAB (AdminTreasuryConfig, the payout-treasury Safe
// configuration). The card's route gate names ['super_admin']
// alone and the treasury_* RPCs enforce the same gate server-side;
// the tab's table (crypto_treasury_config) RLS was raised to
// super_admin by migration 20261240. Neither surface may even be
// SHOWN to a plain admin (CEO orders 2026-10-27 — least
// privilege). Every other card and tab targets a route that
// admits the dashboard's whole admin-tier audience. The two flags
// are pinned separately so each surface's rule stands on its own.
// ---------------------------------------------------------------------

describe("adminDashboardVisibility — both Treasury surfaces are super_admin-only", () => {
  it("super_admin holders see the Treasury card AND the Treasury tab", () => {
    expect(adminDashboardVisibility(["super_admin"])).toEqual({ treasuryConsole: true, treasuryTab: true, platformSettings: true, roleManagement: true, roleRequests: true, crossBorderPayouts: true, receivingAccounts: true, moonpay: true, forensics: true });
    expect(adminDashboardVisibility(["user", "super_admin"])).toEqual({ treasuryConsole: true, treasuryTab: true, platformSettings: true, roleManagement: true, roleRequests: true, crossBorderPayouts: true, receivingAccounts: true, moonpay: true, forensics: true });
    expect(adminDashboardVisibility(["admin", "super_admin"])).toEqual({ treasuryConsole: true, treasuryTab: true, platformSettings: true, roleManagement: true, roleRequests: true, crossBorderPayouts: true, receivingAccounts: true, moonpay: true, forensics: true });
    expect(adminDashboardVisibility(["business", "super_admin"])).toEqual({ treasuryConsole: true, treasuryTab: true, platformSettings: true, roleManagement: true, roleRequests: true, crossBorderPayouts: true, receivingAccounts: true, moonpay: true, forensics: true });
  });

  it("a plain admin sees NEITHER the Treasury card NOR the Treasury tab", () => {
    expect(adminDashboardVisibility(["admin"])).toEqual({ treasuryConsole: false, treasuryTab: false, platformSettings: false, roleManagement: false, roleRequests: false, crossBorderPayouts: false, receivingAccounts: false, moonpay: false, forensics: false });
    expect(adminDashboardVisibility(["user", "admin"])).toEqual({ treasuryConsole: false, treasuryTab: false, platformSettings: false, roleManagement: false, roleRequests: false, crossBorderPayouts: false, receivingAccounts: false, moonpay: false, forensics: false });
    expect(adminDashboardVisibility(["business", "admin"])).toEqual({ treasuryConsole: false, treasuryTab: false, platformSettings: false, roleManagement: false, roleRequests: false, crossBorderPayouts: false, receivingAccounts: false, moonpay: false, forensics: false });
  });

  it("no other role sees either Treasury surface", () => {
    for (const roles of [
      ["user"], ["business"], ["p2p_admin"], ["beta_tester"],
      ["support_admin"], ["compliance_admin"], ["finance_admin"], [],
    ]) {
      expect(adminDashboardVisibility(roles)).toEqual({ treasuryConsole: false, treasuryTab: false, platformSettings: false, roleManagement: false, roleRequests: false, crossBorderPayouts: false, receivingAccounts: false, moonpay: false, forensics: false });
    }
  });

  it("the five governance cards follow super_admin alone (2026-11-19 role split)", () => {
    for (const flag of ["roleManagement", "roleRequests", "crossBorderPayouts", "receivingAccounts", "moonpay", "forensics"] as const) {
      expect(adminDashboardVisibility(["admin"])[flag]).toBe(false);
      expect(adminDashboardVisibility(["user", "admin"])[flag]).toBe(false);
      expect(adminDashboardVisibility(["super_admin"])[flag]).toBe(true);
      expect(adminDashboardVisibility(["user"])[flag]).toBe(false);
    }
  });

  it("the tab flag follows super_admin alone, never the admin tier", () => {
    // The pre-20261240 data gate admitted the whole admin tier;
    // the visibility flag must not quietly keep that wider rule.
    expect(adminDashboardVisibility(["admin"]).treasuryTab).toBe(false);
    expect(adminDashboardVisibility(["admin", "business"]).treasuryTab).toBe(false);
    expect(adminDashboardVisibility(["super_admin"]).treasuryTab).toBe(true);
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

  it("derives menu visibility from the roleVisibility menu model", () => {
    expect(src).toContain("headerMenuVisibility(roles)");
    expect(src).toContain("showAdminLinks");
    expect(src).toContain("showAdminCategory");
    expect(src).toContain("showSuperadminCategory");
    expect(src).toContain("showFraudRules");
    expect(src).toContain("const showAdminCategory = menuVisibility.adminCategory;");
    expect(src).toContain("const showSuperadminCategory = menuVisibility.superadminCategory;");
  });

  it("the two nav categories are behind their own flags (desktop + mobile)", () => {
    // Each category renders exactly twice — the desktop dropdown and
    // the mobile drawer section — and every render is gated by its
    // own model flag, so a plain user gets neither and a plain admin
    // never gets the Superadmin category at all.
    const adminGates = src.match(/\{showAdminCategory &&/g) ?? [];
    expect(adminGates.length).toBe(2);
    const superGates = src.match(/showSuperadminCategory &&/g) ?? [];
    expect(superGates.length).toBe(2);
    // The account menus keep only Subscription behind adminLinks
    // (desktop dropdown + mobile drawer): Audit Logs and Backup &
    // Export moved into the categories (2026-11-21), so the old
    // account-menu occurrences are gone for good.
    const gatedBlocks = src.match(/showAdminLinks &&/g) ?? [];
    expect(gatedBlocks.length).toBe(2);
    expect(src).toContain("{showAdminLinks && <MobileNavLink to=\"/tier-management\"");
    expect(src).toContain("{showFraudRules && <MobileNavLink to=\"/fraud-rules\"");
    expect(src).not.toContain("{showAdminLinks && <MobileNavLink to=\"/audit-logs\"");
    expect(src).not.toContain("showBackupExport");
    expect(src).not.toContain("menuVisibility.backupExport");
  });

  it("Fraud Rules sits with the other role-owned entries in BOTH account menus", () => {
    // Four /fraud-rules links in the Header: the desktop Business
    // dropdown, the desktop account menu, and the mobile drawer's
    // Business and Account sections — each behind showFraudRules,
    // so the entry renders for exactly the roles its route admits
    // (business OR admin tier) in every menu path.
    const fraudLinks = src.match(/to="\/fraud-rules"/g) ?? [];
    expect(fraudLinks.length).toBe(4);
    const fraudGates = src.match(/showFraudRules &&/g) ?? [];
    expect(fraudGates.length).toBe(4);
    // In the desktop account menu (which starts at the signed-in
    // identity block), Fraud Rules follows Role Management and
    // precedes Help & Support — and the consolidated Audit Logs /
    // Backup & Export entries no longer appear there at all.
    const accountMenuStart = src.indexOf("Signed-in identity (CEO order 2026-11-21)");
    expect(accountMenuStart).toBeGreaterThan(-1);
    const accountMenuEnd = src.indexOf("{/* Mobile Menu */}", accountMenuStart);
    expect(accountMenuEnd).toBeGreaterThan(accountMenuStart);
    const accountMenu = src.slice(accountMenuStart, accountMenuEnd);
    expect(accountMenu.indexOf('to="/role-management"')).toBeGreaterThan(-1);
    expect(accountMenu.indexOf('to="/fraud-rules"')).toBeGreaterThan(
      accountMenu.indexOf('to="/role-management"'),
    );
    expect(accountMenu.indexOf('to="/fraud-rules"')).toBeLessThan(
      accountMenu.indexOf('to="/support"'),
    );
    expect(accountMenu).not.toContain('to="/audit-logs"');
    expect(accountMenu).not.toContain('to="/backup-export"');
  });
});

describe("AdminDashboard — the Treasury card is not rendered for non-super_admin", () => {
  const src = read("../../src/pages/AdminDashboard.tsx");

  it("derives card visibility from the roleVisibility model and the roles context", () => {
    expect(src).toContain("adminDashboardVisibility(roles)");
    expect(src).toContain('from "@/lib/roleVisibility"');
    expect(src).toContain("useRoles()");
    expect(src).toContain('from "@/contexts/RoleContext"');
  });

  it("marks the Treasury & Reports card super_admin-only and renders only visible cards", () => {
    expect(src).toContain('title: "Treasury & Reports"');
    expect(src).toContain('link: "/admin/treasury"');
    expect(src).toContain('gate: "treasuryConsole"');
    expect(src).toContain("visibleAdminActions");
    expect(src).toContain("dashboardVisibility.treasuryConsole");
    expect(src).toContain("{visibleAdminActions.map((action) => (");
    expect(src).not.toContain("{adminActions.map((action) => (");
  });

  it("the /admin/treasury route gate itself stays super_admin-only", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain(
      'path="/admin/treasury" element={<RoleGuardedPage roles={[\'super_admin\']}>',
    );
  });

  it("marks the Platform Settings card super_admin-only on its own model flag", () => {
    expect(src).toContain('title: "Platform Settings"');
    expect(src).toContain('link: "/admin/settings"');
    expect(src).toContain('gate: "platformSettings"');
    expect(src).toContain("dashboardVisibility.platformSettings");
  });

  it("marks the five governance cards super_admin-only, each on its own flag (2026-11-19 split)", () => {
    for (const [title, link, gate] of [
      ["Role Management", "/role-management", "roleManagement"],
      ["Role Requests", "/admin/role-requests", "roleRequests"],
      ["Cross-Border Payouts", "/admin/mastercard-move", "crossBorderPayouts"],
      ["Receiving Accounts", "/admin/receiving-accounts", "receivingAccounts"],
      ["MoonPay", "/admin/moonpay", "moonpay"],
    ] as const) {
      expect(src).toContain(`title: "${title}"`);
      expect(src).toContain(`link: "${link}"`);
      expect(src).toContain(`gate: "${gate}"`);
      expect(src).toContain(`dashboardVisibility.${gate}`);
    }
  });

  it("the five governance routes are super_admin-only at the route gate too", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    for (const route of [
      "/admin/role-requests", "/admin/receiving-accounts",
      "/admin/mastercard-move", "/admin/moonpay", "/backup-export",
    ]) {
      expect(routes).toContain(
        `path="${route}" element={<RoleGuardedPage roles={['super_admin']}>`,
      );
    }
  });

  it("queue-viewing cards stay ungated for the admin tier (Bank Payouts, PayPal, Refunds)", () => {
    for (const title of ["Bank Payouts", "PayPal Withdrawals", "Refunds Console"]) {
      const at = src.indexOf(`title: "${title}"`);
      expect(at).toBeGreaterThan(-1);
      // Slice only this card's own object literal (up to its closing
      // "},") so a FOLLOWING card's gate cannot leak into the check.
      const end = src.indexOf("},", at);
      const card = src.slice(at, end + 2);
      expect(card).not.toContain("gate:");
    }
  });

  it("the /admin/settings route gate itself is super_admin-only", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain(
      'path="/admin/settings" element={<RoleGuardedPage roles={[\'super_admin\']}>',
    );
  });
});

describe("AdminDashboard — the Treasury TAB is not rendered for non-super_admin", () => {
  const src = read("../../src/pages/AdminDashboard.tsx");

  it("gates BOTH the tab trigger and the tab content on the model's tab flag", () => {
    expect(src).toContain("dashboardVisibility.treasuryTab");
    const gates = src.match(/dashboardVisibility\.treasuryTab &&/g) ?? [];
    // TabsTrigger + TabsContent are each behind the flag.
    expect(gates.length).toBe(2);
    expect(src).toContain('<TabsTrigger value="treasury">Treasury</TabsTrigger>');
    expect(src).toContain('<TabsContent value="treasury">');
    expect(src).toContain("<AdminTreasuryConfig />");
  });

  it("the other five tabs stay ungated (dashboard-wide audience)", () => {
    for (const tab of ["overview", "users", "system", "notifications", "crypto"]) {
      expect(src).toContain(`<TabsTrigger value="${tab}">`);
    }
  });

  it("the tab's data gate migration raises crypto_treasury_config to super_admin", () => {
    const migration = read(
      "../../supabase/migrations/20261240_treasury_config_superadmin.sql",
    );
    // The one admin-tier policy is dropped, not supplemented —
    // permissive policies OR, so a leftover would silently keep
    // admin access alive.
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Admins manage treasury config" ON public.crypto_treasury_config;',
    );
    expect(migration).toContain(
      'CREATE POLICY "Super admins manage treasury config"',
    );
    const gates =
      migration.match(/has_role\(\(SELECT auth\.uid\(\)\), 'super_admin'::app_role\)/g) ?? [];
    // USING + WITH CHECK — reads and writes both gated.
    expect(gates.length).toBe(2);
    // The new gate never names the wider admin role as sufficient.
    expect(migration).not.toContain("'admin'::app_role");
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
