import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sparkEnabled,
  connectSpark,
  SparkNotEnabledError,
  parsedFlow,
  parsedInputLabel,
  lnurlPayDetails,
  feePreview,
  paymentSummary,
  sparkReceiveBolt11,
  sparkPrepareSend,
  sparkBuyBitcoinUrl,
} from "../../src/lib/selfcustody/spark";
import type {
  InputType,
  Payment,
  PrepareSendPaymentResponse,
} from "@breeztech/breez-sdk-spark/web";

/**
 * Pure-logic tests for the Breez SDK – Spark module (gating, parse-type
 * mapping, fee preview formatting). The SDK itself is never connected
 * here: every validation path tested runs BEFORE any SDK call, exactly
 * like the UI's honest-gating behaviour.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("spark gating (VITE_BREEZ_API_KEY)", () => {
  it("is disabled when no Breez API key is configured", () => {
    vi.stubEnv("VITE_BREEZ_API_KEY", "");
    expect(sparkEnabled()).toBe(false);
  });

  it("is enabled when a Breez API key is configured", () => {
    vi.stubEnv("VITE_BREEZ_API_KEY", "test-key-value");
    expect(sparkEnabled()).toBe(true);
  });

  it("connect refuses with the plain-language error while disabled", async () => {
    vi.stubEnv("VITE_BREEZ_API_KEY", "");
    await expect(connectSpark("abandon abandon abandon")).rejects.toBeInstanceOf(SparkNotEnabledError);
  });
});

describe("amount validation happens before any SDK call", () => {
  it("receive rejects a non-positive invoice amount", async () => {
    await expect(sparkReceiveBolt11("seed", 0, "test")).rejects.toThrow(/positive whole number/);
    await expect(sparkReceiveBolt11("seed", -10, "test")).rejects.toThrow(/positive whole number/);
    await expect(sparkReceiveBolt11("seed", 1.5, "test")).rejects.toThrow(/positive whole number/);
  });

  it("prepare-send rejects a bad amount", async () => {
    await expect(sparkPrepareSend("seed", "bc1qexample", 0)).rejects.toThrow(/positive whole number/);
  });

  it("buy rejects a bad locked amount", async () => {
    await expect(sparkBuyBitcoinUrl("seed", { amountSat: -1 })).rejects.toThrow(/positive whole number/);
  });
});

describe("parsedFlow — SDK parse result → UI flow", () => {
  const asInput = (type: string) => ({ type }) as unknown as InputType;

  it("routes every payable destination to the unified send flow", () => {
    for (const t of [
      "bolt11Invoice",
      "bolt12Invoice",
      "bolt12Offer",
      "bitcoinAddress",
      "silentPaymentAddress",
      "sparkAddress",
      "sparkInvoice",
      "bip21",
      "crossChainAddress",
    ]) {
      expect(parsedFlow(asInput(t))).toBe("send");
    }
  });

  it("routes LNURL-pay and Lightning addresses to the LNURL-pay flow", () => {
    expect(parsedFlow(asInput("lnurlPay"))).toBe("lnurlPay");
    expect(parsedFlow(asInput("lightningAddress"))).toBe("lnurlPay");
  });

  it("routes LNURL withdraw and auth to their own flows", () => {
    expect(parsedFlow(asInput("lnurlWithdraw"))).toBe("lnurlWithdraw");
    expect(parsedFlow(asInput("lnurlAuth"))).toBe("lnurlAuth");
  });

  it("leaves plain URLs unsupported (honest refusal, nothing simulated)", () => {
    expect(parsedFlow(asInput("url"))).toBe("unsupported");
  });
});

describe("parsedInputLabel", () => {
  const asInput = (type: string) => ({ type }) as unknown as InputType;

  it("labels the main destination types", () => {
    expect(parsedInputLabel(asInput("bolt11Invoice"))).toBe("Lightning invoice (BOLT11)");
    expect(parsedInputLabel(asInput("lightningAddress"))).toBe("Lightning address");
    expect(parsedInputLabel(asInput("bitcoinAddress"))).toBe("Bitcoin address");
    expect(parsedInputLabel(asInput("sparkAddress"))).toBe("Spark address");
    expect(parsedInputLabel(asInput("lnurlWithdraw"))).toBe("LNURL withdraw");
  });

  it("falls back to a generic label for unknown types", () => {
    expect(parsedInputLabel(asInput("somethingNew"))).toBe("Payment request");
  });
});

describe("lnurlPayDetails", () => {
  const payDetails = {
    callback: "https://example.com/callback",
    minSendable: 1_000,
    maxSendable: 100_000_000,
    metadataStr: "[]",
    commentAllowed: 0,
    domain: "example.com",
    url: "https://example.com/lnurl",
  };

  it("returns the details for an lnurlPay parse", () => {
    const parsed = { type: "lnurlPay", ...payDetails } as unknown as InputType;
    expect(lnurlPayDetails(parsed)).toEqual(payDetails);
  });

  it("unwraps the pay request inside a Lightning address parse", () => {
    const parsed = {
      type: "lightningAddress",
      address: "user@example.com",
      payRequest: payDetails,
    } as unknown as InputType;
    expect(lnurlPayDetails(parsed)).toEqual(payDetails);
  });

  it("returns null for non-LNURL inputs", () => {
    const parsed = { type: "bolt11Invoice" } as unknown as InputType;
    expect(lnurlPayDetails(parsed)).toBeNull();
  });
});

describe("feePreview — prepare-response fee formatting", () => {
  const asPrepare = (paymentMethod: unknown, amount = 1_000n) =>
    ({ paymentMethod, amount, feePolicy: { type: "feesIncluded" } }) as unknown as PrepareSendPaymentResponse;

  it("shows the Lightning fee for a BOLT11 send", () => {
    const preview = feePreview(asPrepare({ type: "bolt11Invoice", lightningFeeSats: 12 }));
    expect(preview.primaryFeeSats).toBe(12);
    expect(preview.lines).toEqual([{ label: "Lightning fee", feeSats: 12 }]);
    expect(preview.isEstimate).toBe(false);
  });

  it("adds the Spark-transfer alternative fee when the invoice carries one", () => {
    const preview = feePreview(
      asPrepare({ type: "bolt11Invoice", lightningFeeSats: 12, sparkTransferFeeSats: 2 }),
    );
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines[1]).toEqual({ label: "Spark transfer fee (if paid via Spark)", feeSats: 2 });
    expect(preview.primaryFeeSats).toBe(12);
  });

  it("shows all three on-chain speed totals (user fee + L1 broadcast fee)", () => {
    const preview = feePreview(
      asPrepare({
        type: "bitcoinAddress",
        feeQuote: {
          id: "q1",
          expiresAt: 0,
          isEstimate: true,
          speedSlow: { userFeeSat: 10, l1BroadcastFeeSat: 5 },
          speedMedium: { userFeeSat: 20, l1BroadcastFeeSat: 5 },
          speedFast: { userFeeSat: 40, l1BroadcastFeeSat: 5 },
        },
      }),
    );
    expect(preview.lines.map((l) => l.feeSats)).toEqual([15, 25, 45]);
    expect(preview.primaryFeeSats).toBe(25);
    expect(preview.isEstimate).toBe(true);
  });

  it("shows the Spark transfer fee for Spark destinations", () => {
    const preview = feePreview(asPrepare({ type: "sparkAddress", address: "sp1…", fee: 2n }));
    expect(preview.primaryFeeSats).toBe(2);
    expect(preview.lines).toEqual([{ label: "Spark transfer fee", feeSats: 2 }]);
  });

  it("shows the cross-chain fee", () => {
    const preview = feePreview(asPrepare({ type: "crossChainAddress", feeAmount: 77n }));
    expect(preview.primaryFeeSats).toBe(77);
  });
});

describe("paymentSummary", () => {
  it("normalises an SDK payment for display (bigint → number)", () => {
    const payment = {
      id: "p1",
      paymentType: "receive",
      status: "completed",
      amount: 5_000n,
      fees: 3n,
      timestamp: 1_700_000_000,
      method: "lightning",
    } as unknown as Payment;
    expect(paymentSummary(payment)).toEqual({
      id: "p1",
      direction: "receive",
      amountSats: 5_000,
      feesSats: 3,
      status: "completed",
      method: "lightning",
      timestamp: 1_700_000_000,
    });
  });
});
