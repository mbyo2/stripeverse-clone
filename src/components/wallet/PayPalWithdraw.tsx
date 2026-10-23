import { toUserFacingError } from "@/utils/userFacingError";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Info, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformSettings } from "@/hooks/useSubaccounts";
import { useToast } from "@/hooks/use-toast";
import { invalidateMoneyState } from "@/utils/moneyFreshness";
import { PAYPAL_AVAILABLE, PAYPAL_COMING_SOON_LABEL } from "@/config/paypal";
import {
  computePayoutFee,
  isPayPalPayoutCurrency,
  payoutStatusLabel,
  PAYPAL_PAYOUT_FEE_PERCENT_DEFAULT,
  PAYOUT_DAILY_LIMIT,
  PAYOUT_MIN_AMOUNT,
  ZMW_PAYOUT_MESSAGE,
} from "@/utils/paypalPayout";

interface WalletLike {
  id: string;
  currency: string;
  balance?: number;
}

interface WithdrawalView {
  id: string;
  amount: number;
  currency: string;
  fee_amount: number;
  recipient_email: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
}

/** The function's own plain-language error, never a generic one. */
async function functionErrorMessage(error: any, data: any): Promise<string> {
  if (data?.error) return data.error;
  const context = error?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
    } catch {
      // fall through to the generic message below
    }
  }
  return error?.message || "This withdrawal could not be processed. No money has moved.";
}

/**
 * Withdraw to PayPal — the fiat exit that pairs with PayPal
 * deposits. The form previews the fee and total; the server
 * (paypal-payout → reserve_paypal_withdrawal) recomputes
 * everything, enforces the provenance cap (you can withdraw to
 * PayPal at most the PayPal-sourced portion of your balance — the
 * mark follows the money when it's sent between users) and the
 * limits, and its refusal copy is shown verbatim. The available
 * figure below is an owner-read of that same counter
 * (paypal_provenance_balances, RLS owner SELECT).
 */
