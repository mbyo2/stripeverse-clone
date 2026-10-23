// Unit tests for the superadmin console UI (src/lib/adminConsole.ts +
// the pages wired on it): the role-gating truth table that mirrors
// the live user_roles supremacy policy, the freeze-call wiring, the
// plain-language refusal surfacing, and the directory merge.
//
// The DB remains the authority — these tests pin that the UI asks for
// exactly what the foundation authorises and never hides a refusal
// behind raw database text.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canManageRole,
  canOpenP2pConsole,
  canViewAdminConsole,
  directoryUserMatchesSearch,
  freezeErrorMessage,
  grantRole,
  isElevatedRole,
  listDirectoryUsers,
  mergeDirectoryUsers,
  roleChangeErrorMessage,
  roleLabel,
  revokeRole,
  setUserFrozen,
  sortRolesForDisplay,
} from "../../src/lib/adminConsole";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// ---------------------------------------------------------------------
// Role-gating truth table — mirrors 20261105 §2 exactly: elevated
// roles (admin, super_admin, the four feature roles) are super_admin
// territory; plain admins manage base roles only.
// ---------------------------------------------------------------------

describe("canManageRole — supremacy truth table", () => {
  const ELEVATED = [
    "admin",
    "super_admin",
    "p2p_admin",
    "support_admin",
    "compliance_admin",
    "finance_admin",
  ];
  const BASE = ["user", "business", "beta_tester", "moderator"];

  it("a super_admin can manage every role", () => {
    for (const role of [...ELEVATED, ...BASE]) {
      expect(canManageRole(["super_admin"], role)).toBe(true);
      expect(canManageRole(["admin", "super_admin"], role)).toBe(true);
    }
  });

  it("a plain admin manages base roles only", () => {
    for (const role of BASE) {
      expect(canManageRole(["admin"], role)).toBe(true);
    }
    for (const role of ELEVATED) {
      expect(canManageRole(["admin"], role)).toBe(false);
    }
  });

  it("non-staff can manage nothing", () => {
    for (const role of [...ELEVATED, ...BASE]) {
      expect(canManageRole(["user"], role)).toBe(false);
      expect(canManageRole([], role)).toBe(false);
      expect(canManageRole(["p2p_admin"], role)).toBe(false);
    }
  });

  it("isElevatedRole classifies the six elevated roles", () => {
    for (const role of ELEVATED) expect(isElevatedRole(role)).toBe(true);
    for (const role of BASE) expect(isElevatedRole(role)).toBe(false);
  });
});

describe("console gates", () => {
  it("admin console admits admin and super_admin only", () => {
    expect(canViewAdminConsole(["admin"])).toBe(true);
    expect(canViewAdminConsole(["super_admin"])).toBe(true);
    expect(canViewAdminConsole(["user"])).toBe(false);
    expect(canViewAdminConsole(["p2p_admin"])).toBe(false);
  });

  it("p2p console additionally admits p2p_admin", () => {
    expect(canOpenP2pConsole(["p2p_admin"])).toBe(true);
    expect(canOpenP2pConsole(["admin"])).toBe(true);
    expect(canOpenP2pConsole(["super_admin"])).toBe(true);
    expect(canOpenP2pConsole(["support_admin"])).toBe(false);
    expect(canOpenP2pConsole(["user"])).toBe(false);
  });
});

describe("role display helpers", () => {
  it("sorts highest authority first, plain user last", () => {
    expect(
      sortRolesForDisplay(["user", "p2p_admin", "super_admin", "business"]),
    ).toEqual(["super_admin", "p2p_admin", "business", "user"]);
  });

  it("labels every foundation role in plain words", () => {
    expect(roleLabel("super_admin")).toBe("Super Admin");
    expect(roleLabel("p2p_admin")).toBe("P2P Admin");
    expect(roleLabel("finance_admin")).toBe("Finance Admin");
  });
});

// ---------------------------------------------------------------------
// Freeze wiring — the page must call the foundation RPC by its exact
// name with its exact argument names, and propagate refusals.
// ---------------------------------------------------------------------

