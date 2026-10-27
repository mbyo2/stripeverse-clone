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
import { QrScanButton } from "@/components/QrScanButton";
import { parseQrPayload } from "@/lib/qrScan";
import {
  createVault,
  unlockVault,
  vaultExists,
  getVaultState,
  deleteVault,
  getVaultMeta,
  MIN_PASSWORD_LENGTH,
  type VaultState,
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
import {
  cancelSellIntent,
  checkCustodialInvoice,
  checkSellIntent,
  createCustodialInvoice,
  createSellIntent,
  getCustodialDepositAddress,
  listSellIntents,
  previewSellQuote,
  sellPhaseOf,
  SELL_PHASE_COPY,
  type SellIntent,
  type SellQuotePreview,
  type SellRail,
} from "@/lib/selfcustody/sellToZmw";
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

type Stage = "choose" | "backup-show" | "backup-verify" | "set-password" | "import" | "locked" | "wallet" | "recovery";

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
  const [vaultState, setVaultState] = useState<VaultState>(() => getVaultState());
  const [hasVault, setHasVault] = useState<boolean>(() => vaultExists());
  const [stage, setStage] = useState<Stage>(() => {
    // Tri-state: a present-but-unreadable vault goes to the recovery
    // stage — NEVER to "choose", where creating a new wallet would
    // overwrite it.
    const s = getVaultState();
    return s === "readable" ? "locked" : s === "unreadable" ? "recovery" : "choose";
  });

  // Setup flow state (phrase lives here only until it is encrypted into the vault).
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [setupOrigin, setSetupOrigin] = useState<"create" | "import" | "recovery-import">("create");
  const [confirmReplace, setConfirmReplace] = useState(false);
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
  // Send: whether the QR scanner dialog is open. While it is, the
  // wallet counts as active for the auto-lock (see the keep-alive
  // effect below) — aiming a camera or picking an image in the OS
  // file picker produces no clicks in this UI, so without the hold
  // the 5-minute lock fired mid-scan (rendered pass, 2026-10-25).
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  // Buy (MoonPay).
  const [buyAmount, setBuyAmount] = useState("");
  // Sell to ZMW (self-custody → platform ZMW wallet; see
  // lib/selfcustody/sellToZmw.ts). The intent + locked quote live
  // server-side; this state only drives the panel.
  const [sellRail, setSellRail] = useState<SellRail>("lightning");
  const [sellMode, setSellMode] = useState<"sats" | "zmw">("sats");
  const [sellInput, setSellInput] = useState("");
  const [sellPreview, setSellPreview] = useState<SellQuotePreview | null>(null);
  const [sellIntent, setSellIntent] = useState<SellIntent | null>(null);
  const [sellBusy, setSellBusy] = useState(false);
  const [sellPrepared, setSellPrepared] = useState<PreparedSend | null>(null);
  const [sellSent, setSellSent] = useState(false);
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
      if (stage === "wallet") {
        setStage(
          vaultState === "readable" ? "locked" : vaultState === "unreadable" ? "recovery" : "choose",
        );
      }
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
    setSetupOrigin("create");
    setConfirmReplace(false);
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
    // Replacing an unreadable vault file is a destructive, deliberate
    // act: it needs the explicit confirmation step rendered on the
    // set-password card for the recovery-import flow. (createVault
    // independently refuses to overwrite any blob without the flag.)
    const allowReplace = setupOrigin === "recovery-import" && confirmReplace;
    if (setupOrigin === "recovery-import" && !confirmReplace) {
      toast.error("Confirm that you want to replace the unreadable wallet file first");
      return;
    }
    setBusy(true);
    try {
      await createVault(pendingMnemonic, password, allowReplace ? { replaceExisting: true } : undefined);
      unlockSession(pendingMnemonic);
      setPendingMnemonic(null);
      setPassword("");
      setPasswordConfirm("");
      setImportText("");
      setConfirmReplace(false);
      setHasVault(true);
      setVaultState("readable");
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
    // Importing from the recovery stage replaces an unreadable blob —
    // a different, destructive act from a first-time import, and the
    // set-password step treats it that way.
    setSetupOrigin(stage === "recovery" ? "recovery-import" : "import");
    setConfirmReplace(false);
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
    setVaultState("absent");
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

  // QR scanner open-state from the send form's Scan button.
  // Opening the scanner is wallet activity in its own right: reset
  // the countdown immediately, then the keep-alive below holds it
  // for as long as the dialog stays open (including an OS
  // file-picker round-trip, which leaves this UI entirely). When
  // the dialog closes the hold releases and genuine idleness locks
  // on the usual 5-minute schedule.
  const handleQrScannerOpenChange = (next: boolean) => {
    setQrScannerOpen(next);
    if (next) touchSession();
  };

  // While any wallet operation is in flight (Spark connect/sync,
  // chain scan, broadcast) — or the QR scanner dialog is open —
  // keep the self-custody session's auto-lock countdown reset. A
  // first Spark connect downloads a large engine module and can
  // outlast the 5-minute auto-lock on a slow connection; without
  // this, the lock fired mid-operation, wiped the SDK storage
  // under the in-flight connect and bounced the user to the locked
  // screen (CEO report, 2026-10-25). The scanner case is the same
  // shape: holding a phone up to a code is active use, not
  // idleness (rendered pass, 2026-10-25).
  const anyBusy = spBusy || scanning || sending || qrScannerOpen;
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

  /**
   * Scan-to-send: a scanned code only FILLS the destination field
   * (plus the amount for a BIP21 code) — the user then runs the same
   * Review → Prepare → Confirm steps as for a pasted destination.
   * A scan never sends anything by itself.
   */
  const handleScanned = (raw: string) => {
    const payload = parseQrPayload(raw);
    if (payload.kind === "unknown") {
      toast.error(
        "That code was not recognised as a Bitcoin or Lightning destination. Try again, or paste the destination instead.",
      );
      return;
    }
    setSendText(payload.destination);
    setParsedInput(null);
    setPreparedSend(null);
    setPreparedLnurl(null);
    if (payload.kind === "bip21" && payload.amountSats !== undefined) {
      setSendAmountSats(String(payload.amountSats));
    }
    toast.success("Destination filled in from the QR code — review it before sending.");
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

  // ── Sell to ZMW ────────────────────────────────────────────────────────

  const doSellPreview = async () => {
    const value = Number(sellInput);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(sellMode === "sats" ? "Enter an amount in sats" : "Enter an amount in ZMW");
      return;
    }
    setSellBusy(true);
    try {
      const preview = await previewSellQuote(
        sellMode === "sats" ? { amount_sats: Math.floor(value) } : { amount_zmw: value },
      );
      setSellPreview(preview);
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not get a sell quote right now. Please try again."));
    } finally {
      setSellBusy(false);
    }
  };

  const doCreateSell = async () => {
    if (!sellPreview) return;
    setSellBusy(true);
    setSellPrepared(null);
    setSellSent(false);
    try {
      let intent: SellIntent;
      if (sellRail === "lightning") {
        // The invoice comes from the platform's existing Lightning
        // service; the intent binds to it by id.
        const invoice = await createCustodialInvoice(sellPreview.amount_sats);
        intent = await createSellIntent({
          rail: "lightning",
          amount_sats: sellPreview.amount_sats,
          lightning_payment_id: invoice.payment_id,
        });
      } else {
        // Make sure the custodial deposit address exists first (the
        // sell function binds the intent to it, never allocates).
        await getCustodialDepositAddress();
        intent = await createSellIntent({ rail: "onchain", amount_sats: sellPreview.amount_sats });
      }
      setSellIntent(intent);
      setSellPreview(null);
      toast.success("Sell created — send your Bitcoin to settle it");
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not create your sell. Please try again."));
    } finally {
      setSellBusy(false);
    }
  };

  const sellDestination = sellIntent
    ? sellIntent.rail === "lightning"
      ? sellIntent.bolt11
      : sellIntent.deposit_address
    : null;

  /** In-app send via the existing Spark plumbing: prepare (fee shown) → confirm. Nothing is sent before the user confirms. */
  const doSellPrepareInApp = async () => {
    if (!session.mnemonic || !sellIntent || !sellDestination) return;
    setSellBusy(true);
    try {
      const prepared = await sparkPrepareSend(
        session.mnemonic,
        sellDestination,
        sellIntent.rail === "onchain" ? sellIntent.expected_sats : undefined,
      );
      setSellPrepared(prepared);
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not prepare the in-app send"));
    } finally {
      setSellBusy(false);
    }
  };

  const doSellSendInApp = async () => {
    if (!session.mnemonic || !sellPrepared) return;
    setSellBusy(true);
    try {
      await sparkSendPrepared(session.mnemonic, sellPrepared);
      setSellSent(true);
      setSellPrepared(null);
      toast.success("Bitcoin sent from this wallet — waiting for it to arrive");
      refreshSpark();
    } catch (e: any) {
      toast.error(toUserFacingError(e, "The in-app send failed — nothing was settled. You can try again or send from another wallet."));
    } finally {
      setSellBusy(false);
    }
  };

  const doCancelSell = async () => {
    if (!sellIntent) return;
    setSellBusy(true);
    try {
      const updated = await cancelSellIntent(sellIntent.intent_id);
      setSellIntent(updated);
      setSellPrepared(null);
    } catch (e: any) {
      toast.error(toUserFacingError(e, "Could not cancel this sell"));
    } finally {
      setSellBusy(false);
    }
  };

  // Resume the latest open sell when the wallet opens, and poll its
  // status while it is live: for Lightning, poll the platform invoice
  // first (that is what settles the deposit), then ask the sell
  // function to convert it. On-chain deposits settle via the
  // platform's scheduled scan; the poll converts them here too.
  useEffect(() => {
    if (stage !== "wallet") return;
    let cancelled = false;
    (async () => {
      try {
        const intents = await listSellIntents();
        if (cancelled) return;
        const open = intents.find((i) => i.status === "awaiting");
        if (open) setSellIntent((current) => current ?? open);
      } catch {
        // Listing is best-effort: the panel still creates new sells.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const sellPhase = sellIntent ? sellPhaseOf(sellIntent) : null;
  useEffect(() => {
    if (!sellIntent || !sellPhase || sellPhase === "settled" || sellPhase === "expired" || sellPhase === "cancelled") return;
    const id = setInterval(async () => {
      try {
        if (sellIntent.rail === "lightning" && sellIntent.lightning_payment_id) {
          await checkCustodialInvoice(sellIntent.lightning_payment_id).catch(() => null);
        }
        const updated = await checkSellIntent(sellIntent.intent_id);
        setSellIntent(updated);
        if (sellPhaseOf(updated) === "settled") {
          toast.success(`Settled — K${(updated.zmw_credited ?? 0).toFixed(2)} is in your ZMW wallet`);
        }
      } catch {
        // A failed poll changes nothing; the next one retries.
      }
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellIntent?.intent_id, sellIntent?.rail, sellIntent?.lightning_payment_id, sellPhase]);

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

        {stage === "recovery" && (
          <Card className="border-red-500/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" /> A wallet file exists on this device, but it couldn't be read
              </CardTitle>
              <CardDescription>
                The wallet file stored on this device appears to be damaged or incomplete, so it
                cannot be opened or unlocked here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">
                <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                <p>
                  <strong>Do NOT create a new wallet</strong> — that would overwrite this file, and
                  the wallet inside it could still be recoverable. Creating a wallet is blocked
                  while this file is here. Restore from your seed phrase instead, or get help.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery-import-phrase">Restore from your seed phrase</Label>
                <Textarea
                  id="recovery-import-phrase"
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
                <p className="text-xs text-muted-foreground">
                  Restoring asks you to set a wallet password, and then — only after you confirm
                  it on the next step — replaces the unreadable file with the restored wallet.
                </p>
                <Button variant="outline" className="w-full" onClick={startImport} disabled={!importText.trim()}>
                  Restore wallet from seed phrase
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Not sure what happened, or you don't have your seed phrase to hand?{" "}
                <Link to="/support" className="underline underline-offset-2">
                  Get help
                </Link>{" "}
                before doing anything else — and don't clear this browser's site data, which
                would remove the file for good.
              </p>
            </CardContent>
          </Card>
        )}

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
              {setupOrigin === "recovery-import" && (
                <div className="space-y-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>This replaces the unreadable wallet file on this device.</strong>{" "}
                      Finishing permanently replaces that file with the wallet from the seed
                      phrase you entered. The unreadable file cannot be opened — only continue
                      if that phrase is the wallet you want on this device.
                    </span>
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={confirmReplace}
                      onChange={(e) => setConfirmReplace(e.target.checked)}
                    />
                    I understand this replaces the unreadable wallet file on this device, and
                    that the seed phrase I entered becomes the wallet stored here.
                  </label>
                </div>
              )}
              <Button
                className="w-full"
                onClick={finishSetup}
                disabled={busy || (setupOrigin === "recovery-import" && !confirmReplace)}
              >
                {busy
                  ? "Encrypting…"
                  : setupOrigin === "recovery-import"
                    ? "Replace unreadable file & create wallet"
                    : "Create encrypted wallet"}
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
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="sp-send">Send to — paste or scan any destination</Label>
                          <QrScanButton onScan={handleScanned} onOpenChange={handleQrScannerOpenChange} disabled={!session.mnemonic} />
                        </div>
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
                <CardTitle className="flex items-center gap-2">
                  Sell Bitcoin for ZMW <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY → ZMW WALLET</Badge>
                </CardTitle>
                <CardDescription>
                  Sell Bitcoin from this self-custody wallet and get ZMW in your platform ZMW
                  wallet. You send the Bitcoin to BMaGlass Pay yourself — from this wallet, in
                  the app, or from any other wallet — and the ZMW is credited when it arrives.
                  The fee is 1.5%, shown before you confirm.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!sellIntent ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="group" aria-label="Sell rail">
                      <Button
                        type="button" size="sm" variant={sellRail === "lightning" ? "default" : "ghost"}
                        className="h-10 rounded-full text-xs sm:text-sm" disabled={sellBusy}
                        aria-pressed={sellRail === "lightning"}
                        onClick={() => { setSellRail("lightning"); setSellPreview(null); }}
                      >
                        <Zap className="h-4 w-4 mr-1.5 shrink-0" /> Lightning (fastest)
                      </Button>
                      <Button
                        type="button" size="sm" variant={sellRail === "onchain" ? "default" : "ghost"}
                        className="h-10 rounded-full text-xs sm:text-sm" disabled={sellBusy}
                        aria-pressed={sellRail === "onchain"}
                        onClick={() => { setSellRail("onchain"); setSellPreview(null); }}
                      >
                        <Bitcoin className="h-4 w-4 mr-1.5 shrink-0" /> On-chain
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="group" aria-label="Sell amount type">
                      <Button
                        type="button" size="sm" variant={sellMode === "sats" ? "default" : "ghost"}
                        className="h-10 rounded-full text-xs sm:text-sm" disabled={sellBusy}
                        aria-pressed={sellMode === "sats"}
                        onClick={() => { setSellMode("sats"); setSellPreview(null); }}
                      >
                        Amount in sats
                      </Button>
                      <Button
                        type="button" size="sm" variant={sellMode === "zmw" ? "default" : "ghost"}
                        className="h-10 rounded-full text-xs sm:text-sm" disabled={sellBusy}
                        aria-pressed={sellMode === "zmw"}
                        onClick={() => { setSellMode("zmw"); setSellPreview(null); }}
                      >
                        Amount in ZMW
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="sell-amt">{sellMode === "sats" ? "You sell (sats)" : "You want to receive (ZMW)"}</Label>
                      <Input
                        id="sell-amt" type="number" min="1" placeholder={sellMode === "sats" ? "e.g. 50000" : "e.g. 500"}
                        value={sellInput}
                        onChange={(e) => { setSellInput(e.target.value); setSellPreview(null); }}
                      />
                      {sellMode === "zmw" && (
                        <p className="text-xs text-muted-foreground">
                          We work out how many sats that takes at the current rate; the exact
                          locked figures are shown before you confirm.
                        </p>
                      )}
                    </div>
                    {!sellPreview ? (
                      <Button className="w-full" disabled={sellBusy || !sellInput} onClick={doSellPreview}>
                        {sellBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Get sell quote
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
                          <p>You sell: <strong>{sellPreview.amount_sats.toLocaleString()} sats</strong></p>
                          <p>You receive: <strong>K{sellPreview.amount_zmw.toFixed(2)}</strong> in your platform ZMW wallet</p>
                          <p className="text-muted-foreground">
                            Rate: K{sellPreview.mid_rate_zmw.toLocaleString()} per BTC · Fee: K{sellPreview.fee_zmw.toFixed(2)} ({(sellPreview.fee_bps / 100).toFixed(2)}%)
                          </p>
                          <p className="text-muted-foreground">
                            Locking this quote gives you 30 minutes to send. If your Bitcoin is
                            fully received within 1 hour after that, it still settles at this
                            locked rate.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" className="flex-1" disabled={sellBusy} onClick={() => setSellPreview(null)}>Back</Button>
                          <Button className="flex-1 rounded-full bg-[#F7931A] text-black font-semibold hover:bg-[#DE830A]" disabled={sellBusy} onClick={doCreateSell}>
                            {sellBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Lock quote &amp; create sell
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
                      <p>Selling: <strong>{sellIntent.expected_sats.toLocaleString()} sats</strong> via {sellIntent.rail === "lightning" ? "Lightning" : "on-chain"}</p>
                      <p>You receive: <strong>K{sellIntent.expected_zmw.toFixed(2)}</strong> · Rate locked at K{sellIntent.mid_rate_zmw.toLocaleString()} per BTC · Fee K{sellIntent.fee_zmw.toFixed(2)} (1.50%)</p>
                      <p className="text-muted-foreground">Send by {new Date(sellIntent.expires_at).toLocaleString()} · Locked rate honoured for deposits fully received until {new Date(sellIntent.settle_deadline).toLocaleString()}</p>
                      {sellIntent.actual_sats !== null && (
                        <p>Received: <strong>{sellIntent.actual_sats.toLocaleString()} sats</strong>{sellIntent.zmw_credited !== null ? <> · Credited: <strong>K{sellIntent.zmw_credited.toFixed(2)}</strong></> : null}</p>
                      )}
                    </div>
                    <p className="text-sm flex items-start gap-2">
                      {sellPhase === "settled" ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" /> : <Loader2 className={`h-4 w-4 shrink-0 mt-0.5 ${sellPhase === "awaiting" || sellPhase === "received" ? "animate-spin" : ""}`} />}
                      <span>{sellPhase ? SELL_PHASE_COPY[sellPhase] : ""}</span>
                    </p>
                    {sellIntent.settle_error && (
                      <p className="text-sm text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {sellIntent.settle_error}
                      </p>
                    )}
                    {(sellPhase === "awaiting" || sellPhase === "received") && sellDestination && (
                      <div className="space-y-2">
                        <div className="flex justify-center rounded bg-white p-3">
                          <QRCode value={sellIntent.rail === "lightning" ? sellDestination : `bitcoin:${sellDestination}`} size={180} />
                        </div>
                        <p className="font-mono text-[10px] break-all rounded bg-muted p-2">{sellDestination}</p>
                        <Button variant="outline" size="sm" onClick={() => copy(sellDestination, sellIntent.rail === "lightning" ? "Invoice" : "Address")}>
                          <Copy className="h-4 w-4 mr-1" /> Copy {sellIntent.rail === "lightning" ? "invoice" : "address"}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {sellIntent.rail === "onchain"
                            ? "This is your own custodial deposit address. Send exactly the amount above to it from any wallet."
                            : "Pay this Lightning invoice from any Lightning wallet."}{" "}
                          If less or more Bitcoin arrives than shown, you are credited for the
                          amount that actually arrives, at this locked rate — never more, never
                          less. After the deadline above, this sell expires and any Bitcoin
                          received stays in your custodial Bitcoin wallet instead.
                        </p>
                        {sparkEnabled() && session.mnemonic && !sellSent ? (
                          <div className="space-y-2 rounded border p-3">
                            <p className="text-sm font-medium">Send from this wallet now</p>
                            {!sellPrepared ? (
                              <Button variant="outline" className="w-full" disabled={sellBusy} onClick={doSellPrepareInApp}>
                                Prepare in-app send — show me the fee first
                              </Button>
                            ) : (
                              <div className="space-y-2 text-sm">
                                <p>Amount: <strong>{sellPrepared.amountSats.toLocaleString()} sats</strong></p>
                                {sellPrepared.fee.lines.map((line) => (
                                  <p key={line.label}>{line.label}: <strong>{line.feeSats.toLocaleString()} sats</strong></p>
                                ))}
                                <Button className="w-full rounded-full bg-[#F7931A] text-black font-semibold hover:bg-[#DE830A]" disabled={sellBusy} onClick={doSellSendInApp}>
                                  {sellBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                                  Confirm &amp; send from this wallet
                                </Button>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                              The send is signed on this device with your seed phrase — it never
                              leaves this device. Nothing is sent until you confirm.
                            </p>
                          </div>
                        ) : sellSent ? (
                          <p className="text-sm text-muted-foreground">
                            Sent from this wallet. This page updates when the platform confirms
                            receipt — on-chain sends need network confirmations first.
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            In-app sending from this wallet is not enabled on this deployment
                            yet — send from any other Bitcoin wallet using the{" "}
                            {sellIntent.rail === "lightning" ? "invoice" : "address"} above.
                          </p>
                        )}
                        <Button variant="outline" size="sm" disabled={sellBusy} onClick={doCancelSell}>
                          Cancel this sell
                        </Button>
                      </div>
                    )}
                    {(sellPhase === "settled" || sellPhase === "expired" || sellPhase === "cancelled") && (
                      <Button
                        variant="outline" className="w-full"
                        onClick={() => { setSellIntent(null); setSellPreview(null); setSellInput(""); setSellPrepared(null); setSellSent(false); }}
                      >
                        Start a new sell
                      </Button>
                    )}
                  </div>
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
