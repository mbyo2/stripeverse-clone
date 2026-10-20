import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
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
import { useSession, unlockSession, lockSession, touchSession } from "@/lib/selfcustody/session";
import {
  liquidLightningEnabled,
  liquidBalanceSat,
  liquidCreateInvoice,
  liquidPayInvoice,
  disconnectLiquid,
} from "@/lib/selfcustody/lightning";

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
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Self-custody Lightning (Breez SDK – Liquid) state.
  const [lnBalance, setLnBalance] = useState<number | null>(null);
  const [lnBusy, setLnBusy] = useState(false);
  const [lnInvoiceAmount, setLnInvoiceAmount] = useState("");
  const [lnCreatedInvoice, setLnCreatedInvoice] = useState<string | null>(null);
  const [lnPayText, setLnPayText] = useState("");

  const account = useMemo(
    () => (session.mnemonic ? accountFromMnemonic(session.mnemonic) : null),
    [session.mnemonic],
  );

  useEffect(() => {
    if (session.mnemonic) {
      setStage("wallet");
    } else {
      // Locked or removed: drop any Liquid SDK instance bound to the seed.
      disconnectLiquid();
      setLnBalance(null);
      setLnCreatedInvoice(null);
      if (stage === "wallet") setStage(hasVault ? "locked" : "choose");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mnemonic]);

  const doScan = async () => {
    if (!account) return;
    setScanning(true);
    setScanError(null);
    try {
      const [result, rate] = await Promise.all([scanWallet(account), fetchRecommendedFeeRate().catch(() => null)]);
      setScan(result);
      if (rate) setFeeRate(rate);
    } catch (e: any) {
      setScanError(e?.message || "Could not load wallet data from the network");
    } finally {
      setScanning(false);
    }
  };

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
      toast.error(e?.message || "Could not create the wallet vault");
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
      toast.error(e?.message || "Unlock failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = () => {
    deleteVault();
    lockSession();
    setHasVault(false);
    setScan(null);
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
      toast.error(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const receiveAddress = account && scan ? deriveAddress(account, 0, scan.nextReceiveIndex) : null;
  const vaultMeta = getVaultMeta();

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
                Forgot the password? Remove the wallet below and import your seed phrase again —
                that is the only recovery path, by design.
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
                {scanError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> {scanError}
                  </p>
                )}
                {scanning && !scan && <p className="text-sm text-muted-foreground">Scanning the blockchain for your addresses…</p>}
                {scan && (
                  <div>
                    <div className="text-3xl font-bold">{formatBtc(scan.balanceSats)} BTC</div>
                    <div className="text-sm text-muted-foreground">{scan.balanceSats.toLocaleString()} sats confirmed</div>
                  </div>
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
                      <p className="font-mono text-xs break-all rounded bg-muted p-2">{receiveAddress}</p>
                      <Button variant="outline" size="sm" onClick={() => copy(receiveAddress, "Address")}>
                        <Copy className="h-4 w-4 mr-1" /> Copy address
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading address…</p>
                  )}
                  <div className="pt-2">
                    <Label className="text-xs text-muted-foreground">Account public key (zpub — watch-only export)</Label>
                    <p className="font-mono text-[10px] break-all rounded bg-muted p-2 mt-1">{accountXpub(account)}</p>
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
                  Lightning <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY</Badge>
                </CardTitle>
                <CardDescription>
                  Self-custody Lightning runs in your browser via the Breez SDK on the Liquid
                  network, under the same seed phrase as this wallet — no BMaGlass server is
                  involved.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!liquidLightningEnabled() ? (
                  <p className="text-sm text-muted-foreground">
                    Lightning for the self-custody wallet is not enabled on this deployment yet:
                    it requires a dedicated client-scoped Breez API key, separate from the
                    platform's server-side Lightning key (which must never be embedded in a web
                    page). On-chain self-custody above is fully functional. Your custodial
                    account's Lightning works as before.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Liquid balance: {lnBalance === null ? "—" : `${lnBalance.toLocaleString()} sats`}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={lnBusy || !session.mnemonic}
                        onClick={async () => {
                          if (!session.mnemonic) return;
                          setLnBusy(true);
                          try {
                            setLnBalance(await liquidBalanceSat(session.mnemonic));
                          } catch (e: any) {
                            toast.error(e?.message || "Could not connect the Lightning wallet");
                          } finally {
                            setLnBusy(false);
                          }
                        }}
                      >
                        {lnBusy ? "Connecting…" : "Connect / refresh"}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="ln-amt">Create invoice (sats)</Label>
                        <Input id="ln-amt" type="number" min="1" value={lnInvoiceAmount} onChange={(e) => setLnInvoiceAmount(e.target.value)} />
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={lnBusy || !session.mnemonic || !lnInvoiceAmount}
                          onClick={async () => {
                            if (!session.mnemonic) return;
                            setLnBusy(true);
                            try {
                              const { invoice, feesSat } = await liquidCreateInvoice(
                                session.mnemonic,
                                Number(lnInvoiceAmount),
                              );
                              setLnCreatedInvoice(invoice);
                              toast.success(`Invoice created (network/swap fee ${feesSat} sats)`);
                            } catch (e: any) {
                              toast.error(e?.message || "Could not create the invoice");
                            } finally {
                              setLnBusy(false);
                            }
                          }}
                        >
                          Create invoice
                        </Button>
                        {lnCreatedInvoice && (
                          <>
                            <p className="font-mono text-[10px] break-all rounded bg-muted p-2">{lnCreatedInvoice}</p>
                            <Button variant="outline" size="sm" onClick={() => copy(lnCreatedInvoice, "Invoice")}>
                              <Copy className="h-4 w-4 mr-1" /> Copy invoice
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ln-pay">Pay an invoice</Label>
                        <Textarea id="ln-pay" rows={3} placeholder="lnbc…" value={lnPayText} onChange={(e) => setLnPayText(e.target.value)} />
                        <Button
                          className="w-full"
                          disabled={lnBusy || !session.mnemonic || !lnPayText.trim()}
                          onClick={async () => {
                            if (!session.mnemonic) return;
                            setLnBusy(true);
                            try {
                              const { feesSat } = await liquidPayInvoice(session.mnemonic, lnPayText);
                              toast.success(`Invoice paid (fees ${feesSat ?? 0} sats)`);
                              setLnPayText("");
                              setLnBalance(await liquidBalanceSat(session.mnemonic));
                            } catch (e: any) {
                              toast.error(e?.message || "Payment failed");
                            } finally {
                              setLnBusy(false);
                            }
                          }}
                        >
                          Pay invoice
                        </Button>
                      </div>
                    </div>
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