describe("setUserFrozen — RPC wiring", () => {
  it("calls admin_set_user_frozen with p_user_id / p_frozen / p_reason", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: { success: true, is_frozen: true }, error: null };
      },
    };
    const result = await setUserFrozen(client, "user-1", true, "Suspected fraud");
    expect(calls).toEqual([
      {
        fn: "admin_set_user_frozen",
        args: { p_user_id: "user-1", p_frozen: true, p_reason: "Suspected fraud" },
      },
    ]);
    expect(result).toEqual({ success: true, is_frozen: true });
  });

  it("propagates the RPC refusal so the page can surface it", async () => {
    const refusal = { message: "A super admin account cannot be frozen" };
    const client = {
      rpc: async () => ({ data: null, error: refusal }),
    };
    await expect(setUserFrozen(client, "owner-1", true, "test")).rejects.toBe(
      refusal,
    );
  });
});

describe("freezeErrorMessage — refusals in plain language", () => {
  it("explains super_admin immunity without raw text", () => {
    const msg = freezeErrorMessage({
      message: "A super admin account cannot be frozen",
    });
    expect(msg).toContain("super admin");
    expect(msg).toContain("can't be frozen");
    expect(msg.toLowerCase()).not.toContain("raise exception");
  });

  it("explains the staff-only gate", () => {
    const msg = freezeErrorMessage({
      message: "Only an admin can freeze or unfreeze an account",
    });
    expect(msg).toContain("Only admins and super admins");
  });

  it("explains a missing profile", () => {
    const msg = freezeErrorMessage({ message: "User profile not found" });
    expect(msg).toContain("couldn't find that user's profile");
  });

  it("never leaks a raw RLS message", () => {
    const msg = freezeErrorMessage({
      message: 'permission denied for table "profiles" — violates row-level security policy',
    });
    expect(msg).not.toContain("row-level security");
    expect(msg).not.toContain("permission denied for table");
  });
});

// ---------------------------------------------------------------------
// Role grant/revoke wiring + refusal surfacing.
// ---------------------------------------------------------------------

describe("grantRole / revokeRole — user_roles wiring", () => {
  function mockUserRoles(error: unknown = null) {
    const seen: Record<string, unknown> = {};
    const client = {
      from: (table: string) => {
        seen.table = table;
        return {
          insert: async (row: Record<string, unknown>) => {
            seen.insert = row;
            return { error };
          },
          delete: () => {
            const chain = {
              eq: (column: string, value: unknown) => {
                (seen.filters as [string, unknown][]).push([column, value]);
                return chain;
              },
              then: (resolve: (v: { error: unknown }) => void) =>
                resolve({ error }),
            };
            return chain;
          },
        };
      },
    };
    seen.filters = [];
    return { client, seen };
  }

  it("grantRole inserts a user_roles row", async () => {
    const { client, seen } = mockUserRoles();
    await grantRole(client as never, "user-9", "p2p_admin");
    expect(seen.table).toBe("user_roles");
    expect(seen.insert).toEqual({ user_id: "user-9", role: "p2p_admin" });
  });

  it("revokeRole deletes the matching user_roles row", async () => {
    const { client, seen } = mockUserRoles();
    await revokeRole(client as never, "user-9", "admin");
    expect(seen.table).toBe("user_roles");
    expect(seen.filters).toEqual([
      ["user_id", "user-9"],
      ["role", "admin"],
    ]);
  });

  it("an RLS refusal propagates out of grantRole", async () => {
    const refusal = {
      message: "new row violates row-level security policy for table \"user_roles\"",
    };
    const { client } = mockUserRoles(refusal);
    await expect(grantRole(client as never, "user-9", "admin")).rejects.toBe(
      refusal,
    );
  });
});

describe("roleChangeErrorMessage — supremacy refusals surfaced honestly", () => {
  const rlsError = {
    message: "new row violates row-level security policy for table \"user_roles\"",
  };

  it("names the super_admin rule for elevated roles", () => {
    const msg = roleChangeErrorMessage(rlsError, "admin");
    expect(msg).toContain("Only a super admin can grant or remove the Admin role");
    expect(msg).not.toContain("row-level security");
  });

  it("names the super_admin rule for feature roles too", () => {
    const msg = roleChangeErrorMessage(rlsError, "p2p_admin");
    expect(msg).toContain("Only a super admin can grant or remove the P2P Admin role");
  });

  it("explains duplicates without raw text", () => {
    const msg = roleChangeErrorMessage(
      { message: "duplicate key value violates unique constraint \"user_roles_pkey\"" },
      "business",
    );
    expect(msg).toContain("already assigned");
    expect(msg).not.toContain("duplicate key");
  });
});

// ---------------------------------------------------------------------
// Directory merge.
// ---------------------------------------------------------------------

