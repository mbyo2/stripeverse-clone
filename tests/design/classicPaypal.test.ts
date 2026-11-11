// Classic PayPal shell pins (CEO decision, 2026-11-11 17:12, made
// from his classic PayPal reference screens): the top bar is NAVY
// and primary buttons are GOLD PILLS. This supersedes the white bar
// + blue primaries of the same day's anatomy rollout for the bar and
// the primary buttons only — the rest of the anatomy stands
// (Manrope, hairline lists, sky heroes, pale secondaries), and the
// action blue #0066F5 keeps links, active/selected states, focus
// rings and the outline/link button variants.
//
// The values, matched to the Doc'O Clock conversion of the same
// decision:
//   - Bar: classic navy #003087 (HSL 219 100% 26%), white text and
//     icons in BOTH modes — dark mode deepens it slightly (219 100%
//     22%) but it stays navy. The logo renders in its white variant.
//     Nav links are white; the active item is a lighter-navy pill
//     (white tint over the navy) with semibold white text — gold is
//     never a nav state.
//   - Primary buttons: PayPal gold #FFC439 (HSL 42 100% 61%),
//     near-black text #001435 (HSL 217 100% 10%), hover the deeper
//     gold #F2B705 (HSL 45 96% 48%). The conversion rides the shared
//     Button `default` variant (plus the .button-primary utility), so
//     every primary CTA follows; the hero primaries that were
//     hard-coded black pills (dashboard Open wallet, Deposit BTC,
//     WalletBalance Send) and the landing hero CTA are gold too.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const css = read("src/index.css");
const lightTokens = css.slice(css.indexOf(":root"), css.indexOf(".dark"));
const darkTokens = css.slice(css.indexOf(".dark"));
const config = read("tailwind.config.ts");

describe("classic navy bar tokens", () => {
  it("index.css carries navy #003087 for the bar, deepened in dark mode", () => {
    expect(lightTokens).toContain("--navy: 219 100% 26%");
    expect(lightTokens).toContain("#003087");
    expect(darkTokens).toContain("--navy: 219 100% 22%");
  });

  it("tailwind exposes the navy token as a colour", () => {
    expect(config).toContain('navy: {');
    expect(config).toContain('DEFAULT: "hsl(var(--navy))"');
  });
});

describe("classic gold primary tokens", () => {
  it("index.css carries gold #FFC439, near-black #001435 text, #F2B705 hover — both modes", () => {
    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens).toContain("--gold: 42 100% 61%");
      expect(tokens).toContain("--gold-hover: 45 96% 48%");
      expect(tokens).toContain("--gold-foreground: 217 100% 10%");
    }
    expect(lightTokens).toContain("#FFC439");
    expect(lightTokens).toContain("#001435");
    expect(lightTokens).toContain("#F2B705");
  });

  it("tailwind exposes gold as DEFAULT / hover / foreground", () => {
    expect(config).toContain('DEFAULT: "hsl(var(--gold))"');
    expect(config).toContain('hover: "hsl(var(--gold-hover))"');
    expect(config).toContain('foreground: "hsl(var(--gold-foreground))"');
  });

  it("the action blue stays the link/active colour — --primary is untouched", () => {
    expect(lightTokens).toContain("--primary: 215 100% 48%");
    expect(darkTokens).toContain("--primary: 215 100% 66%");
  });
});

describe("the shared primary button is the gold pill", () => {
  const button = read("src/components/ui/button.tsx");

  it("the default variant is gold with near-black text and deeper-gold hover", () => {
    expect(button).toContain(
      'default: "bg-gold text-gold-foreground shadow-none hover:bg-gold-hover"',
    );
    expect(button).not.toContain(
      'default: "bg-primary text-primary-foreground',
    );
  });

  it("the .button-primary utility follows the variant", () => {
    expect(css).toContain("bg-gold text-gold-foreground");
    expect(css).toContain("hover:bg-gold-hover");
  });
});

