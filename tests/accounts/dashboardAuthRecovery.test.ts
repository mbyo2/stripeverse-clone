// Regression tests for the 2026-10-25 22:52 CAT dashboard incident
// (src/lib/authFailure.ts + its wiring across AuthContext,
// ProtectedRoute, App, the dashboard and the audited pages).
//
// The CEO cleared his browser cache and landed on "We couldn't load
// your dashboard — check your connection" while the header still
// offered Sign Out: the shell believed the STORED session object,
// the data layer was being refused by it, and Try Again re-ran the
// same doomed fetch. These tests pin the replacement rules:
//
//   - auth failures (401 / JWT expired / dead refresh token) are
//     classified apart from network/server failures;
//   - recovery validates → refreshes → only a genuine GoTrue
//     refusal ends the session;
//   - a network failure NEVER ends a session ("unverifiable");
//   - protected routes wait for a VERIFIED session (isAuthReady);
//   - every audited Try Again re-verifies the session first.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAuthFailure,
  recoverAuthSession,
  markSessionEndedNotice,
  consumeSessionEndedNotice,
  clearSessionEndedNotice,
  SESSION_ENDED_MESSAGE,
  type RecoveryDeps,
} from "../../src/lib/authFailure";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const NOW = 1_762_000_000_000;
const jwtExpired = { code: "PGRST301", message: "JWT expired", status: 401 };
const refreshDead = {
  code: "refresh_token_not_found",
  message: "Invalid Refresh Token: Refresh Token Not Found",
  status: 400,
};
const networkDown = new TypeError("Failed to fetch");

// ---------------------------------------------------------------------
// isAuthFailure — auth refusals vs everything else
// ---------------------------------------------------------------------

