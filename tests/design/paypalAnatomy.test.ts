// PayPal anatomy rollout pins (CEO order, 2026-11-11): "Roll the
// PayPal anatomy across the whole app — even on desktop", following
// the Doc'O Clock rollout (origin/main 639690ea → 9e142977 there).
// Same design, font, layout and theme as PayPal on every surface;
// workflows untouched — presentation only.
//
// The system these tests pin:
//   - Font: Manrope app-wide, loaded the Doc'O Clock way (Google
//     Fonts @import in src/index.css). Ramp: headings 800 / -0.02em,
//     greeting 28px/800 (text-greeting), hero number 40px/800
//     (text-heronum), body 15-16px, sublines 13px muted.
//   - Anatomy per surface: greeting header (bold title + one 13px
//     grey subline) → at most ONE hero card (24px radius, 20px
//     padding, the surface's headline number) → quick actions as
//     56px pale circles with 12px labels (≤4 per row) → content as
//     hairline lists (~64px rows) instead of stacked cards →
//     full-pill CTAs. No shadows, no gradients, no colour bands.
//   - Heroes are the sky card #60CDFF in light mode and a dark
//     hairline card in dark mode — never a white slab, never a band.
//   - BMaGlass rules: the dashboard leads with the Bitcoin wallet —
//     its hero is the BTC balance with the ₿ medallion as brand
//     mark; Deposit / Sell / Withdraw (and Send / Receive on the
//     wallet surfaces) are ALWAYS visible, never gated.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const css = read("src/index.css");
const config = read("tailwind.config.ts");

describe("typography: Manrope everywhere, PayPal ramp", () => {
  it("Manrope loads via the Google Fonts @import in index.css (the Doc'O Clock route)", () => {
    expect(css).toContain(
      "@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap')",
    );
    // …and index.html carries no font stylesheet link anymore.
    expect(read("index.html")).not.toContain("family=Inter");
    expect(read("index.html")).not.toContain("family=Poppins");
  });

  it("body and both font aliases resolve to Manrope", () => {
    expect(css).toContain("font-family: 'Manrope', system-ui, -apple-system, sans-serif");
    expect(config).toContain('sans: ["Manrope", "system-ui", "-apple-system", "sans-serif"]');
    expect(config).toContain('display: ["Manrope", "system-ui", "-apple-system", "sans-serif"]');
    expect(config).not.toContain("Poppins");
    expect(config).not.toContain('"Inter"');
  });

  it("headings take the ramp: 800 weight, -0.02em tracking", () => {
    expect(css).toContain("h1, h2, h3");
    expect(css).toContain("font-weight: 800");
    expect(css).toContain("letter-spacing: -0.02em");
  });

  it("the fixed ramp tokens exist: greeting 28px/800, heronum 40px/800", () => {
    expect(config).toContain('greeting: ["1.75rem"');
    expect(config).toContain('heronum: ["2.5rem"');
  });

  it("cards take the PayPal radius: 16px hairline, no shadow", () => {
    expect(read("src/components/ui/card.tsx")).toContain(
      '"rounded-2xl border bg-card text-card-foreground shadow-none"',
    );
  });
});

describe("dashboard: greeting, bitcoin hero, pale-circle actions, hairline lists", () => {
  const dash = read("src/pages/Dashboard.tsx");

  it("greeting header: bold greeting token + one 13px subline", () => {
    expect(dash).toContain('className="text-greeting text-foreground"');
    expect(dash).toContain("Welcome back, {firstName}");
    expect(dash).toContain('className="text-[13px] text-muted-foreground mt-1"');
  });

  it("the hero is the bitcoin balance — sky card, ₿ medallion, hero number", () => {
    expect(dash).toContain("bg-[#60CDFF] dark:bg-card");
    expect(dash).toContain("rounded-[24px] p-5");
    expect(dash).toContain("text-heronum tabular-nums");
    expect(dash).toContain("balance_sats");
    // the ₿ medallion is the hero's brand mark (white tile, orange ₿)
    expect(dash).toContain("rounded-2xl bg-white");
    expect(dash).toContain('className="h-6 w-6 text-bitcoin"');
    // no navy band survives on the dashboard
    expect(dash).not.toContain("bg-[#002991]");
  });

  it("hero CTAs: black pill primary on sky (blue returns in dark), pale pill secondary", () => {
    expect(dash).toContain("bg-slate-950 text-white hover:bg-slate-950/90");
    expect(dash).toContain("bg-white/70 text-slate-950 hover:bg-white");
    expect(dash).toMatch(/<Link to="\/bitcoin-wallet">Open wallet<\/Link>/);
    expect(dash).toMatch(/<Link to="\/bitcoin-wallet\/self-custody">Self-custody<\/Link>/);
  });

  it("Deposit / Sell / Withdraw are 56px pale circles — always rendered, never gated", () => {
    expect(dash).toContain('["Deposit", "Sell", "Withdraw"]');
    expect(dash).toContain("w-14 h-14 rounded-full bg-secondary");
    expect(dash).not.toContain('canSeeFeature("custodialSend")');
    expect(dash).not.toContain('canSeeFeature("custodialDeposit")');
  });

  it("everyday balance is a hairline card; its quick actions are pale circles too", () => {
    expect(dash).toContain("Available balance");
    expect(dash).toContain("navigate('/request-money')");
    expect(dash).toContain("navigate('/transfer')");
  });

  it("stats are one hairline list (~64px rows), not stacked cards", () => {
    expect(dash).toContain("divide-y divide-border");
    expect(dash).toContain("min-h-16");
    expect(dash).toContain("Monthly Activity");
    expect(dash).toContain("Total Transactions");
    expect(dash).toContain("Rewards Points");
  });

  it("the skeleton twin mirrors the new anatomy (greeting, sky hero, circles)", () => {
    const skel = read("src/components/ui/skeletons.tsx");
    expect(skel).toContain(
      'className="bg-[#60CDFF] dark:bg-card dark:border dark:border-border rounded-[24px] p-5 mb-6"',
    );
    expect(skel).not.toContain("bg-[#002991] rounded-lg");
  });
});

