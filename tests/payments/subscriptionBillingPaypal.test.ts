// Pins for the subscription-billing migration (Stripe → PayPal,
// CEO decision 2026-10-26 18:03):
//
//   - Platform subscriptions bill through the PayPal subscription
//     flow (paypal-checkout) in USD. The Pricing page's kwacha prices
//     were converted at the platform's stored ZMW→USD rate
//     (exchange_rates: 1 ZMW = $0.04933399, i.e. $1 = K20.27,
//     exchangerate-api, 2026-10-26) and rounded to cents:
//       Basic      K9.99/mo  -> $0.49    K99.99/yr  -> $4.93
//       Premium    K19.99/mo -> $0.99    K199.99/yr -> $9.87
//       Enterprise K49.99/mo -> $2.47    K499.99/yr -> $24.67
//     The charge currency must be unmistakable next to every price.
//   - The buyer's billing period is part of the price point end to
//     end (Pricing → PayPalCheckout → usePayPalPayments →
//     paypal-checkout → paypal_billing_plans.interval_unit, migration
//     20261228) and the PayPal plan frequency matches it — a yearly
//     checkout must never mint a MONTH-frequency plan again.
//   - The Stripe subscription surface is gone: create-checkout and
//     customer-portal are deleted, no client code invokes them, and
//     nothing reads STRIPE_SECRET_KEY.
//
// Source pins, the house style for presentation contracts (see
// mobileMoneyCopyHonesty.test.ts).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.resolve(here, rel));

const pricing = read("../../src/pages/Pricing.tsx");
const paypalCheckoutUi = read("../../src/components/PayPalCheckout.tsx");
const paypalHook = read("../../src/hooks/usePayPalPayments.ts");
const subscriptionHook = read("../../src/hooks/useSubscription.ts");
const paypalCheckoutFn = read("../../supabase/functions/paypal-checkout/index.ts");

describe("subscription billing: USD prices on Pricing (converted at the platform rate)", () => {
  it("carries the six converted USD charge amounts", () => {
    for (const usd of ["0.49", "4.93", "0.99", "9.87", "2.47", "24.67"]) {
      expect(pricing).toContain(usd);
    }
  });

  it("keeps the original kwacha prices only as reference fields", () => {
    for (const zmw of ["monthlyPriceZmw: 9.99", "yearlyPriceZmw: 99.99", "monthlyPriceZmw: 19.99", "yearlyPriceZmw: 199.99", "monthlyPriceZmw: 49.99", "yearlyPriceZmw: 499.99"]) {
      expect(pricing).toContain(zmw);
    }
  });

  it("sends USD — never ZMW — to the PayPal subscription dialog", () => {
    expect(pricing).toContain('currency="USD"');
    expect(pricing).not.toContain('currency="ZMW"');
  });

  it("states the charge currency plainly next to the price and in the dialog", () => {
    expect(pricing).toContain("Billed in US dollars via PayPal");
    expect(pricing).toContain("Subscriptions are billed in US dollars (USD) via PayPal.");
  });
});

describe("subscription billing: period is part of the price point end to end", () => {
  it("Pricing passes the selected billing period into the dialog", () => {
    expect(pricing).toContain("billingPeriod={billingPeriod === 'yearly' ? 'yearly' : 'monthly'}");
    expect(paypalCheckoutUi).toContain("period: billingPeriod");
    expect(paypalCheckoutUi).toContain("billingPeriod === 'yearly' ? 'year' : 'month'");
    expect(paypalCheckoutUi).toContain("{billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'} Billing");
  });

  it("the hook forwards the period to the checkout function", () => {
    expect(paypalHook).toContain("period: paymentData.period ?? 'monthly'");
  });

  it("the function keys the plan catalogue by interval and bills at that frequency", () => {
    expect(paypalCheckoutFn).toContain("const intervalUnit = body.period === 'yearly' ? 'YEAR' : 'MONTH'");
    expect(paypalCheckoutFn).toContain('.eq("interval_unit", input.intervalUnit)');
    expect(paypalCheckoutFn).toContain("interval_unit: input.intervalUnit");
    expect(paypalCheckoutFn).toContain("interval_unit: input.intervalUnit,");
    expect(paypalCheckoutFn).not.toContain('interval_unit: "MONTH",');
  });
});

describe("subscription billing: the Stripe subscription surface is removed", () => {
  it("create-checkout and customer-portal no longer exist", () => {
    expect(exists("../../supabase/functions/create-checkout/index.ts")).toBe(false);
    expect(exists("../../supabase/functions/customer-portal/index.ts")).toBe(false);
  });

  it("no client hook invokes the removed functions", () => {
    expect(subscriptionHook).not.toContain("functions.invoke('create-checkout'");
    expect(subscriptionHook).not.toContain("functions.invoke('customer-portal'");
    expect(subscriptionHook).not.toContain("createCheckout");
    expect(subscriptionHook).not.toContain("openCustomerPortal");
  });

  it("the migration file records the interval dimension", () => {
    const migration = read("../../supabase/migrations/20261228_paypal_billing_plan_interval.sql");
    expect(migration).toContain("add column if not exists interval_unit");
    expect(migration).toContain("paypal_billing_plans_price_point_key");
  });
});
