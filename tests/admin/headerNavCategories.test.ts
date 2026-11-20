// Header Admin + Superadmin nav categories and the signed-in email
// (CEO order 2026-11-21): "show the account's email used so people
// can know and put the features of admin and superadmin have it's
// own category the way you have done with business".
//
// What is pinned here:
//   1. The two categories exist in the desktop nav AND the mobile
//      drawer, built exactly like the Business category (same
//      DropdownMenu primitives, same trigger treatment, same
//      labelled-section pattern in the drawer).
//   2. Their exact contents: the Admin category carries the
//      operations surfaces whose routes admit the admin tier; the
//      Superadmin category carries the governance surfaces whose
//      routes are super_admin-only — and neither leaks into the
//      other or into the account menu (Audit Logs / Backup & Export
//      were consolidated out of the account menu into the
//      categories; one home per surface).
//   3. Every category route appears exactly twice in the Header
//      (desktop dropdown + mobile section) — no third, ungated copy.
//   4. The route gates in AnimatedRoutes are untouched: this is a
//      navigation regrouping, it opens nothing to anyone new.
//   5. The signed-in account's email renders at the top of the
//      account menu and in the mobile drawer, sourced from the auth
//      record (user.email), with the saved profile name above it
//      when one exists; Settings keeps its read-only Email row.
//
// Presentation only, like everything in the Header: the database
// (RLS + in-DB role checks) and the route gates remain the
// enforcement layer.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const header = read("../../src/components/Header.tsx");
const routes = read("../../src/components/AnimatedRoutes.tsx");

/** The Admin category's routes: every target's route gate admits
 *  the admin tier (admin OR super_admin). */
const ADMIN_ROUTES = [
  "/admin-dashboard",
  "/admin/users",
  "/admin/identity",
  "/admin/p2p",
  "/admin/transactions",
  "/admin/merchants",
  "/admin/refunds",
  "/admin/bank-payouts",
  "/admin/paypal",
  "/aml-screening",
  "/compliance",
  "/feedback-dashboard",
  "/audit-logs",
];

/** The Superadmin category's routes: every target's route gate is
 *  ['super_admin'] alone. */
const SUPERADMIN_ROUTES = [
  "/admin/settings",
  "/admin/treasury",
  "/admin/forensics",
  "/admin/role-requests",
  "/admin/receiving-accounts",
  "/admin/mastercard-move",
  "/admin/moonpay",
  "/backup-export",
];

const linkCount = (src: string, route: string) =>
  src.split(`to="${route}"`).length - 1;

// The four Header regions, sliced by their stable markers.
const categoriesStart = header.indexOf("Admin + Superadmin categories (CEO order 2026-11-21)");
const desktopAdmin = header.slice(
  categoriesStart,
  header.indexOf("{showSuperadminCategory && (", categoriesStart),
);
const desktopSuperadmin = header.slice(
  header.indexOf("{showSuperadminCategory && (", categoriesStart),
  header.indexOf("</nav>", categoriesStart),
);
const mobileAdminStart = header.indexOf(">Admin</p>");
const mobileAdmin = header.slice(mobileAdminStart, header.indexOf(">Superadmin</p>"));
const mobileSuperadmin = header.slice(
  header.indexOf(">Superadmin</p>"),
  header.indexOf(">Account</p>"),
);

describe("the Admin category — Business pattern, operations contents", () => {
  it("the category markers are found (slice sanity)", () => {
    expect(categoriesStart).toBeGreaterThan(-1);
    expect(desktopAdmin).toContain("Admin <ChevronDown");
    expect(desktopSuperadmin).toContain("Superadmin <ChevronDown");
    expect(mobileAdminStart).toBeGreaterThan(-1);
    expect(mobileSuperadmin).toContain("Backup & Export");
  });

  it("desktop dropdown rides the same primitives and trigger treatment as Business", () => {
    expect(desktopAdmin).toContain("<DropdownMenu>");
    expect(desktopAdmin).toContain('<DropdownMenuContent align="start" className="w-52">');
    expect(desktopAdmin).toContain("navBtnClass(isGroupActive([");
    expect(desktopAdmin).toContain("Admin <ChevronDown");
  });

  it("carries every operations route and no governance route", () => {
    for (const route of ADMIN_ROUTES) {
      expect(desktopAdmin).toContain(`to="${route}"`);
      expect(mobileAdmin).toContain(`to="${route}"`);
    }
    for (const route of SUPERADMIN_ROUTES) {
      expect(desktopAdmin).not.toContain(`to="${route}"`);
      expect(mobileAdmin).not.toContain(`to="${route}"`);
    }
  });
});

