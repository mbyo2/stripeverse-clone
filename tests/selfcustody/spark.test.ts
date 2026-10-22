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
  parseAutoClaimPreference,
  maxFeeForAutoClaim,
  shouldAutoClaim,
  unclaimedDepositStatus,
  DEFAULT_AUTO_CLAIM_PREFERENCE,
  parseShowFiatPreference,
  satsToFiatAmount,
  formatFiatEquivalent,
  type AutoClaimPreference,
} from "../../src/lib/selfcustody/spark";
import type {
  DepositInfo,
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

describe("automatic claims — preference parsing (product default: on, fixed 500 sats)", () => {
  it("defaults to enabled with a 500-sat limit when nothing is stored", () => {
    expect(parseAutoClaimPreference(null)).toEqual({ enabled: true, maxFeeSats: 500 });
    expect(DEFAULT_AUTO_CLAIM_PREFERENCE).toEqual({ enabled: true, maxFeeSats: 500 });
  });

  it("round-trips a stored preference", () => {
    expect(parseAutoClaimPreference(JSON.stringify({ enabled: false, maxFeeSats: 250 }))).toEqual({
      enabled: false,
      maxFeeSats: 250,
    });
    expect(parseAutoClaimPreference(JSON.stringify({ enabled: true, maxFeeSats: 5000 }))).toEqual({
      enabled: true,
      maxFeeSats: 5000,
    });
  });

  it("falls back to the default on malformed or invalid stored values", () => {
    expect(parseAutoClaimPreference("not json")).toEqual({ enabled: true, maxFeeSats: 500 });
    expect(parseAutoClaimPreference(JSON.stringify({ enabled: true, maxFeeSats: 0 }))).toEqual({
      enabled: true,
      maxFeeSats: 500,
    });
    expect(parseAutoClaimPreference(JSON.stringify({ enabled: true, maxFeeSats: -50 }))).toEqual({
      enabled: true,
      maxFeeSats: 500,
    });
    expect(parseAutoClaimPreference(JSON.stringify({ enabled: true, maxFeeSats: 12.5 }))).toEqual({
      enabled: true,
      maxFeeSats: 500,
    });
    expect(parseAutoClaimPreference(JSON.stringify({ maxFeeSats: "lots" }))).toEqual({
      enabled: true,
      maxFeeSats: 500,
    });
    expect(parseAutoClaimPreference(JSON.stringify({}))).toEqual({ enabled: true, maxFeeSats: 500 });
  });
});

describe("automatic claims — SDK config mapping (MaxFee, fixed sats cap)", () => {
  it("maps the default preference to a fixed 500-sat on-chain cap", () => {
    expect(maxFeeForAutoClaim({ enabled: true, maxFeeSats: 500 })).toEqual({
      onchain: { type: "fixed", amount: 500 },
    });
  });

  it("maps a user-raised limit to that fixed cap", () => {
    expect(maxFeeForAutoClaim({ enabled: true, maxFeeSats: 2000 })).toEqual({
      onchain: { type: "fixed", amount: 2000 },
    });
  });

  it("maps OFF to a 0-sat cap, which no real claim fee can fit", () => {
    expect(maxFeeForAutoClaim({ enabled: false, maxFeeSats: 500 })).toEqual({
      onchain: { type: "fixed", amount: 0 },
    });
  });
});

describe("shouldAutoClaim — claim automatically only at or under the limit", () => {
  const on: AutoClaimPreference = { enabled: true, maxFeeSats: 500 };
  const off: AutoClaimPreference = { enabled: false, maxFeeSats: 500 };

  it("claims at and under the limit, never above it", () => {
    expect(shouldAutoClaim(0, on)).toBe(true);
    expect(shouldAutoClaim(499, on)).toBe(true);
    expect(shouldAutoClaim(500, on)).toBe(true);
    expect(shouldAutoClaim(501, on)).toBe(false);
    expect(shouldAutoClaim(100_000, on)).toBe(false);
  });

  it("never claims when the user turned automatic claims off", () => {
    expect(shouldAutoClaim(0, off)).toBe(false);
    expect(shouldAutoClaim(100, off)).toBe(false);
  });

  it("respects a user-changed limit", () => {
    const raised: AutoClaimPreference = { enabled: true, maxFeeSats: 50 };
    expect(shouldAutoClaim(50, raised)).toBe(true);
    expect(shouldAutoClaim(51, raised)).toBe(false);
  });

  it("refuses nonsensical fees", () => {
    expect(shouldAutoClaim(-1, on)).toBe(false);
    expect(shouldAutoClaim(1.5, on)).toBe(false);
    expect(shouldAutoClaim(Number.NaN, on)).toBe(false);
  });
});

describe("unclaimedDepositStatus — honest per-deposit states", () => {
  const pref: AutoClaimPreference = { enabled: true, maxFeeSats: 500 };
  const deposit = (over: Partial<DepositInfo>): DepositInfo => ({
    txid: "ab".repeat(32),
    vout: 0,
    amountSats: 25_000,
    isMature: true,
    ...over,
  });

  it("an immature deposit is still confirming", () => {
    expect(unclaimedDepositStatus(deposit({ isMature: false }), pref, null).status).toBe("confirming");
  });

  it("a mature deposit whose standard fee fits the limit is withinLimit", () => {
    expect(unclaimedDepositStatus(deposit({}), pref, 300)).toEqual({
      status: "withinLimit",
      requiredFeeSats: null,
      claimErrorMessage: null,
    });
  });

  it("a mature deposit with an unknown quote is not reported over the limit", () => {
    expect(unclaimedDepositStatus(deposit({}), pref, null).status).toBe("withinLimit");
  });

  it("a mature deposit whose fee exceeds the limit is overLimit with the fee", () => {
    expect(unclaimedDepositStatus(deposit({}), pref, 900)).toEqual({
      status: "overLimit",
      requiredFeeSats: 900,
      claimErrorMessage: null,
    });
  });

  it("with automatic claims off, any real fee is overLimit", () => {
    expect(unclaimedDepositStatus(deposit({}), { enabled: false, maxFeeSats: 500 }, 300).status).toBe(
      "overLimit",
    );
  });

  it("an SDK max-fee-exceeded error is overLimit with the required fee", () => {
    const d = deposit({
      claimError: { type: "maxDepositClaimFeeExceeded", tx: "ab".repeat(32), vout: 0, requiredFeeSats: 1200 },
    });
    expect(unclaimedDepositStatus(d, pref, null)).toEqual({
      status: "overLimit",
      requiredFeeSats: 1200,
      claimErrorMessage: null,
    });
  });

  it("other SDK claim errors are claimFailed with a plain-language message", () => {
    const generic = deposit({ claimError: { type: "generic", message: "provider exploded" } });
    expect(unclaimedDepositStatus(generic, pref, null)).toEqual({
      status: "claimFailed",
      requiredFeeSats: null,
      claimErrorMessage: "provider exploded",
    });
    const tooSmall = deposit({ claimError: { type: "depositTooSmall", tx: "ab".repeat(32), vout: 0 } });
    expect(unclaimedDepositStatus(tooSmall, pref, null).status).toBe("claimFailed");
    expect(unclaimedDepositStatus(tooSmall, pref, null).claimErrorMessage).toMatch(/too small/i);
  });
});

describe("fiat display preference (default off)", () => {
  it("parses only explicit true values as on", () => {
    expect(parseShowFiatPreference("true")).toBe(true);
    expect(parseShowFiatPreference("1")).toBe(true);
    expect(parseShowFiatPreference("false")).toBe(false);
    expect(parseShowFiatPreference(null)).toBe(false);
    expect(parseShowFiatPreference("yes")).toBe(false);
  });
});

describe("fiat conversion — display-only, honest about missing rates", () => {
  it("converts sats at a fiat-per-BTC rate", () => {
    // 100,000 sats = 0.001 BTC; at K2,600,000/BTC → K2,600.00
    expect(satsToFiatAmount(100_000, 2_600_000)).toBeCloseTo(2600);
    expect(satsToFiatAmount(100_000_000, 97_000)).toBeCloseTo(97_000);
    expect(satsToFiatAmount(0, 97_000)).toBe(0);
  });

  it("returns null for missing, zero, or invalid rates — never a fabricated value", () => {
    expect(satsToFiatAmount(100_000, null)).toBeNull();
    expect(satsToFiatAmount(100_000, undefined)).toBeNull();
    expect(satsToFiatAmount(100_000, 0)).toBeNull();
    expect(satsToFiatAmount(100_000, Number.NaN)).toBeNull();
    expect(satsToFiatAmount(100_000, -5)).toBeNull();
    expect(formatFiatEquivalent(100_000, 0, "USD", "en-US")).toBeNull();
    expect(formatFiatEquivalent(100_000, Number.NaN, "USD", "en-US")).toBeNull();
    expect(formatFiatEquivalent(100_000, null, "USD", "en-US")).toBeNull();
  });

  it("formats like ≈ $970.00 / ≈ K 2,600.00 (Intl, app currency locales)", () => {
    expect(formatFiatEquivalent(1_000_000, 97_000, "USD", "en-US")).toBe("≈ $970.00");
    expect(formatFiatEquivalent(100_000, 2_600_000, "ZMW", "en-ZM")).toMatch(/^≈ K\s?2,600\.00$/);
    expect(formatFiatEquivalent(100_000_000, 2_600_000, "ZMW", "en-ZM")).toMatch(/^≈ K\s?2,600,000\.00$/);
  });
});
