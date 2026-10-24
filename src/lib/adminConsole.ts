// Pure logic for the superadmin console surfaces (user directory,
// 360° user view, freeze control, role management, role-request
// inbox). Kept dependency-light and side-effect free where possible
// so the rules can be unit-tested without a browser or a database.
//
// The rules here MIRROR the live database foundation (migration
// 20261105_superadmin_foundation.sql, proven 2026-10-23):
//   - user_roles writes enforce supremacy in RLS: the elevated roles
//     (admin, super_admin and the four per-feature admin roles) can be
//     granted or removed ONLY by a super_admin; plain admins manage
//     the base roles. The UI never pretends otherwise — it attempts
//     the write the database authorises and presents refusals in
//     plain language.
//   - admin_list_users() is the only client path to user emails.
//   - admin_set_user_frozen() refuses super_admin targets and writes
//     the audit rows; profiles.is_frozen is what the money paths read.

import { toUserFacingError } from "@/utils/userFacingError";

/** Roles a plain admin may grant/remove (foundation §2: everything
 *  that is NOT elevated). `moderator` is a vestigial base role: it is
 *  non-elevated in the RLS policy, so it is classified here even
 *  though the console's base-role picker offers the three live ones. */
export const BASE_ROLES = ["user", "business", "beta_tester", "moderator"] as const;

/** The base roles the console offers in its picker. */
export const SELECTABLE_BASE_ROLES = ["user", "business", "beta_tester"] as const;

/** Roles only a super_admin may grant or remove (foundation §2). */
export const ELEVATED_ROLES = [
  "admin",
  "super_admin",
  "p2p_admin",
  "support_admin",
  "compliance_admin",
  "finance_admin",
] as const;

/** The per-feature admin roles (a subset of the elevated roles). */
export const FEATURE_ROLES = [
  "p2p_admin",
  "support_admin",
  "compliance_admin",
  "finance_admin",
] as const;

export const ALL_ROLES = [...BASE_ROLES, ...ELEVATED_ROLES] as const;

export const ROLE_LABELS: Record<string, string> = {
  user: "User",
  business: "Business",
  beta_tester: "Beta Tester",
  moderator: "Moderator",
  admin: "Admin",
  super_admin: "Super Admin",
  p2p_admin: "P2P Admin",
  support_admin: "Support Admin",
  compliance_admin: "Compliance Admin",
  finance_admin: "Finance Admin",
};

export const FEATURE_ROLE_DESCRIPTIONS: Record<string, string> = {
  p2p_admin: "Can work the P2P dispute console and rule on disputes.",
  support_admin: "Per-feature admin for support operations.",
  compliance_admin: "Per-feature admin for compliance operations.",
  finance_admin: "Per-feature admin for finance operations.",
};

/** Display order: highest authority first, plain user last. */
const ROLE_DISPLAY_ORDER = [
  "super_admin",
  "admin",
  "p2p_admin",
  "support_admin",
  "compliance_admin",
  "finance_admin",
  "business",
  "beta_tester",
  "moderator",
  "user",
];

export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

export const isElevatedRole = (role: string): boolean =>
  (ELEVATED_ROLES as readonly string[]).includes(role);

export const isFeatureRole = (role: string): boolean =>
  (FEATURE_ROLES as readonly string[]).includes(role);

export const isBaseRole = (role: string): boolean => !isElevatedRole(role);

