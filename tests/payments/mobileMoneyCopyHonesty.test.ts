// Pins for the mobile-money copy alignment (provider-connections
// audit 2026-10-26, copy follow-up): BMaGlass marketing/help copy
// spoke of mobile money in the PRESENT tense ("We support MTN
// Mobile Money…", a footer payment-method list, instant-deposit
// claims) while every transaction surface correctly says "not
// available yet" — the rail is not connected. Mobile money arrives
// through DIRECT connections to MTN MoMo, Airtel Money and Zamtel
// after telco merchant onboarding; Bitcoin is live today. The
// legacy MobileMoneyPayment component carried "simulated" wording
// on a dead surface and rendered a working-looking payment form —
// it must never look like a working payment option again.
//
// Source pins, the house style for presentation contracts (see
// checkoutBitcoinOnly.test.ts).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const footer = read("../../src/components/Footer.tsx");
const faq = read("../../src/pages/Faq.tsx");
const help = read("../../src/pages/Help.tsx");
const mobileMoneyPayment = read("../../src/components/payments/MobileMoneyPayment.tsx");

describe("mobile-money copy honesty (source pins)", () => {
  it("Footer: Bitcoin is the live rail; mobile money is labelled coming soon", () => {
    expect(footer).toContain("Mobile Money — coming soon");
    expect(footer).toContain("'Bitcoin'");
    expect(footer).not.toContain("'MTN Money'");
    expect(footer).not.toContain("'Airtel Money'");
  });

  it("FAQ: mobile money is coming via direct telco connections, never offered as live", () => {
    expect(faq).toContain(
      "mobile money is coming soon through direct connections to MTN, Airtel and Zamtel",
    );
    expect(faq).toContain("Mobile Money (MTN, Airtel, Zamtel) is coming soon");
    expect(faq).not.toContain("We offer mobile money");
    expect(faq).not.toContain("Mobile Money: 1-2%");
  });

  it("Help: no present-tense mobile-money support or instant-deposit claims", () => {
    expect(help).toContain("Mobile money is coming soon");
    expect(help).not.toContain(
      "We support MTN Mobile Money, Airtel Money, and Zamtel Money",
    );
    expect(help).not.toContain("Mobile Money deposits are instant");
    expect(help).not.toContain(
      "Choose Mobile Money (MTN, Airtel, Zamtel), bank transfer, or card",
    );
  });

  it("MobileMoneyPayment: an honest unavailable panel, not a simulated form", () => {
    expect(mobileMoneyPayment).toContain("Mobile money isn't available yet");
    expect(mobileMoneyPayment.toLowerCase()).not.toContain("simulated");
    expect(mobileMoneyPayment).not.toContain("Sandbox Mode");
    // No payment can start here: no edge-function submit, no form,
    // no pay button, no success callback firing.
    expect(mobileMoneyPayment).not.toContain("process-payment");
    expect(mobileMoneyPayment).not.toContain("functions.invoke");
    expect(mobileMoneyPayment).not.toContain("<form");
    expect(mobileMoneyPayment).not.toContain("onSuccess({");
    expect(mobileMoneyPayment).not.toContain("Pay ${");
  });
});