describe("isAuthFailure", () => {
  it("classifies session refusals as auth failures", () => {
    const authFailures: unknown[] = [
      { status: 401, message: "unauthorized" }, // PostgREST with a dead token
      jwtExpired, // PostgREST JWT-expired shape
      { message: "JWT expired" },
      refreshDead, // GoTrue refresh refusal
      { code: "session_not_found", message: "Session from session_id claim in JWT does not exist", status: 400 },
      { name: "AuthSessionMissingError", message: "Auth session missing!" },
      new Error("User not authenticated"), // the app's own query guards
    ];
    for (const failure of authFailures) {
      expect(isAuthFailure(failure), JSON.stringify(failure)).toBe(true);
    }
  });

  it("does NOT classify network, server, rate-limit or permission failures as auth failures", () => {
    const notAuth: unknown[] = [
      networkDown, // connectivity — proves nothing about the session
      new Error("Failed to fetch"),
      { status: 500, message: "Internal server error" },
      { status: 503 },
      { status: 429, message: "Too many requests" }, // rate limit is transient
      { status: 403, code: "42501", message: "permission denied for table wallets" }, // RLS: valid token, no permission
      { status: 404, message: "Not found" },
      { code: "PGRST302", message: "Anonymous role claims are not allowed" }, // role-claims issue, not a dead session
      new Error("Something went wrong"),
      "a plain string failure",
      null,
      undefined,
      {},
    ];
    for (const failure of notAuth) {
      expect(isAuthFailure(failure), JSON.stringify(failure)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------
// recoverAuthSession — validate → refresh → sign out only on refusal
// ---------------------------------------------------------------------

function makeDeps(overrides: Partial<RecoveryDeps> = {}): {
  deps: RecoveryDeps;
  calls: { getUser: number; refresh: number; endSession: number };
} {
  const calls = { getUser: 0, refresh: 0, endSession: 0 };
  const deps: RecoveryDeps = {
    getSession: async () => ({ expires_at: Math.floor(NOW / 1000) + 3600 }),
    getUser: async () => {
      calls.getUser++;
      return { user: { id: "user-1" }, error: null };
    },
    refreshSession: async () => {
      calls.refresh++;
      return { error: null };
    },
    endSession: async () => {
      calls.endSession++;
    },
    nowMs: NOW,
    ...overrides,
  };
  return { deps, calls };
}

describe("recoverAuthSession", () => {
  it("no stored session → signed-out, with nothing else attempted", async () => {
    const { deps, calls } = makeDeps({ getSession: async () => null });
    await expect(recoverAuthSession(deps)).resolves.toBe("signed-out");
    expect(calls.getUser).toBe(0);
    expect(calls.refresh).toBe(0);
    expect(calls.endSession).toBe(0);
  });

  it("access token accepted → valid; no refresh, no sign-out (silent normal path)", async () => {
    const { deps, calls } = makeDeps();
    await expect(recoverAuthSession(deps)).resolves.toBe("valid");
    expect(calls.refresh).toBe(0);
    expect(calls.endSession).toBe(0);
  });

  it("expired access token + valid refresh token → refreshed, session survives", async () => {
    const { deps, calls } = makeDeps({
      getUser: async () => ({ user: null, error: jwtExpired }),
    });
    await expect(recoverAuthSession(deps)).resolves.toBe("refreshed");
    expect(calls.refresh).toBe(1);
    expect(calls.endSession).toBe(0);
  });

  it("expired access token + refused refresh token → signed-out, local session ended exactly once", async () => {
    const { deps, calls } = makeDeps({
      getUser: async () => ({ user: null, error: jwtExpired }),
      refreshSession: async () => {
        calls.refresh++;
        return { error: refreshDead };
      },
    });
    await expect(recoverAuthSession(deps)).resolves.toBe("signed-out");
    expect(calls.endSession).toBe(1);
  });

  it("validation unreachable (network) → unverifiable; session untouched, refresh never attempted", async () => {
    const { deps, calls } = makeDeps({
      getUser: async () => ({ user: null, error: networkDown }),
    });
    await expect(recoverAuthSession(deps)).resolves.toBe("unverifiable");
    expect(calls.refresh).toBe(0);
    expect(calls.endSession).toBe(0);
  });

  it("refresh attempt lost to the network → unverifiable; a network failure NEVER signs out", async () => {
    const { deps, calls } = makeDeps({
      getUser: async () => ({ user: null, error: jwtExpired }),
      refreshSession: async () => {
        calls.refresh++;
        return { error: networkDown };
      },
      // Stored session still shows the old (past) expiry afterwards.
      getSession: async () => ({ expires_at: Math.floor(NOW / 1000) - 60 }),
    });
    await expect(recoverAuthSession(deps)).resolves.toBe("unverifiable");
    expect(calls.endSession).toBe(0);
  });

  it("refresh raced a successful background refresh → valid, session survives", async () => {
    let reads = 0;
    const { deps, calls } = makeDeps({
      getUser: async () => ({ user: null, error: jwtExpired }),
      refreshSession: async () => {
        calls.refresh++;
        return { error: networkDown };
      },
      getSession: async () => {
        reads++;
        // First read: the stored session. Second read (after the
        // inconclusive refresh): a background refresh has landed and
        // the expiry is comfortably in the future again.
        return { expires_at: Math.floor(NOW / 1000) + (reads > 1 ? 3600 : -60) };
      },
    });
    await expect(recoverAuthSession(deps)).resolves.toBe("valid");
    expect(calls.endSession).toBe(0);
  });

  it("models the Try Again contract: fetch fails auth → recover (refresh) → same fetch succeeds", async () => {
    // The CEO's loop, inverted: the first fetch goes out with a dead
    // token and is refused; recovery refreshes; the retry — Try
    // Again's second half — goes out with the live token and loads.
    let tokenLive = false;
    const fetchDashboard = async () => {
      if (!tokenLive) throw jwtExpired;
      return { totalBalance: 1250 };
    };
    const { deps, calls } = makeDeps({
      getUser: async () =>
        tokenLive ? { user: { id: "user-1" }, error: null } : { user: null, error: jwtExpired },
      refreshSession: async () => {
        calls.refresh++;
        tokenLive = true;
        return { error: null };
      },
    });

    await expect(fetchDashboard()).rejects.toBe(jwtExpired);
    await expect(recoverAuthSession(deps)).resolves.toBe("refreshed");
    await expect(fetchDashboard()).resolves.toEqual({ totalBalance: 1250 });
    expect(calls.endSession).toBe(0);
  });
});

// ---------------------------------------------------------------------
// The signed-out notice — shown once, storage failures never fatal
// ---------------------------------------------------------------------

describe("session-ended notice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says it in plain language", () => {
    expect(SESSION_ENDED_MESSAGE).toBe(
      "You've been signed out. Please sign in again.",
    );
  });

  it("mark → consume shows exactly once; clear drops a pending notice", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });

    expect(consumeSessionEndedNotice()).toBe(false);
    markSessionEndedNotice();
    expect(consumeSessionEndedNotice()).toBe(true);
    expect(consumeSessionEndedNotice()).toBe(false);

    markSessionEndedNotice();
    clearSessionEndedNotice();
    expect(consumeSessionEndedNotice()).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => markSessionEndedNotice()).not.toThrow();
    expect(() => clearSessionEndedNotice()).not.toThrow();
    expect(consumeSessionEndedNotice()).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Structural pins on the wiring
// ---------------------------------------------------------------------

describe("AuthContext wiring", () => {
  const ctx = read("../../src/contexts/AuthContext.tsx");

  it("bootstrap VERIFIES the stored session instead of trusting its presence", () => {
    expect(ctx).toContain("supabase.auth.getUser()");
    expect(ctx).toContain("recoverAuthSession({");
    expect(ctx).toContain("setIsAuthReady(true)");
  });

  it("exposes the verified gate and recovery to the app", () => {
    expect(ctx).toContain("isAuthReady");
    expect(ctx).toContain("recoverSession");
  });

  it("a genuine session end clears local state even if the sign-out call fails", () => {
    expect(ctx).toContain("endSessionLocally");
    expect(ctx).toContain("markSessionEndedNotice()");
    // verifySession's terminal branch (5735718 decision) now ends
    // the session locally with the notice.
    const verifyBranch = ctx.slice(ctx.indexOf("shouldSignOutAfterVerify({"));
    expect(verifyBranch).toContain("endSessionLocally({ notice: true })");
  });

  it("registers the app-wide auth-failure net and invalidates on refresh", () => {
    expect(ctx).toContain("setAuthFailureHandler(");
    expect(ctx).toContain('outcome === "refreshed"');
    expect(ctx).toContain("queryClient.invalidateQueries()");
  });

  it("does not disturb the 5735718 session lifecycle", () => {
    expect(ctx).toContain("expirySchedule(session.expires_at, Date.now())");
    expect(ctx).toContain("shouldSignOutAfterVerify({");
    expect(ctx).toContain('signOut({ scope: "local" })');
  });
});

describe("route + shell wiring", () => {
  it("ProtectedRoute renders nothing protected until the session is verified", () => {
    const route = read("../../src/components/ProtectedRoute.tsx");
    expect(route).toContain("isAuthReady");
    expect(route).toContain("!isAuthReady || rolesLoading || rolesNotReady");
    expect(route).toContain('<Navigate to="/login"');
  });

  it("App forwards every query error to the auth-failure net", () => {
    const app = read("../../src/App.tsx");
    expect(app).toContain("QueryCache");
    expect(app).toContain("notifyAuthFailure(error)");
  });

  it("RoleContext waits for verification before fetching roles", () => {
    const roles = read("../../src/contexts/RoleContext.tsx");
    expect(roles).toContain("if (!isAuthReady) return;");
  });

  it("Login shows the signed-out notice, consumed once", () => {
    const login = read("../../src/pages/Login.tsx");
    expect(login).toContain("consumeSessionEndedNotice()");
    expect(login).toContain("SESSION_ENDED_MESSAGE");
  });
});

describe("page wiring — Try Again recovers, auth failures never wall", () => {
  it("the recovering-retry hook verifies the session before refetching", () => {
    const hook = read("../../src/hooks/useRecoveringRetry.ts");
    expect(hook).toContain("recoverSession()");
    expect(hook).toContain('outcome !== "signed-out"');
  });

  it("the dashboard auto-recovers auth failures and never walls them", () => {
    const data = read("../../src/hooks/useDashboardData.ts");
    expect(data).toContain("isAuthFailure(firstError)");
    expect(data).toContain("retryWithRecovery");
    expect(data).toContain("isAuthRecovering");

    const page = read("../../src/pages/Dashboard.tsx");
    expect(page).toContain("isAuthRecovering");
    expect(page).toContain("onRetry={retryWithRecovery}");
    expect(page).not.toContain("onRetry={refetchDashboard}");
  });

  it("wallet, transactions and the P2P pages retry through recovery", () => {
    expect(read("../../src/pages/Wallet.tsx")).toContain(
      "retryWithRecovery(refetchWallet)",
    );
    expect(read("../../src/components/wallet/TransactionHistory.tsx")).toContain(
      "retryWithRecovery(refetch)",
    );
    for (const page of [
      "P2POrders",
      "P2PMarketplace",
      "P2PMyAds",
      "P2PDispute",
      "P2PTradeRoom",
    ]) {
      expect(read(`../../src/pages/${page}.tsx`), page).toContain(
        "retryWithRecovery(() =>",
      );
    }
  });

  it("the Bitcoin wallet shows a real error state for genuine failures only", () => {
    const page = read("../../src/pages/BitcoinWallet.tsx");
    expect(page).toContain("isAuthFailure(walletError)");
    expect(page).toContain("PageErrorState");
    expect(page).toContain("retryWithRecovery(refetchWallet)");
  });
});