describe("the Superadmin category — governance contents, super_admin only", () => {
  it("desktop dropdown rides the same primitives and trigger treatment as Business", () => {
    expect(desktopSuperadmin).toContain("<DropdownMenu>");
    expect(desktopSuperadmin).toContain('<DropdownMenuContent align="start" className="w-52">');
    expect(desktopSuperadmin).toContain("navBtnClass(isGroupActive([");
    expect(desktopSuperadmin).toContain("Superadmin <ChevronDown");
  });

  it("carries every governance route and no operations route", () => {
    for (const route of SUPERADMIN_ROUTES) {
      expect(desktopSuperadmin).toContain(`to="${route}"`);
      expect(mobileSuperadmin).toContain(`to="${route}"`);
    }
    for (const route of ADMIN_ROUTES) {
      expect(desktopSuperadmin).not.toContain(`to="${route}"`);
      expect(mobileSuperadmin).not.toContain(`to="${route}"`);
    }
  });

  it("Backup & Export lives here now — its super_admin-only rule moved with it", () => {
    expect(desktopSuperadmin).toContain('to="/backup-export"');
    expect(mobileSuperadmin).toContain('to="/backup-export"');
    expect(desktopAdmin).not.toContain('to="/backup-export"');
  });
});

describe("one home per surface — no third, ungated copy anywhere", () => {
  it("every category route is linked exactly twice in the Header (desktop + mobile)", () => {
    for (const route of [...ADMIN_ROUTES, ...SUPERADMIN_ROUTES]) {
      expect(linkCount(header, route)).toBe(2);
    }
  });

  it("all header menus ride the shared DropdownMenuContent primitive (menu-scroll fix intact)", () => {
    // Send & Request, Wallet, Business, Admin, Superadmin, account.
    const contents = header.match(/<DropdownMenuContent/g) ?? [];
    expect(contents.length).toBeGreaterThanOrEqual(6);
  });

  it("the bar widened for the eight-item nav, and the search icon yields below 2xl for the admin tier", () => {
    // Measured on the pre-change build: a super_admin's nav content
    // is ~924px and overflowed the old 1200px container's nav box,
    // painting the last triggers over the right cluster (the
    // 2026-11-11 unclickable-menu defect class). The container is
    // 1440px now, and below 2xl the search icon (36px) is not
    // rendered for admin-tier viewers — ⌘K still opens search for
    // them, and the 2xl pill shows for everyone.
    expect(header).toContain("max-w-[1440px]");
    expect(header).toContain("{!showAdminCategory && (");
    expect(header).toContain("hidden 2xl:flex h-9 gap-2 font-normal w-28");
  });
});

describe("route gates untouched — the regrouping opens nothing", () => {
  it("every Superadmin category target still sits behind the super_admin-only gate", () => {
    for (const route of SUPERADMIN_ROUTES) {
      const line = routes
        .split("\n")
        .find((l) => l.includes(`path="${route}"`));
      expect(line, `route ${route}`).toBeTruthy();
      expect(line).toContain("roles={['super_admin']}");
    }
  });

  it("every Admin category target still sits behind the admin-tier gate", () => {
    // The gate expression each route has always carried: most name
    // the ADMIN_ROLES constant; three spell the same audience
    // inline (bank-payouts, paypal) or add the business sibling
    // (compliance). All of them admit admin + super_admin and no
    // one else new.
    const expectedGate: Record<string, string> = {
      "/admin/p2p": "P2P_ADMIN_ROLES",
      "/admin/bank-payouts": "['admin', 'super_admin']",
      "/admin/paypal": "['admin', 'super_admin']",
      "/compliance": "['admin','super_admin','business']",
    };
    for (const route of ADMIN_ROUTES) {
      const line = routes
        .split("\n")
        .find((l) => l.includes(`path="${route}"`));
      expect(line, `route ${route}`).toBeTruthy();
      expect(line).toContain(expectedGate[route] ?? "roles={ADMIN_ROLES}");
      expect(line).not.toContain("roles={['super_admin']}");
    }
  });
});

describe("the signed-in email — visible in the account menus", () => {
  it("renders the auth record's email in the desktop account menu AND the mobile drawer", () => {
    const emails = header.match(/\{user\.email\}/g) ?? [];
    expect(emails.length).toBe(2);
  });

  it("the desktop identity block sits at the top of the account menu, above the role badge", () => {
    const menuStart = header.indexOf("Signed-in identity (CEO order 2026-11-21)");
    const menuEnd = header.indexOf("{/* Mobile Menu */}", menuStart);
    const menu = header.slice(menuStart, menuEnd);
    expect(menu.indexOf("{user.email}")).toBeGreaterThan(-1);
    expect(menu.indexOf("{user.email}")).toBeLessThan(menu.indexOf("<RoleBadge />"));
  });

  it("the name above the email comes from the profile (the name source of truth)", () => {
    expect(header).toContain('from "@/hooks/useProfile"');
    expect(header).toContain("profile?.first_name");
    expect(header).toContain("profile?.last_name");
    // The name line renders only when a name is actually saved.
    expect(header).toContain("{displayName && (");
  });

  it("Settings keeps its read-only Email row (the account email, not editable)", () => {
    const settings = read("../../src/pages/Settings.tsx");
    expect(settings).toContain('<Label htmlFor="email">Email</Label>');
    expect(settings).toContain('value={user?.email || ""} disabled');
    expect(settings).toContain("Email cannot be changed");
  });
});
