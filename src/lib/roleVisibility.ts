// Role visibility — the presentation rules behind the CEO directive
// (2026-10-25): "every role sees only its own things; no Access
// Denied screens." A surface that belongs to a role the user does not
// hold is simply not rendered for them, and a signed-in user who
// lands on a URL outside their role is quietly redirected to their
// own role's home instead of hitting a wall.
//
// PRESENTATION ONLY. Nothing here grants or denies data access: the
// database (RLS + SECURITY DEFINER RPCs with in-DB role checks) and
// the edge functions remain the enforcement layer, exactly as before.
// These helpers only decide what renders and where a mismatched
// navigation lands.

/** Where admins and super admins land: the console's user directory
 *  (/admin itself redirects there too). */
export const ADMIN_CONSOLE_HOME = "/admin/users";

/** Where a per-feature p2p_admin (who holds no staff admin role)
 *  lands: their console area, the P2P dispute console. */
export const P2P_CONSOLE_HOME = "/admin/p2p";

/** Everyone else's home — the route every user already lands on
 *  after login. support_admin / compliance_admin / finance_admin
 *  have no dedicated console routes today, so their home is the
 *  dashboard until one exists. */
export const DEFAULT_ROLE_HOME = "/dashboard";

/**
 * The home route for a set of held roles. Priority mirrors the
 * console gates: staff admins first (super_admin is additive over
 * admin), then the one per-feature role that owns a console area,
 * then the plain dashboard.
 *
 * Loop-safety: the returned route's own gate is always satisfied by
 * the roles that selected it (admin home requires admin/super_admin;
 * the P2P home admits p2p_admin; the dashboard requires only a
 * session), so a redirect can never bounce.
 */
export const roleHomePath = (roles: readonly string[]): string => {
  if (roles.includes("admin") || roles.includes("super_admin")) {
    return ADMIN_CONSOLE_HOME;
  }
  if (roles.includes("p2p_admin")) {
    return P2P_CONSOLE_HOME;
  }
  return DEFAULT_ROLE_HOME;
};

/** True when the held roles include at least one of the required. */
export const holdsAnyRole = (
  held: readonly string[],
  required: readonly string[],
): boolean => required.some((role) => held.includes(role));

/**
 * True for the admin tier — admin OR super_admin. super_admin is
 * additive over admin everywhere in the app (RoleContext feature
 * checks, console gates), so a super_admin-only holder must never be
 * treated as a lesser account by a visibility check that names only
 * "admin".
 */
export const isAdminTier = (roles: readonly string[]): boolean =>
  roles.includes("admin") || roles.includes("super_admin");

/**
 * The Header's role-owned menu entries, as one model. Four entries
 * in the account menus (desktop dropdown + mobile drawer) belong to
 * roles, not to every signed-in user:
 *
 *   - Subscription, Audit Logs, Backup & Export are admin-console
 *     destinations: admin tier only.
 *   - Fraud Rules is a business surface whose route gate ALSO admits
 *     the admin tier (BusinessRouteGuard / /fraud-rules parity), so
 *     it renders for business holders OR the admin tier — a
 *     super_admin-only holder (the owner holds no business role row)
 *     must still see it.
 *
 * Every other role (plain user, beta_tester, lone p2p_admin) gets
 * none of the four. Kept as a pure function of the held roles so the
 * menu model is pinned directly by tests.
 */
export interface HeaderMenuVisibility {
  /** Subscription, Audit Logs, Backup & Export — admin tier only. */
  adminLinks: boolean;
  /** Fraud Rules — business holders OR the admin tier. */
  fraudRules: boolean;
}

export const headerMenuVisibility = (
  roles: readonly string[],
): HeaderMenuVisibility => {
  const adminTier = isAdminTier(roles);
  return {
    adminLinks: adminTier,
    fraudRules: adminTier || holdsAnyRole(roles, ["business"]),
  };
};

/**
 * The Admin Dashboard's role-owned action cards, as one model.
 * The dashboard itself is an admin-tier surface (its route gate
 * admits admin OR super_admin), and every action card's target
 * route admits that same audience — with ONE exception:
 *
 *   - Treasury & Reports (/admin/treasury) is super_admin ONLY:
 *     its route gate names ['super_admin'] alone and the
 *     treasury_* RPCs enforce the same gate server-side (CEO
 *     order 2026-10-27: the console must not even be SHOWN to
 *     anyone who is not super_admin — least privilege). A plain
 *     admin therefore never renders the card at all; the link
 *     simply does not exist for them.
 *
 * Every other card (User Management, Transaction Oversight, P2P
 * Disputes, Identity Review, Role Management, Role Requests,
 * Refunds Console, Cross-Border Payouts, MoonPay, PayPal
 * Withdrawals, Compliance Center) targets a route whose gate
 * admits the dashboard's whole audience, so it renders for every
 * viewer who can open the dashboard. Kept as a pure function of
 * the held roles so the rule is pinned directly by tests.
 */
export interface AdminDashboardVisibility {
  /** Treasury & Reports card — super_admin holders only. */
  treasuryConsole: boolean;
}

export const adminDashboardVisibility = (
  roles: readonly string[],
): AdminDashboardVisibility => ({
  treasuryConsole: holdsAnyRole(roles, ["super_admin"]),
});
