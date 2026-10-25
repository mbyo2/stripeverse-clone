import { toUserFacingError } from "@/utils/userFacingError";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import { Skeleton } from "@/components/ui/skeleton";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowLeft,
  Bitcoin,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  createVault,
  unlockVault,
  vaultExists,
  deleteVault,
  getVaultMeta,
  MIN_PASSWORD_LENGTH,
} from "@/lib/selfcustody/vault";
import {
  generateWalletMnemonic,
  isValidMnemonic,
  accountFromMnemonic,
  accountXpub,
  deriveAddress,
  buildSignedTransaction,
} from "@/lib/selfcustody/wallet";
import { scanWallet, fetchRecommendedFeeRate, broadcastTransaction, type WalletScan } from "@/lib/selfcustody/chain";
import { loadLastKnown, saveLastKnown, clearLastKnown, type LastKnownWalletData } from "@/lib/selfcustody/lastKnown";
import { useSession, unlockSession, lockSession, touchSession } from "@/lib/selfcustody/session";
import {
  sparkEnabled,
  sparkBalanceSat,
  sparkReceiveBolt11,
  sparkReceiveBitcoinAddress,
  sparkReceiveSparkAddress,
  sparkParseInput,
  parsedFlow,
  parsedInputLabel,
  lnurlPayDetails,
  sparkPrepareSend,
  sparkSendPrepared,
  sparkPrepareLnurlPay,
  sparkSendLnurlPay,
  sparkLnurlWithdraw,
  sparkLnurlAuth,
  sparkListPayments,
  sparkBuyBitcoinUrl,
  disconnectSparkAndWipeStorage,
  sparkConnectionActive,
  shouldReconnectSpark,
  loadAutoClaimPreference,
  saveAutoClaimPreference,
  sparkListUnclaimedDeposits,
  sparkClaimDeposit,
  loadShowFiatPreference,
  saveShowFiatPreference,
  formatFiatEquivalent,
  type PreparedSend,
  type PreparedLnurlPay,
  type PaymentSummary,
  type AutoClaimPreference,
  type UnclaimedDepositSummary,
} from "@/lib/selfcustody/spark";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useExchangeRates } from "@/hooks/useMultiCurrency";
import { resolveExchangeRate } from "@/utils/exchangeRates";
import type { InputType } from "@breeztech/breez-sdk-spark/web";
import QRCode from "qrcode.react";

/**
 * SELF-CUSTODY Bitcoin wallet — keys exist only on this device.
 *
 * The seed phrase is generated in the browser, encrypted into an on-device
 * vault (see lib/selfcustody/vault.ts), and NEVER transmitted anywhere.
 * Balances are read from the public chain; sends are signed locally and
 * only the signed transaction is broadcast. BMaGlass cannot see, move, or
 * recover these funds — the UI says so plainly at every step.
 */

type Stage = "choose" | "backup-show" | "backup-verify" | "set-password" | "import" | "locked" | "wallet";

function formatBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
}

/**
 * Turn a chain-scan failure into something a user can act on. A blocked
 * or unreachable mempool.space surfaces from fetch() as the raw
 * TypeError "Failed to fetch" — meaningless on a money screen. HTTP
 * failures ("Chain data request failed (429)") are already informative
 * and pass through untouched.
 */
function friendlyScanError(e: any): string {
  const msg = typeof e?.message === "string" ? e.message : "";
  if (!msg || /failed to fetch|networkerror|load failed|abort|timed? ?out/i.test(msg)) {
    return "Could not reach the Bitcoin network (mempool.space and blockstream.info both failed). Check your connection and try again.";
  }
  return toUserFacingError(e);
}

