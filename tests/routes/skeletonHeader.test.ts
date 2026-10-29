// Header-in-skeleton pins (CEO complaint, 2026-10-29): "the skeleton
// loader is missing what is in the header which is making it look
// very bad."
//
// The route Suspense fallback (AnimatedRoutes) and the auth bootstrap
// (ProtectedRoute) cannot render the real Header — every page renders
// it from its own lazy chunk — so they render SkeletonHeaderBar from
// the tiny ui/skeletons kit. The old twin was one logo slab, three
// text bars, a pill and a circle: none of the real header's contents
// (wordmark, the six-item signed-in nav with the Bitcoin Wallet pill,
// the search/bell/theme/account cluster, the h-12 Log In / Sign Up
// pills, the mobile bell + hamburger) were in it.
//
// These tests pin the twin to the real Header's geometry, per
// variant, and pin the wiring that picks the variant from the auth
// session — a twin that drifts from Header.tsx must fail the suite.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const skeletons = read("src/components/ui/skeletons.tsx");
const header = read("src/components/Header.tsx");
const protectedRoute = read("src/components/ProtectedRoute.tsx");
const animatedRoutes = read("src/components/AnimatedRoutes.tsx");

describe("SkeletonHeaderBar — shell geometry matches the real Header", () => {
  it("keeps the real bar: 72px height, 1320px container, same fill/border", () => {
    for (const src of [skeletons, header]) {
      expect(src).toContain("h-[72px]");
      expect(src).toContain("max-w-[1320px]");
      expect(src).toContain("dark:bg-[#0A0F1A]");
    }
  });

  it("logo is mark + wordmark, not a single slab", () => {
    expect(skeletons).toContain("h-8 w-8");
    expect(skeletons).toContain("w-[118px]");
    // The old single-slab logo must not survive inside the header twin
    // itself (h-9 w-36 legitimately appears in unrelated twins below).
    const twinStart = skeletons.indexOf("export const SkeletonHeaderBar");
    const twinEnd = skeletons.indexOf("SkeletonStatCard", twinStart);
    const twin = skeletons.slice(twinStart, twinEnd);
    expect(twin).not.toContain("h-9 w-36");
    expect(twin).not.toContain("h-10 w-24 rounded-full hidden sm:block");
  });
});

describe("SkeletonHeaderBar — signed-in variant mirrors the authed Header", () => {
  it("nav carries all six items at h-9, Bitcoin pill second and pill-shaped", () => {
    // Dashboard / Bitcoin Wallet / P2P / Send & Request / Wallet / Business
    for (const w of ["w-[102px]", "w-[146px]", "w-[104px]", "w-[134px]", "w-[82px]", "w-[94px]"]) {
      expect(skeletons).toContain(w);
    }
    const navStart = skeletons.indexOf('variant === "guest"');
    const bitcoinPill = skeletons.indexOf("w-[146px] rounded-full");
    const dashboard = skeletons.indexOf("w-[102px]");
    expect(dashboard).toBeGreaterThan(navStart);
    expect(bitcoinPill).toBeGreaterThan(dashboard);
  });

  it("right cluster: search, bell, theme, account-menu pill at h-9", () => {
    expect(skeletons).toContain("w-[54px] rounded-full"); // account menu
    expect(skeletons).toContain("w-32 rounded-md hidden 2xl:block"); // ⌘K field at 2xl
  });

  it("mobile cluster: bell + hamburger below xl", () => {
    expect(skeletons).toContain("xl:hidden flex items-center gap-2");
  });
});

describe("SkeletonHeaderBar — signed-out variant mirrors the guest Header", () => {
  it("nav is Personal / Business / Developers text bars at gap-8", () => {
    for (const w of ["w-[62px]", "w-[68px]", "w-[86px]"]) {
      expect(skeletons).toContain(w);
    }
  });

  it("right cluster carries the h-12 Log In / Sign Up pills", () => {
    expect(skeletons).toContain("h-12 w-[106px] rounded-full");
    expect(skeletons).toContain("h-12 w-[112px] rounded-full");
    // The real guest buttons are h-12 — the old twin's h-10 pill was wrong.
    expect(header).toContain("h-12 rounded-full");
  });
});

describe("variant wiring — the twin follows the auth session", () => {
  // Amended 2026-10-29 (wrong-page flash fix): the variant no longer
  // reads the raw user alone — while a stored session is still
  // resolving, `user` is null and the old ternary picked "guest",
  // flipping to "authed" a few frames later. Both call sites now use
  // the shared gate arithmetic (lib/sessionHint.shellSkeletonVariant),
  // which already counts a resolving session as authed. The unit
  // truth table lives in tests/accounts/authBootstrapGate.test.ts.
  it("ProtectedRoute passes its auth gate state to the header twin", () => {
    expect(protectedRoute).toContain(
      '<SkeletonHeaderBar variant={shellSkeletonVariant({ user, isAuthReady, hasStoredSession })} />'
    );
  });

  it("the route fallback passes its auth gate state to the shell twin", () => {
    expect(animatedRoutes).toContain(
      "variant={shellSkeletonVariant({ user, isAuthReady, hasStoredSession })}"
    );
    expect(animatedRoutes).toContain("useAuth");
  });

  it("RouteShellSkeleton forwards the variant to SkeletonHeaderBar", () => {
    expect(skeletons).toContain("<SkeletonHeaderBar variant={variant} />");
    expect(skeletons).toContain("SkeletonHeaderVariant");
  });
});
