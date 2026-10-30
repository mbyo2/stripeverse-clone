// ExistingPayoutsView — the data-stranding guard for the Wallet's
// Withdraw surface (CEO directive 2026-10-30, see
// src/lib/featureVisibility.ts). Withdrawals to PayPal and to a bank
// account are switched off, so regular users no longer see the
// withdraw forms at all — but a user who already saved a bank
// account or has a withdrawal in flight must never lose sight of
// their own records. This is that view: strictly read-only (saved
// bank accounts masked, withdrawal history with plain-language
// statuses), rendered in place of the withdraw panels for a
// non-admin who holds such records. It offers no action that moves
// money and no path into the switched-off forms.
//
// Reads go straight to the tables — all three carry owner SELECT
// policies — and account numbers are masked here, never displayed
// in full.

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Landmark, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { bankWithdrawalStatusLabel } from "@/utils/bankPayout";
import { payoutStatusLabel } from "@/utils/paypalPayout";
import { format } from "date-fns";

interface BankAccountRow {
  id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_primary: boolean;
}

interface BankWithdrawalRow {
  id: string;
  amount: number;
  currency: string;
  fee_amount: number;
  bank_name: string;
  account_number: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
}

interface PayPalWithdrawalRow {
  id: string;
  amount: number;
  currency: string;
  fee_amount: number;
  recipient_email: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
}

const maskAccountNumber = (value: string) =>
  value.length > 4 ? `•••• ${value.slice(-4)}` : "••••";

const fmt = (amount: number, currency: string) =>
  `${currency} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const ExistingPayoutsView = () => {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["existing-payouts", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // The payout tables are newer than the generated types — the
      // scoped cast the other payout readers use.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const [accounts, bankWithdrawals, paypalWithdrawals] =
        await Promise.all([
          db
            .from("bank_accounts")
            .select("id, bank_name, account_name, account_number, is_primary")
            .eq("user_id", user!.id)
            .order("created_at", { ascending: true }),
          db
            .from("bank_withdrawals")
            .select(
              "id, amount, currency, fee_amount, bank_name, account_number, status, failure_reason, created_at",
            )
            .eq("user_id", user!.id)
            .order("created_at", { ascending: false }),
          db
            .from("paypal_withdrawals")
            .select(
              "id, amount, currency, fee_amount, recipient_email, status, failure_reason, created_at",
            )
            .eq("user_id", user!.id)
            .order("created_at", { ascending: false }),
        ]);
      return {
        accounts: (accounts.data ?? []) as BankAccountRow[],
        bankWithdrawals: (bankWithdrawals.data ?? []) as BankWithdrawalRow[],
        paypalWithdrawals: (paypalWithdrawals.data ??
          []) as PayPalWithdrawalRow[],
      };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading your withdrawals">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const accounts = data?.accounts ?? [];
  const bankWithdrawals = data?.bankWithdrawals ?? [];
  const paypalWithdrawals = data?.paypalWithdrawals ?? [];
  const empty =
    accounts.length === 0 &&
    bankWithdrawals.length === 0 &&
    paypalWithdrawals.length === 0;

  return (
    <div className="space-y-5 p-4">
      <p className="text-sm text-muted-foreground">
        Withdrawals are paused right now, so no new withdrawal can be
        started. Your existing details and withdrawal history are
        below — nothing here has changed, and any withdrawal already
        in progress will still be completed.
      </p>

      {empty && (
        <p className="text-sm text-muted-foreground">
          You have no saved bank accounts or withdrawals yet.
        </p>
      )}

      {accounts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Landmark className="h-4 w-4" /> Saved bank accounts
          </h3>
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium">{account.bank_name}</p>
                <p className="text-xs text-muted-foreground">
                  {account.account_name} · {maskAccountNumber(account.account_number)}
                </p>
              </div>
              {account.is_primary && (
                <Badge variant="secondary">Primary</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {bankWithdrawals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Bank withdrawals
          </h3>
          {bankWithdrawals.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {fmt(Number(row.amount), row.currency)} to{" "}
                  {row.bank_name}
                </p>
                <Badge variant="outline">
                  {bankWithdrawalStatusLabel(row.status)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {maskAccountNumber(row.account_number)} ·{" "}
                {format(new Date(row.created_at), "d MMM yyyy, HH:mm")}
                {Number(row.fee_amount) > 0 &&
                  ` · Fee ${fmt(Number(row.fee_amount), row.currency)}`}
              </p>
              {row.failure_reason && (
                <p className="text-xs text-destructive mt-1">
                  {row.failure_reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {paypalWithdrawals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" /> PayPal withdrawals
          </h3>
          {paypalWithdrawals.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {fmt(Number(row.amount), row.currency)} to{" "}
                  {row.recipient_email}
                </p>
                <Badge variant="outline">{payoutStatusLabel(row.status)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(row.created_at), "d MMM yyyy, HH:mm")}
                {Number(row.fee_amount) > 0 &&
                  ` · Fee ${fmt(Number(row.fee_amount), row.currency)}`}
              </p>
              {row.failure_reason && (
                <p className="text-xs text-destructive mt-1">
                  {row.failure_reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExistingPayoutsView;