describe("wave 2: bitcoin wallets and history", () => {
  const bw = read("src/pages/BitcoinWallet.tsx");

  it("custodial wallet: greeting title, sky balance hero, hero number", () => {
    expect(bw).toContain('className="text-greeting mb-6"');
    expect(bw).toContain("bg-[#60CDFF] dark:bg-card");
    expect(bw).toContain('<p className="text-heronum tabular-nums">{btcBalance}</p>');
  });

  it("Deposit and Send stay always visible — black pill + pale pill on the hero", () => {
    expect(bw).toContain("Deposit BTC");
    expect(bw).toContain("Send BTC");
    expect(bw).toContain("bg-slate-950 text-white hover:bg-slate-950/90");
    expect(bw).toContain("<DialogTitle>Send Bitcoin</DialogTitle>");
    expect(bw).toContain("<DialogTitle>Deposit Bitcoin</DialogTitle>");
    expect(bw).not.toContain("custodialSend");
    expect(bw).not.toContain("custodialDeposit");
  });

  it("recent BTC activity stays a hairline list via the shared resolver", () => {
    expect(bw).toContain('<ul className="divide-y divide-border">');
    expect(bw).toContain("formatBtcRowAmount");
  });

  it("self-custody: greeting title and the ramp hero number (card stays hairline — caution-led surface)", () => {
    const sc = read("src/pages/SelfCustodyWallet.tsx");
    expect(sc).toContain('className="text-greeting"');
    expect(sc).toContain("text-heronum tabular-nums");
    expect(sc).not.toContain("bg-[#60CDFF]");
  });

  it("history pages take the greeting title; lists stay hairline", () => {
    expect(read("src/pages/Transactions.tsx")).toContain("text-greeting");
    expect(read("src/pages/TransactionList.tsx")).toContain("text-greeting");
    expect(read("src/components/wallet/TransactionHistory.tsx")).toContain(
      "divide-y divide-border",
    );
  });

  it("wallet page quick actions are 56px pale circles with 12px labels", () => {
    const qa = read("src/components/wallet/QuickActions.tsx");
    expect(qa).toContain("w-14 h-14 rounded-full bg-secondary");
    expect(qa).toContain("text-xs font-medium text-foreground");
    expect(read("src/pages/Wallet.tsx")).toContain("text-greeting");
  });
});

describe("wave 3: send / request, P2P, payment links", () => {
  it("money-movement pages take the greeting title", () => {
    expect(read("src/pages/SendMoney.tsx")).toContain("text-greeting");
    expect(read("src/pages/Transfer.tsx")).toContain("text-greeting");
    expect(read("src/pages/RequestMoney.tsx")).toContain("text-greeting");
    expect(read("src/pages/PaymentLinks.tsx")).toContain("text-greeting");
  });

  it("P2P shell: greeting title, 13px subline, segmented pale-pill tabs", () => {
    const shell = read("src/components/p2p/P2pShell.tsx");
    expect(shell).toContain('className="text-greeting text-foreground"');
    expect(shell).toContain('className="text-[13px] text-muted-foreground mt-1"');
    expect(shell).toContain("rounded-full whitespace-nowrap");
    expect(shell).toContain("bg-secondary text-foreground font-semibold");
    expect(shell).not.toContain("border-b-2 border-primary");
  });

  it("marketplace: buy/sell is a segmented pill control; offers are hairline rows", () => {
    const mkt = read("src/pages/P2PMarketplace.tsx");
    expect(mkt).toContain("flex bg-secondary rounded-full p-1 gap-1");
    expect(mkt).toContain(
      "rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden",
    );
    const ad = read("src/components/p2p/AdCard.tsx");
    expect(ad).toContain('<div className="px-4 py-4 sm:px-5">');
    expect(ad).not.toContain('from "@/components/ui/card"');
  });

  it("payment links list stays a hairline list", () => {
    expect(read("src/pages/PaymentLinks.tsx")).toContain("divide-y divide-border");
  });
});

describe("wallet balance hero follows the same anatomy", () => {
  const wb = read("src/components/wallet/WalletBalance.tsx");

  it("sky hero card with the hero-number token; dark mode is a dark card", () => {
    expect(wb).toContain('className="bg-[#60CDFF] dark:bg-card p-5 text-slate-950 dark:text-card-foreground"');
    expect(wb).toContain("text-heronum tabular-nums");
    expect(wb).not.toContain("bg-[#002991]");
  });

  it("Send is the black pill on sky; Receive the pale pill — both always visible", () => {
    expect(wb).toContain("bg-slate-950 text-white hover:bg-slate-950/90");
    expect(wb).toContain("bg-white/70 text-slate-950 hover:bg-white");
    expect(wb).toContain("Send Money");
    expect(wb).toContain("Receive");
  });
});
