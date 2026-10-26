// Unit tests for supabase/functions/_shared/payment-providers.ts — the
// pure routing classifier shared by the process-payment and
// payment-link-checkout edge functions. The module has no imports, so
// this suite loads the exact file Deno will run.
//
// The property under test is honesty: the only route that may proceed
// toward a real gateway is PayPal with credentials configured; every
// provider the old mock used to "process" with a random success roll
// must classify as not_configured.

import { describe, it, expect } from "vitest";
import {
  classifyProvider,
  classifyLinkMethod,
  paypalDepositCurrencyRefusal,
} from "../../supabase/functions/_shared/payment-providers";

describe("paypalDepositCurrencyRefusal (PayPal deposits are USD-only)", () => {
  it("lets USD through and refuses everything else with the reason", () => {
    expect(paypalDepositCurrencyRefusal("USD")).toBeNull();
    expect(paypalDepositCurrencyRefusal("usd")).toBeNull();
    // ZMW is the live-found case: PayPal has no ZMW, so a ZMW-wallet
    // deposit must be refused up front, not after a provider round-trip.
    expect(paypalDepositCurrencyRefusal("ZMW")).toMatch(/US dollars only/);
    expect(paypalDepositCurrencyRefusal("EUR")).toMatch(/US dollars only/);
    expect(paypalDepositCurrencyRefusal("")).toMatch(/US dollars only/);
  });
});

describe("classifyProvider", () => {
  it("routes PayPal to the gateway when credentials are configured", () => {
    expect(classifyProvider("paypal", { paypalConfigured: true })).toEqual({ kind: "paypal" });
    expect(classifyProvider("PayPal", { paypalConfigured: true })).toEqual({ kind: "paypal" });
  });

  it("refuses PayPal truthfully when credentials are missing", () => {
    const route = classifyProvider("paypal", { paypalConfigured: false });
    expect(route.kind).toBe("not_configured");
    if (route.kind === "not_configured") expect(route.error).toMatch(/PayPal is not configured/);
  });

  it("never fabricates mobile-money processing", () => {
    for (const provider of ["mtn", "MTN", "airtel", "zamtel", "mobile_money", "mobile"]) {
      const route = classifyProvider(provider, { paypalConfigured: true });
      expect(route.kind).toBe("not_configured");
      if (route.kind === "not_configured") expect(route.error).toMatch(/not enabled|not configured/);
    }
  });

  it("never fabricates card or bank processing", () => {
    for (const provider of ["visa", "mastercard", "card", "bank", "bank_transfer", "ussd"]) {
      expect(classifyProvider(provider, { paypalConfigured: true }).kind).toBe("not_configured");
    }
  });

  it("sends wallet and deposit flows to their real homes", () => {
    const wallet = classifyProvider("wallet", { paypalConfigured: true });
    expect(wallet.kind).toBe("not_configured");
    if (wallet.kind === "not_configured") expect(wallet.error).toMatch(/transfer flow/);
    const deposit = classifyProvider("deposit", { paypalConfigured: true });
    expect(deposit.kind).toBe("not_configured");
    if (deposit.kind === "not_configured") expect(deposit.error).toMatch(/deposit flow/);
  });

  it("rejects unknown and empty providers", () => {
    expect(classifyProvider("bitcoin", { paypalConfigured: true }).kind).toBe("not_configured");
    expect(classifyProvider("", { paypalConfigured: true }).kind).toBe("not_configured");
  });
});

describe("classifyLinkMethod", () => {
  it("routes wallet payments to settlement", () => {
    expect(classifyLinkMethod("wallet")).toEqual({ kind: "wallet" });
    expect(classifyLinkMethod("Wallet")).toEqual({ kind: "wallet" });
  });

  it("answers external methods with a truthful not-configured", () => {
    for (const method of ["card", "mobile_money", "bank"]) {
      const route = classifyLinkMethod(method);
      expect(route.kind).toBe("not_configured");
      if (route.kind === "not_configured") {
        expect(route.error).toMatch(/not enabled for payment links/);
      }
    }
  });

  it("rejects unknown methods", () => {
    expect(classifyLinkMethod("cheque").kind).toBe("not_configured");
    expect(classifyLinkMethod("").kind).toBe("not_configured");
  });
});
