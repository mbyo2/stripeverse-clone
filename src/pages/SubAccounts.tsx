import { useMemo, useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus, ArrowLeftRight, Pencil, Snowflake, RotateCcw, XCircle,
  Building2, PiggyBank, TrendingUp, User, Shapes, Wallet as WalletIcon, Check,
} from 'lucide-react';
import { useAccount } from '@/contexts/AccountContext';
import {
  useAccounts, useCreateSubAccount, useRenameSubAccount, useSetSubAccountStatus,
  useCloseSubAccount, useInternalTransfer, SUB_ACCOUNT_KINDS, subAccountKindLabel,
  type SubAccountKind,
} from '@/hooks/useAccounts';
import { useMultiCurrencyWallets } from '@/hooks/useMultiCurrency';
import {
  groupWalletsByAccount, totalZmwAcrossGroups,
  type AccountRow, type AccountWalletGroup,
} from '@/utils/accountGrouping';
import { formatCurrency } from '@/utils/walletUtils';
import { toast } from 'sonner';
import { FROZEN_SUB_ACCOUNT_MESSAGE } from '@/utils/userFacingError';

const kindIcon = (kind: string) => {
  switch (kind) {
    case 'business': return Building2;
    case 'savings': return PiggyBank;
    case 'trading': return TrendingUp;
    case 'personal': return User;
    default: return Shapes;
  }
};

const statusBadge = (status: string) => {
  switch (status) {
    case 'frozen':
      return <Badge variant="secondary" className="gap-1"><Snowflake className="h-3 w-3" />Frozen</Badge>;
    case 'closed':
      return <Badge variant="outline">Closed</Badge>;
    default:
      return <Badge>Active</Badge>;
  }
};

