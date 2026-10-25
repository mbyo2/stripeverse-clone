import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/contexts/RoleContext";
import {
  ArrowLeft,
  Bitcoin,
  CreditCard,
  Link2,
  Lock,
  Shield,
  Snowflake,
  Sun,
  Wallet as WalletIcon,
} from "lucide-react";
import {
  FEATURE_ROLE_DESCRIPTIONS,
  FEATURE_ROLES,
  SELECTABLE_BASE_ROLES,
  baseRoleOf,
  freezeErrorMessage,
  grantRole,
  listDirectoryUsers,
  revokeRole,
  roleChangeErrorMessage,
  roleLabel,
  setUserFrozen,
  sortRolesForDisplay,
} from "@/lib/adminConsole";
import { toUserFacingError } from "@/utils/userFacingError";

interface ProfileRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
  is_frozen: boolean | null;
  frozen_at: string | null;
  frozen_reason: string | null;
}

interface WalletRow {
  id: string;
  currency: string;
  balance: number;
  status: string;
  created_at: string;
}

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  created_at: string;
}

interface PaymentLinkRow {
  id: string;
  title: string | null;
  link_code: string;
  amount: number | null;
  currency: string;
  status: string;
  total_collected: number;
  payment_count: number;
  created_at: string;
}

interface CryptoWalletRow {
  id: string;
  asset: string;
  balance_sats: number;
  available_sats: number;
  updated_at: string;
}

interface BtcDepositRow {
  id: string;
  address: string;
  txid: string;
  amount_sats: number;
  confirmations: number;
  status: string;
  created_at: string;
}

const roleBadgeVariant = (role: string) =>
  role === "super_admin" || role === "admin"
    ? "destructive"
    : role === "business"
      ? "default"
      : "secondary";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";
