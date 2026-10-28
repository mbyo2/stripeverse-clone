// SweepB (pre-launch, 2026-10-28) honesty pins:
//  - Billing mirrors Pricing, including the PayPal rail rate (1%,
//    CEO decision 2026-10-28) that Billing previously omitted.
//  - Help/Support must not present virtual cards as live,
//    online-purchase cards: they are "Coming soon" + admin-only, and
//    internal (not issuer-backed) when they exist at all.
//  - Support must not resurrect subscription tiers (removed
//    2026-10-26) or claim mobile money / card / USSD rails are live.
//  - Help/Support KYC copy must state the live-camera face rule
//    (CEO 2026-10-24): documents upload, faces are camera-only.
//  - P2PNewAd's sell-blocked banner must describe the LIVE gate
//    (T2+, migration 20261211) — not the removed 14-day / 5-trade
//    conjuncts.
//  - The virtual-card edge functions' admin gate must accept
//    super_admin additively (as manage-virtual-card and the card
//    pages do); a super_admin-only holder was refused with the
//    public "coming soon" message while the UI let them in.
//  - VirtualCardManager (Wallet-embedded) must apply the same
//    Coming Soon gate as the dedicated card pages.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("sweepb pricing truth", () => {
  it("Billing lists the PayPal 1% collection fee like Pricing does", () => {
    // Billing's PayPal row was landed by the parallel sweep-A mission
    // (0b9150c) while this sweep was in flight; the pin holds whoever
    // owns the line: a PayPal row at exactly 1% must exist.
    const billing = read("../../src/pages/Billing.tsx");
    expect(billing).toContain("PayPal payments (when received)");
    expect(billing).toContain('"1%"');
    const pricing = read("../../src/pages/Pricing.tsx");
    expect(pricing).toContain("Accept PayPal Payments");
  });
  it("the FAQ fee answer includes the PayPal rate", () => {
    expect(read("../../src/pages/Faq.tsx")).toContain("Receiving a payment through PayPal costs 1%");
  });
});

describe("sweepb virtual-card honesty", () => {
  it("Help never presents cards as live online-purchase cards", () => {
    const help = read("../../src/pages/Help.tsx");
    expect(help).not.toContain("ready instantly for online purchases");
    expect(help).not.toContain("Create and manage virtual cards for online payments");
    expect(help).toContain("Virtual cards are coming soon");
  });
  it("Support never presents cards or dead rails as live", () => {
    const support = read("../../src/pages/Support.tsx");
    expect(support).toContain("Virtual cards are coming soon");
    expect(support).not.toContain("We support Mobile Money (MTN, Airtel, Zamtel), Card payments");
    expect(support).not.toContain("Limits depend on your subscription tier");
    expect(support).not.toContain("Upgrade your tier");
  });
  it("the Wallet-embedded card manager is Coming-Soon gated", () => {
    const mgr = read("../../src/components/wallet/VirtualCardManager.tsx");
    expect(mgr).toContain("VirtualCardsComingSoon");
    expect(mgr).toContain('hasRole("super_admin")');
  });
  it("create/fund card functions accept super_admin additively", () => {
    for (const fn of ["create-virtual-card", "fund-virtual-card"]) {
      const src = read(`../../supabase/functions/${fn}/index.ts`);
      expect(src).toContain('.in("role", ["admin", "super_admin"])');
    }
  });
});

describe("sweepb KYC + P2P copy", () => {
  it("Help and Support state the live-camera face rule", () => {
    for (const page of ["../../src/pages/Help.tsx", "../../src/pages/Support.tsx"]) {
      expect(read(page)).toContain("captured live with your camera");
    }
  });
  it("P2PNewAd banner matches the live T2 gate (20261211)", () => {
    const newAd = read("../../src/pages/P2PNewAd.tsx");
    expect(newAd).not.toContain("at least 14 days old");
    expect(newAd).not.toContain("5\n                completed trades as a buyer");
    expect(newAd).toContain("post sell ads straight away");
  });
  it("the plain-language P2P refusal migration exists", () => {
    const mig = read("../../supabase/migrations/20261243_p2p_refusal_reasons_plain.sql");
    expect(mig).toContain("p2p_reasons_plain");
    expect(mig).toContain("finish KYC in Settings");
  });
});
