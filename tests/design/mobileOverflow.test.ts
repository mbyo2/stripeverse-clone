// Mobile-overflow pins (CEO report, 2026-11-11): "Words and numbers
// are the ones overflowing and going to where they are not supposed
// to" — pages must FIT at 360/390/414/430px fluid widths while
// tablets/desktops keep their wide layouts.
//
// Evidence base: a local rendered probe (vite preview build in
// headless Chromium at 390px/360px viewports, QA account) measured
// document scrollWidth vs innerWidth across 60+ routes, plus a
// source audit for the classes a fresh/empty account cannot reach.
// Confirmed spills fixed under these pins:
//   - /multi-currency header row pushed "Add Wallet" 45px (390px)
//     / 75px (360px) past the viewport edge.
//   - /developers: the Endpoints card's unbreakable Base URL grew
//     the page to 494px at a 390px viewport.
//   - /sdk-docs: the 5-tab strip measured 481px inside a 358px card.
// These pins keep the root-cause fixes (not just the safety net)
// from regressing.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const css = read("src/index.css");
const config = read("tailwind.config.ts");

describe("safety net: the page can never be stretched sideways", () => {
  it("html/body carry overflow-x: clip (clip, not hidden — sticky survives)", () => {
    expect(css).toContain("html, body {");
    expect(css).toContain("overflow-x: clip;");
    expect(css).not.toContain("overflow-x: hidden");
  });

  it("unbreakable <code> tokens inside prose wrap instead of spilling", () => {
    expect(css).toContain(":where(p, li, td) code {");
    expect(css).toContain("overflow-wrap: anywhere;");
  });
});

describe("numbers: hero figures scale down at phone widths", () => {
  it("text-heronum is clamp-scaled with the desktop 2.5rem as its cap", () => {
    expect(config).toContain('heronum: ["clamp(1.75rem, 8vw, 2.5rem)"');
  });

  it("the hero-number surfaces keep tabular-nums (digits never jitter)", () => {
    expect(read("src/pages/Dashboard.tsx")).toContain("text-heronum tabular-nums");
    expect(read("src/pages/BitcoinWallet.tsx")).toContain("text-heronum tabular-nums");
    expect(read("src/components/wallet/WalletBalance.tsx")).toContain("text-heronum tabular-nums");
  });

  it("the fiat hero row can wrap its eye toggle instead of pushing it out", () => {
    const wb = read("src/components/wallet/WalletBalance.tsx");
    expect(wb).toContain("flex flex-wrap items-center gap-3");
    expect(wb).toContain('className="min-w-0"');
  });
});

describe("tab strips wrap at phone width instead of spilling", () => {
  it("the shared TabsList primitive wraps, caps its width and keeps its 40px floor", () => {
    const tabs = read("src/components/ui/tabs.tsx");
    expect(tabs).toContain("min-h-10 max-w-full flex-wrap");
    expect(tabs).not.toContain('"inline-flex h-10 items-center');
  });
});

describe("measured spills: root-cause fixes stay in place", () => {
  it("/multi-currency header wraps its action buttons under the title", () => {
    const mc = read("src/pages/MultiCurrencyWallet.tsx");
    expect(mc).toContain("flex flex-wrap items-center justify-between gap-3 mb-8");
    expect(mc).toContain('className="flex flex-wrap gap-2"');
  });

  it("/developers Base URL and endpoint paths can break", () => {
    const dev = read("src/pages/Developers.tsx");
    expect(dev).toContain('<CardDescription className="break-all">Base URL: {BASE}</CardDescription>');
    expect(dev).toContain("font-mono text-sm shrink-0 break-all");
  });

  it("/notifications header wraps its action buttons instead of clipping them", () => {
    const n = read("src/pages/Notifications.tsx");
    expect(n).toContain("flex flex-wrap items-center justify-between gap-3 mb-6");
    expect(n).toContain('className="flex flex-wrap gap-2"');
  });

  it("transaction rows: text column shrinks (min-w-0), amount column never does", () => {
    const th = read("src/components/wallet/TransactionHistory.tsx");
    expect(th).toContain("flex items-center space-x-4 flex-1 min-w-0");
    expect(th).toContain("flex items-center space-x-2 shrink-0");
  });
});

describe("tables stay inside scroll wrappers", () => {
  it("the shared Table primitive wraps itself in overflow-auto", () => {
    expect(read("src/components/ui/table.tsx")).toContain(
      '<div className="relative w-full overflow-auto">'
    );
  });

  it("the two raw <table> surfaces keep their overflow-x-auto wrappers", () => {
    expect(read("src/pages/BitcoinPos.tsx")).toContain('<div className="overflow-x-auto">');
    expect(read("src/components/tiers/TierFeatureMatrix.tsx")).toContain(
      "hidden overflow-x-auto md:block"
    );
  });
});

describe("long hashes and addresses keep their break-all", () => {
  it("wallet address/txid blocks break anywhere", () => {
    const bw = read("src/pages/BitcoinWallet.tsx");
    expect(bw).toContain("font-mono text-xs break-all");
    const sc = read("src/pages/SelfCustodyWallet.tsx");
    expect(sc).toContain("font-mono text-xs break-all rounded bg-muted p-2");
  });
});