export const sortRolesForDisplay = (roles: string[]): string[] =>
  [...roles].sort((a, b) => {
    const ia = ROLE_DISPLAY_ORDER.indexOf(a);
    const ib = ROLE_DISPLAY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

export const primaryRoleOf = (roles: string[]): string =>
  sortRolesForDisplay(roles)[0] ?? "user";

export const baseRoleOf = (roles: string[]): string =>
  SELECTABLE_BASE_ROLES.find((r) => roles.includes(r)) ?? "user";

/** Who may open the admin console at all (route gate mirror). */
export const canViewAdminConsole = (actorRoles: string[]): boolean =>
  actorRoles.includes("admin") || actorRoles.includes("super_admin");

/** Who may open the P2P admin console (route gate mirror): staff
 *  admins, plus the per-feature p2p_admin role the foundation added. */
export const canOpenP2pConsole = (actorRoles: string[]): boolean =>
  canViewAdminConsole(actorRoles) || actorRoles.includes("p2p_admin");

/**
 * The supremacy truth table, mirroring the live user_roles RLS
 * policy exactly:
 *   - a super_admin can grant/remove ANY role;
 *   - a plain admin can grant/remove base roles only — elevated rows
 *     are invisible to their writes and elevated inserts are refused;
 *   - anyone else can manage nothing.
 */
export const canManageRole = (actorRoles: string[], role: string): boolean => {
  if (actorRoles.includes("super_admin")) return true;
  if (actorRoles.includes("admin")) return !isElevatedRole(role);
  return false;
};

// ---------------------------------------------------------------------
// Error surfacing — the error-presentation rule: plain language, what
// happened and what to do next, never a raw database message.
// ---------------------------------------------------------------------

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}

const looksLikeRlsRefusal = (text: string): boolean =>
  /permission denied|row-level security|insufficient privilege|not authorized/i.test(
    text,
  );

/** Plain-language message for a failed admin_set_user_frozen call. */
export function freezeErrorMessage(error: unknown): string {
  const raw = rawMessage(error);
  if (/super admin account cannot be frozen/i.test(raw)) {
    return "This account belongs to a super admin, so it can't be frozen. Super admin accounts are never locked out — if something is wrong with one, it has to be handled by the platform owner directly.";
  }
  if (/only an admin can freeze/i.test(raw)) {
    return "You don't have permission to change this account's frozen status. Only admins and super admins can freeze or unfreeze accounts.";
  }
  if (/user profile not found/i.test(raw)) {
    return "We couldn't find that user's profile. It may have been removed — go back to the user list, refresh it, and try again.";
  }
  return toUserFacingError(
    error,
    "We couldn't update this account's frozen status. Please try again.",
  );
}

/** Plain-language message for a failed user_roles grant/revoke. */
export function roleChangeErrorMessage(error: unknown, role: string): string {
  const raw = rawMessage(error);
  const label = roleLabel(role);
  if (/duplicate key|violates unique constraint/i.test(raw)) {
    return `The ${label} role is already assigned to this user, so nothing changed.`;
  }
  if (looksLikeRlsRefusal(raw) || /only a super admin/i.test(raw)) {
    if (isElevatedRole(role)) {
      return `Only a super admin can grant or remove the ${label} role. Your change wasn't saved.`;
    }
    return "You don't have permission to change this user's roles. If you believe this is a mistake, please contact a super admin.";
  }
  return toUserFacingError(
    error,
    `We couldn't update the ${label} role. Please try again.`,
  );
}

// ---------------------------------------------------------------------
// Directory merge — admin_list_users() rows carry the email (the only
// client path to it); role rows and frozen flags come from their own
// tables and are joined client-side.
// ---------------------------------------------------------------------

export interface DirectoryRpcRow {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
}

export interface DirectoryUser {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
  roles: string[];
  is_frozen: boolean;
}

export function mergeDirectoryUsers(
  rpcRows: DirectoryRpcRow[],
  roleRows: { user_id: string; role: string }[],
  frozenRows: { id: string; is_frozen: boolean | null }[],
): DirectoryUser[] {
  const rolesByUser = new Map<string, string[]>();
  roleRows.forEach((r) => {
    const held = rolesByUser.get(r.user_id) ?? [];
    held.push(r.role);
    rolesByUser.set(r.user_id, held);
  });
  const frozenByUser = new Map<string, boolean>();
  frozenRows.forEach((r) => {
    frozenByUser.set(r.id, r.is_frozen === true);
  });
  return rpcRows.map((row) => ({
    id: row.user_id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    created_at: row.created_at,
    roles: rolesByUser.get(row.user_id)?.length
      ? rolesByUser.get(row.user_id)!
      : ["user"],
    is_frozen: frozenByUser.get(row.user_id) ?? false,
  }));
}

export const directoryUserMatchesSearch = (
  user: DirectoryUser,
  search: string,
): boolean => {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    (user.first_name?.toLowerCase().includes(q) ?? false) ||
    (user.last_name?.toLowerCase().includes(q) ?? false) ||
    (user.email?.toLowerCase().includes(q) ?? false) ||
    (user.phone?.includes(search.trim()) ?? false)
  );
};

// ---------------------------------------------------------------------
// Thin supabase-call wrappers — the exact calls the pages make, kept
// here so tests can pin the wiring (RPC name, argument names, table)
// with a structural mock, the accountFreeze.test.ts pattern.
// ---------------------------------------------------------------------

/** Structural minimum of the supabase client these wrappers use. */
export interface RpcCapableClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export interface UserRolesCapableClient {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
    delete: () => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        eq: (
          column: string,
          value: unknown,
        ) => Promise<{ error: unknown }>;
      };
    };
  };
}

/** Freeze or unfreeze via the foundation RPC. Throws the RPC error
 *  so the caller can surface it through freezeErrorMessage(). */
export async function setUserFrozen(
  client: RpcCapableClient,
  userId: string,
  frozen: boolean,
  reason: string | null,
): Promise<{ is_frozen: boolean }> {
  const { data, error } = await client.rpc("admin_set_user_frozen", {
    p_user_id: userId,
    p_frozen: frozen,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { is_frozen: boolean };
}

/** The user directory via the foundation RPC (emails included). */
export async function listDirectoryUsers(
  client: RpcCapableClient,
): Promise<DirectoryRpcRow[]> {
  const { data, error } = await client.rpc("admin_list_users", {});
  if (error) throw error;
  return (data ?? []) as DirectoryRpcRow[];
}

/** Grant a role with a direct user_roles insert — RLS enforces
 *  supremacy; a refusal throws and the caller surfaces it honestly. */
export async function grantRole(
  client: UserRolesCapableClient,
  userId: string,
  role: string,
): Promise<void> {
  const { error } = await client
    .from("user_roles")
    .insert({ user_id: userId, role });
  if (error) throw error;
}

/** Revoke a role with a direct user_roles delete (same RLS path). */
export async function revokeRole(
  client: UserRolesCapableClient,
  userId: string,
  role: string,
): Promise<void> {
  const { error } = await client
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role);
  if (error) throw error;
}
