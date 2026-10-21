import type { Database } from '@/integrations/supabase/types';

export type AccountRow = Database['public']['Tables']['accounts']['Row'];
export type WalletRow = Database['public']['Tables']['wallets']['Row'];

export interface AccountWalletGroup {
  /** null = the Main account (wallets with account_id NULL). */
  accountId: string | null;
  /** The accounts row for a sub-account; null for Main and orphan groups. */
  account: AccountRow | null;
  /** Display name: 'Main account' or the sub-account's name. */
  name: string;
  isMain: boolean;
  wallets: WalletRow[];
  /** Summed balance per currency code. */
  totalByCurrency: Record<string, number>;
  /** Summed balance of the group's ZMW wallet(s). */
  totalZMW: number;
}

const emptyGroup = (
  accountId: string | null,
  account: AccountRow | null,
  name: string,
): AccountWalletGroup => ({
  accountId,
  account,
  name,
  isMain: accountId === null,
  wallets: [],
  totalByCurrency: {},
  totalZMW: 0,
});

/**
 * Groups a user's wallets by the account they belong to.
 *
 * The Main group (account_id NULL) always comes first, followed by one
 * group per account in the order `accounts` was given (callers order by
 * created_at), including accounts that hold no wallets yet. Wallets whose
 * account_id points at an account missing from `accounts` are kept in a
 * trailing fallback group so their balances are never silently dropped
 * from totals.
 */
export function groupWalletsByAccount(
  wallets: WalletRow[],
  accounts: AccountRow[],
): AccountWalletGroup[] {
  const main = emptyGroup(null, null, 'Main account');
  const byId = new Map<string, AccountWalletGroup>();
  for (const account of accounts) {
    byId.set(account.id, emptyGroup(account.id, account, account.name));
  }
  const orphans = new Map<string, AccountWalletGroup>();

  for (const wallet of wallets) {
    const key = wallet.account_id ?? null;
    let group: AccountWalletGroup;
    if (key === null) {
      group = main;
    } else if (byId.has(key)) {
      group = byId.get(key)!;
    } else {
      if (!orphans.has(key)) orphans.set(key, emptyGroup(key, null, 'Sub-account'));
      group = orphans.get(key)!;
    }
    group.wallets.push(wallet);
    const balance = Number(wallet.balance) || 0;
    group.totalByCurrency[wallet.currency] =
      (group.totalByCurrency[wallet.currency] ?? 0) + balance;
    if (wallet.currency === 'ZMW') group.totalZMW += balance;
  }

  return [main, ...accounts.map((a) => byId.get(a.id)!), ...orphans.values()];
}

/** Total ZMW held across every group (Main + all sub-accounts). */
export function totalZmwAcrossGroups(groups: AccountWalletGroup[]): number {
  return groups.reduce((sum, group) => sum + group.totalZMW, 0);
}