describe("mergeDirectoryUsers", () => {
  it("joins email (RPC), roles and the frozen flag", () => {
    const merged = mergeDirectoryUsers(
      [
        {
          user_id: "u1",
          email: "a@example.com",
          first_name: "A",
          last_name: "One",
          phone: "111",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          user_id: "u2",
          email: "b@example.com",
          first_name: null,
          last_name: null,
          phone: null,
          created_at: null,
        },
      ],
      [
        { user_id: "u1", role: "admin" },
        { user_id: "u1", role: "super_admin" },
      ],
      [{ id: "u1", is_frozen: true }],
    );
    expect(merged[0]).toMatchObject({
      id: "u1",
      email: "a@example.com",
      roles: ["admin", "super_admin"],
      is_frozen: true,
    });
    // A user with no role rows defaults to the plain user role, and a
    // missing profile flag reads as not frozen.
    expect(merged[1].roles).toEqual(["user"]);
    expect(merged[1].is_frozen).toBe(false);
  });

  it("search matches email as well as name and phone", () => {
    const user = mergeDirectoryUsers(
      [
        {
          user_id: "u1",
          email: "qa17@bmaglasspay.online",
          first_name: "QA",
          last_name: "Test",
          phone: "0961234567",
          created_at: null,
        },
      ],
      [],
      [],
    )[0];
    expect(directoryUserMatchesSearch(user, "bmaglasspay")).toBe(true);
    expect(directoryUserMatchesSearch(user, "0961")).toBe(true);
    expect(directoryUserMatchesSearch(user, "nobody")).toBe(false);
    expect(directoryUserMatchesSearch(user, "")).toBe(true);
  });
});

describe("listDirectoryUsers — RPC wiring", () => {
  it("calls admin_list_users", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (fn: string) => {
        calls.push(fn);
        return { data: [], error: null };
      },
    };
    await expect(listDirectoryUsers(client)).resolves.toEqual([]);
    expect(calls).toEqual(["admin_list_users"]);
  });
});

// ---------------------------------------------------------------------
// Source pins — the routes and pages stay wired to the foundation.
// ---------------------------------------------------------------------

describe("superadmin console source pins", () => {
  const routes = read("../../src/components/AnimatedRoutes.tsx");
  const detail = read("../../src/pages/AdminUserDetail.tsx");
  const directory = read("../../src/pages/AdminUsers.tsx");
  const inbox = read("../../src/pages/AdminRoleRequests.tsx");
  const refunds = read("../../src/pages/AdminRefunds.tsx");

  it("routes the new pages behind the admin gate", () => {
    expect(routes).toContain('path="/admin/users/:userId"');
    expect(routes).toContain('path="/admin/role-requests"');
    expect(routes).toContain('path="/admin/refunds"');
    expect(routes).toContain("const ADMIN_ROLES: Role[] = ['admin', 'super_admin']");
  });

  it("the P2P console admits the per-feature p2p_admin role", () => {
    expect(routes).toContain(
      "const P2P_ADMIN_ROLES: Role[] = ['admin', 'super_admin', 'p2p_admin']",
    );
    expect(routes).toContain("roles={P2P_ADMIN_ROLES}><AdminP2P />");
  });

  it("the 360° view reads the oversight tables and wires freeze + roles", () => {
    expect(detail).toContain("setUserFrozen");
    expect(detail).toContain("freezeErrorMessage");
    expect(detail).toContain("roleChangeErrorMessage");
    for (const table of [
      "wallets",
      "accounts",
      "payment_links",
      "crypto_wallets",
      "btc_deposits",
    ]) {
      expect(detail).toContain(`.from("${table}")`);
    }
    // Super admin controls are only rendered for super admin holders.
    expect(detail).toContain("viewerIsSuperAdmin");
  });

  it("the directory lists users through admin_list_users", () => {
    expect(directory).toContain("listDirectoryUsers");
    expect(directory).toContain("mergeDirectoryUsers");
  });

  it("the inbox approves via a real grant and stamps the reviewer", () => {
    expect(inbox).toContain('.from("role_requests")');
    expect(inbox).toContain("grantRole");
    expect(inbox).toContain("reviewed_by");
    expect(inbox).toContain("reviewed_at");
  });

  it("the refunds console reads the refunds table and rejects without moving money", () => {
    expect(refunds).toContain('.from("refunds")');
    expect(refunds).toContain("No money was moved");
  });
});
