// Scanner keep-alive (rendered pass finding, 2026-10-25): during
// the QR scan-to-send rendered pass, the self-custody wallet
// auto-locked TWICE while the scan dialog / OS file-picker steps
// were in progress, forcing password re-entry mid-flow. Aiming a
// camera at a code — or picking an image in the OS picker, which
// leaves the wallet UI entirely — produces no clicks in the page,
// so the idle timer read active use as idleness.
//
// The fix extends the in-flight keep-alive the wallet operations
// already use (commit ef28948: an operation counts as activity
// start-to-finish, held by a 60s touch interval): the scanner
// dialog reports its open state through an OPT-IN onOpenChange
// hook that only the self-custody send form passes, the open state
// joins the same busy condition that drives the keep-alive
// interval, and opening the scanner touches the session at once.
// The 5-minute idle timeout itself is unchanged, and with the
// scanner closed genuine idleness still locks — pinned below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// ---------------------------------------------------------------------
// Behavioural: the session's idle lock, with the scanner hold
// simulated exactly as the wallet wires it (touch on open, 60s
// touch interval while open, interval cleared on close).
// ---------------------------------------------------------------------

describe("self-custody auto-lock vs the scanner hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function freshSession() {
    vi.resetModules();
    return import("../../src/lib/selfcustody/session");
  }

  it("pins the idle timeout at exactly 5 minutes (unchanged)", async () => {
    const session = await freshSession();
    expect(session.AUTO_LOCK_MS).toBe(5 * 60 * 1000);
  });

  it("genuine idle with the scanner closed still locks at 5 minutes", async () => {
    const session = await freshSession();
    session.unlockSession("test mnemonic words");
    expect(session.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(session.AUTO_LOCK_MS - 1);
    expect(session.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(session.isUnlocked()).toBe(false);
  });

  it("while the scanner hold runs, the wallet stays unlocked well past 5 minutes", async () => {
    const session = await freshSession();
    session.unlockSession("test mnemonic words");
    // Scanner opens: immediate touch + the 60s keep-alive interval
    // the busy effect runs while anyBusy (incl. qrScannerOpen).
    session.touchSession();
    const keepAlive = setInterval(session.touchSession, 60_000);
    // Twelve minutes of aiming/picking — far beyond one idle window.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(60_000);
      expect(session.isUnlocked()).toBe(true);
    }
    clearInterval(keepAlive);
    session.lockSession();
  });

  it("once the scanner closes, the hold releases and idle locks again", async () => {
    const session = await freshSession();
    session.unlockSession("test mnemonic words");
    session.touchSession();
    const keepAlive = setInterval(session.touchSession, 60_000);
    vi.advanceTimersByTime(3 * 60_000); // a few minutes in the dialog
    expect(session.isUnlocked()).toBe(true);
    // Dialog closes (cancel / X / backdrop / successful scan): the
    // busy condition drops, the interval is cleared, and from the
    // last keep-alive touch the normal 5-minute idle window runs.
    clearInterval(keepAlive);
    vi.advanceTimersByTime(session.AUTO_LOCK_MS - 1);
    expect(session.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(session.isUnlocked()).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Structural: the wiring that connects the dialog to the hold.
// ---------------------------------------------------------------------

describe("scanner open-state wiring", () => {
  const scanner = read("../../src/components/QrScanButton.tsx");
  const selfCustody = read("../../src/pages/SelfCustodyWallet.tsx");
  const bitcoinWallet = read("../../src/pages/BitcoinWallet.tsx");

  it("the scanner exposes an opt-in onOpenChange hook", () => {
    expect(scanner).toContain("onOpenChange?: (open: boolean) => void;");
    expect(scanner).toContain("onOpenChangeRef.current?.(next);");
  });

  it("every open/close transition goes through the tracked setter", () => {
    expect(scanner).toContain("onClick={() => setScannerOpen(true)}");
    expect(scanner).toContain("else setScannerOpen(true);");
    // Successful scan + explicit close both release through it.
    expect(scanner.match(/setScannerOpen\(false\)/g) ?? []).toHaveLength(2);
    // The raw state setter is only ever called inside the tracked
    // setter itself — no path can flip the dialog silently.
    expect(scanner.match(/setOpen\(/g) ?? []).toHaveLength(1);
    expect(scanner).toContain("setOpen(next);");
  });

  it("unmounting with the scanner open releases the hold", () => {
    const cleanup = scanner.slice(
      scanner.indexOf("const wasOpen = openRef.current;") - 200,
      scanner.indexOf("const wasOpen = openRef.current;") + 300,
    );
    expect(cleanup).toContain("if (wasOpen) onOpenChangeRef.current?.(false);");
  });

  it("self-custody: the send form's Scan button registers the hold", () => {
    expect(selfCustody).toContain(
      "onOpenChange={handleQrScannerOpenChange}",
    );
    const handler = selfCustody.slice(
      selfCustody.indexOf("const handleQrScannerOpenChange"),
      selfCustody.indexOf("const handleQrScannerOpenChange") + 200,
    );
    expect(handler).toContain("setQrScannerOpen(next);");
    // Opening counts as activity immediately, not at the next tick.
    expect(handler).toContain("if (next) touchSession();");
  });

  it("self-custody: scanner-open joins the same keep-alive busy condition as wallet operations", () => {
    expect(selfCustody).toContain(
      "const [qrScannerOpen, setQrScannerOpen] = useState(false);",
    );
    expect(selfCustody).toContain(
      "const anyBusy = spBusy || scanning || sending || qrScannerOpen;",
    );
    // …and that condition still drives the one shared 60s interval.
    const effect = selfCustody.slice(
      selfCustody.indexOf("const anyBusy"),
      selfCustody.indexOf("const anyBusy") + 300,
    );
    expect(effect).toContain("setInterval(touchSession, 60_000)");
  });

  it("custodial: the shared scanner is used WITHOUT the hold (no auto-lock there)", () => {
    const usage = bitcoinWallet.slice(
      bitcoinWallet.indexOf("<QrScanButton"),
      bitcoinWallet.indexOf("<QrScanButton") + 200,
    );
    expect(usage).toContain("onScan={handleScanned}");
    expect(usage).not.toContain("onOpenChange");
  });
});
