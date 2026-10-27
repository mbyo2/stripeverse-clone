// Tests for the PayPal funding options (CEO directive 2026-10-27):
// clicking the top-level "PayPal" method opens two PayPal-specific
// ways to pay — Card via PayPal and PayPal account — both completing
// through the same PayPal order, the choice only steering which
// PayPal page opens first (Orders API landing_page). Plus the
// standing Bitcoin-first rule (reaffirmed 2026-10-28) in every
// picker this work touched, and the Bitcoin-led share metadata.
//
// The property under test is clarity without confusion: the card
// that runs through PayPal is labelled as PayPal's, everywhere; a
// future DIRECT card method is a top-level sibling, never a PayPal
// funding option; and nothing here invents a rail that cannot
// complete.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAYPAL_FUNDING_OPTIONS,
  DEFAULT_PAYPAL_FUNDING,
  isPayPalFunding,
  paypalFundingOption,
  paypalLandingPageForFunding,
  type PayPalFunding,
} from "../../src/utils/paypalFunding";
import {
  paypalFundingIntent,
  paypalLandingPageForFunding as serverLandingPageForFunding,
} from "../../supabase/functions/_shared/payment-providers";
import { getDepositMethodOptions } from "../../src/utils/depositMethods";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("PAYPAL_FUNDING_OPTIONS — PayPal expands to exactly two sub-options", () => {
  it("has exactly the card-via-PayPal and PayPal-account options", () => {
    expect(PAYPAL_FUNDING_OPTIONS).toHaveLength(2);
    expect(PAYPAL_FUNDING_OPTIONS.map((o) => o.value)).toEqual([
      "paypal_card",
      "paypal_account",
    ]);
  });

  it("labels the card option as PayPal's, never as a plain 'Card'", () => {
    const card = paypalFundingOption("paypal_card");
    expect(card.title).toBe("Card via PayPal");
    // The description must say PayPal processes it and that no
    // PayPal account is needed (guest checkout).
    expect(card.description).toContain("PayPal processes the card payment");
    expect(card.description).toContain("no PayPal account needed");
  });

  it("describes the account option as PayPal-to-PayPal", () => {
    const account = paypalFundingOption("paypal_account");
    expect(account.title).toBe("PayPal account");
    expect(account.description).toContain("PayPal balance");
  });

  it("steers each option to the PayPal page where it starts", () => {
    expect(paypalLandingPageForFunding("paypal_card")).toBe("BILLING");
    expect(paypalLandingPageForFunding("paypal_account")).toBe("LOGIN");
    for (const option of PAYPAL_FUNDING_OPTIONS) {
      expect(option.landingPage).toBe(
        paypalLandingPageForFunding(option.value),
      );
    }
  });

  it("pre-selects a real option (the account route)", () => {
    expect(isPayPalFunding(DEFAULT_PAYPAL_FUNDING)).toBe(true);
    expect(DEFAULT_PAYPAL_FUNDING).toBe("paypal_account");
  });
});

describe("architecture — funding options are PayPal's children, never top-level methods", () => {
  it("namespaces every funding value so it cannot collide with a top-level method", () => {
    const topLevelValues = [
      "card",
      "bitcoin",
      "mobile",
      "mobile_money",
      "ussd",
      "paypal",
      "moonpay_card",
      "wallet",
      "bank",
    ];
    for (const option of PAYPAL_FUNDING_OPTIONS) {
      expect(option.value.startsWith("paypal_")).toBe(true);
      expect(topLevelValues).not.toContain(option.value);
    }
  });

  it("keeps the Add Money top-level methods unchanged — no funding option leaks in as a method", () => {
    const options = getDepositMethodOptions({
      paypalAvailable: true,
      mobileMoneyAvailable: false,
      moonpayAvailable: false,
    });
    expect(options.map((o) => o.value)).toEqual([
      "mobile_money",
      "paypal",
      "moonpay_card",
    ]);
  });
});

describe("server mapping — only the two known intents steer, raw values never forward", () => {
  it("maps the intents to PayPal landing pages", () => {
    expect(serverLandingPageForFunding("paypal_card")).toBe("BILLING");
    expect(serverLandingPageForFunding("paypal_account")).toBe("LOGIN");
  });

  it("returns null (no steering) for anything else, including raw landing-page values", () => {
    for (const bad of ["card", "LOGIN", "BILLING", "", "paypal", null, undefined, 42, {}]) {
      expect(serverLandingPageForFunding(bad)).toBeNull();
      expect(paypalFundingIntent(bad)).toBeNull();
    }
  });

  it("records only validated intents on transaction rows", () => {
    expect(paypalFundingIntent("paypal_card")).toBe("paypal_card");
    expect(paypalFundingIntent("paypal_account")).toBe("paypal_account");
  });

  it("client and server agree on the mapping", () => {
    const values: PayPalFunding[] = ["paypal_card", "paypal_account"];
    for (const value of values) {
      expect(serverLandingPageForFunding(value)).toBe(
        paypalLandingPageForFunding(value),
      );
    }
  });
});

