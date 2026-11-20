// RoleBadge highest-role pins (CEO follow-up, 2026-11-21).
//
// The defect: the header's RoleBadge (src/components/FeatureAccess.tsx)
// kept a private copy of the role ladder that never checked
// super_admin, so an account holding super_admin WITHOUT the admin
// role was badged "User" in the account menus. The badge now resolves
// its label through the shared console model (adminConsole.ts) —
// primaryRoleLabel(roles) — the same display order and labels the
// user directory and role management use.
//
// These tests pin (a) the label for every role combination the badge
// can meet, through the exact function the badge renders, and (b) the
// wiring: the badge delegates to the shared model, keeps the admin
// family's navy and the base roles' existing colours, and never
// resurrects its private ladder.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  primaryRoleLabel,
  primaryRoleOf,
} from "../../src/lib/adminConsole";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const featureAccess = read("../../src/components/FeatureAccess.tsx");
const badgeBlock = featureAccess.slice(
  featureAccess.indexOf("export const RoleBadge"),
  featureAccess.indexOf("export const FeatureList"),
);

describe("primaryRoleLabel — the label the RoleBadge renders", () => {
  it("super_admin alone is Super Admin (the fixed defect)", () => {
    expect(primaryRoleOf(["super_admin"])).toBe("super_admin");
    expect(primaryRoleLabel(["super_admin"])).toBe("Super Admin");
    expect(primaryRoleLabel(["user", "super_admin"])).toBe("Super Admin");
  });

  it("super_admin outranks admin when both are held", () => {
    expect(primaryRoleLabel(["admin", "super_admin"])).toBe("Super Admin");
    expect(primaryRoleLabel(["super_admin", "admin"])).toBe("Super Admin");
    expect(primaryRoleLabel(["user", "admin", "super_admin", "business"])).toBe(
      "Super Admin",
    );
  });

  it("admin alone is Admin, unchanged", () => {
    expect(primaryRoleLabel(["admin"])).toBe("Admin");
    expect(primaryRoleLabel(["user", "admin"])).toBe("Admin");
    expect(primaryRoleLabel(["business", "admin"])).toBe("Admin");
  });

  it("admin outranks the per-feature admin roles", () => {
    expect(primaryRoleLabel(["p2p_admin", "admin"])).toBe("Admin");
    expect(primaryRoleLabel(["finance_admin", "admin", "user"])).toBe("Admin");
  });

  it("each per-feature admin role alone shows its existing label", () => {
    expect(primaryRoleLabel(["p2p_admin"])).toBe("P2P Admin");
    expect(primaryRoleLabel(["support_admin"])).toBe("Support Admin");
    expect(primaryRoleLabel(["compliance_admin"])).toBe("Compliance Admin");
    expect(primaryRoleLabel(["finance_admin"])).toBe("Finance Admin");
    // …and above the base roles when combined with them.
    expect(primaryRoleLabel(["user", "p2p_admin"])).toBe("P2P Admin");
    expect(primaryRoleLabel(["business", "support_admin"])).toBe("Support Admin");
  });

  it("the base roles are unchanged", () => {
    expect(primaryRoleLabel(["business"])).toBe("Business");
    expect(primaryRoleLabel(["beta_tester"])).toBe("Beta Tester");
    expect(primaryRoleLabel(["user", "business"])).toBe("Business");
  });

  it("a plain user — or no roles at all — is User", () => {
    expect(primaryRoleLabel(["user"])).toBe("User");
    expect(primaryRoleLabel([])).toBe("User");
  });
});

describe("RoleBadge wiring — delegates to the shared model", () => {
  it("renders the shared primary-role label", () => {
    expect(badgeBlock).toContain("primaryRoleLabel(roles)");
    expect(badgeBlock).toContain("primaryRoleOf(roles)");
    expect(featureAccess).toContain("primaryRoleLabel");
    expect(featureAccess).toContain('from "@/lib/adminConsole"');
  });

  it("the badge's private role ladder is gone", () => {
    expect(badgeBlock).not.toContain("getHighestRole");
    expect(badgeBlock).not.toContain('roles.includes("admin")) return "Admin"');
    expect(badgeBlock).not.toContain('roles.includes("business")) return "Business"');
  });

  it("the admin family wears the admin navy; base colours are untouched", () => {
    expect(badgeBlock).toContain('primaryRole === "super_admin"');
    expect(badgeBlock).toContain('primaryRole === "admin"');
    expect(badgeBlock).toContain("isFeatureRole(primaryRole)");
    expect(badgeBlock).toContain("bg-[#002991] text-white");
    expect(badgeBlock).toContain("bg-primary text-black");
    expect(badgeBlock).toContain("bg-amber-500 text-black");
    expect(badgeBlock).toContain("bg-gray-600 text-white");
  });

  it("the tier badge beside it is untouched", () => {
    expect(badgeBlock).toContain("getTierName()");
    expect(badgeBlock).toContain("Your subscription tier");
    expect(badgeBlock).toContain("Your account role");
  });
});
