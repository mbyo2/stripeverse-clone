// Unit tests for src/config/moonpay.ts — the pure helpers behind
// the MoonPay frontend (admin console, useMoonpay hook and the
// Bitcoin buy entry).
//
// The properties under test:
//   - The rail fails CLOSED in language: all six internal statuses
//     have exact plain-language labels and unknown values never
//     borrow a real label.
//   - A moonpay-session response is a started purchase ONLY when it
//     carries a hosted-checkout URL; the crafted not_configured /
//     coming-soon answers surface the server's message, and any
//     other shape is a plain failure that says no money moved.
//   - Purchases are USD (MoonPay does not support ZMW) and the
//     coming-soon copy never claims availability.

import { describe, it, expect } from "vitest";
import {
  MOONPAY_CARD_DESCRIPTION,
  MOONPAY_CARD_TITLE,
  MOONPAY_COMING_SOON_COPY,
  MOONPAY_COMING_SOON_LABEL,
  MOONPAY_ENABLED_SETTING,
  MOONPAY_FIAT_CURRENCY,
  MOONPAY_STATUS_LABELS,
  isMoonpaySandbox,
  moonpayEnvironmentLabel,
  moonpayStatusLabel,
  resolveMoonpaySessionOutcome,
  shortenMoonpayValue,
} from "../../src/config/moonpay";

describe("moonpay constants (the truthful gate)", () => {
  it("pins the platform_settings flag and the USD purchase currency", () => {
    expect(MOONPAY_ENABLED_SETTING).toBe("moonpay_enabled");
    expect(MOONPAY_FIAT_CURRENCY).toBe("USD");
    expect(MOONPAY_CARD_TITLE).toBe("Card (MoonPay)");
    expect(MOONPAY_COMING_SOON_LABEL).toBe("Coming soon");
  });

  it("builds the coming-soon copy from the card description", () => {
    expect(MOONPAY_CARD_DESCRIPTION).toBe(
      "Buy Bitcoin with a debit or credit card, delivered straight to your wallet.",
    );
    expect(MOONPAY_COMING_SOON_COPY).toBe(
      "Buy Bitcoin with a debit or credit card, delivered straight to your wallet. Coming soon.",
    );
    expect(MOONPAY_COMING_SOON_COPY).not.toContain("ZMW");
  });
});

describe("moonpayStatusLabel (the six internal statuses)", () => {
  it("labels every internal status in plain language", () => {
    expect(moonpayStatusLabel("initiated")).toBe("Started");
    expect(moonpayStatusLabel("waiting_payment")).toBe("Waiting for payment");
    expect(moonpayStatusLabel("pending")).toBe("Processing");
    expect(moonpayStatusLabel("waiting_authorization")).toBe("Waiting for card approval");
    expect(moonpayStatusLabel("completed")).toBe("Completed");
    expect(moonpayStatusLabel("failed")).toBe("Failed");
    expect(Object.keys(MOONPAY_STATUS_LABELS)).toHaveLength(6);
  });

  it("never borrows a real label for an unknown status", () => {
    expect(moonpayStatusLabel("refunded")).toBe("Unknown");
    expect(moonpayStatusLabel(null)).toBe("Unknown");
    expect(moonpayStatusLabel(undefined)).toBe("Unknown");
    expect(moonpayStatusLabel("")).toBe("Unknown");
  });
});

describe("moonpayEnvironmentLabel", () => {
  it("labels sandbox and production plainly", () => {
    expect(moonpayEnvironmentLabel("sandbox")).toBe("Sandbox");
    expect(moonpayEnvironmentLabel("test")).toBe("Sandbox");
    expect(moonpayEnvironmentLabel("production")).toBe("Production");
    expect(moonpayEnvironmentLabel("live")).toBe("Production");
    expect(isMoonpaySandbox("sandbox")).toBe(true);
    expect(isMoonpaySandbox("production")).toBe(false);
  });

  it("returns null when no environment is reported", () => {
    expect(moonpayEnvironmentLabel(null)).toBeNull();
    expect(moonpayEnvironmentLabel(undefined)).toBeNull();
    expect(moonpayEnvironmentLabel("")).toBeNull();
    expect(isMoonpaySandbox(null)).toBe(false);
  });
});

describe("shortenMoonpayValue", () => {
  it("shortens long addresses and references, leaves short ones whole", () => {
    expect(shortenMoonpayValue("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe(
      "bc1qxy2kgd…hx0wlh",
    );
    expect(shortenMoonpayValue("short-ref")).toBe("short-ref");
    expect(shortenMoonpayValue(null)).toBe("—");
    expect(shortenMoonpayValue(undefined)).toBe("—");
    expect(shortenMoonpayValue("")).toBe("—");
  });
});

describe("resolveMoonpaySessionOutcome", () => {
  it("treats only a response carrying a checkout URL as ready", () => {
    expect(
      resolveMoonpaySessionOutcome({
        url: "https://buy.moonpay.com/?session=abc",
        external_reference: "ref-1",
        deposit_address: "bc1qexample",
        environment: "sandbox",
      }),
    ).toEqual({ kind: "ready", url: "https://buy.moonpay.com/?session=abc" });
  });

  it("surfaces the server's plain-language not_configured message", () => {
    expect(
      resolveMoonpaySessionOutcome({
        status: "not_configured",
        error: "MoonPay is not connected yet — purchases are unavailable.",
      }),
    ).toEqual({
      kind: "not_configured",
      message: "MoonPay is not connected yet — purchases are unavailable.",
    });
  });

  it("surfaces coming-soon answers, with a truthful default message", () => {
    const withMessage = resolveMoonpaySessionOutcome({
      status: "coming_soon",
      message: "Card purchases are coming soon.",
    });
    expect(withMessage).toEqual({
      kind: "coming_soon",
      message: "Card purchases are coming soon.",
    });
    const bare = resolveMoonpaySessionOutcome({ status: "coming_soon" });
    expect(bare.kind).toBe("coming_soon");
    if (bare.kind === "coming_soon") {
      expect(bare.message).toContain("coming soon");
      expect(bare.message).toContain("No money has moved");
    }
  });

  it("maps anything else to a plain failure that says no money moved", () => {
    for (const data of [null, undefined, {}, { success: false }, "junk"]) {
      const outcome = resolveMoonpaySessionOutcome(data);
      expect(outcome.kind).toBe("failed");
      if (outcome.kind === "failed") {
        expect(outcome.message).toContain("No money was charged");
      }
    }
  });
});
