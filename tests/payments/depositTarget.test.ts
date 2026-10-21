// Unit tests for src/utils/depositTarget.ts — which wallet a deposit
// targets. The rule that matters: a PayPal deposit is never aimed at a
// ZMW wallet, because PayPal does not support ZMW as a checkout
// currency and the order would fail at creation (the failure f0aa8ff
// stopped the UI from toasting as a success). Other methods must pass
// the viewed wallet through untouched.

import { describe, it, expect } from "vitest";
import { resolveDepositTarget } from "../../src/utils/depositTarget";

const ZMW_WALLET = "zmw-wallet-id";
const USD_WALLET = "usd-wallet-id";

describe("resolveDepositTarget", () => {
  it("targets the user's USD wallet for a PayPal deposit when one exists", () => {
    expect(
      resolveDepositTarget({
        paymentMethod: "paypal",
        walletId: ZMW_WALLET,
        currency: "ZMW",
        usdWalletId: USD_WALLET,
      }),
    ).toEqual({ walletId: USD_WALLET, currency: "USD" });
  });

  it("defers to the function's Main-wallet fallback for PayPal when no USD wallet exists", () => {
    // No wallet_id, currency 'USD': wallet-deposit resolves (or
    // creates) the caller's Main USD wallet itself.
    expect(
      resolveDepositTarget({
        paymentMethod: "paypal",
        walletId: ZMW_WALLET,
        currency: "ZMW",
        usdWalletId: null,
      }),
    ).toEqual({ walletId: undefined, currency: "USD" });
  });

  it("treats a missing USD lookup result the same as no USD wallet", () => {
    expect(
      resolveDepositTarget({ paymentMethod: "paypal", walletId: ZMW_WALLET, currency: "ZMW" }),
    ).toEqual({ walletId: undefined, currency: "USD" });
  });

  it("passes the viewed wallet through untouched for mobile money", () => {
    expect(
      resolveDepositTarget({
        paymentMethod: "mobile_money",
        walletId: ZMW_WALLET,
        currency: "ZMW",
        usdWalletId: USD_WALLET,
      }),
    ).toEqual({ walletId: ZMW_WALLET, currency: "ZMW" });
  });

  it("passes the viewed wallet through untouched for card deposits", () => {
    expect(
      resolveDepositTarget({
        paymentMethod: "card",
        walletId: ZMW_WALLET,
        currency: "ZMW",
        usdWalletId: USD_WALLET,
      }),
    ).toEqual({ walletId: ZMW_WALLET, currency: "ZMW" });
  });
});