const PayPalWithdraw = ({ wallet }: { wallet: WalletLike | null }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = usePlatformSettings();
  const feePercent = Number(
    settings?.paypal_payout_fee_percent ?? PAYPAL_PAYOUT_FEE_PERCENT_DEFAULT,
  );

  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");

  const currency = wallet?.currency ?? "";
  const supported = isPayPalPayoutCurrency(currency);
  const parsedAmount = parseFloat(amount);
  const fee =
    !isNaN(parsedAmount) && parsedAmount > 0 ? computePayoutFee(parsedAmount, feePercent) : 0;
  const total = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount + fee : 0;

  const historyQuery = useQuery({
    queryKey: ["paypal-withdrawals", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("paypal-payout", {
        body: { action: "list" },
      });
      if (error) throw error;
      return (data?.withdrawals ?? []) as WithdrawalView[];
    },
  });

  // How much of this wallet's currency balance arrived via PayPal
  // and can therefore leave via PayPal — an owner-read of the
  // provenance counter the reserve RPC enforces (RLS: own rows
  // only). The table is not in the generated types yet, hence the
  // untyped client, the same pattern other untyped tables use.
  const provenanceQuery = useQuery({
    queryKey: ["paypal-provenance", user?.id, currency],
    enabled: !!user?.id && supported,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("paypal_provenance_balances")
        .select("sourced_amount")
        .eq("user_id", user!.id)
        .eq("currency", currency)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.sourced_amount) : 0;
    },
  });

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ["paypal-withdrawals"] });
    queryClient.invalidateQueries({ queryKey: ["paypal-provenance"] });
    // A created/refunded withdrawal changes the wallet balance and
    // the activity list too — refresh all money state, not just the
    // wallet root.
    invalidateMoneyState(queryClient);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("User not authenticated");
      const { data, error } = await supabase.functions.invoke("paypal-payout", {
        body: {
          action: "create",
          amount: parsedAmount,
          currency,
          recipient_email: email.trim(),
          wallet_id: wallet?.id,
          idempotency_key: `payout-${user.id}-${Date.now()}`,
        },
      });
      if (error || !data?.success) {
        throw new Error(await functionErrorMessage(error, data));
      }
      return data;
    },
    onSuccess: (data) => {
      setAmount("");
      refreshHistory();
      toast({
        title: data.status === "completed" ? "Withdrawal completed" : "Withdrawal sent",
        description:
          data.message ||
          "Your withdrawal is processing — it completes when PayPal confirms it.",
      });
    },
    onError: (error: any) => {
      refreshHistory();
      toast({
        title: "Withdrawal not completed",
        description: toUserFacingError(error, "An unknown error occurred"),
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (withdrawalId: string) => {
      const { data, error } = await supabase.functions.invoke("paypal-payout", {
        body: { action: "status", withdrawal_id: withdrawalId },
      });
      if (error || !data?.success) {
        throw new Error(await functionErrorMessage(error, data));
      }
      return data;
    },
    onSuccess: () => refreshHistory(),
    onError: (error: any) => {
      toast({
        title: "Couldn't refresh status",
        description: toUserFacingError(error, "An unknown error occurred"),
        variant: "destructive",
      });
    },
  });

  if (!PAYPAL_AVAILABLE) {
    return (
      <div className="space-y-5 p-4">
        <p className="text-sm text-muted-foreground text-center">
          PayPal withdrawals are {PAYPAL_COMING_SOON_LABEL.toLowerCase()} — they aren't available yet.
        </p>
        <WithdrawalHistory
          rows={historyQuery.data ?? []}
          onRefresh={(id) => statusMutation.mutate(id)}
          refreshing={statusMutation.isPending}
        />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="space-y-5 p-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {currency === "ZMW"
              ? ZMW_PAYOUT_MESSAGE
              : `PayPal withdrawals aren't supported in ${currency || "this currency"}. They are available from USD, EUR and GBP wallets (and other PayPal payout currencies).`}
          </AlertDescription>
        </Alert>
        <WithdrawalHistory
          rows={historyQuery.data ?? []}
          onRefresh={(id) => statusMutation.mutate(id)}
          refreshing={statusMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <Label htmlFor="payout-email" className="text-sm font-medium">
          Recipient PayPal email
        </Label>
        <Input
          id="payout-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 rounded-lg"
        />
        <p className="text-xs text-muted-foreground">
          The payout is sent to this PayPal account. You can withdraw up to the part of
          your balance that arrived via PayPal — it keeps that right when it's sent
          between users.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="payout-amount" className="text-sm font-medium">
          Amount ({currency})
        </Label>
        <Input
          id="payout-amount"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="text-2xl h-14 font-semibold text-center rounded-lg"
          min="0"
        />
        <p className="text-xs text-muted-foreground text-center">
          Minimum {PAYOUT_MIN_AMOUNT.toFixed(2)} {currency} · Daily limit{" "}
          {PAYOUT_DAILY_LIMIT.toLocaleString()}.00 {currency}
        </p>
        {provenanceQuery.data !== undefined && (
          <p className="text-xs text-muted-foreground text-center">
            Available to withdraw to PayPal: {provenanceQuery.data.toFixed(2)} {currency}
          </p>
        )}
      </div>
      {parsedAmount > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recipient receives</span>
            <span className="font-medium">
              {parsedAmount.toFixed(2)} {currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Fee{feePercent > 0 ? ` (${feePercent}%)` : ""}
            </span>
            <span className="font-medium">
              {fee.toFixed(2)} {currency}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1">
            <span className="text-muted-foreground">Taken from your wallet</span>
            <span className="font-semibold">
              {total.toFixed(2)} {currency}
            </span>
          </div>
        </div>
      )}
      <Button
        onClick={() => createMutation.mutate()}
        className="w-full h-12 rounded-full text-base font-semibold"
        disabled={
          !email.trim() ||
          isNaN(parsedAmount) ||
          parsedAmount < PAYOUT_MIN_AMOUNT ||
          createMutation.isPending
        }
      >
        {createMutation.isPending ? "Sending..." : "Withdraw to PayPal"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        A withdrawal shows as completed only when PayPal confirms it. If PayPal can't
        complete it, the full amount — including any fee — returns to your wallet.
      </p>
      <WithdrawalHistory
        rows={historyQuery.data ?? []}
        onRefresh={(id) => statusMutation.mutate(id)}
        refreshing={statusMutation.isPending}
      />
    </div>
  );
};

const WithdrawalHistory = ({
  rows,
  onRefresh,
  refreshing,
}: {
  rows: WithdrawalView[];
  onRefresh: (id: string) => void;
  refreshing: boolean;
}) => {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">PayPal withdrawals</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {row.amount.toFixed(2)} {row.currency} → {row.recipient_email}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </p>
              {row.status === "failed" && row.failure_reason && (
                <p className="text-xs text-destructive">{row.failure_reason}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={
                  row.status === "completed"
                    ? "default"
                    : row.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {payoutStatusLabel(row.status)}
              </Badge>
              {(row.status === "pending" || row.status === "processing") && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRefresh(row.id)}
                  disabled={refreshing}
                  aria-label="Refresh status"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PayPalWithdraw;
