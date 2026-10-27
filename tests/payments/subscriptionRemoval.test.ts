// Pins for the subscription REMOVAL (CEO decision 2026-10-26 18:31,
// superseding the same-day Stripe → PayPal subscription migration):
// "just leave the percentage payments we had so as everything is not
// done in a subscription."
//
//   - There is NO subscription offering anywhere: Pricing is a fee
//     schedule, the Billing page manages no plan, the stale
//     /subscription-tiers route lands on the truth, and no client
//     code can start or manage a subscription.
//   - The fees Pricing displays are the fees the code actually
//     charges, verified 2026-10-26 against their live sources:
//       Send money 2.5%        platform_settings.send_money_fee_percent
//       Transfer 1.5%          platform_settings.transfer_fee_percent
//       P2P trades 0.5%        platform_settings.p2p_fee_percent
//       Instant buy/sell 1.5%  btc-trade fee (150 bps default)
//       Payment links 2.5%     platform_settings.split_platform_fee_percent
//       Card funding 1% min K2 fund-virtual-card fee code
//   - The server refuses plainly: paypal-checkout subscription
//     creates and every manage-subscription action return the
//     removal notice; the one-time D1 refusal is unchanged.
//   - What must survive: PayPal wallet deposits (wallet-deposit),
//     the card-funding fee, and the read-only entitlement plumbing
//     (check-subscription) that usage limits still read.
//
// Source pins, the house style for presentation contracts.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.resolve(here, rel));

const pricing = read("../../src/pages/Pricing.tsx");
const billing = read("../../src/pages/Billing.tsx");
const tiersPage = read("../../src/pages/SubscriptionTiers.tsx");
const paypalCheckoutFn = read("../../supabase/functions/paypal-checkout/index.ts");
const manageSubscriptionFn = read("../../supabase/functions/manage-subscription/index.ts");

describe("subscription removal: Pricing is the verified fee schedule, nothing else", () => {
  it("shows the percentage fees the platform actually charges", () => {
    for (const fee of ["2.5%", "1.5%", "0.5%", "1%"]) {
      expect(pricing).toContain(fee);
    }
    expect(pricing).toContain("minimum fee of K2");
    expect(pricing).toContain("Send Money");
    expect(pricing).toContain("Payment Links");
    // The PayPal rail rate (1%, CEO decision 2026-10-28) is a fee
    // card of its own — pinned in paypalPlatformFee.test.ts.
    expect(pricing).toContain("Accept PayPal Payments");
  });

  it("names the live source of every fee in its header comment", () => {
    for (const src of [
      "send_money_fee_percent",
      "transfer_fee_percent",
      "p2p_fee_percent",
      "split_platform_fee_percent",
      "paypal_platform_fee_percent",
    ]) {
      expect(pricing).toContain(src);
    }
  });

  it("carries no plan, price point or subscribe path", () => {
    for (const gone of [
      "Basic Plan", "Premium Plan", "Enterprise Plan", "Free Plan",
      "Subscribe Now", "billingPeriod", "PayPalCheckout",
      "0.49", "4.93", "9.87", "24.67",
      "2.9% + K2.50", "Most Popular", "Current Plan",
    ]) {
      expect(pricing).not.toContain(gone);
    }
    expect(pricing).toContain("no subscription plans");
  });

  it("the FAQ fee answer matches the same verified schedule", () => {
    const faq = read("../../src/pages/Faq.tsx");
    expect(faq).toContain("Sending money costs 2.5%");
    expect(faq).toContain("There are no subscription plans or monthly fees");
    expect(faq).not.toContain("Card payments: 2.5-3%");
    expect(faq).not.toContain("Bank transfers: K5 flat fee");
  });
});

describe("subscription removal: no page presents a plan or an upgrade", () => {
  it("Billing explains fees and manages nothing", () => {
    expect(billing).toContain("No plans, no monthly bills");
    expect(billing).not.toContain("SubscriptionManager");
    expect(billing).not.toContain("UsageTracker");
    expect(billing).not.toContain("BillingHistory");
  });

  it("the stale /subscription-tiers route lands on the truth", () => {
    expect(tiersPage).toContain("There Are No Subscription Plans");
    expect(tiersPage).not.toContain("19.99");
    expect(tiersPage).not.toContain("49.99");
    expect(tiersPage).not.toContain("selectedPlan");
  });

  it("feature gates and limit errors never promise an upgrade", () => {
    const featureAccess = read("../../src/components/FeatureAccess.tsx");
    const limitChecker = read("../../src/components/FeatureLimitChecker.tsx");
    const protectedRoute = read("../../src/components/ProtectedRoute.tsx");
    const featureGate = read("../../src/hooks/useFeatureGate.ts");
    const paymentProcessing = read("../../src/hooks/usePaymentProcessing.ts");
    const wallet = read("../../src/hooks/useWallet.ts");
    for (const src of [featureAccess, limitChecker, protectedRoute, featureGate, paymentProcessing, wallet]) {
      expect(src).not.toContain("Upgrade your plan");
      expect(src).not.toContain("Upgrade to continue");
      expect(src).not.toContain("upgrade your plan");
      expect(src).not.toContain("upgrade your subscription");
      expect(src).not.toContain("plan or higher");
    }
    // The route guard's restricted state itself is untouched.
    expect(protectedRoute).toContain("Access Restricted");
    expect(protectedRoute).toContain("requiredFeature");
  });

  it("Help no longer sends anyone to upgrade in Pricing", () => {
    const help = read("../../src/pages/Help.tsx");
    expect(help).not.toContain("Upgrade in Pricing");
    expect(help).toContain("no paid plans or upgrades");
  });
});