const SubAccounts = () => {
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: allWallets = [], isLoading: walletsLoading } = useMultiCurrencyWallets();
  const { selectedAccountId, setSelectedAccountId } = useAccount();

  const createSub = useCreateSubAccount();
  const renameSub = useRenameSubAccount();
  const setStatus = useSetSubAccountStatus();
  const closeSub = useCloseSubAccount();
  const internalTransfer = useInternalTransfer();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; kind: SubAccountKind }>({
    name: '',
    kind: 'custom',
  });
  const [renameTarget, setRenameTarget] = useState<AccountRow | null>(null);
  const [renameName, setRenameName] = useState('');
  const [closeTarget, setCloseTarget] = useState<AccountRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromWalletId: '', toWalletId: '', amount: '', description: '' });

  const groups = useMemo(
    () => groupWalletsByAccount(allWallets, accounts),
    [allWallets, accounts],
  );
  const totalZMW = useMemo(() => totalZmwAcrossGroups(groups), [groups]);
  const subAccounts = accounts.filter((a) => a.status !== 'closed');
  const totalWallets = groups.reduce((n, g) => n + g.wallets.length, 0);
  const isLoading = accountsLoading || walletsLoading;

  const groupOfWallet = (walletId: string) =>
    groups.find((g) => g.wallets.some((w) => w.id === walletId));
  const fromGroup = transferForm.fromWalletId ? groupOfWallet(transferForm.fromWalletId) : undefined;
  const fromWallet = fromGroup?.wallets.find((w) => w.id === transferForm.fromWalletId);

  // Sources: any wallet in an active account (frozen accounts can receive
  // but never send; closed accounts do neither).
  const sourceGroups = groups.filter(
    (g) => g.isMain || (g.account && g.account.status === 'active'),
  );
  // Destinations: same currency, different account, not a closed account.
  const destinationWallets = fromWallet
    ? groups
        .filter((g) => g.accountId !== (fromGroup?.accountId ?? null))
        .filter((g) => g.isMain || (g.account && g.account.status !== 'closed'))
        .flatMap((g) => g.wallets.filter((w) => w.currency === fromWallet.currency))
    : [];

  const openTransfer = (presetFromWalletId?: string) => {
    setTransferForm({ fromWalletId: presetFromWalletId ?? '', toWalletId: '', amount: '', description: '' });
    setTransferOpen(true);
  };

  const handleCreate = () => {
    createSub.mutate(
      { name: createForm.name.trim(), kind: createForm.kind },
      { onSuccess: () => { setCreateOpen(false); setCreateForm({ name: '', kind: 'custom' }); } },
    );
  };

  const handleRename = () => {
    if (!renameTarget) return;
    renameSub.mutate(
      { accountId: renameTarget.id, name: renameName.trim() },
      { onSuccess: () => setRenameTarget(null) },
    );
  };

  const handleTransfer = () => {
    // Frozen-source guard (Workstream C, 2026-10-26): a frozen
    // sub-account can receive but never send. The source list below
    // already excludes frozen accounts, but an account can be frozen
    // in another tab after this dialog opened — refuse HERE, with the
    // crafted message, instead of letting the attempt fail silently
    // or surface a raw server refusal.
    const sourceGroup = groupOfWallet(transferForm.fromWalletId);
    if (sourceGroup?.account?.status === 'frozen') {
      toast.error(FROZEN_SUB_ACCOUNT_MESSAGE);
      return;
    }
    internalTransfer.mutate(
      {
        fromWalletId: transferForm.fromWalletId,
        toWalletId: transferForm.toWalletId,
        amount: Number(transferForm.amount),
        description: transferForm.description.trim() || undefined,
      },
      { onSuccess: () => { setTransferOpen(false); setTransferForm({ fromWalletId: '', toWalletId: '', amount: '', description: '' }); } },
    );
  };

  const transferAmount = Number(transferForm.amount);
  const transferValid =
    !!transferForm.fromWalletId &&
    !!transferForm.toWalletId &&
    transferAmount > 0 &&
    !!fromWallet &&
    transferAmount <= Number(fromWallet.balance);

  const renderGroupRow = (group: AccountWalletGroup) => {
    const account = group.account;
    const Icon = group.isMain ? WalletIcon : kindIcon(account?.kind ?? 'custom');
    const status = group.isMain ? 'active' : account?.status ?? 'active';
    const isSelected = selectedAccountId === group.accountId;
    const zeroBalance = group.wallets.every((w) => Number(w.balance) === 0);
    const zmwWallet = group.wallets.find((w) => w.currency === 'ZMW');

    return (
      <div key={group.accountId ?? 'main'} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-foreground truncate">{group.name}</p>
              {group.isMain && <Badge variant="outline">Main</Badge>}
              {!group.isMain && <Badge variant="outline">{subAccountKindLabel(account?.kind ?? 'custom')}</Badge>}
              {!group.isMain && statusBadge(status)}
              {isSelected && (
                <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />Selected</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {group.wallets.length === 0
                ? 'No wallets yet'
                : Object.entries(group.totalByCurrency)
                    .map(([currency, amount]) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
                    .join(' · ')}
            </p>
            {status === 'frozen' && (
              <p className="text-xs text-muted-foreground mt-1">Frozen — this account can receive money but cannot send.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 md:flex-col md:items-end md:gap-2 shrink-0">
          <p className="text-lg font-display font-semibold text-foreground tabular-nums">
            {formatCurrency(group.totalZMW, 'ZMW')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full"
              disabled={status === 'closed' || !zmwWallet}
              onClick={() => {
                // Frozen accounts keep an ACTIVE Transfer button so
                // the refusal is a crafted in-app message, not a
                // silently dead control (Workstream C, 2026-10-26).
                if (status === 'frozen') {
                  toast.error(FROZEN_SUB_ACCOUNT_MESSAGE);
                  return;
                }
                if (zmwWallet) openTransfer(zmwWallet.id);
              }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> Transfer
            </Button>
            {!group.isMain && account && status !== 'closed' && (
              <>
                {!isSelected && (
                  <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => setSelectedAccountId(account.id)}>
                    Switch
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full"
                  onClick={() => { setRenameTarget(account); setRenameName(account.name); }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({
                    accountId: account.id,
                    status: status === 'frozen' ? 'active' : 'frozen',
                  })}
                >
                  {status === 'frozen'
                    ? <><RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Unfreeze</>
                    : <><Snowflake className="h-3.5 w-3.5 mr-1.5" /> Freeze</>}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full text-destructive hover:text-destructive"
                  disabled={!zeroBalance}
                  title={zeroBalance ? 'Close this account' : 'Move the balance out before closing'}
                  onClick={() => setCloseTarget(account)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" /> Close
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">Sub-accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Separate accounts under your one login — each with its own wallets and balances.
            </p>
          </div>
          <Button className="h-11 px-5 rounded-full font-semibold" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create sub-account
          </Button>
        </div>

        {/* Summary */}
        <div className="bg-[#003087] rounded-[24px] px-6 py-8 md:px-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-white/80 text-sm font-medium mb-1">Total balance across all accounts</p>
              <h2 className="text-4xl md:text-[40px] font-display font-semibold text-white tabular-nums">
                {isLoading ? '—' : formatCurrency(totalZMW, 'ZMW')}
              </h2>
              <p className="text-white/70 text-sm mt-1">Kwacha wallets only — other currencies are listed per account below.</p>
            </div>
            <div className="text-white/80 text-sm">
              <p>{subAccounts.length} sub-account{subAccounts.length === 1 ? '' : 's'} · {totalWallets} wallet{totalWallets === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {!isLoading && subAccounts.length === 0 && accounts.length === 0 && (
          <div className="bg-[#FEF3E2] dark:bg-card rounded-[24px] px-6 py-8 md:px-8 mb-6">
            <h2 className="text-lg font-display font-semibold text-foreground mb-2">Keep different money separate</h2>
            <p className="text-sm text-muted-foreground max-w-2xl mb-4">
              Create a sub-account for your shop takings, your savings, or your trading — each one gets its own
              kwacha wallet (and can hold other currencies too), its own balance and its own history. Moving money
              between your own accounts is instant and free, and you can freeze a sub-account at any time so
              nothing can leave it.
            </p>
            <Button className="h-11 px-5 rounded-full font-semibold" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create your first sub-account
            </Button>
          </div>
        )}

        {/* Accounts list */}
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {groups.map(renderGroupRow)}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground mt-4">
          Sub-accounts sit under your one BMaGlass Pay account — there are no extra logins or passwords.
          Switch the account you're viewing at any time from the account menu in the header.
        </p>
      </main>
      <Footer />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create sub-account</DialogTitle>
            <DialogDescription>
              Give it a name and a purpose. A kwacha wallet is created for it automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sub-name">Name</Label>
              <Input
                id="sub-name"
                value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Shop Takings"
                maxLength={60}
              />
            </div>
            <div>
              <Label>Purpose</Label>
              <Select
                value={createForm.kind}
                onValueChange={(v) => setCreateForm((p) => ({ ...p, kind: v as SubAccountKind }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUB_ACCOUNT_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full h-11 rounded-full font-semibold"
              onClick={handleCreate}
              disabled={createSub.isPending || !createForm.name.trim()}
            >
              {createSub.isPending ? 'Creating...' : 'Create sub-account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename account</DialogTitle>
            <DialogDescription>Choose a new name for this sub-account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rename-name">Name</Label>
              <Input
                id="rename-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                maxLength={60}
              />
            </div>
            <Button
              className="w-full h-11 rounded-full font-semibold"
              onClick={handleRename}
              disabled={renameSub.isPending || !renameName.trim()}
            >
              {renameSub.isPending ? 'Saving...' : 'Save name'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Internal transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move money between my accounts</DialogTitle>
            <DialogDescription>Instant and free. Both accounts must use the same currency.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>From</Label>
              <Select
                value={transferForm.fromWalletId}
                onValueChange={(v) => setTransferForm({ fromWalletId: v, toWalletId: '', amount: transferForm.amount, description: transferForm.description })}
              >
                <SelectTrigger><SelectValue placeholder="Select source wallet" /></SelectTrigger>
                <SelectContent>
                  {sourceGroups.map((g) => (
                    <SelectGroup key={g.accountId ?? 'main'}>
                      <SelectLabel>{g.name}</SelectLabel>
                      {g.wallets.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.currency} — {Number(w.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select
                value={transferForm.toWalletId}
                onValueChange={(v) => setTransferForm((p) => ({ ...p, toWalletId: v }))}
                disabled={!fromWallet}
              >
                <SelectTrigger><SelectValue placeholder={fromWallet ? 'Select destination wallet' : 'Choose a source first'} /></SelectTrigger>
                <SelectContent>
                  {destinationWallets.map((w) => {
                    const g = groupOfWallet(w.id);
                    return (
                      <SelectItem key={w.id} value={w.id}>
                        {g?.name} — {w.currency}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {fromWallet && destinationWallets.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No other account holds a {fromWallet.currency} wallet yet. Add one from the Multi-Currency page.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="transfer-amount">Amount{fromWallet ? ` (${fromWallet.currency})` : ''}</Label>
              <Input
                id="transfer-amount"
                type="number"
                min="0"
                step="0.01"
                value={transferForm.amount}
                onChange={(e) => setTransferForm((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
              />
              {fromWallet && transferAmount > Number(fromWallet.balance) && (
                <p className="text-xs text-destructive mt-1">Amount is more than this wallet holds.</p>
              )}
            </div>
            <div>
              <Label htmlFor="transfer-note">Note (optional)</Label>
              <Input
                id="transfer-note"
                value={transferForm.description}
                onChange={(e) => setTransferForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="e.g. Weekly shop float"
                maxLength={120}
              />
            </div>
            <Button
              className="w-full h-11 rounded-full font-semibold"
              onClick={handleTransfer}
              disabled={internalTransfer.isPending || !transferValid}
            >
              {internalTransfer.isPending ? 'Moving...' : 'Move money'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close confirm */}
      <AlertDialog open={!!closeTarget} onOpenChange={(open) => { if (!open) setCloseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close “{closeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing is permanent. The account and its history stay on record, but it can no longer
              send or receive money, and it cannot be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep account</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (closeTarget) closeSub.mutate(closeTarget.id, { onSuccess: () => setCloseTarget(null) }); }}
            >
              Close account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SubAccounts;