describe("Wallet Add Money — Bitcoin first, PayPal expands (source pins)", () => {
  const wallet = read("../../src/pages/Wallet.tsx");
  const useWallet = read("../../src/hooks/useWallet.ts");

  it("shows a Bitcoin entry at the head of the deposit methods, routing to the Bitcoin wallet", () => {
    expect(wallet).toContain("navigate('/bitcoin-wallet')");
    expect(wallet).toContain("Add Bitcoin in your Bitcoin wallet");
    expect(wallet.indexOf("navigate('/bitcoin-wallet')")).toBeLessThan(
      wallet.indexOf("<Select value={depositMethod}"),
    );
  });

  it("renders the PayPal funding options when PayPal is the chosen method", () => {
    expect(wallet).toContain("<PayPalFundingOptions");
    expect(wallet).toContain("depositMethod === 'paypal' ? paypalFunding : undefined");
  });

  it("sends the funding intent only for PayPal deposits", () => {
    expect(useWallet).toContain("paypal_funding: paypalFunding");
    expect(useWallet).toContain("paymentMethod === 'paypal' && paypalFunding");
  });
});

describe("Checkout — Bitcoin first, PayPal expands (source pins)", () => {
  const checkout = read("../../src/pages/Checkout.tsx");

  it("lists Bitcoin before every other method button", () => {
    const bitcoin = checkout.indexOf('setSelectedPaymentMethod("bitcoin")');
    expect(bitcoin).toBeGreaterThan(-1);
    expect(bitcoin).toBeLessThan(checkout.indexOf('setSelectedPaymentMethod("mobile")'));
    expect(bitcoin).toBeLessThan(checkout.indexOf('setSelectedPaymentMethod("card")'));
    expect(bitcoin).toBeLessThan(checkout.indexOf('setSelectedPaymentMethod("ussd")'));
    expect(bitcoin).toBeLessThan(checkout.indexOf('setSelectedPaymentMethod("paypal")'));
  });

  it("expands PayPal into its funding options inside the PayPal panel", () => {
    expect(checkout).toContain("<PayPalFundingOptions");
    expect(checkout).toContain("paypal_funding: paypalFunding");
    expect(checkout).toContain("Pay by card via PayPal");
    expect(checkout).toContain("Pay with PayPal account");
  });
});

describe("Payment-link page — Bitcoin tiles listed first (source pins)", () => {
  const page = read("../../src/pages/PublicCheckout.tsx");

  it("places the Bitcoin/Lightning tiles ahead of the BMaGlass Wallet tile", () => {
    expect(page.indexOf("...(bitcoinAvailable ? [")).toBeLessThan(
      page.indexOf("...(payerId ? [{"),
    );
  });

  it("still reads clearly that this checkout takes Bitcoin", () => {
    expect(page).toContain("For now, this checkout takes Bitcoin only");
  });
});

describe("edge functions — funding intent wired as steering only (source pins)", () => {
  const walletDeposit = read("../../supabase/functions/wallet-deposit/index.ts");
  const processPayment = read("../../supabase/functions/process-payment/index.ts");

  it("wallet-deposit validates the intent and steers the order's landing page", () => {
    expect(walletDeposit).toContain("paypalLandingPageForFunding(body.paypal_funding)");
    expect(walletDeposit).toContain("landing_page: input.landingPage");
    expect(walletDeposit).toContain("paypal_funding: fundingIntent");
  });

  it("process-payment validates the intent and steers the order's landing page", () => {
    expect(processPayment).toContain("paypalLandingPageForFunding(paymentData.paypal_funding)");
    expect(processPayment).toContain("landing_page: input.landingPage");
    expect(processPayment).toContain("paypal_funding: fundingIntent");
  });
});

describe("share metadata — the preview leads with Bitcoin (source pins)", () => {
  const html = read("../../index.html");

  it("titles the page as the Bitcoin wallet", () => {
    expect(html).toContain("<title>BMaGlass Pay — Your Bitcoin Wallet, Built for Zambia</title>");
    expect(html).toContain('property="og:title" content="BMaGlass Pay — Your Bitcoin Wallet, Built for Zambia"');
    expect(html).toContain('name="twitter:title" content="BMaGlass Pay — Your Bitcoin Wallet, Built for Zambia"');
  });

  it("describes Bitcoin before any other rail in the social descriptions", () => {
    const og = html.match(/property="og:description" content="([^"]+)"/)?.[1] ?? "";
    expect(og).toContain("Bitcoin");
    expect(og.indexOf("Bitcoin")).toBeLessThan(og.indexOf("PayPal"));
    const twitter = html.match(/name="twitter:description" content="([^"]+)"/)?.[1] ?? "";
    expect(twitter).toContain("Bitcoin");
  });

  it("points shares at the real domain", () => {
    expect(html).toContain('property="og:url" content="https://bmaglasspay.online"');
    expect(html).not.toContain("bmaglasspay.com");
  });
});