describe("subscription removal: the client subscription surface is deleted", () => {
  it("the checkout dialog, hooks and billing components are gone", () => {
    for (const gone of [
      "../../src/components/PayPalCheckout.tsx",
      "../../src/hooks/usePayPalPayments.ts",
      "../../src/hooks/useNativeBilling.ts",
      "../../src/hooks/useSubscriptions.ts",
      "../../src/hooks/usePricing.ts",
      "../../src/components/Products.tsx",
      "../../src/components/subscription/SubscriptionManager.tsx",
      "../../src/components/subscription/BillingHistory.tsx",
      "../../src/components/subscription/UsageTracker.tsx",
    ]) {
      expect(exists(gone)).toBe(false);
    }
  });

  it("no client code invokes the subscription functions", () => {
    const paymentSuccess = read("../../src/pages/PaymentSuccess.tsx");
    expect(paymentSuccess).not.toContain("useSubscription");
    expect(paymentSuccess).not.toContain("Thank you for your subscription");
  });
});

describe("subscription removal: the server refuses plainly", () => {
  it("paypal-checkout refuses subscriptions with the removal notice", () => {
    expect(paypalCheckoutFn).toContain("SUBSCRIPTIONS_REMOVED_MESSAGE");
    expect(paypalCheckoutFn).toContain("no longer offers subscription plans");
    expect(paypalCheckoutFn).toContain("410");
  });

  it("paypal-checkout can no longer build a subscription", () => {
    for (const gone of [
      "/v1/billing/subscriptions",
      "/v1/billing/plans",
      "/v1/catalogs/products",
      "ensureBillingPlan",
      "ensureSubscriptionProduct",
      "paypal_billing_plans",
    ]) {
      expect(paypalCheckoutFn).not.toContain(gone);
    }
  });

  it("the one-time D1 refusal is preserved verbatim", () => {
    expect(paypalCheckoutFn).toContain("ONE_TIME_DEPRECATED_MESSAGE");
    expect(paypalCheckoutFn).toContain(
      "One-time PayPal payments no longer run through this checkout",
    );
  });

  it("manage-subscription refuses every action and mutates nothing", () => {
    expect(manageSubscriptionFn).toContain("SUBSCRIPTION_MANAGEMENT_REMOVED_MESSAGE");
    expect(manageSubscriptionFn).toContain("410");
    expect(manageSubscriptionFn).not.toContain("case 'upgrade'");
    expect(manageSubscriptionFn).not.toContain("proration");
    expect(manageSubscriptionFn).not.toContain(".update(");
    expect(manageSubscriptionFn).not.toContain(".insert(");
  });
});

describe("subscription removal: what must survive, survives", () => {
  it("PayPal wallet deposits keep their create path", () => {
    const walletDeposit = read("../../supabase/functions/wallet-deposit/index.ts");
    expect(walletDeposit).toContain("wallet-deposit-order-");
    expect(exists("../../supabase/functions/paypal-deposit-capture/index.ts")).toBe(true);
  });

  it("the virtual-card funding fee is untouched", () => {
    const fundCard = read("../../supabase/functions/fund-virtual-card/index.ts");
    expect(fundCard).toContain("Math.max(amount * 0.01, 2)");
  });

  it("the read-only entitlement check stays for usage limits", () => {
    expect(exists("../../supabase/functions/check-subscription/index.ts")).toBe(true);
    const hook = read("../../src/hooks/useSubscription.ts");
    expect(hook).toContain("check_usage_limit");
    expect(hook).not.toContain("functions.invoke('paypal-checkout'");
    expect(hook).not.toContain("functions.invoke('manage-subscription'");
  });

  it("the billing-plan catalogue and its migrations stay as history", () => {
    expect(exists("../../supabase/migrations/20261228_paypal_billing_plan_interval.sql")).toBe(true);
  });
});
