// Unit tests for src/utils/depositMethods.ts — the Wallet "Add Money"
// dialog's option labels and default selection. The rules that
// matter: the dialog opens on the first AVAILABLE method (never on
// an unconfigured one while a live rail exists), every option states
// its availability in its label, and each option's selectability
// matches what the dialog has always done (mobile money selectable
// so its explanation stays reachable; PayPal unselectable while its
// gate is off).

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
    moonpayAvailable: false,
  });

  it("keeps all three methods, in the dialog's existing order", () => {
    expect(options.map((o) => o.value)).toEqual([
      "mobile_money",
      "paypal",
      "moonpay_card",
    ]);
  });

  it("labels each option with its availability in plain language", () => {
    expect(options[0].label).toBe("Mobile Money — Not available yet");
    expect(options[1].label).toBe("PayPal");
  });

  it("keeps mobile money selectable and the unavailable MoonPay rail disabled", () => {
    expect(options[0].disabled).toBe(false);
    expect(options[1].disabled).toBe(false);
    expect(options[2].disabled).toBe(true);
  });

  it("defaults to PayPal — the first available method", () => {
    expect(selectDefaultDepositMethod(options)).toBe("paypal");
  });
});

describe("getDepositMethodOptions — PayPal gate off", () => {
  const options = getDepositMethodOptions({
    paypalAvailable: false,
    mobileMoneyAvailable: false,
    moonpayAvailable: false,
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
    moonpayAvailable: false,
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

describe("getDepositMethodOptions — MoonPay gate", () => {
  it("labels MoonPay as available soon and disables it while moonpay_enabled is off", () => {
    const options = getDepositMethodOptions({
      paypalAvailable: true,
      mobileMoneyAvailable: false,
        moonpayAvailable: false,
    });
    expect(options[2].label).toBe("Card (MoonPay) — Available soon");
    expect(options[2].disabled).toBe(true);
    expect(options[2].available).toBe(false);
    // MoonPay never becomes the default while it is off.
    expect(selectDefaultDepositMethod(options)).toBe("paypal");
  });

  it("offers MoonPay plainly once moonpay_enabled is on", () => {
    const options = getDepositMethodOptions({
      paypalAvailable: true,
      mobileMoneyAvailable: false,
        moonpayAvailable: true,
    });
    expect(options[2].label).toBe("Card (MoonPay)");
    expect(options[2].disabled).toBe(false);
    expect(options[2].available).toBe(true);
  });
});
