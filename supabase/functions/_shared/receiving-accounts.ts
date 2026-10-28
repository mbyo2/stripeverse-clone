// Local receiving accounts — shared logic for the receiving-admin
// edge function (the admin half of migration 20261246).
//
// Why an edge function at all: the credit path updates wallet
// balances, and the protect_wallet_balance trigger neutralises any
// balance UPDATE made while a user JWT is in scope (auth.uid() NOT
// NULL). House money doctrine (see _shared/supabase-client.ts) is
// therefore: verify the caller from their JWT, gate on roles read
// through the service-role client, then call the money RPCs through
// that same JWT-free client with the actor id passed explicitly.
// The RPCs re-check the actor's role server-side (defence in depth)
// and audit-log under the actor id.

export const RECEIVING_ADMIN_ROLES = ["admin", "super_admin"] as const;

export const RECEIVING_ADMIN_REFUSAL_MESSAGE =
  "Receiving account administration is limited to platform admins. If you believe this is a mistake, contact the platform owner.";

export const RECEIVING_ADMIN_ACTIONS = [
  "create_partner",
  "update_partner",
  "assign_account",
  "set_account_status",
  "record_deposit",
  "credit_deposit",
  "reject_deposit",
] as const;

export type ReceivingAdminAction = (typeof RECEIVING_ADMIN_ACTIONS)[number];

export function isReceivingAdminAction(
  value: unknown,
): value is ReceivingAdminAction {
  return (
    typeof value === "string" &&
    (RECEIVING_ADMIN_ACTIONS as readonly string[]).includes(value)
  );
}

/** Pure role gate: admin or super_admin may administer receiving accounts. */
export function canUseReceivingAdmin(roles: readonly string[]): boolean {
  return roles.some((r) =>
    (RECEIVING_ADMIN_ROLES as readonly string[]).includes(r),
  );
}

interface RolesReader {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => Promise<{
        data: Array<{ role: string }> | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** Resolve a caller's roles and apply the receiving-admin gate. */
export async function canUseReceivingAdminFor(
  client: RolesReader,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(`Role lookup failed: ${error.message}`);
  const roles = ((data ?? []) as Array<{ role: string }>).map((r) => r.role);
  return canUseReceivingAdmin(roles);
}

/**
 * The admin RPCs RAISE plain-language (crafted) messages. PostgREST
 * surfaces them as the error message; pass those through. Anything
 * that does not look like one of ours collapses to a generic crafted
 * message — raw provider text never reaches the admin UI.
 */
export function receivingRpcErrorMessage(error: {
  message?: string;
} | null): string {
  const raw = (error?.message ?? "").trim();
  const looksCrafted =
    raw.length > 0 &&
    raw.length <= 200 &&
    !/supabase|postgrest|JWT|PGRST|relation .* does not exist/i.test(raw);
  return looksCrafted
    ? raw
    : "Something went wrong on our side. Please try again.";
}
