import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeftRight, Loader2, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  newIdempotencyKey,
  P2pActionError,
  transferP2pAccount,
} from "@/services/p2pService";
import { useInvalidateP2p, useP2pAccount } from "@/hooks/useP2p";
import {
  formatBtcFromSats,
  formatSats,
  maxTransferableToMainSats,
} from "@/utils/p2pUi";

export type P2pTransferDirection = "to_p2p" | "to_main";

/**
 * Move sats between the main wallet and the separate P2P account.
 *
 * One idempotency key per intent: a fresh key is generated when the
 * dialog opens, and — mirroring the AdCard pattern — regenerated
 * after a failed attempt, because the intent may have changed.
 * Server refusals (frozen account, insufficient available, sats
 * still inside the safety hold) arrive as P2pActionError with
 * crafted plain-language messages and surface inline, verbatim.
 */
export function P2pTransferDialog({
  open,
  onOpenChange,
  initialDirection = "to_p2p",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDirection?: P2pTransferDirection;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const accountQuery = useP2pAccount(open);
  const account = accountQuery.data;

  const [direction, setDirection] = useState<P2pTransferDirection>(initialDirection);
  const [amountInput, setAmountInput] = useState("");
  const [idemKey, setIdemKey] = useState<string>(() => newIdempotencyKey());
  const [formError, setFormError] = useState<string | null>(null);

  // Fresh intent (and fresh idempotency key) every time the dialog opens.
  useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setAmountInput("");
      setFormError(null);
      setIdemKey(newIdempotencyKey());
    }
  }, [open, initialDirection]);

  const unmaturedHoldsSats = account?.unmatured_holds_sats ?? 0;
  const maxSats =
    direction === "to_p2p"
      ? (account?.main.available_sats ?? 0)
      : (account?.transferable_to_main_sats ??
        maxTransferableToMainSats(account?.p2p.available_sats ?? 0, unmaturedHoldsSats));
  const sourceAvailableSats =
    direction === "to_p2p" ? account?.main.available_sats : account?.p2p.available_sats;

  const amountSats = Number(amountInput);
  const amountValid = Number.isFinite(amountSats) && amountSats > 0;
  const amountInteger = amountValid ? Math.trunc(amountSats) : 0;

  const transfer = useMutation({
    mutationFn: () =>
      transferP2pAccount(direction, amountInteger, idemKey),
    onSuccess: (result) => {
      toast({
        title: "Transfer complete",
        description: `${formatSats(result.amount_sats)} moved to your ${
          direction === "to_p2p" ? "P2P account" : "main wallet"
        }.`,
      });
      invalidate();
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      // A failed attempt must not replay the same key on the next
      // try — the intent changed, so the key does too.
      setIdemKey(newIdempotencyKey());
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "The transfer could not be completed. Please try again.",
      );
    },
  });

  const submit = () => {
    setFormError(null);
    if (!amountValid || amountSats !== amountInteger) {
      setFormError("Enter the amount in sats — a whole number, for example 50000.");
      return;
    }
    if (amountInteger > maxSats) {
      setFormError(
        direction === "to_p2p"
          ? `You can move at most ${formatSats(maxSats)} — that is what is available in your main wallet.`
          : `You can move at most ${formatSats(maxSats)} back to your main wallet right now.`,
      );
      return;
    }
    transfer.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Bitcoin between your accounts</DialogTitle>
          <DialogDescription>
            Moving Bitcoin between your main wallet and your P2P account is
            free. Trades only ever use the P2P account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <Button
              type="button"
              variant={direction === "to_p2p" ? "default" : "ghost"}
              className="rounded-none flex-1"
              onClick={() => {
                setDirection("to_p2p");
                setFormError(null);
              }}
            >
              To P2P account
            </Button>
            <Button
              type="button"
              variant={direction === "to_main" ? "default" : "ghost"}
              className="rounded-none flex-1"
              onClick={() => {
                setDirection("to_main");
                setFormError(null);
              }}
            >
              To main wallet
            </Button>
          </div>

          {accountQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : accountQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                We couldn&apos;t load your balances. Close this and try again.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {direction === "to_p2p" ? "From your main wallet" : "From your P2P account"}
              {" — "}
              {sourceAvailableSats !== undefined
                ? `${formatSats(sourceAvailableSats)} available`
                : "—"}
              {direction === "to_main" &&
                ` · ${formatSats(maxSats)} can move to your main wallet now`}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="p2p-transfer-amount">Amount (sats)</Label>
            <div className="flex gap-2">
              <Input
                id="p2p-transfer-amount"
                type="number"
                min={0}
                step={1}
                placeholder="e.g. 50000"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmountInput(String(maxSats))}
                disabled={!account || maxSats <= 0}
              >
                Max
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">
              ≈ {formatBtcFromSats(amountValid ? amountInteger : 0)} BTC
            </p>
          </div>

          {direction === "to_main" && unmaturedHoldsSats > 0 && (
            <p className="text-sm text-muted-foreground">
              {formatSats(unmaturedHoldsSats)} are inside the 24-hour safety hold
              and stay in your P2P account for now.
            </p>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={transfer.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={transfer.isPending || accountQuery.isLoading || !account}
          >
            {transfer.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {direction === "to_p2p" ? "Move to P2P account" : "Move to main wallet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The separate P2P (funding) account, Binance-style: trades lock and
 * settle from this balance, never from the main wallet. Shows the
 * balance, what is available to trade or move, and what the T+1
 * safety hold is still covering.
 */
export function P2pAccountCard() {
  const accountQuery = useP2pAccount();
  const [transferOpen, setTransferOpen] = useState(false);
  const account = accountQuery.data;

  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f7931a]/15 text-[#f7931a]">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold">P2P account</div>
              <p className="text-xs text-muted-foreground max-w-md">
                Trades run from this account; your main wallet is never touched
                by trades.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setTransferOpen(true)}
            disabled={accountQuery.isLoading || accountQuery.isError}
            className="gap-2"
          >
            <ArrowLeftRight className="h-4 w-4" /> Transfer
          </Button>
        </div>

        <div className="mt-4">
          {accountQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : accountQuery.isError || !account ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load your P2P account right now.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void accountQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Balance</div>
                <div className="font-mono font-medium">
                  {formatBtcFromSats(account.p2p.balance_sats)} BTC
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatSats(account.p2p.balance_sats)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="font-mono font-medium">
                  {formatBtcFromSats(account.p2p.available_sats)} BTC
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatSats(account.p2p.available_sats)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Held by the 24-hour safety hold
                </div>
                <div className="font-mono font-medium">
                  {formatBtcFromSats(account.unmatured_holds_sats)} BTC
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatSats(account.unmatured_holds_sats)}
                </div>
              </div>
            </div>
          )}
        </div>

        <P2pTransferDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          initialDirection="to_p2p"
        />
      </CardContent>
    </Card>
  );
}
