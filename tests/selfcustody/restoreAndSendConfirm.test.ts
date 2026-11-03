// Self-custody completion pins (audit, 2026-11-03):
//  1. The locked screen offered NO recovery at all — a forgot-password
//     user could neither restore from the seed phrase (the copy
//     promised it, the screen had no path) nor remove the wallet
//     (removal sat behind the unlock they could not do). These tests
//     pin the restore path AND the locked-screen removal, both wired
//     through the existing import/createVault-replace machinery.
//  2. The on-chain Send card broadcast immediately from address +
//     amount. It now prepares → confirms with destination, amount,
//     live fee at the chosen tier, and total — the same standard as
//     the Spark send — plus a send-max.
//  3. The Spark send always used the "medium" confirmation speed for
//     on-chain destinations although the preview listed slow/medium/
//     fast fees. The chosen speed is now wired through.
//  4. The seed phrase could never be viewed again after setup. It now
//     sits behind a warning + password re-verification.
//  5. The two balances (BIP84 on-chain, Spark) are labelled as two
//     pots under one seed, with how funds move between them.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const page = read("../../src/pages/SelfCustodyWallet.tsx");
const lastKnown = read("../../src/lib/selfcustody/lastKnown.ts");

describe("locked screen — forgot-password restore from the seed phrase", () => {
  it("offers a clearly-labelled restore path from the locked screen", () => {
    expect(page).toContain("Forgot password — restore from seed phrase");
    expect(page).toContain('setStage("forgot-restore")');
    expect(page).toContain("There is no password reset — but your seed phrase restores the wallet");
  });

  it("drops the old misleading copy that promised a path the screen did not have", () => {
    expect(page).not.toContain("Unlock the wallet to manage or remove it");
    expect(page).not.toContain("Sign & broadcast");
  });

  it("has a dedicated restore stage that warns the device copy is replaced", () => {
    expect(page).toContain('stage === "forgot-restore"');
    expect(page).toContain("Restoring replaces the wallet stored on this device.");
    expect(page).toContain("the current wallet file is only overwritten on the next step");
    expect(page).toContain("controlled by the seed phrase itself, not by the file");
  });

  it("validates the phrase against BIP39 and enters setup as locked-restore", () => {
    const fn = page.slice(page.indexOf("const startForgotRestore"), page.indexOf("const doUnlock"));
    expect(fn).toContain("isValidMnemonic(phrase)");
    expect(fn).toContain('setSetupOrigin("locked-restore")');
    expect(fn).toContain('setStage("set-password")');
  });

  it("finishSetup only replaces the vault for the replace origins, with explicit confirmation", () => {
    const fn = page.slice(page.indexOf("const finishSetup"), page.indexOf("const startImport"));
    expect(fn).toContain('setupOrigin === "recovery-import" || setupOrigin === "locked-restore"');
    expect(fn).toContain("const allowReplace = replaceOrigin && confirmReplace;");
    expect(fn).toContain("allowReplace ? { replaceExisting: true } : undefined");
  });

  it("the set-password step renders the locked-restore replacement warning + checkbox", () => {
    expect(page).toContain("This replaces the wallet stored on this device.");
    expect(page).toContain("Replace wallet on this device & restore");
    expect(page).toContain(
      "I understand this replaces the wallet stored on this device, and that the seed phrase I entered becomes the wallet stored here under my new password.",
    );
  });
});

describe("locked screen — removal without unlocking, double-confirmed", () => {
  it("offers removal from the locked screen itself", () => {
    expect(page).toContain("Remove wallet from this device");
    expect(page).toContain("You can remove the wallet from this device without unlocking it");
  });

  it("states the consequences plainly before either confirmation", () => {
    expect(page).toContain("Removal deletes only the encrypted wallet copy stored on this");
    expect(page).toContain("The Bitcoin itself stays on the blockchain");
    expect(page).toContain("becomes unreachable, and BMaGlass cannot recover it for you");
  });

  it("requires TWO explicit confirmations, the second one final", () => {
    expect(page).toContain("I understand — continue");
    expect(page).toContain("Final confirmation.");
    expect(page).toContain("Yes — remove the wallet from this device");
    expect(page).toContain("setConfirmRemoveLockedFinal(true)");
  });

  it("removal reuses the shared machinery and clears every last-known entry (xpub unknowable while locked)", () => {
    const fn = page.slice(page.indexOf("const doRemoveLocked"), page.indexOf("const doRevealSeed"));
    expect(fn).toContain("clearAllLastKnown();");
    expect(fn).toContain("finishRemoval();");
    expect(page).toContain("const finishRemoval = () => {");
    expect(lastKnown).toContain("export function clearAllLastKnown()");
  });
});