describe("the header is the navy bar", () => {
  const header = read("src/components/Header.tsx");

  it("bar fill is navy with white content in both modes; logo renders white", () => {
    expect(header).toContain(
      'className="fixed top-0 left-0 right-0 z-50 bg-navy text-white border-b border-white/10"',
    );
    expect(header).toContain('<Logo variant="white" />');
    expect(header).not.toContain("bg-background border-b border-border");
  });

  it("nav links are white; the active item is the lighter-navy pill, never gold", () => {
    expect(header).toContain(
      '"text-sm font-semibold h-9 px-3 text-white bg-white/15 hover:bg-white/15 hover:text-white"',
    );
    expect(header).toContain(
      '"text-sm font-medium h-9 px-3 text-white hover:bg-white/10 hover:text-white"',
    );
  });

  it("guest Sign Up is the gold pill; the skeleton twin mirrors the navy bar", () => {
    expect(header).toContain(
      'className="h-12 rounded-full bg-gold px-7 text-[15px] font-semibold text-gold-foreground shadow-none hover:bg-gold-hover"',
    );
    const skeletons = read("src/components/ui/skeletons.tsx");
    expect(skeletons).toContain("bg-navy border-b border-white/10");
  });
});

describe("no chrome hides content (CEO addition, 2026-11-11 17:21)", () => {
  const header = read("src/components/Header.tsx");

  it("the fixed bar reserves its space in BOTH header branches", () => {
    // Real header and the auth-pending skeleton twin are both fixed;
    // each must be followed by the in-flow 72px spacer, or page
    // content starts underneath the bar.
    const spacers = header.split('className="h-[72px] shrink-0"').length - 1;
    expect(spacers).toBeGreaterThanOrEqual(2);
  });

  it("fragment targets land below the bar: 88px scroll margin, app-wide", () => {
    expect(css).toContain("scroll-margin-top: 88px");
    const index = read("src/pages/Index.tsx");
    expect(index).toContain("scroll-mt-[88px]");
    expect(index).not.toContain("scroll-mt-[72px]");
  });

  it("page bottoms clear the 64px mobile bottom nav", () => {
    expect(read("src/components/MobileBottomNav.tsx")).toContain("h-16");
    // The pages whose mains carried less than the nav's height:
    expect(read("src/pages/BitcoinWallet.tsx")).toContain(
      "pt-8 pb-20 md:py-10",
    );
    expect(read("src/pages/Business.tsx")).toContain(
      "flex-1 pt-14 pb-20",
    );
    expect(read("src/pages/AdminPaypal.tsx")).toContain("pt-8 pb-20");
    expect(read("src/pages/Disputes.tsx")).toContain("pt-8 pb-20");
    expect(read("src/pages/CryptoWallet.tsx")).toContain("pb-20");
    expect(read("src/pages/TwoFactorAuth.tsx")).toContain("pb-20");
  });

  it("the one FAB pattern clears the bottom nav on mobile", () => {
    expect(read("src/components/BetaBanner.tsx")).toContain(
      "fixed bottom-20 right-4 z-50 md:bottom-4",
    );
  });
});

describe("hero and landing primaries are gold", () => {
  it("dashboard Open wallet, Deposit BTC and WalletBalance Send ride gold", () => {
    expect(read("src/pages/Dashboard.tsx")).toContain(
      'className="bg-gold text-gold-foreground hover:bg-gold-hover"',
    );
    expect(read("src/pages/BitcoinWallet.tsx")).toContain(
      'className="bg-gold text-gold-foreground hover:bg-gold-hover">Deposit BTC</Button>',
    );
    expect(read("src/components/wallet/WalletBalance.tsx")).toContain(
      "bg-gold text-gold-foreground hover:bg-gold-hover",
    );
  });

  it("the landing hero CTA is the gold pill in both modes", () => {
    expect(read("src/components/Hero.tsx")).toContain(
      "bg-gold px-[30px] text-[15px] font-semibold text-gold-foreground hover:bg-gold-hover",
    );
  });
});
