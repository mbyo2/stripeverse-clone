// Regression tests for the 2026-10-29 wrong-page flash (CEO: "it is
// trying to show another page and then it realizes that I'm logged
// in") — src/lib/sessionHint.ts + its wiring across AuthContext,
// Index, Login, Register, Header, AnimatedRoutes and ProtectedRoute.
//
// Root cause: AuthProvider initialises user === null and only applies
// the persisted session after getSession() resolves in an effect, so
// every surface branching on `user` painted its signed-out version
// first — the landing page at `/`, the login/register forms, the
// guest header chrome — and flipped when the session landed.
//
// These tests pin the replacement rules:
//   - the persisted-session hint is read synchronously and strictly
//     (only a real sb-*-auth-token blob with live token material
//     counts; corrupt/verifier/empty blobs never hold a guest);
//   - the gate (isAuthPending) holds ONLY the unresolved-with-hint
//     window — guests are never held, resolved states never held;
//   - the skeleton header variant follows the same arithmetic
//     everywhere a shell is shown;
//   - the hint is a paint decision only: it reads storage, never the
//     Supabase client, and grants nothing — ProtectedRoute still
//     waits for the VERIFIED session (isAuthReady).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasPersistedSession,
  isAuthPending,
  shellSkeletonVariant,
  type SessionStorageLike,
} from "../../src/lib/sessionHint";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const AUTH_KEY = "sb-hhxwwozpvgktuqutfkhc-auth-token";

const fakeStorage = (entries: Record<string, string>): SessionStorageLike => ({
  length: Object.keys(entries).length,
  key: (i) => Object.keys(entries)[i] ?? null,
  getItem: (k) => (k in entries ? entries[k] : null),
});

const sessionBlob = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    access_token: "access-token-value",
    refresh_token: "refresh-token-value",
    expires_at: 1799999999,
    user: { id: "user-id" },
    ...overrides,
  });

// ---------------------------------------------------------------------
// hasPersistedSession — the synchronous hint read
// ---------------------------------------------------------------------