const fmtMoney = (currency: string, amount: number) =>
  `${currency} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fmtSats = (sats: number) => `${Number(sats).toLocaleString()} sats`;
const truncateMiddle = (value: string, keep = 10) =>
  value.length <= keep * 2 + 3
    ? value
    : `${value.slice(0, keep)}…${value.slice(-keep)}`;

const SectionError = ({ message }: { message: string }) => (
  <p className="text-sm text-destructive py-4 text-center">{message}</p>
);

const EmptyRow = ({ colSpan, text }: { colSpan: number; text: string }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6">
      {text}
    </TableCell>
  </TableRow>
);

const AdminUserDetail = () => {
  const { userId } = useParams<{ userId: string }>();
  const { toast } = useToast();
  const { roles: viewerRoles, hasRole } = useRoles();
  const viewerIsSuperAdmin = hasRole("super_admin");

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkRow[]>([]);
  const [cryptoWallets, setCryptoWallets] = useState<CryptoWalletRow[]>([]);
  const [btcDeposits, setBtcDeposits] = useState<BtcDepositRow[]>([]);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  const [freezeReason, setFreezeReason] = useState("");
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [freezeBusy, setFreezeBusy] = useState(false);

  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [confirmElevated, setConfirmElevated] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [directory, profileRes, rolesRes] = await Promise.all([
        listDirectoryUsers(supabase as never).catch(() => []),
        (supabase as any)
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);

      if (profileRes.error) throw profileRes.error;
      if (!profileRes.data) {
        setLoadError(
          "We couldn't find that user. They may have been removed — go back to the user list and try again.",
        );
        setProfile(null);
        return;
      }
      setProfile(profileRes.data as ProfileRow);
      const dirRow = directory.find((d) => d.user_id === userId);
      setEmail(dirRow?.email ?? null);
      setUserRoles((rolesRes.data || []).map((r) => r.role as string));
    } catch (err) {
      setLoadError(
        toUserFacingError(err, "We couldn't load this user's account. Please try again."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const loadSections = useCallback(async () => {
    if (!userId) return;
    const errors: Record<string, string> = {};
    const run = async <T,>(
      key: string,
      query: Promise<{ data: T[] | null; error: unknown }>,
      apply: (rows: T[]) => void,
    ) => {
      const { data, error } = await query;
      if (error) {
        errors[key] = toUserFacingError(
          error,
          "We couldn't load this section. Please refresh the page and try again.",
        );
      } else {
        apply(data || []);
      }
    };
    await Promise.all([
      run<WalletRow>(
        "wallets",
        supabase
          .from("wallets")
          .select("id, currency, balance, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }) as never,
        setWallets,
      ),
      run<AccountRow>(
        "accounts",
        supabase
          .from("accounts")
          .select("id, name, kind, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }) as never,
        setAccounts,
      ),
      run<PaymentLinkRow>(
        "paymentLinks",
        supabase
          .from("payment_links")
          .select("id, title, link_code, amount, currency, status, total_collected, payment_count, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }) as never,
        setPaymentLinks,
      ),
      run<CryptoWalletRow>(
        "cryptoWallets",
        supabase
          .from("crypto_wallets")
          .select("id, asset, balance_sats, available_sats, updated_at")
          .eq("user_id", userId) as never,
        setCryptoWallets,
      ),
      run<BtcDepositRow>(
        "btcDeposits",
        (supabase as any)
          .from("btc_deposits")
          .select("id, address, txid, amount_sats, confirmations, status, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        setBtcDeposits,
      ),
    ]);
    setSectionErrors(errors);
  }, [userId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
    loadUser();
    loadSections();
  }, [loadUser, loadSections]);

  const isFrozen = profile?.is_frozen === true;
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "No name";

  // ---- Freeze / unfreeze -------------------------------------------------

  const handleFreeze = async () => {
    if (!userId || !profile) return;
    const reason = freezeReason.trim();
    if (!reason) {
      toast({
        title: "A reason is required",
        description: "Write why this account is being frozen — the reason is kept on the account record and in the audit log.",
        variant: "destructive",
      });
      return;
    }
    setFreezeBusy(true);
    try {
      await setUserFrozen(supabase as never, userId, true, reason);
      setProfile({ ...profile, is_frozen: true, frozen_at: new Date().toISOString(), frozen_reason: reason });
      setFreezeReason("");
      setConfirmFreeze(false);
      toast({
        title: "Account frozen",
        description: `${fullName} can still receive money and sign in, but sending, transfers and payouts are now blocked.`,
      });
    } catch (err) {
      toast({ title: "Couldn't freeze this account", description: freezeErrorMessage(err), variant: "destructive" });
    } finally {
      setFreezeBusy(false);
    }
  };

  const handleUnfreeze = async () => {
    if (!userId || !profile) return;
    setFreezeBusy(true);
    try {
      await setUserFrozen(supabase as never, userId, false, null);
      setProfile({ ...profile, is_frozen: false, frozen_at: null, frozen_reason: null });
      toast({
        title: "Account unfrozen",
        description: `${fullName} can send, transfer and withdraw again.`,
      });
    } catch (err) {
      toast({ title: "Couldn't unfreeze this account", description: freezeErrorMessage(err), variant: "destructive" });
    } finally {
      setFreezeBusy(false);
    }
  };

  // ---- Role management ---------------------------------------------------

  const refreshRoles = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    setUserRoles((data || []).map((r) => r.role as string));
  };

  const handleGrantRole = async (role: string) => {
    if (!userId) return;
    setRoleBusy(role);
    try {
      await grantRole(supabase as never, userId, role);
      toast({ title: "Role granted", description: `${fullName} now holds the ${roleLabel(role)} role.` });
      setConfirmElevated(null);
      await refreshRoles();
    } catch (err) {
      toast({ title: "Couldn't grant that role", description: roleChangeErrorMessage(err, role), variant: "destructive" });
    } finally {
      setRoleBusy(null);
    }
  };

  const handleRevokeRole = async (role: string) => {
    if (!userId) return;
    if (role === "admin" && userId === currentUserId) {
      toast({
        title: "Not allowed",
        description: "You cannot remove your own admin role.",
        variant: "destructive",
      });
      return;
    }
    if (role === "super_admin" && userId === currentUserId) {
      toast({
        title: "Not allowed",
        description: "You cannot remove your own super admin role — another super admin would have to do it.",
        variant: "destructive",
      });
      return;
    }
    setRoleBusy(role);
    try {
      await revokeRole(supabase as never, userId, role);
      toast({ title: "Role removed", description: `${fullName} no longer holds the ${roleLabel(role)} role.` });
      setConfirmElevated(null);
      await refreshRoles();
    } catch (err) {
      toast({ title: "Couldn't remove that role", description: roleChangeErrorMessage(err, role), variant: "destructive" });
    } finally {
      setRoleBusy(null);
    }
  };

  const handleSetBaseRole = async (newBaseRole: string) => {
    if (!userId || baseRoleOf(userRoles) === newBaseRole) return;
    setRoleBusy("base");
    // Replace only the base role rows — elevated rows are never touched
    // here (a plain admin's delete would refuse them at the database).
    const { error: deleteError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .in("role", [...SELECTABLE_BASE_ROLES] as never);
    if (deleteError) {
      setRoleBusy(null);
      toast({ title: "Couldn't update the base role", description: roleChangeErrorMessage(deleteError, newBaseRole), variant: "destructive" });
      return;
    }
    try {
      await grantRole(supabase as never, userId, newBaseRole);
      toast({ title: "Base role updated", description: `${fullName} now has the ${roleLabel(newBaseRole)} role.` });
      await refreshRoles();
    } catch (err) {
      toast({ title: "Couldn't update the base role", description: roleChangeErrorMessage(err, newBaseRole), variant: "destructive" });
      await refreshRoles();
    } finally {
      setRoleBusy(null);
    }
  };

  const elevatedControl = (role: string) => {
    const held = userRoles.includes(role);
    const busy = roleBusy === role;
    if (!held && confirmElevated === role) {
      return (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmElevated(null)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleGrantRole(role)}>
            Confirm grant {roleLabel(role)}?
          </Button>
        </div>
      );
    }
    return held ? (
      <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleRevokeRole(role)}>
        Remove
      </Button>
    ) : (
      <Button variant="default" size="sm" disabled={busy} onClick={() => setConfirmElevated(role)}>
        <Shield className="h-4 w-4 mr-1" />
        Grant
      </Button>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to user list
        </Link>

        {loadError || !profile ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-destructive mb-4">
                {loadError || "We couldn't load this user's account. Please try again."}
              </p>
              <Button variant="outline" onClick={loadUser}>Try again</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-1">{fullName}</h1>
              <p className="text-muted-foreground">
                Full account view — everything below is read from the live account records.
              </p>
            </div>

            {isFrozen && (
              <Card className="border-destructive">
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="flex items-center gap-2 font-semibold text-destructive">
                    <Snowflake className="h-5 w-5" /> This account is frozen
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Frozen {fmtDateTime(profile.frozen_at)}
                    {profile.frozen_reason ? ` — ${profile.frozen_reason}` : ""}
                  </span>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Overview */}
              <Card>
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Email</span>
                    <span className="text-right">{email || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Phone</span>
                    <span>{profile.phone || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">User ID</span>
                    <span className="font-mono text-xs break-all text-right">{profile.id}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Joined</span>
                    <span>{fmtDateTime(profile.created_at)}</span>
                  </div>
                  <div className="flex justify-between items-start gap-4">
                    <span className="text-muted-foreground">Roles</span>
                    <div className="flex flex-wrap justify-end gap-1">
                      {sortRolesForDisplay(userRoles).map((r) => (
                        <Badge key={r} variant={roleBadgeVariant(r)}>
                          {roleLabel(r)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Freeze control */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {isFrozen ? <Snowflake className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    Account freeze
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isFrozen ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        This account is frozen. It can still receive money and sign in,
                        but sending, transfers, card funding and payouts are blocked.
                      </p>
                      <Button onClick={handleUnfreeze} disabled={freezeBusy}>
                        <Sun className="h-4 w-4 mr-1" />
                        Unfreeze account
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Freezing blocks money leaving this account (sends, transfers,
                        card funding, payouts) while leaving sign-in and incoming money
                        untouched. A reason is required and is written to the audit log.
                      </p>
                      <Textarea
                        placeholder="Reason for freezing (required)"
                        value={freezeReason}
                        onChange={(e) => setFreezeReason(e.target.value)}
                        rows={2}
                      />
                      {confirmFreeze ? (
                        <div className="flex gap-2">
                          <Button variant="outline" disabled={freezeBusy} onClick={() => setConfirmFreeze(false)}>
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={freezeBusy || !freezeReason.trim()}
                            onClick={handleFreeze}
                          >
                            Confirm freeze
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="destructive"
                          disabled={freezeBusy || !freezeReason.trim()}
                          onClick={() => setConfirmFreeze(true)}
                        >
                          <Snowflake className="h-4 w-4 mr-1" />
                          Freeze account
                        </Button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Role management */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" /> Role management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Base role</p>
                    <p className="text-xs text-muted-foreground">
                      The everyday role this account signs in with.
                    </p>
                  </div>
                  <Select
                    value={baseRoleOf(userRoles)}
                    onValueChange={handleSetBaseRole}
                    disabled={roleBusy === "base"}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Base role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="beta_tester">Beta Tester</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Admin</p>
                      <p className="text-xs text-muted-foreground">
                        Full admin console access.
                      </p>
                    </div>
                    {elevatedControl("admin")}
                  </div>

                  {FEATURE_ROLES.map((role) => (
                    <div key={role} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{roleLabel(role)}</p>
                        <p className="text-xs text-muted-foreground">
                          {FEATURE_ROLE_DESCRIPTIONS[role]}
                        </p>
                      </div>
                      {elevatedControl(role)}
                    </div>
                  ))}

                  <p className="text-xs text-muted-foreground">
                    Elevated roles (Admin, Super Admin and the per-feature admin roles)
                    can only be granted or removed by a super admin — the database
                    enforces this, and a refusal will be explained here rather than hidden.
                  </p>
                </div>

                {viewerIsSuperAdmin && (
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">Super Admin</p>
                        <p className="text-xs text-muted-foreground">
                          The top tier: manages every role, can never be frozen, and is
                          the only tier that can grant or remove elevated roles. Only
                          visible to super admins.
                        </p>
                      </div>
                      {elevatedControl("super_admin")}
                    </div>
                    {userId === currentUserId && (
                      <p className="text-xs text-muted-foreground mt-2">
                        This is your own account — you cannot remove your own super
                        admin role.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Wallets */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <WalletIcon className="h-5 w-5" /> Wallets ({wallets.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectionErrors.wallets ? (
                  <SectionError message={sectionErrors.wallets} />
                ) : (
                  <Table className="[&_td]:px-2.5 [&_th]:px-2.5 md:[&_td]:px-4 md:[&_th]:px-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Currency</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wallets.map((w) => (
                        <TableRow key={w.id}>
                          <TableCell className="font-medium">{w.currency}</TableCell>
                          <TableCell>{fmtMoney(w.currency, w.balance)}</TableCell>
                          <TableCell>
                            <Badge variant={w.status === "active" ? "default" : "secondary"}>
                              {w.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{fmtDate(w.created_at)}</TableCell>
                        </TableRow>
                      ))}
                      {wallets.length === 0 && <EmptyRow colSpan={4} text="No wallets" />}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Accounts */}
            <Card>
              <CardHeader>
                <CardTitle>Accounts ({accounts.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {sectionErrors.accounts ? (
                  <SectionError message={sectionErrors.accounts} />
                ) : (
                  <Table className="[&_td]:px-2.5 [&_th]:px-2.5 md:[&_td]:px-4 md:[&_th]:px-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell>{a.kind}</TableCell>
                          <TableCell>
                            <Badge variant={a.status === "active" ? "default" : "secondary"}>
                              {a.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{fmtDate(a.created_at)}</TableCell>
                        </TableRow>
                      ))}
                      {accounts.length === 0 && <EmptyRow colSpan={4} text="No accounts" />}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Payment links */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" /> Payment links ({paymentLinks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectionErrors.paymentLinks ? (
                  <SectionError message={sectionErrors.paymentLinks} />
                ) : (
                  <Table className="[&_td]:px-2.5 [&_th]:px-2.5 md:[&_td]:px-4 md:[&_th]:px-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead className="hidden md:table-cell">Code</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Collected</TableHead>
                        <TableHead>Payments</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentLinks.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="max-w-[120px] truncate font-medium md:max-w-none">{l.title || "—"}</TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">{l.link_code}</TableCell>
                          <TableCell>
                            {l.amount != null ? fmtMoney(l.currency, l.amount) : "Any amount"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={l.status === "active" ? "default" : "secondary"}>
                              {l.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{fmtMoney(l.currency, l.total_collected)}</TableCell>
                          <TableCell>{l.payment_count}</TableCell>
                        </TableRow>
                      ))}
                      {paymentLinks.length === 0 && (
                        <EmptyRow colSpan={6} text="No payment links" />
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Crypto wallets */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bitcoin className="h-5 w-5" /> Crypto wallets ({cryptoWallets.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectionErrors.cryptoWallets ? (
                  <SectionError message={sectionErrors.cryptoWallets} />
                ) : (
                  <Table className="[&_td]:px-2.5 [&_th]:px-2.5 md:[&_td]:px-4 md:[&_th]:px-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead className="hidden md:table-cell">Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cryptoWallets.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.asset}</TableCell>
                          <TableCell>{fmtSats(c.balance_sats)}</TableCell>
                          <TableCell>{fmtSats(c.available_sats)}</TableCell>
                          <TableCell className="hidden md:table-cell">{fmtDate(c.updated_at)}</TableCell>
                        </TableRow>
                      ))}
                      {cryptoWallets.length === 0 && (
                        <EmptyRow colSpan={4} text="No crypto wallets" />
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* BTC deposits */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" /> Bitcoin deposits ({btcDeposits.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sectionErrors.btcDeposits ? (
                  <SectionError message={sectionErrors.btcDeposits} />
                ) : (
                  <Table className="[&_td]:px-2.5 [&_th]:px-2.5 md:[&_td]:px-4 md:[&_th]:px-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Address</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead className="hidden md:table-cell">Confirmations</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Transaction</TableHead>
                        <TableHead className="hidden md:table-cell">Detected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {btcDeposits.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">
                            {truncateMiddle(d.address)}
                          </TableCell>
                          <TableCell>{fmtSats(d.amount_sats)}</TableCell>
                          <TableCell className="hidden md:table-cell">{d.confirmations}</TableCell>
                          <TableCell>
                            <Badge variant={d.status === "credited" ? "default" : "secondary"}>
                              {d.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {truncateMiddle(d.txid)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{fmtDate(d.created_at)}</TableCell>
                        </TableRow>
                      ))}
                      {btcDeposits.length === 0 && (
                        <EmptyRow colSpan={6} text="No Bitcoin deposits" />
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Oversight is read-only: balances and records above can be viewed by
              admins but never edited from this console — money only moves through
              the platform's audited payment paths. Role changes and freezes are
              recorded in the audit logs.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AdminUserDetail;
