import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAccounts } from '@/hooks/useAccounts';
import type { AccountRow } from '@/utils/accountGrouping';

const STORAGE_KEY = 'bmaglass.selectedAccount';

interface AccountContextType {
  /** All of the user's sub-accounts (any status), oldest first. */
  accounts: AccountRow[];
  /** The selected sub-account id, or null when the Main account is selected. */
  selectedAccountId: string | null;
  /** The selected sub-account row; null when Main is selected. */
  selectedAccount: AccountRow | null;
  /** Display name of the current selection ('Main account' or the sub-account's name). */
  selectedAccountName: string;
  setSelectedAccountId: (accountId: string | null) => void;
  isLoading: boolean;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

const readStoredSelection = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: accounts = [], isLoading } = useAccounts();
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(readStoredSelection);

  const setSelectedAccountId = (accountId: string | null) => {
    setSelectedAccountIdState(accountId);
    try {
      if (accountId) localStorage.setItem(STORAGE_KEY, accountId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode) — selection still works in-memory.
    }
  };

  // If the stored/selected account no longer exists or has been closed,
  // fall back to the Main account.
  useEffect(() => {
    if (isLoading || selectedAccountId === null) return;
    const match = accounts.find((a) => a.id === selectedAccountId);
    if (!match || match.status === 'closed') {
      setSelectedAccountId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, isLoading, selectedAccountId]);

  const selectedAccount =
    selectedAccountId !== null
      ? accounts.find((a) => a.id === selectedAccountId) ?? null
      : null;

  return (
    <AccountContext.Provider
      value={{
        accounts,
        selectedAccountId,
        selectedAccount,
        selectedAccountName: selectedAccount?.name ?? 'Main account',
        setSelectedAccountId,
        isLoading,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};

export const useAccount = (): AccountContextType => {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
};