describe("hasPersistedSession", () => {
  it("is true for a stored session blob with both tokens", () => {
    expect(hasPersistedSession(fakeStorage({ [AUTH_KEY]: sessionBlob() }))).toBe(true);
  });

  it("is true with only an access token, and with only a refresh token", () => {
    expect(
      hasPersistedSession(fakeStorage({ [AUTH_KEY]: sessionBlob({ refresh_token: undefined }) })),
    ).toBe(true);
    expect(
      hasPersistedSession(
        fakeStorage({ [AUTH_KEY]: JSON.stringify({ refresh_token: "refresh-only" }) }),
      ),
    ).toBe(true);
  });

  it("is true for the wrapped currentSession storage shape", () => {
    const wrapped = JSON.stringify({
      currentSession: { access_token: "a", refresh_token: "r" },
      expiresAt: 1799999999,
    });
    expect(hasPersistedSession(fakeStorage({ [AUTH_KEY]: wrapped }))).toBe(true);
  });

  it("is false when storage holds no auth-token key", () => {
    expect(
      hasPersistedSession(fakeStorage({ "theme": "dark", "bmg-language": "en" })),
    ).toBe(false);
    expect(hasPersistedSession(fakeStorage({}))).toBe(false);
  });

  it("ignores the PKCE code-verifier key — it is not a session", () => {
    expect(
      hasPersistedSession(
        fakeStorage({ [`${AUTH_KEY}-code-verifier`]: sessionBlob() }),
      ),
    ).toBe(false);
  });

  it("is false for a corrupt or token-less blob", () => {
    expect(hasPersistedSession(fakeStorage({ [AUTH_KEY]: "{not json" }))).toBe(false);
    expect(hasPersistedSession(fakeStorage({ [AUTH_KEY]: "{}" }))).toBe(false);
    expect(
      hasPersistedSession(
        fakeStorage({ [AUTH_KEY]: JSON.stringify({ access_token: "", refresh_token: "" }) }),
      ),
    ).toBe(false);
  });

  it("is false when storage is missing or throws — guests are never held", () => {
    expect(hasPersistedSession(null)).toBe(false);
    const throwing: SessionStorageLike = {
      length: 1,
      key: () => {
        throw new Error("denied");
      },
      getItem: () => null,
    };
    expect(hasPersistedSession(throwing)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// isAuthPending / shellSkeletonVariant — the gate arithmetic
// ---------------------------------------------------------------------

describe("isAuthPending", () => {
  const user = { id: "user-id" };

  it("holds only the unresolved window when a stored session exists", () => {
    expect(isAuthPending({ user: null, isAuthReady: false, hasStoredSession: true })).toBe(true);
  });

  it("never holds a guest (no stored session)", () => {
    expect(isAuthPending({ user: null, isAuthReady: false, hasStoredSession: false })).toBe(false);
  });

  it("never holds once auth has resolved, either way", () => {
    expect(isAuthPending({ user: null, isAuthReady: true, hasStoredSession: true })).toBe(false);
    expect(isAuthPending({ user, isAuthReady: true, hasStoredSession: true })).toBe(false);
  });

  it("never holds once the user has been applied, even mid-verification", () => {
    expect(isAuthPending({ user, isAuthReady: false, hasStoredSession: true })).toBe(false);
  });
});

describe("shellSkeletonVariant", () => {
  const user = { id: "user-id" };

  it("shows the authed twin for a known user and for a resolving session", () => {
    expect(shellSkeletonVariant({ user, isAuthReady: false, hasStoredSession: true })).toBe("authed");
    expect(shellSkeletonVariant({ user: null, isAuthReady: false, hasStoredSession: true })).toBe("authed");
  });

  it("shows the guest twin for resolved signed-out and for plain guests", () => {
    expect(shellSkeletonVariant({ user: null, isAuthReady: true, hasStoredSession: true })).toBe("guest");
    expect(shellSkeletonVariant({ user: null, isAuthReady: false, hasStoredSession: false })).toBe("guest");
    expect(shellSkeletonVariant({ user: null, isAuthReady: true, hasStoredSession: false })).toBe("guest");
  });
});

// ---------------------------------------------------------------------
// Source pins — the wiring that makes the arithmetic matter
// ---------------------------------------------------------------------

describe("bootstrap gate wiring (source pins)", () => {
  it("AuthContext exposes the hint, read synchronously in a state initialiser", () => {
    const src = read("../../src/contexts/AuthContext.tsx");
    expect(src).toContain("hasStoredSession: boolean;");
    expect(src).toContain("useState<boolean>(() => hasPersistedSession())");
    expect(src).toContain("hasStoredSession,");
  });

  it("the hint module reads storage only — never the Supabase client", () => {
    const src = read("../../src/lib/sessionHint.ts");
    expect(src).not.toContain("integrations/supabase/client");
    expect(src).not.toContain("createClient");
    expect(src).not.toContain(".auth.getSession");
  });

  it("Index gates the landing behind the pending check, before the hero paints", () => {
    const src = read("../../src/pages/Index.tsx");
    const gate = src.indexOf("isAuthPending({ user, isAuthReady, hasStoredSession })");
    expect(gate).toBeGreaterThan(-1);
    expect(src).toContain('<RouteShellSkeleton variant="authed" />');
    expect(gate).toBeLessThan(src.indexOf("<Hero"));
  });

  it("Login and Register hold their forms while a session resolves", () => {
    for (const rel of ["../../src/pages/Login.tsx", "../../src/pages/Register.tsx"]) {
      const src = read(rel);
      const gate = src.indexOf("isAuthPending({ user, isAuthReady, hasStoredSession })");
      expect(gate).toBeGreaterThan(-1);
      expect(src).toContain('<RouteShellSkeleton variant="authed" />');
      // The gate stands before the page's own form markup (its Header).
      expect(gate).toBeLessThan(src.indexOf("<Header />"));
    }
  });

  it("Header swaps to the signed-in skeleton twin while a session resolves", () => {
    const src = read("../../src/components/Header.tsx");
    const gate = src.indexOf("isAuthPending({ user, isAuthReady, hasStoredSession })");
    expect(gate).toBeGreaterThan(-1);
    expect(src).toContain('<SkeletonHeaderBar variant="authed" />');
    // …and the swap stands before the real header element renders.
    expect(gate).toBeLessThan(src.indexOf("bg-white dark:bg-[#0A0F1A]"));
  });

  it("the route fallback and ProtectedRoute share the variant arithmetic", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain("shellSkeletonVariant({ user, isAuthReady, hasStoredSession })");
    const guard = read("../../src/components/ProtectedRoute.tsx");
    expect(guard).toContain("shellSkeletonVariant({ user, isAuthReady, hasStoredSession })");
    expect(guard).not.toContain('variant={user ? "authed" : "guest"}');
  });

  it("ProtectedRoute still waits for the VERIFIED session — the hint grants nothing", () => {
    const guard = read("../../src/components/ProtectedRoute.tsx");
    expect(guard).toContain("if (!isAuthReady || rolesLoading || rolesNotReady)");
  });
});