describe("on-chain send — prepare → confirm, fee tiers, send max", () => {
  it("no longer broadcasts straight from the form", () => {
    expect(page).not.toContain("const doSend");
    expect(page).toContain("const doPrepareChainSend");
    expect(page).toContain("const doConfirmChainSend");
  });

  it("prepare builds and signs locally but never broadcasts", () => {
    const fn = page.slice(page.indexOf("const doPrepareChainSend"), page.indexOf("const doConfirmChainSend"));
    expect(fn).toContain("buildSignedTransaction({");
    expect(fn).toContain("fetchRecommendedFeeRates()");
    expect(fn).not.toContain("broadcastTransaction");
    expect(fn).toContain("setPreparedChainSend({");
  });

  it("confirm broadcasts exactly the reviewed transaction", () => {
    const fn = page.slice(page.indexOf("const doConfirmChainSend"), page.indexOf("const copy = async"));
    expect(fn).toContain("broadcastTransaction(preparedChainSend.hex)");
  });

  it("the review shows destination, amount, the live fee at the chosen tier, and the total", () => {
    expect(page).toContain("Review send — show the fee first");
    expect(page).toContain("Network fee:");
    expect(page).toContain("Total leaving this pot:");
    expect(page).toContain("Confirm & broadcast");
    expect(page).toContain("Nothing is broadcast until you review the fee and");
  });

  it("offers the economy / hour / half-hour tiers at their live rates", () => {
    expect(page).toContain("CHAIN_SPEEDS");
    expect(page).toContain("chainFeeRates[tier.key]");
    expect(page).toContain('aria-label="On-chain confirmation speed"');
    expect(page).toContain("const rate = rates[sendSpeed];");
  });

  it("offers send-max, planned and built as a true max", () => {
    expect(page).toContain("Send max (whole balance, minus the fee)");
    expect(page).toContain("planSendMax(scan.utxos, rate)");
    expect(page).toContain("sendMax,");
  });

  it("editing any send field drops the prepared transaction", () => {
    const clears = page.match(/setPreparedChainSend\(null\)/g) ?? [];
    // Session-lock reset + address + amount + max toggle + speed = at least 5.
    expect(clears.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Spark send — the chosen confirmation speed is wired through", () => {
  it("passes the user's speed to sparkSendPrepared instead of always medium", () => {
    expect(page).toContain("sparkSendPrepared(session.mnemonic, preparedSend, sparkSpeed)");
    // The sell flow's own call stays on the default — its pin lives in sellToZmw.test.ts.
    expect(page).toContain("sparkSendPrepared(session.mnemonic, sellPrepared)");
  });

  it("renders a slow / medium / fast selector for on-chain destinations", () => {
    expect(page).toContain('preparedSend.prepareResponse.paymentMethod.type === "bitcoinAddress"');
    expect(page).toContain('aria-label="Confirmation speed"');
    expect(page).toContain("setSparkSpeed(speed)");
    expect(page).toContain("Confirmation speed for this on-chain send");
  });
});

describe("seed reveal — warning, password re-verification, auto-hide", () => {
  it("offers Show seed phrase in the unlocked wallet", () => {
    expect(page).toContain("Show seed phrase");
    expect(page).toContain("Hide seed phrase");
    expect(page).toContain('setSeedView("warn")');
  });

  it("warns plainly before any password prompt", () => {
    expect(page).toContain("Never show this phrase next to other people.");
    expect(page).toContain("Anyone who");
    expect(page).toContain("controls your funds");
  });

  it("verifies the password against the vault and only for THIS wallet", () => {
    const fn = page.slice(page.indexOf("const doRevealSeed"), page.indexOf("const doPrepareChainSend"));
    expect(fn).toContain("unlockVault(seedPw)");
    expect(fn).toContain("mnemonic !== session.mnemonic");
    expect(fn).toContain('setSeedView("shown")');
  });

  it("auto-hides when the wallet locks (session reset drops the reveal state)", () => {
    const lockReset = page.slice(page.indexOf("disconnectSparkAndWipeStorage();"), page.indexOf('if (stage === "wallet")'));
    expect(lockReset).toContain('setSeedView("idle")');
    expect(lockReset).toContain('setSeedPw("")');
  });
});

describe("two balances — two pots, one seed, plainly labelled", () => {
  it("labels the BIP84 balance as the on-chain pot", () => {
    expect(page).toContain("This is your <strong>on-chain pot</strong>");
    expect(page).toContain("the place for larger amounts");
  });

  it("labels the Spark balance as the second pot and explains moving between them", () => {
    expect(page).toContain("This is your <strong>second pot</strong>");
    expect(page).toContain("The two pots are separate balances.");
    expect(page).toContain("send from one pot to the other pot");
    expect(page).toContain("each move is an ordinary payment and may");
  });
});
