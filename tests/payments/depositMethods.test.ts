// Unit tests for src/utils/depositMethods.ts — the Wallet "Add Money"
// dialog's option labels and default selection. The rules that
// matter: the dialog opens on the first AVAILABLE method (never on
// an unconfigured one while a live rail exists), every option states
// its availability in its label, and each option's selectability
// matches what the dialog has always done (mobile money selectable
// so its explanation stays reachable; PayPal and the admin-only
// Stripe rail unselectable for viewers who may not use them).

import { describe, it, expect } from "vitest";
import {
  getDepositMethodOptions,
  selectDefaultDepositMethod,
} from "../../src/utils/depositMethods";

describe("getDepositMethodOptions — today's production state", () => {
  // PayPal live, mobile money unconfigured, plain (non-admin) viewer.
  const options = getDepositMethodOptions({
    paypalAvailable: true,
    mobileMoneyAvailable: false,
    stripeCardAvailable: false,
  });

  it("keeps all three methods, in the dialog's existing order", () => {
    expect(options.map((o) => o.value)).toEqual([
      "mobile_money",
      "paypal",
      "stripe_card",
    ]);
  });

  it("labels each option with its availability in plain language", () => {
    expect(options[0].label).toBe("Mobile Money — Not available yet");
    expect(options[1].label).toBe("PayPal");
    expect(options[2].label).toBe("Card (Stripe) — Coming soon");
  });

  it("keeps mobile money selectable and the unavailable Stripe rail disabled", () => {
    expect(options[0].disabled).toBe(false);
    expect(options[1].disabled).toBe(false);
    expect(options[2].disabled).toBe(true);
  });

  it("defaults to PayPal — the first available method", () => {
    expect(selectDefaultDepositMethod(options)).toBe("paypal");
  });
});

describe("getDepositMethodOptions — admin viewer (Stripe rail usable)", () => {
  const options = getDepositMethodOptions({
    paypalAvailable: true,
    mobileMoneyAvailable: false,
    stripeCardAvailable: true,
  });

  it("shows the Stripe option enabled with its sandbox label", () => {
    expect(options[2].label).toBe("Card (Stripe) — Sandbox");
    expect(options[2].disabled).toBe(false);
    expect(options[2].available).toBe(true);
  });

  it("still defaults to PayPal, the first available method in list order", () => {
    expect(selectDefaultDepositMethod(options)).toBe("paypal");
  });
});

describe("getDepositMethodOptions — PayPal gate off", () => {
  const options = getDepositMethodOptions({
    paypalAvailable: false,
    mobileMoneyAvailable: false,
    stripeCardAvailable: false,
  });

  it("labels PayPal with its coming-soon suffix and disables it", () => {
    expect(options[1].label).toBe("PayPal — Coming soon");
    expect(options[1].disabled).toBe(true);
  });

  it("falls back to the first option when nothing is available", () => {
    expect(selectDefaultDepositMethod(options)).toBe("mobile_money");
  });
});

describe("getDepositMethodOptions — mobile money configured", () => {
  const options = getDepositMethodOptions({
    paypalAvailable: false,
    mobileMoneyAvailable: true,
    stripeCardAvailable: false,
  });

  it("labels mobile money plainly and defaults to it", () => {
    expect(options[0].label).toBe("Mobile Money");
    expect(options[0].available).toBe(true);
    expect(selectDefaultDepositMethod(options)).toBe("mobile_money");
  });
});

describe("selectDefaultDepositMethod — degenerate input", () => {
  it("falls back to mobile_money for an empty option list", () => {
    expect(selectDefaultDepositMethod([])).toBe("mobile_money");
  });
});
