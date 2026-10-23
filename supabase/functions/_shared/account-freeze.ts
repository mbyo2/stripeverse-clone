// account-freeze: the shared money-out choke-point guard for the
// superadmin account freeze (migration 20261105: profiles.is_frozen,
// switched only by public.admin_set_user_frozen, which is admin /
// super_admin only and refuses to freeze a super_admin).
//
// Every user-initiated money-out edge function calls
// assertAccountNotFrozen with its SERVICE-ROLE client right after the
// caller has been resolved from their JWT and before any money logic
// runs. A frozen account can still sign in, view balances and history
// and RECEIVE money — freeze blocks value leaving the account, which
// is the containment an admin actually needs.
//
// Failure posture: an explicit is_frozen = true refuses with the
// crafted plain-language message below. A failed status READ also
// refuses (fail-closed) with a retry message — money never moves when
// the platform cannot verify the account's status. This module is
// dependency-free (no imports) so the vitest suite can load it
// directly: tests/admin/accountFreeze.test.ts.

export const ACCOUNT_FROZEN_MESSAGE =
  "Your account is currently frozen, so this can't be completed right now. " +
  "Please contact support and we'll help you get it sorted out.";

export const ACCOUNT_STATUS_UNVERIFIED_MESSAGE =
  "We couldn't verify your account status just now, so this can't be completed yet. " +
  "Please try again in a moment.";

// The minimal structural shape of a Supabase service client that the
// guard needs — kept structural so callers can pass any client.
// deno-lint-ignore no-explicit-any
type ProfilesReader = any;

export async function isAccountFrozen(
  admin: ProfilesReader,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .select("is_frozen")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(ACCOUNT_STATUS_UNVERIFIED_MESSAGE);
  }
  return data?.is_frozen === true;
}

export async function assertAccountNotFrozen(
  admin: ProfilesReader,
  userId: string,
): Promise<void> {
  if (await isAccountFrozen(admin, userId)) {
    throw new Error(ACCOUNT_FROZEN_MESSAGE);
  }
}
