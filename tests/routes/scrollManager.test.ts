// Class pin: route changes land at the TOP of the new page (or on
// their hash anchor), never at the previous page's scroll offset.
//
// Why this exists (CEO report, 2026-10-28): the app had no scroll
// management at all. BrowserRouter PUSH navigations keep the window's
// scroll offset, so clicking a link presented the new page at the old
// position — clamped to the bottom (the footer) whenever the new page
// was shorter. Measured live in headless Chrome at 390px: landing
// scrolled 1500 -> Pricing opened at scrollY 1500; a footer link
// clicked from the bottom of the landing page opened /pricing at
// scrollY == maxScroll (the footer itself).
//
// The fix is central: components/ScrollManager (rendered once by
// AnimatedRoutes) decides via lib/scrollManager.resolveScrollAction.
// These tests pin (a) the decision table and (b) that the central
// wiring stays in place — a per-page patch or a deleted ScrollManager
// must fail the suite, not silently regress the CEO's bug.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScrollAction } from "../../src/lib/scrollManager";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("resolveScrollAction — navigation scroll decisions", () => {
  it("first load without a hash lands at the top", () => {
    expect(resolveScrollAction(null, { pathname: "/", hash: "" })).toEqual({ type: "top" });
  });

  it("first load with a hash goes to the anchor, not the top", () => {
    expect(resolveScrollAction(null, { pathname: "/", hash: "#bitcoin" })).toEqual({
      type: "anchor",
      id: "bitcoin",
    });
  });

  it("pathname change lands at the top (the footer bug)", () => {
    expect(
      resolveScrollAction({ pathname: "/", hash: "" }, { pathname: "/pricing", hash: "" }),
    ).toEqual({ type: "top" });
    expect(
      resolveScrollAction(
        { pathname: "/dashboard", hash: "" },
        { pathname: "/wallet", hash: "" },
      ),
    ).toEqual({ type: "top" });
    expect(
      resolveScrollAction(
        { pathname: "/wallet", hash: "" },
        { pathname: "/bitcoin-wallet", hash: "" },
      ),
    ).toEqual({ type: "top" });
  });

  it("pathname change WITH a hash goes to the anchor", () => {
    expect(
      resolveScrollAction(
        { pathname: "/", hash: "" },
        { pathname: "/faq", hash: "#fees" },
      ),
    ).toEqual({ type: "anchor", id: "fees" });
  });

  it("hash-only change on the same page scrolls to the anchor — never to the top", () => {
    const action = resolveScrollAction(
      { pathname: "/", hash: "" },
      { pathname: "/", hash: "#bitcoin" },
    );
    expect(action).toEqual({ type: "anchor", id: "bitcoin" });
    expect(action.type).not.toBe("top");
  });

  it("same pathname and same hash is a no-op (query/tab changes do not yank scroll)", () => {
    expect(
      resolveScrollAction(
        { pathname: "/wallet", hash: "" },
        { pathname: "/wallet", hash: "" },
      ),
    ).toEqual({ type: "none" });
  });

  it("anchor ids are URI-decoded", () => {
    expect(resolveScrollAction(null, { pathname: "/faq", hash: "#a%20b" })).toEqual({
      type: "anchor",
      id: "a b",
    });
  });
});

describe("ScrollManager wiring — the fix stays central", () => {
  it("AnimatedRoutes renders ScrollManager exactly once", () => {
    const src = read("src/components/AnimatedRoutes.tsx");
    expect(src).toContain("import ScrollManager from '@/components/ScrollManager'");
    expect(src.match(/<ScrollManager \/>/g)).toHaveLength(1);
  });

  it("ScrollManager takes over scroll restoration and scrolls via the decision table", () => {
    const src = read("src/components/ScrollManager.tsx");
    expect(src).toContain("history.scrollRestoration = 'manual'");
    expect(src).toContain("window.scrollTo(0, 0)");
    expect(src).toContain("resolveScrollAction");
    expect(src).toContain("scrollIntoView");
  });
});
