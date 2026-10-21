import { Link } from 'react-router-dom';
import { Check, ChevronDown, Snowflake, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useAccount } from '@/contexts/AccountContext';
import { useMultiCurrencyWallets } from '@/hooks/useMultiCurrency';
import { groupWalletsByAccount, type AccountWalletGroup } from '@/utils/accountGrouping';
import { formatCurrency } from '@/utils/walletUtils';

/**
 * Groups the switcher can offer: the Main account plus real sub-accounts
 * that are not closed. (Wallets pointing at an unknown account — an
 * orphan group from the grouping helper — are not selectable.)
 */
const selectableGroups = (groups: AccountWalletGroup[]): AccountWalletGroup[] =>
  groups.filter((g) => g.isMain || (g.account !== null && g.account.status !== 'closed'));

const FrozenBadge = () => (
  <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0">
    <Snowflake className="h-3 w-3" />Frozen
  </Badge>
);

/** Desktop header dropdown: shows the current account and switches scope. */
export const AccountSwitcher = () => {
  const { user } = useAuth();
  const { accounts, selectedAccountId, selectedAccountName, setSelectedAccountId } = useAccount();
  const { data: wallets = [] } = useMultiCurrencyWallets();

  if (!user) return null;

  const groups = selectableGroups(groupWalletsByAccount(wallets, accounts));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-full max-w-[190px]"
          aria-label="Switch account"
        >
          <Wallet className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{selectedAccountName}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Viewing account</DropdownMenuLabel>
        {groups.map((group) => {
          const isSelected = selectedAccountId === group.accountId;
          return (
            <DropdownMenuItem
              key={group.accountId ?? 'main'}
              onClick={() => setSelectedAccountId(group.accountId)}
              className="flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className="flex items-center gap-2 min-w-0">
                {isSelected
                  ? <Check className="h-4 w-4 shrink-0 text-primary" />
                  : <span className="w-4 shrink-0" />}
                <span className="truncate">{group.name}</span>
                {group.account?.status === 'frozen' && <FrozenBadge />}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {formatCurrency(group.totalZMW, 'ZMW')}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/sub-accounts" className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Manage sub-accounts
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Mobile menu variant: a tappable list of the user's accounts. */
export const AccountSwitcherList = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { user } = useAuth();
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccount();
  const { data: wallets = [] } = useMultiCurrencyWallets();

  if (!user) return null;

  const groups = selectableGroups(groupWalletsByAccount(wallets, accounts));

  return (
    <div className="px-4 py-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account</p>
      <div className="space-y-1">
        {groups.map((group) => {
          const isSelected = selectedAccountId === group.accountId;
          return (
            <button
              key={group.accountId ?? 'main'}
              onClick={() => setSelectedAccountId(group.accountId)}
              className={`flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isSelected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Wallet className="h-4 w-4 shrink-0" />
                <span className="truncate">{group.name}</span>
                {group.account?.status === 'frozen' && <FrozenBadge />}
              </span>
              <span className={`text-xs tabular-nums shrink-0 ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                {formatCurrency(group.totalZMW, 'ZMW')}
              </span>
            </button>
          );
        })}
      </div>
      <Link
        to="/sub-accounts"
        onClick={onNavigate}
        className="block px-3 py-2 text-sm font-medium text-primary hover:underline underline-offset-4"
      >
        Manage sub-accounts
      </Link>
    </div>
  );
};