function SelfCustodyWallet() {
  const session = useSession();
  const [hasVault, setHasVault] = useState<boolean>(() => vaultExists());
  const [stage, setStage] = useState<Stage>(() => (vaultExists() ? "locked" : "choose"));

  // Setup flow state (phrase lives here only until it is encrypted into the vault).
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [verifyAnswers, setVerifyAnswers] = useState<Record<number, string>>({});
  const [importText, setImportText] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Wallet state.
  const [scan, setScan] = useState<WalletScan | null>(null);
  const [lastKnown, setLastKnown] = useState<LastKnownWalletData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Self-custody Lightning & Spark (Breez SDK – Spark) state.
  const [spBalance, setSpBalance] = useState<number | null>(null);
  const [spBusy, setSpBusy] = useState(false);
  const [spPayments, setSpPayments] = useState<PaymentSummary[] | null>(null);
  // Receive: one of three destination types, each rendered with a QR.
  const [receiveKind, setReceiveKind] = useState<"bolt11" | "bitcoin" | "spark">("bolt11");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [receiveDest, setReceiveDest] = useState<string | null>(null);
  const [receiveFee, setReceiveFee] = useState<number | null>(null);
  // Send: paste anything → parse → prepare (fee preview) → confirm.
  const [sendText, setSendText] = useState("");
  const [sendParsedText, setSendParsedText] = useState<string | null>(null);
  const [parsedInput, setParsedInput] = useState<InputType | null>(null);
  const [sendAmountSats, setSendAmountSats] = useState("");
  const [preparedSend, setPreparedSend] = useState<PreparedSend | null>(null);
  const [preparedLnurl, setPreparedLnurl] = useState<PreparedLnurlPay | null>(null);
  // Buy (MoonPay).
  const [buyAmount, setBuyAmount] = useState("");
  // Automatic Claims preference (device-local; default ON, fixed 500-sat limit).
  const [autoClaimPref, setAutoClaimPref] = useState<AutoClaimPreference>(() => loadAutoClaimPreference());
  const [autoClaimLimitDraft, setAutoClaimLimitDraft] = useState<string>(
    () => String(loadAutoClaimPreference().maxFeeSats),
  );
  const [unclaimed, setUnclaimed] = useState<UnclaimedDepositSummary[] | null>(null);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  // Fiat value display (opt-in, display-only). The rate is composed from
  // the app's existing price machinery: BTC/USD spot from Coinbase (the
  // same source the btc-trade function uses) × the exchange_rates
  // USD→currency rate. No rate → sats shown alone, never a guess.
  const { currency, currencyConfig } = useCurrency();
  const { data: exchangeRateRows } = useExchangeRates();
  const [showFiat, setShowFiat] = useState<boolean>(() => loadShowFiatPreference());
  const [btcUsd, setBtcUsd] = useState<number | null>(null);

  const usdToCurrency = resolveExchangeRate(exchangeRateRows, "USD", currency);
  const fiatPerBtc = btcUsd !== null && usdToCurrency !== null ? btcUsd * usdToCurrency : null;
  const fiat = (sats: number): string | null =>
    showFiat ? formatFiatEquivalent(sats, fiatPerBtc, currency, currencyConfig.locale) : null;

  // Fetch the BTC/USD spot price only when the user has opted into fiat
  // display. Display-only: a failure leaves the sats figures untouched
  // and never blocks any wallet operation.
  useEffect(() => {
    if (!showFiat || btcUsd !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const spot = Number.parseFloat(data?.data?.amount);
        if (!cancelled && Number.isFinite(spot) && spot > 0) setBtcUsd(spot);
      } catch {
        // Price unavailable: sats figures are shown alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showFiat, btcUsd]);

  const account = useMemo(
    () => (session.mnemonic ? accountFromMnemonic(session.mnemonic) : null),
    [session.mnemonic],
  );

  // The account xpub is a BIP32 derivation (seed → account node):
  // cheap once, wasteful on every render — and this page re-renders
  // on every keystroke in every form field. Memoised on the account.
  const xpub = useMemo(() => (account ? accountXpub(account) : null), [account]);

  useEffect(() => {
    if (session.mnemonic) {
      setStage("wallet");
    } else {
      // Locked or removed: drop the Spark SDK instance bound to the
      // seed AND wipe its persisted IndexedDB state, so a locked wallet
      // leaves no SDK wallet state behind in this browser (it is
      // re-derived from the seed phrase on the next unlock).
      disconnectSparkAndWipeStorage();
      setSpBalance(null);
      setSpPayments(null);
      setUnclaimed(null);
      setReceiveDest(null);
      setParsedInput(null);
      setPreparedSend(null);
      setPreparedLnurl(null);
      if (stage === "wallet") setStage(hasVault ? "locked" : "choose");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mnemonic]);

  const doScan = async () => {
    if (!account) return;
    // A scan over a degraded endpoint can run long; it counts as
    // wallet activity from start to finish so the auto-lock cannot
    // fire mid-scan and wipe the wallet under the user.
    touchSession();
    setScanning(true);
    setScanError(null);
    try {
      const [result, rate] = await Promise.all([scanWallet(account), fetchRecommendedFeeRate().catch(() => null)]);
      setScan(result);
      // Persist the good reading on-device: if the network later fails,
      // the wallet still shows its last-known balance and receive index
      // instead of blanking out (see lastKnown.ts).
      const reading: LastKnownWalletData = {
        receiveIndex: result.nextReceiveIndex,
        balanceSats: result.balanceSats,
        updatedAt: Date.now(),
      };
      if (xpub) saveLastKnown(xpub, reading);
      setLastKnown(reading);
      if (rate) setFeeRate(rate);
    } catch (e: any) {
      setScanError(friendlyScanError(e));
    } finally {
      setScanning(false);
      touchSession();
    }
  };

  // Load the last-known reading for whichever wallet is unlocked.
  useEffect(() => {
    setLastKnown(xpub ? loadLastKnown(xpub) : null);
  }, [xpub]);

  useEffect(() => {
    if (stage === "wallet" && account) doScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, account]);

  // ── Setup flows ──────────────────────────────────────────────────────────

  const startCreate = () => {
    setPendingMnemonic(generateWalletMnemonic());
    setBackupConfirmed(false);
    setVerifyAnswers({});
    setStage("backup-show");
  };

  const verifyIndices = useMemo(() => {
    if (!pendingMnemonic) return [];
    const words = pendingMnemonic.split(" ");
    const picks = new Set<number>();
    while (picks.size < 3) picks.add(Math.floor(Math.random() * words.length));
    return [...picks].sort((a, b) => a - b);
  }, [pendingMnemonic]);

  const verifyPassed = useMemo(() => {
    if (!pendingMnemonic || verifyIndices.length === 0) return false;
    const words = pendingMnemonic.split(" ");
    return verifyIndices.every(
      (i) => (verifyAnswers[i] || "").trim().toLowerCase() === words[i],
    );
  }, [pendingMnemonic, verifyIndices, verifyAnswers]);

  const finishSetup = async () => {
    if (!pendingMnemonic) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Wallet password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== passwordConfirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await createVault(pendingMnemonic, password);
      unlockSession(pendingMnemonic);
      setPendingMnemonic(null);
      setPassword("");
      setPasswordConfirm("");
      setImportText("");
      setHasVault(true);
      toast.success("Self-custody wallet ready");
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not create the wallet vault"));
    } finally {
      setBusy(false);
    }
  };

  const startImport = () => {
    const phrase = importText.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidMnemonic(phrase)) {
      toast.error("That seed phrase is not a valid BIP39 phrase (check the words and order)");
      return;
    }
    setPendingMnemonic(phrase);
    setStage("set-password");
  };

  const doUnlock = async () => {
    setBusy(true);
    try {
      const mnemonic = await unlockVault(unlockPassword);
      unlockSession(mnemonic);
      setUnlockPassword("");
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Unlock failed"));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = () => {
    if (xpub) clearLastKnown(xpub);
    deleteVault();
    lockSession();
    setHasVault(false);
    setScan(null);
    setLastKnown(null);
    setConfirmDelete(false);
    setStage("choose");
    toast.success("Wallet removed from this device. Funds remain on-chain, recoverable only with your seed phrase.");
  };

  // ── Send (signed fully on-device) ────────────────────────────────────────

  const doSend = async () => {
    if (!account || !scan) return;
    const amount = Number(sendAmount);
    if (!sendTo.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
      toast.error("Enter a destination address and an amount in sats");
      return;
    }
    setSending(true);
    try {
      const rate = feeRate ?? (await fetchRecommendedFeeRate());
      const built = buildSignedTransaction({
        account,
        utxos: scan.utxos,
        toAddress: sendTo.trim(),
        amountSats: BigInt(amount),
        feeRateSatVb: rate,
        changeIndex: scan.nextChangeIndex,
      });
      const txid = await broadcastTransaction(built.hex);
      toast.success(`Sent. Transaction ${txid.slice(0, 16)}… broadcast.`);
      setSendTo("");
      setSendAmount("");
      doScan();
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Send failed"));
    } finally {
      setSending(false);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  // ── Spark wallet (Breez SDK – Spark, Glow-style) ───────────────────────

  const refreshSpark = async () => {
    if (!session.mnemonic) return;
    // The first connect downloads and initialises the Spark engine
    // and can take a while on a slow connection. The whole operation
    // is wallet activity: the auto-lock must not fire mid-connect
    // (it would wipe the SDK storage under the in-flight connect and
    // bounce the user to the locked screen — the "kicked out while
    // loading" the CEO reported on 2026-10-25).
    touchSession();
    setSpBusy(true);
    try {
      const [balance, payments, deposits] = await Promise.all([
        sparkBalanceSat(session.mnemonic),
        sparkListPayments(session.mnemonic).catch(() => null),
        sparkListUnclaimedDeposits(session.mnemonic).catch(() => null),
      ]);
      setSpBalance(balance);
      if (payments) setSpPayments(payments);
      if (deposits) setUnclaimed(deposits);
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not connect the Spark wallet"));
    } finally {
      setSpBusy(false);
      touchSession();
    }
  };

  // Auto-reconnect when the user comes back to this tab (e.g. after
  // completing a MoonPay purchase in another tab): if the wallet is
  // unlocked but the Spark connection is down — or no balance was ever
  // loaded — the card sat at "Spark balance: —" until a manual
  // Connect click. Returning focus now reconnects on its own.
  const spBusyRef = useRef(false);
  useEffect(() => {
    spBusyRef.current = spBusy;
  }, [spBusy]);

  // While any wallet operation is in flight (Spark connect/sync,
  // chain scan, broadcast), keep the self-custody session's
  // auto-lock countdown reset. A first Spark connect downloads a
  // large engine module and can outlast the 5-minute auto-lock on a
  // slow connection; without this, the lock fired mid-operation,
  // wiped the SDK storage under the in-flight connect and bounced
  // the user to the locked screen (CEO report, 2026-10-25).
  const anyBusy = spBusy || scanning || sending;
  useEffect(() => {
    if (!anyBusy) return;
    const id = setInterval(touchSession, 60_000);
    return () => clearInterval(id);
  }, [anyBusy]);

  useEffect(() => {
    if (stage !== "wallet" || !session.mnemonic) return;
    const maybeReconnect = () => {
      if (document.visibilityState === "hidden") return;
      if (
        shouldReconnectSpark({
          unlocked: true,
          connectionActive: sparkConnectionActive(),
          balanceKnown: spBalance !== null,
          busy: spBusyRef.current,
        })
      ) {
        void refreshSpark();
      }
    };
    window.addEventListener("focus", maybeReconnect);
    document.addEventListener("visibilitychange", maybeReconnect);
    return () => {
      window.removeEventListener("focus", maybeReconnect);
      document.removeEventListener("visibilitychange", maybeReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, session.mnemonic, spBalance]);

  // ── Automatic Claims settings + manual claims ──────────────────────────
  const applyAutoClaimPref = (next: AutoClaimPreference) => {
    saveAutoClaimPreference(next);
    setAutoClaimPref(next);
    setAutoClaimLimitDraft(String(next.maxFeeSats));
    // connectSpark reads the preference fresh and reconnects with the
    // new fee cap when it has changed, so refreshing applies the new
    // setting now rather than on the next visit.
    refreshSpark();
  };

  const toggleAutoClaim = (on: boolean) => applyAutoClaimPref({ ...autoClaimPref, enabled: on });

  const commitAutoClaimLimit = () => {
    const value = Number(autoClaimLimitDraft);
    if (!Number.isSafeInteger(value) || value <= 0) {
      toast.error("Enter the fee limit as a whole number of sats (1 or more)");
      setAutoClaimLimitDraft(String(autoClaimPref.maxFeeSats));
      return;
    }
    if (value !== autoClaimPref.maxFeeSats) {
      applyAutoClaimPref({ ...autoClaimPref, maxFeeSats: value });
    }
  };

  /** The fee a manual claim would run at for this deposit, if one is quotable. */
  const manualClaimFee = (d: UnclaimedDepositSummary): number | null =>
    d.isMature ? (d.claimFeeSats ?? d.requiredFeeSats) : (d.instantFeeSats ?? d.requiredFeeSats);

  const doClaimDeposit = async (d: UnclaimedDepositSummary) => {
    if (!session.mnemonic) return;
    const fee = manualClaimFee(d);
    if (fee === null) return;
    const key = `${d.txid}:${d.vout}`;
    setClaimingKey(key);
    try {
      await sparkClaimDeposit(session.mnemonic, d.txid, d.vout, fee);
      toast.success("Deposit claimed into your Spark balance");
      refreshSpark();
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not claim that deposit"));
    } finally {
      setClaimingKey(null);
    }
  };

  const toggleShowFiat = (on: boolean) => {
    saveShowFiatPreference(on);
    setShowFiat(on);
  };

  const doSparkReceive = async () => {
    if (!session.mnemonic) return;
    // Same protection as refreshSpark: creating a destination may
    // first have to connect the Spark engine — activity throughout.
    touchSession();
    setSpBusy(true);
    setReceiveDest(null);
    try {
      const result =
        receiveKind === "bolt11"
          ? await sparkReceiveBolt11(
              session.mnemonic,
              receiveAmount ? Number(receiveAmount) : undefined,
              "BMaGlass Pay",
            )
          : receiveKind === "bitcoin"
            ? await sparkReceiveBitcoinAddress(session.mnemonic)
            : await sparkReceiveSparkAddress(session.mnemonic);
      setReceiveDest(result.destination);
      setReceiveFee(result.feeSats);
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not create that receive destination"));
    } finally {
      setSpBusy(false);
      touchSession();
    }
  };

  /** Step 1 of sending: parse the pasted input so the UI drives the right flow. */
  const doParseSend = async () => {
    if (!session.mnemonic || !sendText.trim()) return;
    setSpBusy(true);
    setParsedInput(null);
    setPreparedSend(null);
    setPreparedLnurl(null);
    try {
      const parsed = await sparkParseInput(session.mnemonic, sendText);
      setParsedInput(parsed);
      setSendParsedText(sendText.trim());
    } catch (e: any) {
      toast.error(toUserFacingError(e, "That destination could not be recognised"));
    } finally {
      setSpBusy(false);
    }
  };

  /** Step 2 (unified send + LNURL-pay): prepare, so the exact fee is shown before confirming. */
  const doPrepareSend = async () => {
    if (!session.mnemonic || !parsedInput || !sendParsedText) return;
    const flow = parsedFlow(parsedInput);
    const amount = sendAmountSats ? Number(sendAmountSats) : undefined;
    setSpBusy(true);
    try {
      if (flow === "lnurlPay") {
        const details = lnurlPayDetails(parsedInput);
        if (!details) throw new Error("That input has no LNURL payment details");
        if (amount === undefined) {
          toast.error("Enter an amount in sats for this payment");
          return;
        }
        setPreparedLnurl(await sparkPrepareLnurlPay(session.mnemonic, details, amount));
      } else {
        setPreparedSend(await sparkPrepareSend(session.mnemonic, sendParsedText, amount));
      }
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not prepare that payment"));
    } finally {
      setSpBusy(false);
    }
  };

  /** Step 3: execute exactly what was previewed. */
  const doConfirmSend = async () => {
    if (!session.mnemonic) return;
    setSpBusy(true);
    try {
      if (preparedLnurl) {
        await sparkSendLnurlPay(session.mnemonic, preparedLnurl);
        toast.success("Payment sent");
      } else if (preparedSend) {
        await sparkSendPrepared(session.mnemonic, preparedSend);
        toast.success("Payment sent");
      } else {
        return;
      }
      setSendText("");
      setSendParsedText(null);
      setParsedInput(null);
      setSendAmountSats("");
      setPreparedSend(null);
      setPreparedLnurl(null);
      refreshSpark();
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Payment failed"));
    } finally {
      setSpBusy(false);
    }
  };

  const doLnurlWithdraw = async () => {
    if (!session.mnemonic || !parsedInput) return;
    const amount = Number(sendAmountSats);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error("Enter the amount to withdraw, in sats");
      return;
    }
    setSpBusy(true);
    try {
      await sparkLnurlWithdraw(session.mnemonic, parsedInput, amount);
      toast.success("Withdrawal claimed into your Spark wallet");
      setParsedInput(null);
      setSendText("");
      setSendAmountSats("");
      refreshSpark();
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Withdrawal failed"));
    } finally {
      setSpBusy(false);
    }
  };

  const doLnurlAuth = async () => {
    if (!session.mnemonic || !parsedInput) return;
    setSpBusy(true);
    try {
      const status = await sparkLnurlAuth(session.mnemonic, parsedInput);
      toast.success(`Sign-in answer sent (${status})`);
      setParsedInput(null);
      setSendText("");
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Sign-in failed"));
    } finally {
      setSpBusy(false);
    }
  };

  /**
   * MoonPay buy, the way Breez documents it for web: pre-open a blank
   * tab SYNCHRONOUSLY inside the click handler (mobile browsers block
   * window.open after an await), then navigate it once the SDK returns
   * the MoonPay URL. Falls back to same-tab navigation if the pre-open
   * was blocked.
   */
  const doBuyBitcoin = async () => {
    if (!session.mnemonic) return;
    const tab = window.open("", "_blank");
    setSpBusy(true);
    try {
      const url = await sparkBuyBitcoinUrl(session.mnemonic, {
        amountSat: buyAmount ? Number(buyAmount) : undefined,
        redirectUrl: window.location.href,
      });
      if (tab) {
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e: any) {
      if (tab) tab.close();
      toast.error(toUserFacingError(e, "Could not start the MoonPay purchase"));
    } finally {
      setSpBusy(false);
    }
  };

  // The receive address is derived LOCALLY from the account key — it
  // must never wait on the network scan. The scan only refines WHICH
  // index is next (first unused); until a scan lands we use the
  // last-known index, then index 0. Any of these is the user's own
  // address, so showing it early can never misdirect funds.
  const receiveAddress = useMemo(
    () =>
      account
        ? deriveAddress(account, 0, scan?.nextReceiveIndex ?? lastKnown?.receiveIndex ?? 0)
        : null,
    [account, scan?.nextReceiveIndex, lastKnown?.receiveIndex],
  );
  const vaultMeta = useMemo(() => getVaultMeta(), [hasVault]);

  return (
    <div className="min-h-screen bg-background" onClick={touchSession}>
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/bitcoin-wallet">
              <ArrowLeft className="h-4 w-4 mr-1" /> Custodial account
            </Link>
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6" /> Bitcoin Wallet
            <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY</Badge>
          </h1>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 mb-6 text-sm">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p>
            <strong>You hold the keys to this wallet.</strong> The seed phrase never leaves this
            device and BMaGlass cannot see, move, or recover these funds. If you lose your seed
            phrase, your Bitcoin is gone — there is no password reset and no support recovery.
          </p>
        </div>

        {stage === "choose" && (
          <Card>
            <CardHeader>
              <CardTitle>Create a self-custody wallet</CardTitle>
              <CardDescription>
                A self-custody wallet lives only on this device, protected by a wallet password.
                You can also keep using your custodial account — the two are separate, and moving
                Bitcoin between them is an ordinary on-chain send.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full" onClick={startCreate}>
                <KeyRound className="h-4 w-4 mr-2" /> Create new wallet (24-word seed phrase)
              </Button>
              <div className="space-y-2">
                <Label htmlFor="import-phrase">Import an existing seed phrase</Label>
                <Textarea
                  id="import-phrase"
                  placeholder="word1 word2 word3 … (12 or 24 words)"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={3}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Eye className="h-3 w-3" /> The phrase is validated and encrypted on this device
                  only. It is never sent to BMaGlass or any server.
                </p>
                <Button variant="outline" className="w-full" onClick={startImport} disabled={!importText.trim()}>
                  Import wallet
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {stage === "backup-show" && pendingMnemonic && (
          <Card>
            <CardHeader>
              <CardTitle>Write down your seed phrase</CardTitle>
              <CardDescription>
                These 24 words are the ONLY way to recover this wallet. Write them on paper, in
                order, and store them somewhere safe and offline. Never photograph them, email
                them, or type them into any other website.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {pendingMnemonic.split(" ").map((word, i) => (
                  <div key={i} className="rounded border px-2 py-1.5 text-sm font-mono">
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {word}
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={backupConfirmed}
                  onChange={(e) => setBackupConfirmed(e.target.checked)}
                />
                I have written the phrase down on paper and stored it safely. I understand that
                losing it means losing my Bitcoin permanently.
              </label>
              <Button className="w-full" disabled={!backupConfirmed} onClick={() => setStage("backup-verify")}>
                Continue to verification
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === "backup-verify" && pendingMnemonic && (
          <Card>
            <CardHeader>
              <CardTitle>Verify your backup</CardTitle>
              <CardDescription>Enter the requested words from your written phrase.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {verifyIndices.map((i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`verify-${i}`}>Word #{i + 1}</Label>
                  <Input
                    id={`verify-${i}`}
                    autoComplete="off"
                    value={verifyAnswers[i] || ""}
                    onChange={(e) => setVerifyAnswers((s) => ({ ...s, [i]: e.target.value }))}
                  />
                </div>
              ))}
              <Button className="w-full" disabled={!verifyPassed} onClick={() => setStage("set-password")}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Backup verified — set wallet password
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === "set-password" && (
          <Card>
            <CardHeader>
              <CardTitle>Set a wallet password</CardTitle>
              <CardDescription>
                This password encrypts the wallet on this device (PBKDF2 + AES-256-GCM). It is
                never stored or sent anywhere. If you forget it, restore the wallet by importing
                your seed phrase again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pw">Wallet password (min {MIN_PASSWORD_LENGTH} characters)</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              <Button className="w-full" onClick={finishSetup} disabled={busy}>
                {busy ? "Encrypting…" : "Create encrypted wallet"}
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === "locked" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" /> Wallet locked
              </CardTitle>
              <CardDescription>
                A self-custody wallet exists on this device
                {vaultMeta ? ` (created ${new Date(vaultMeta.createdAt).toLocaleDateString()})` : ""}.
                Enter its password to unlock. Unlocking happens entirely on this device.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="unlock-pw">Wallet password</Label>
                <Input
                  id="unlock-pw"
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doUnlock()}
                  autoComplete="current-password"
                />
              </div>
              <Button className="w-full" onClick={doUnlock} disabled={busy || !unlockPassword}>
                {busy ? "Unlocking…" : "Unlock wallet"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Forgot the password? Unlock the wallet to manage or remove it — if the password
                is lost, your seed phrase is the only recovery path, by design.
              </p>
            </CardContent>
          </Card>
        )}

        {stage === "wallet" && account && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Balance <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY</Badge>
                  </CardTitle>
                  <CardDescription>Read live from the Bitcoin network. BMaGlass does not hold or record this balance.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={doScan} disabled={scanning}>
                    <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => lockSession()}>
                    <Lock className="h-4 w-4 mr-1" /> Lock
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {scan ? (
                  <div>
                    <div className="text-3xl font-bold">{formatBtc(scan.balanceSats)} BTC</div>
                    <div className="text-sm text-muted-foreground">{scan.balanceSats.toLocaleString()} sats confirmed</div>
                    {scanError && (
                      <p className="text-sm text-amber-600 flex items-center gap-1 mt-2">
                        <AlertTriangle className="h-4 w-4" /> Couldn't refresh just now — {scanError} Showing your last successful reading.
                      </p>
                    )}
                  </div>
                ) : lastKnown ? (
                  <div>
                    <div className="text-3xl font-bold">{formatBtc(lastKnown.balanceSats)} BTC</div>
                    <div className="text-sm text-muted-foreground">
                      {lastKnown.balanceSats.toLocaleString()} sats — last known, {new Date(lastKnown.updatedAt).toLocaleString()}
                    </div>
                    {scanError ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" /> {scanError}
                        </p>
                        <Button variant="outline" size="sm" onClick={doScan} disabled={scanning}>
                          <RefreshCw className={`h-4 w-4 mr-1 ${scanning ? "animate-spin" : ""}`} /> Retry
                        </Button>
                      </div>
                    ) : scanning ? (
                      <p className="text-sm text-muted-foreground mt-2">Refreshing from the network…</p>
                    ) : null}
                  </div>
                ) : scanError ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4 text-amber-600" /> Balance unavailable
                    </p>
                    <p className="text-sm text-muted-foreground">{scanError}</p>
                    <Button variant="outline" size="sm" onClick={doScan} disabled={scanning}>
                      <RefreshCw className={`h-4 w-4 mr-1 ${scanning ? "animate-spin" : ""}`} /> Retry
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Scanning the blockchain for your addresses…</p>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Receive</CardTitle>
                  <CardDescription>Anyone can pay this address. It belongs to your self-custody wallet only.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {receiveAddress ? (
                    <>
                      <div className="flex justify-center">
                        <div className="rounded bg-white p-3">
                          <QRCode value={`bitcoin:${receiveAddress}`} size={180} />
                        </div>
                      </div>
                      <p className="font-mono text-xs break-all rounded bg-muted p-2">{receiveAddress}</p>
                      <Button variant="outline" size="sm" onClick={() => copy(receiveAddress, "Address")}>
                        <Copy className="h-4 w-4 mr-1" /> Copy address
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2" role="status" aria-label="Loading address">
                      <Skeleton className="h-[204px] w-[204px]" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  )}
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">Account public key (zpub — watch-only export)</Label>
                    <p className="font-mono text-[10px] break-all rounded bg-muted p-2 mt-1">{xpub}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Send</CardTitle>
                  <CardDescription>
                    Signed on this device and broadcast to the network.
                    {feeRate ? ` Current fee rate ≈ ${feeRate} sat/vB.` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="sc-to">Destination address</Label>
                    <Input id="sc-to" placeholder="bc1q…" value={sendTo} onChange={(e) => setSendTo(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sc-amount">Amount (sats)</Label>
                    <Input id="sc-amount" type="number" min="1" placeholder="e.g. 25000" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} />
                  </div>
                  <Button className="w-full" onClick={doSend} disabled={sending || !scan}>
                    <Send className="h-4 w-4 mr-2" /> {sending ? "Broadcasting…" : "Sign & broadcast"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    To move Bitcoin to your custodial account, paste a deposit address from the
                    custodial wallet's Receive tab.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Lightning &amp; Spark <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY</Badge>
                </CardTitle>
                <CardDescription>
                  Lightning, on-chain deposits and Spark transfers in one balance, running entirely in
                  your browser under the same seed phrase as this wallet — no BMaGlass server is
                  involved.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!sparkEnabled() ? (
                  <p className="text-sm text-muted-foreground">
                    This part of the self-custody wallet is not enabled on this deployment yet.
                    On-chain self-custody above is fully functional in the meantime, and your
                    custodial account works as before.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">
                        Spark balance: {spBalance === null ? "—" : `${spBalance.toLocaleString()} sats`}
                        {spBalance !== null && fiat(spBalance) && (
                          <span> · {fiat(spBalance)}</span>
                        )}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          className="rounded-full bg-[#F7931A] text-black hover:bg-[#F7931A]/90"
                          size="sm"
                          disabled={spBusy || !session.mnemonic}
                          onClick={doBuyBitcoin}
                        >
                          Buy Bitcoin
                        </Button>
                        <Button variant="outline" size="sm" disabled={spBusy || !session.mnemonic} onClick={refreshSpark}>
                          {spBusy ? "Connecting…" : "Connect / refresh"}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="buy-amt">Buy amount (sats, optional — MoonPay sets the final fiat amount)</Label>
                      <Input id="buy-amt" type="number" min="1" placeholder="Leave blank to choose on MoonPay" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        Buying opens MoonPay in a new tab. MoonPay handles payment and
                        identity checks; purchases are paid in USD/EUR/GBP (ZMW is not supported by
                        MoonPay), with a minimum of about $20. Bought Bitcoin lands on this
                        wallet&apos;s Bitcoin deposit address and is added to the balance
                        automatically.
                      </p>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <p className="text-sm font-medium">Claims &amp; display</p>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="auto-claim">Automatic Claims</Label>
                          <p className="text-xs text-muted-foreground">
                            On-chain deposits are claimed automatically while the network fee stays
                            under this limit.
                          </p>
                        </div>
                        <Switch
                          id="auto-claim"
                          checked={autoClaimPref.enabled}
                          onCheckedChange={toggleAutoClaim}
                          disabled={!session.mnemonic}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="auto-claim-limit">Fee limit — fixed (sats)</Label>
                        <Input
                          id="auto-claim-limit"
                          type="number"
                          min="1"
                          value={autoClaimLimitDraft}
                          disabled={!autoClaimPref.enabled || !session.mnemonic}
                          onChange={(e) => setAutoClaimLimitDraft(e.target.value)}
                          onBlur={commitAutoClaimLimit}
                        />
                        <p className="text-xs text-muted-foreground">
                          {autoClaimPref.enabled
                            ? `A deposit whose claim fee is above ${autoClaimPref.maxFeeSats.toLocaleString()} sats waits unclaimed until fees fall or you claim it yourself below.`
                            : "Automatic claims are off. Deposits wait until you claim them yourself below."}
                        </p>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="show-fiat">Show fiat value</Label>
                          <p className="text-xs text-muted-foreground">
                            Show approximate {currency} values next to sat amounts, using the live
                            Bitcoin price. Display only — nothing is ever charged or limited in
                            fiat.
                          </p>
                        </div>
                        <Switch id="show-fiat" checked={showFiat} onCheckedChange={toggleShowFiat} />
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      {/* Receive type selector: one segmented pill group,
                          identical treatment for all three kinds. The
                          options are inert while a Spark operation is
                          in flight, so the destination type can never
                          be switched mid-request. */}
                      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1" role="group" aria-label="Receive type">
                        <Button
                          type="button"
                          size="sm"
                          variant={receiveKind === "bolt11" ? "default" : "ghost"}
                          className="h-10 rounded-full text-xs sm:text-sm"
                          disabled={spBusy}
                          aria-pressed={receiveKind === "bolt11"}
                          onClick={() => { setReceiveKind("bolt11"); setReceiveDest(null); }}
                        >
                          <Zap className="h-4 w-4 mr-1.5 shrink-0" /> Lightning invoice
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={receiveKind === "bitcoin" ? "default" : "ghost"}
                          className="h-10 rounded-full text-xs sm:text-sm"
                          disabled={spBusy}
                          aria-pressed={receiveKind === "bitcoin"}
                          onClick={() => { setReceiveKind("bitcoin"); setReceiveDest(null); }}
                        >
                          <Bitcoin className="h-4 w-4 mr-1.5 shrink-0" /> Bitcoin address
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={receiveKind === "spark" ? "default" : "ghost"}
                          className="h-10 rounded-full text-xs sm:text-sm"
                          disabled={spBusy}
                          aria-pressed={receiveKind === "spark"}
                          onClick={() => { setReceiveKind("spark"); setReceiveDest(null); }}
                        >
                          <Sparkles className="h-4 w-4 mr-1.5 shrink-0" /> Spark address
                        </Button>
                      </div>
                      {receiveKind === "bolt11" && (
                        <div className="space-y-1">
                          <Label htmlFor="rcv-amt">Invoice amount (sats, optional)</Label>
                          <Input id="rcv-amt" type="number" min="1" placeholder="Blank = any amount" value={receiveAmount} onChange={(e) => setReceiveAmount(e.target.value)} />
                        </div>
                      )}
                      {receiveKind === "bitcoin" && (
                        <p className="text-xs text-muted-foreground">
                          Your Bitcoin deposit address. Deposits are detected as soon as they are
                          sent and claimed into your Spark balance automatically under your
                          Automatic Claims setting above (standard claim at 3 confirmations, sooner
                          when an instant claim fits your fee limit). MoonPay purchases are
                          delivered here too.
                        </p>
                      )}
                      {receiveKind === "spark" && (
                        <p className="text-xs text-muted-foreground">
                          Your Spark address — instant transfers from other Spark wallets.
                        </p>
                      )}
                      {/* The receive action: a solid Bitcoin-orange
                          pill — the same treatment as "Buy Bitcoin"
                          above — so it unmistakably reads as THE
                          tappable action for the selected kind (the
                          previous thin outline button did not read as
                          clickable at all; CEO report 2026-10-25).
                          While the engine works it shows a spinner
                          and stays disabled. */}
                      <Button
                        type="button"
                        className="h-11 w-full rounded-full bg-[#F7931A] text-black font-semibold hover:bg-[#DE830A] active:scale-[0.99] transition"
                        disabled={spBusy || !session.mnemonic}
                        aria-busy={spBusy}
                        onClick={doSparkReceive}
                      >
                        {spBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {receiveKind === "bolt11" ? "Creating invoice…" : "Loading address…"}
                          </>
                        ) : receiveKind === "bolt11" ? (
                          <>
                            <Zap className="h-4 w-4 mr-2" /> Create Lightning invoice
                          </>
                        ) : receiveKind === "bitcoin" ? (
                          <>
                            <Bitcoin className="h-4 w-4 mr-2" /> Show Bitcoin address
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" /> Show Spark address
                          </>
                        )}
                      </Button>
                      {receiveDest && (
                        <div className="space-y-2">
                          <div className="flex justify-center rounded bg-white p-3">
                            <QRCode value={receiveDest} size={180} />
                          </div>
                          <p className="font-mono text-[10px] break-all rounded bg-muted p-2">{receiveDest}</p>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => copy(receiveDest, "Destination")}>
                              <Copy className="h-4 w-4 mr-1" /> Copy
                            </Button>
                            {receiveFee !== null && receiveFee > 0 && (
                              <span className="text-xs text-muted-foreground">
                                Receive fee: {receiveFee.toLocaleString()} sats
                                {fiat(receiveFee) ? ` (${fiat(receiveFee)})` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="sp-send">Send to — paste any destination</Label>
                        <Textarea
                          id="sp-send"
                          rows={3}
                          placeholder="Lightning invoice, Lightning address, LNURL, Bitcoin address, Spark address…"
                          value={sendText}
                          onChange={(e) => { setSendText(e.target.value); setParsedInput(null); setPreparedSend(null); setPreparedLnurl(null); }}
                        />
                      </div>
                      <Button variant="outline" className="w-full" disabled={spBusy || !session.mnemonic || !sendText.trim()} onClick={doParseSend}>
                        Review destination
                      </Button>
                      {parsedInput && (
                        <div className="space-y-3 rounded border p-3">
                          <p className="text-sm">
                            Recognised: <strong>{parsedInputLabel(parsedInput)}</strong>
                          </p>
                          {parsedFlow(parsedInput) === "unsupported" && (
                            <p className="text-sm text-muted-foreground">
                              This kind of input can&apos;t be paid from the wallet yet. Nothing has been sent.
                            </p>
                          )}
                          {parsedFlow(parsedInput) === "lnurlAuth" && (
                            <Button className="w-full" disabled={spBusy} onClick={doLnurlAuth}>
                              Sign in with this wallet
                            </Button>
                          )}
                          {parsedFlow(parsedInput) === "lnurlWithdraw" && (
                            <>
                              <div className="space-y-1">
                                <Label htmlFor="wd-amt">Amount to withdraw (sats)</Label>
                                <Input id="wd-amt" type="number" min="1" value={sendAmountSats} onChange={(e) => setSendAmountSats(e.target.value)} />
                              </div>
                              <Button className="w-full" disabled={spBusy} onClick={doLnurlWithdraw}>
                                Claim withdrawal
                              </Button>
                            </>
                          )}
                          {(parsedFlow(parsedInput) === "send" || parsedFlow(parsedInput) === "lnurlPay") && (
                            <>
                              <div className="space-y-1">
                                <Label htmlFor="sp-amt">Amount (sats{parsedFlow(parsedInput) === "lnurlPay" ? "" : " — only for destinations without a fixed amount"})</Label>
                                <Input id="sp-amt" type="number" min="1" value={sendAmountSats} onChange={(e) => setSendAmountSats(e.target.value)} />
                              </div>
                              {!preparedSend && !preparedLnurl && (
                                <Button variant="outline" className="w-full" disabled={spBusy} onClick={doPrepareSend}>
                                  Prepare — show me the fee first
                                </Button>
                              )}
                              {preparedLnurl && (
                                <div className="space-y-2 text-sm">
                                  <p>Amount: <strong>{preparedLnurl.amountSats.toLocaleString()} sats</strong>{fiat(preparedLnurl.amountSats) ? <span className="text-muted-foreground"> ({fiat(preparedLnurl.amountSats)})</span> : null}</p>
                                  <p>Fee: <strong>{preparedLnurl.feeSats.toLocaleString()} sats</strong>{fiat(preparedLnurl.feeSats) ? <span className="text-muted-foreground"> ({fiat(preparedLnurl.feeSats)})</span> : null}</p>
                                  <Button className="w-full rounded-full bg-[#F7931A] text-black hover:bg-[#F7931A]/90" disabled={spBusy} onClick={doConfirmSend}>
                                    Confirm &amp; pay {(preparedLnurl.amountSats + preparedLnurl.feeSats).toLocaleString()} sats
                                  </Button>
                                </div>
                              )}
                              {preparedSend && (
                                <div className="space-y-2 text-sm">
                                  <p>Amount: <strong>{preparedSend.amountSats.toLocaleString()} sats</strong>{fiat(preparedSend.amountSats) ? <span className="text-muted-foreground"> ({fiat(preparedSend.amountSats)})</span> : null}</p>
                                  {preparedSend.fee.lines.map((line) => (
                                    <p key={line.label}>{line.label}: <strong>{line.feeSats.toLocaleString()} sats</strong>{fiat(line.feeSats) ? <span className="text-muted-foreground"> ({fiat(line.feeSats)})</span> : null}</p>
                                  ))}
                                  {preparedSend.fee.isEstimate && (
                                    <p className="text-xs text-amber-600">Fee shown is an estimate — the final fee is confirmed by the network when sending.</p>
                                  )}
                                  <Button className="w-full rounded-full bg-[#F7931A] text-black hover:bg-[#F7931A]/90" disabled={spBusy} onClick={doConfirmSend}>
                                    Confirm &amp; send
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {unclaimed && unclaimed.length > 0 && (
                      <div className="border-t pt-4 space-y-2">
                        <p className="text-sm font-medium">On-chain deposits waiting to be claimed</p>
                        {unclaimed.map((d) => {
                          const fee = manualClaimFee(d);
                          const canClaim =
                            (d.status === "overLimit" || d.status === "claimFailed") && fee !== null;
                          return (
                            <div key={`${d.txid}:${d.vout}`} className="rounded border p-2 text-sm space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                  {d.amountSats.toLocaleString()} sats
                                  {fiat(d.amountSats) ? (
                                    <span className="text-muted-foreground font-normal"> ({fiat(d.amountSats)})</span>
                                  ) : null}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {d.txid.slice(0, 12)}…:{d.vout}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {d.status === "confirming" &&
                                  (autoClaimPref.enabled
                                    ? "Confirming — it will be claimed automatically once ready, while the fee fits your limit."
                                    : "Confirming — automatic claims are off; you can claim it here once it is ready.")}
                                {d.status === "withinLimit" && "Ready — being claimed automatically under your fee limit."}
                                {d.status === "overLimit" &&
                                  (autoClaimPref.enabled
                                    ? `The claim fee (${(d.requiredFeeSats ?? fee ?? 0).toLocaleString()} sats) is above your ${autoClaimPref.maxFeeSats.toLocaleString()}-sat limit, so it has not been claimed. It will claim automatically if fees fall — or claim it now at that fee.`
                                    : `Automatic claims are off, so this deposit is waiting.${fee !== null ? ` Claim fee: ${fee.toLocaleString()} sats.` : ""}`)}
                                {d.status === "claimFailed" &&
                                  (d.claimErrorMessage ?? "The last claim attempt failed.")}
                              </p>
                              {canClaim && (
                                <Button
                                  size="sm"
                                  className="rounded-full bg-[#F7931A] text-black hover:bg-[#F7931A]/90"
                                  disabled={claimingKey === `${d.txid}:${d.vout}` || !session.mnemonic}
                                  onClick={() => doClaimDeposit(d)}
                                >
                                  {claimingKey === `${d.txid}:${d.vout}`
                                    ? "Claiming…"
                                    : `Claim now — fee ${fee.toLocaleString()} sats`}
                                </Button>
                              )}
                              {(d.status === "overLimit" || d.status === "claimFailed") && fee === null && (
                                <p className="text-xs text-muted-foreground">
                                  The claim fee could not be quoted right now — use Connect / refresh
                                  above to try again.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {spPayments && (
                      <div className="border-t pt-4 space-y-2">
                        <p className="text-sm font-medium">Spark wallet activity</p>
                        {spPayments.length === 0 && (
                          <p className="text-sm text-muted-foreground">No Spark payments yet.</p>
                        )}
                        {spPayments.map((p) => (
                          <div key={p.id} className="flex items-center justify-between rounded border p-2 text-sm">
                            <div>
                              <div className="capitalize">{p.direction} · {p.method}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(p.timestamp * 1000).toLocaleString()} · {p.status}
                                {p.feesSats > 0 ? ` · fee ${p.feesSats.toLocaleString()} sats` : ""}
                              </div>
                            </div>
                            <div className={p.direction === "receive" ? "text-green-600 font-medium" : "font-medium"}>
                              {p.direction === "receive" ? "+" : "−"}{p.amountSats.toLocaleString()} sats
                              {fiat(p.amountSats) ? (
                                <div className="text-xs text-muted-foreground font-normal">{fiat(p.amountSats)}</div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Transactions touching this wallet, from the public chain.</CardDescription>
              </CardHeader>
              <CardContent>
                {scan && scan.history.length === 0 && (
                  <p className="text-sm text-muted-foreground">No transactions yet.</p>
                )}
                <div className="space-y-2">
                  {scan?.history.map((entry) => (
                    <div key={entry.txid} className="flex items-center justify-between rounded border p-2 text-sm">
                      <div>
                        <a
                          className="font-mono text-xs underline"
                          href={`https://mempool.space/tx/${entry.txid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {entry.txid.slice(0, 20)}…
                        </a>
                        <div className="text-xs text-muted-foreground">
                          {entry.blockTime ? new Date(entry.blockTime * 1000).toLocaleString() : "Unconfirmed"}
                        </div>
                      </div>
                      <div className={entry.netSats >= 0 ? "text-green-600 font-medium" : "font-medium"}>
                        {entry.netSats >= 0 ? "+" : ""}
                        {entry.netSats.toLocaleString()} sats
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>
                  Removing the wallet deletes the encrypted vault from this device only. Your
                  Bitcoin stays on-chain and can be restored anywhere with your seed phrase —
                  and ONLY with your seed phrase.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!confirmDelete ? (
                  <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4 mr-2" /> Remove wallet from this device
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="destructive" onClick={doDelete}>Yes, remove it</Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default SelfCustodyWallet;
