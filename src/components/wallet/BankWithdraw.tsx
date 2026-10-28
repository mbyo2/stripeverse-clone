import { toUserFacingError } from "@/utils/userFacingError";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Info, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useToast } from "@/hooks/use-toast";
import { invalidateMoneyState } from "@/utils/moneyFreshness";
import {
  BANK_PAYOUTS_ACTIVATING_MESSAGE,
  bankAccountNameMatches,
  bankWithdrawalStatusLabel,
  computeBankPayoutFee,
  ZAMBIAN_BANKS,
} from "@/utils/bankPayout";

interface WalletLike {
  id: string;
  currency: string;
  balance?: number;
}

interface BankSettings {
  enabled: boolean;
  fee_percent: number;
  min_zmw: number;
}

interface BankMethod {
  id: string;
  bank_name: string;
  bank_code: string | null;
  account_name: string;
  account_number_masked: string;
  is_primary: boolean;
}

interface BankWithdrawalView {
  id: string;
  amount: number;
  currency: string;
  fee_amount: number;
  bank_name: string;
  account_name: string;
  account_number_masked: string;
  status: string;
  failure_reason: string | null;
  external_reference: string | null;
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

async function invokeBankPayout(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("bank-payout", { body });
  if (error || !data?.success) {
    throw new Error(await functionErrorMessage(error, data));
  }
  return data;
}

/**
 * Withdraw to a Zambian bank account — the bank cash-out leg
 * (migration 20261245). Bank payouts are ZMW only, from the ZMW
 * wallet: the reserve happens at request time, an admin reviews,
 * an operator pays from the platform's bank account, and the
 * withdrawal completes when it is marked paid with the bank's
 * reference. While platform_settings.bank_payouts_enabled is off
 * the form is replaced by the honest activating state BEFORE any
 * amount can be entered — but saved bank accounts stay manageable
 * and history stays visible, exactly like the PayPal rail gate.
 */
const BankWithdraw = ({ wallet }: { wallet: WalletLike | null }) => {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newBankCode, setNewBankCode] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountNumber, setNewAccountNumber] = useState("");

  const holderName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  const settingsQuery = useQuery({
    queryKey: ["bank-payout-settings"],
    enabled: !!user?.id,
    queryFn: async () => (await invokeBankPayout({ action: "settings" })) as BankSettings,
  });

  const methodsQuery = useQuery({
    queryKey: ["bank-payout-methods", user?.id],
    enabled: !!user?.id,
    queryFn: async () =>
      ((await invokeBankPayout({ action: "methods_list" }))?.methods ?? []) as BankMethod[],
  });

  const historyQuery = useQuery({
    queryKey: ["bank-withdrawals", user?.id],
    enabled: !!user?.id,
    queryFn: async () =>
      ((await invokeBankPayout({ action: "list" }))?.withdrawals ?? []) as BankWithdrawalView[],
  });

  // Fail closed while the gate state is unknown: the form only
  // becomes submittable once the settings response has positively
  // said the rail is on. (The function enforces the same gate
  // before any reservation.)
  const settings = settingsQuery.data;
  const payoutsEnabled = settings?.enabled === true;
  const feePercent = settings?.fee_percent ?? 0;
  const minZmw = settings?.min_zmw ?? 50;

  const methods = methodsQuery.data ?? [];
  const selectedMethod = methods.find((m) => m.id === methodId) ?? methods[0];
  const nameMismatch =
    !!selectedMethod &&
    holderName.length > 0 &&
    !bankAccountNameMatches(selectedMethod.account_name, holderName);

  const parsedAmount = parseFloat(amount);
  const fee =
    !isNaN(parsedAmount) && parsedAmount > 0
      ? computeBankPayoutFee(parsedAmount, feePercent)
      : 0;
  const total = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount + fee : 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-withdrawals"] });
    queryClient.invalidateQueries({ queryKey: ["bank-payout-methods"] });
    invalidateMoneyState(queryClient);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("User not authenticated");
      if (!selectedMethod) throw new Error("Save a bank account first.");
      return invokeBankPayout({
        action: "create",
        amount: parsedAmount,
        bank_account_id: selectedMethod.id,
        wallet_id: wallet?.id,
        idempotency_key: `bank-payout-${user.id}-${Date.now()}`,
      });
    },
    onSuccess: (data) => {
      setAmount("");
      refresh();
      toast({
        title: "Withdrawal requested",
        description:
          data.message ||
          "Your withdrawal is reserved and waiting for review.",
      });
    },
    onError: (error: any) => {
      refresh();
      toast({
        title: "Withdrawal not completed",
        description: toUserFacingError(error, "An unknown error occurred"),
        variant: "destructive",
      });
    },
  });

  const addMethodMutation = useMutation({
    mutationFn: async () =>
      invokeBankPayout({
        action: "methods_add",
        bank_code: newBankCode,
        account_name: newAccountName.trim(),
        account_number: newAccountNumber.trim(),
      }),
    onSuccess: () => {
      setShowAdd(false);
      setNewBankCode("");
      setNewAccountName("");
      setNewAccountNumber("");
      refresh();
      toast({ title: "Bank account saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't save the bank account",
        description: toUserFacingError(error, "An unknown error occurred"),
        variant: "destructive",
      });
    },
  });

  const removeMethodMutation = useMutation({
    mutationFn: async (id: string) =>
      invokeBankPayout({ action: "methods_remove", bank_account_id: id }),
    onSuccess: () => refresh(),
    onError: (error: any) => {
      toast({
        title: "Couldn't remove the bank account",
        description: toUserFacingError(error, "An unknown error occurred"),
        variant: "destructive",
      });
    },
  });

  const methodsSection = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Your bank account</Label>
        {!showAdd && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdd(true)}
            className="h-8 px-2"
          >
            <Plus className="h-4 w-4 mr-1" /> Add account
          </Button>
        )}
      </div>
      {methods.length > 0 && !showAdd && (
        <div className="space-y-2">
          <Select
            value={selectedMethod?.id ?? ""}
            onValueChange={setMethodId}
          >
            <SelectTrigger className="h-12 rounded-lg">
              <SelectValue placeholder="Choose a bank account" />
            </SelectTrigger>
            <SelectContent>
              {methods.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.bank_name} — {m.account_number_masked} ({m.account_name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedMethod && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Pays to {selectedMethod.account_name},{" "}
                {selectedMethod.account_number_masked}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => removeMethodMutation.mutate(selectedMethod.id)}
                aria-label="Remove this bank account"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
          {nameMismatch && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                The name on this bank account ({selectedMethod.account_name})
                doesn't match your BMaGlass Pay name ({holderName}). The
                withdrawal can still be requested, but payouts to an account
                in a different name get extra review — double-check this is
                the right account.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {(showAdd || methods.length === 0) && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Bank</Label>
            <Select value={newBankCode} onValueChange={setNewBankCode}>
              <SelectTrigger className="h-11 rounded-lg">
                <SelectValue placeholder="Choose your bank" />
              </SelectTrigger>
              <SelectContent>
                {ZAMBIAN_BANKS.map((b) => (
                  <SelectItem key={b.code} value={b.code}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name on the account</Label>
            <Input
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="As it appears at the bank"
              className="h-11 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account number</Label>
            <Input
              value={newAccountNumber}
              onChange={(e) => setNewAccountNumber(e.target.value)}
              placeholder="Digits only"
              inputMode="numeric"
              className="h-11 rounded-lg"
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 h-11 rounded-full"
              onClick={() => addMethodMutation.mutate()}
              disabled={
                !newBankCode ||
                newAccountName.trim().length < 2 ||
                newAccountNumber.trim().length < 6 ||
                addMethodMutation.isPending
              }
            >
              {addMethodMutation.isPending ? "Saving..." : "Save bank account"}
            </Button>
            {methods.length > 0 && (
              <Button
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const history = <BankWithdrawalHistory rows={historyQuery.data ?? []} />;

  // Rail gate (migration 20261245): while bank payouts activation
  // is incomplete the rail cannot settle ANY withdrawal, so the
  // amount form is replaced by the honest activating state BEFORE
  // the user can walk into a reservation that cannot complete.
  // Saved accounts and history stay available below.
  if (settingsQuery.isSuccess && !payoutsEnabled) {
    return (
      <div className="space-y-5 p-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{BANK_PAYOUTS_ACTIVATING_MESSAGE}</AlertDescription>
        </Alert>
        {methodsSection}
        {history}
      </div>
    );
  }

  if (wallet && wallet.currency !== "ZMW") {
    return (
      <div className="space-y-5 p-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Bank withdrawals are paid in Zambian kwacha (ZMW) to a Zambian
            bank, so they're made from your ZMW wallet. Convert your balance
            to ZMW first (Multi-Currency page), then withdraw from that
            wallet.
          </AlertDescription>
        </Alert>
        {methodsSection}
        {history}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {methodsSection}
      <div className="space-y-2">
        <Label htmlFor="bank-payout-amount" className="text-sm font-medium">
          Amount (ZMW)
        </Label>
        <Input
          id="bank-payout-amount"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="text-2xl h-14 font-semibold text-center rounded-lg"
          min="0"
        />
        <p className="text-xs text-muted-foreground text-center">
          Minimum K{minZmw.toFixed(2)} · Paid to your Zambian bank after review
        </p>
        {wallet?.balance !== undefined && (
          <p className="text-xs text-muted-foreground text-center">
            ZMW wallet balance: K{Number(wallet.balance).toFixed(2)}
          </p>
        )}
      </div>
      {parsedAmount > 0 && (
        <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Your bank receives</span>
            <span className="font-medium">{parsedAmount.toFixed(2)} ZMW</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Fee{feePercent > 0 ? ` (${feePercent}%)` : ""}
            </span>
            <span className="font-medium">{fee.toFixed(2)} ZMW</span>
          </div>
          <div className="flex justify-between border-t pt-1">
            <span className="text-muted-foreground">Taken from your wallet</span>
            <span className="font-semibold">{total.toFixed(2)} ZMW</span>
          </div>
        </div>
      )}
      <Button
        onClick={() => createMutation.mutate()}
        className="w-full h-12 rounded-full text-base font-semibold"
        disabled={
          !payoutsEnabled ||
          !selectedMethod ||
          isNaN(parsedAmount) ||
          parsedAmount < minZmw ||
          createMutation.isPending
        }
      >
        {createMutation.isPending ? "Requesting..." : "Withdraw to Bank"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        The amount is reserved in your wallet while the withdrawal is
        reviewed. If it can't be completed, the full amount — including any
        fee — returns to your wallet.
      </p>
      {history}
    </div>
  );
};

const BankWithdrawalHistory = ({ rows }: { rows: BankWithdrawalView[] }) => {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Bank withdrawals</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                K{row.amount.toFixed(2)} → {row.bank_name}{" "}
                {row.account_number_masked}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
                {row.status === "paid_out" && row.external_reference
                  ? ` · Bank ref: ${row.external_reference}`
                  : ""}
              </p>
              {(row.status === "rejected" || row.status === "failed") &&
                row.failure_reason && (
                  <p className="text-xs text-destructive">{row.failure_reason}</p>
                )}
            </div>
            <Badge
              variant={
                row.status === "paid_out"
                  ? "default"
                  : row.status === "rejected" || row.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="shrink-0"
            >
              {bankWithdrawalStatusLabel(row.status)}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BankWithdraw;
