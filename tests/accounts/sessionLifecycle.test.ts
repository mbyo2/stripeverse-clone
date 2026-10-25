// Regression tests for the 2026-10-25 "signed out while using the
// wallet" incident (src/lib/sessionLifecycle.ts + its wiring in
// AuthContext / SessionTimeoutWarning).
//
// Forensic basis (auth audit log, project paymentgetway): a
// client-side `logout` at 18:05:44 CAT — an explicit
// supabase.auth.signOut() call, NOT a token revocation. The app
// carried two automatic sign-out triggers (a bare expiry timer
// racing supabase-js auto-refresh, and a warning countdown
// decoupled from the live session), and signOut() defaulted to
// scope "global", revoking every device. These tests pin the
// replacement rules:
//
//   - expiry is a VERIFY point, never a direct sign-out;
//   - only a genuine GoTrue refresh failure ends a session;
//   - wallet/SDK/data errors are never session-ending;
//   - an explicit sign-out is scoped to this device ("local").

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expirySchedule,
  shouldSignOutAfterVerify,
  isSessionEndingError,
  SESSION_WARN_BEFORE_MS,
} from "../../src/lib/sessionLifecycle";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const NOW = 1_762_000_000_000; // fixed ms epoch for the truth tables
const inSeconds = (msFromNow: number) => Math.floor((NOW + msFromNow) / 1000);

// ---------------------------------------------------------------------
// expirySchedule — the verify/warn timetable
// ---------------------------------------------------------------------

describe("expirySchedule", () => {
  it("no session expiry → no timers at all", () => {
    expect(expirySchedule(undefined, NOW)).toEqual({ warnDelayMs: null, verifyDelayMs: null });
  });

  it("expiry comfortably ahead → warn 5 minutes before, verify at expiry", () => {
    const s = expirySchedule(inSeconds(60 * 60 * 1000), NOW);
    expect(s.verifyDelayMs).toBe(60 * 60 * 1000);
    expect(s.warnDelayMs).toBe(60 * 60 * 1000 - SESSION_WARN_BEFORE_MS);
  });

  it("expiry inside the warning window → no warning, verify at expiry", () => {
    const s = expirySchedule(inSeconds(2 * 60 * 1000), NOW);
    expect(s.warnDelayMs).toBeNull();
    expect(s.verifyDelayMs).toBe(2 * 60 * 1000);
  });

  it("already-expired token → verify immediately (0), never a negative delay", () => {
    // The old code armed setTimeout(signOut, negative) here, which
    // fired instantly on mount and signed the user out.
    const s = expirySchedule(inSeconds(-30 * 1000), NOW);
    expect(s.verifyDelayMs).toBe(0);
    expect(s.warnDelayMs).toBeNull();
  });
});

// ---------------------------------------------------------------------
// shouldSignOutAfterVerify — the only automatic session-ending decision
// ---------------------------------------------------------------------

describe("shouldSignOutAfterVerify", () => {
  it("a successful refresh never signs out", () => {
    expect(shouldSignOutAfterVerify({ refreshFailed: false, nowMs: NOW })).toBe(false);
  });

  it("a failed refresh with no valid session afterwards signs out (genuine failure)", () => {
    expect(shouldSignOutAfterVerify({ refreshFailed: true, nowMs: NOW })).toBe(true);
    expect(
      shouldSignOutAfterVerify({
        refreshFailed: true,
        expiresAtSecondsAfter: inSeconds(-60 * 1000),
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("a failed refresh that raced a successful background refresh does NOT sign out", () => {
    expect(
      shouldSignOutAfterVerify({
        refreshFailed: true,
        expiresAtSecondsAfter: inSeconds(30 * 60 * 1000),
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Wallet / SDK / data errors are never session-ending
// ---------------------------------------------------------------------

describe("isSessionEndingError — wallet failures never clear the session", () => {
  const walletFailures: unknown[] = [
    new Error("Could not connect the Spark wallet"), // Spark SDK connect failure
    new Error("Failed to fetch dynamically imported module"), // stale chunk
    new Error("Chain data request failed (429)"), // esplora read failure
    new Error("Failed to fetch"), // network drop mid-load
    { message: "Edge function returned 500", status: 500 }, // FunctionsHttpError shape
    { message: "JWT expired" }, // even an auth-flavoured DATA error: decisions live in the refresh path only
    "a plain string failure",
    null,
    undefined,
  ];

  it("returns false for every simulated wallet-load / early-click failure", () => {
    for (const failure of walletFailures) {
      expect(isSessionEndingError(failure)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------
// Structural pins on the wiring
// ---------------------------------------------------------------------

describe("AuthContext wiring", () => {
  const auth = read("../../src/contexts/AuthContext.tsx");

  it("signs out with scope local, never the global default", () => {
    expect(auth).toContain('signOut({ scope: "local" })');
    expect(auth).not.toMatch(/await supabase\.auth\.signOut\(\)/);
  });

  it("has no bare expiry timer that calls signOut (the removed race)", () => {
    expect(auth).not.toContain("Auto logout at expiry");
    expect(auth).not.toMatch(/setTimeout\(\(\) => \{\s*signOut\(\)/);
    expect(auth).toContain("expirySchedule(session.expires_at, Date.now())");
    expect(auth).toContain("void verifySession()");
  });

  it("verifySession decides via shouldSignOutAfterVerify", () => {
    expect(auth).toContain("shouldSignOutAfterVerify({");
    expect(auth).toContain("refreshSession()");
  });
});

describe("SessionTimeoutWarning wiring", () => {
  const warning = read("../../src/components/SessionTimeoutWarning.tsx");

  it("countdown end is a verify point, not a sign-out", () => {
    expect(warning).toMatch(/prev <= 1\) \{\s*void verifySession\(\);/);
  });
});

describe("wallet surfaces hold no session-ending power", () => {
  const walletFiles = [
    "../../src/pages/SelfCustodyWallet.tsx",
    "../../src/pages/BitcoinWallet.tsx",
    "../../src/lib/selfcustody/spark.ts",
    "../../src/lib/selfcustody/chain.ts",
    "../../src/lib/selfcustody/session.ts",
  ];

  it("no wallet file calls supabase signOut or the auth context's signOut", () => {
    for (const rel of walletFiles) {
      const src = read(rel);
      expect(src, rel).not.toContain("auth.signOut");
      expect(src, rel).not.toMatch(/const \{[^}]*signOut[^}]*\} = useAuth\(\)/);
    }
  });

  it("the self-custody page keeps its session alive during in-flight work", () => {
    const page = read("../../src/pages/SelfCustodyWallet.tsx");
    // Keep-alive interval while busy + touches around the receive flow.
    expect(page).toContain("setInterval(touchSession, 60_000)");
    const receive = page.slice(page.indexOf("const doSparkReceive"), page.indexOf("const doParseSend"));
    expect(receive).toContain("touchSession()");
  });
});
