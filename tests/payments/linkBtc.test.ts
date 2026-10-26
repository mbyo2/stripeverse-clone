// Unit tests for supabase/functions/_shared/link-btc.ts — the pure
// quote/fee/state logic behind "Pay with Bitcoin" on payment links
// (CEO order 2026-10-26). The edge functions run this exact module;
// the SQL settlement RPCs mirror splitLinkBtcSettlement, and their
// behaviour (partial accumulation, expiry close-out, exactly-once)
// is proven live against the paymentgetway project — see
// goals/bmaglass-pay-completion-sweep/hidden_files/
// pay-with-bitcoin-addendum-2026-10-26.md.
// Byte-identical transpile-loader style, same as fiatAmount.test.ts.
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(here, "../../supabase/functions/_shared/link-btc.ts");
const tmpPath = path.join(here, ".tmp-link-btc.mjs");
type Mod = typeof import("../../supabase/functions/_shared/link-btc");
let mod: Mod;
beforeAll(async () => {
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(tmpPath, outputText);
  mod = await import(tmpPath);
});

// Reference figures: K100.00 at K2,600,000/BTC, 2.5% fee.
//   amount_sats = ceil(10000 ngwee × 1e8 / 260,000,000) = 3847
//   fee = K2.50 → ceil(250 × 1e8 / 260,000,000) = 97 sats
const ZMW_RATE = 2_600_000;

describe("quoteLinkBtc — locked quote math", () => {
  it("quotes sats that cover the fiat amount (ceil, never a hair under)", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 100, rateFiatPerBtc: ZMW_RATE, feePercent: 2.5, feePayer: "seller" });
    expect(q.amountSats).toBe(3847);
    // Invariant: amountSats covers the price; one sat less would not.
    const rateMinor = BigInt(Math.round(ZMW_RATE * 100));
    expect(BigInt(q.amountSats) * rateMinor).toBeGreaterThanOrEqual(10_000n * 100_000_000n);
    expect(BigInt(q.amountSats - 1) * rateMinor).toBeLessThan(10_000n * 100_000_000n);
  });

  it("computes the fee on the FIAT amount, as the fiat settlement does", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 100, rateFiatPerBtc: ZMW_RATE, feePercent: 2.5, feePayer: "seller" });
    expect(q.feeFiat).toBe(2.5);
    expect(q.feeSats).toBe(97);
  });

  it("seller mode: the payer is asked for the amount; the fee leaves the proceeds", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 100, rateFiatPerBtc: ZMW_RATE, feePercent: 2.5, feePayer: "seller" });
    expect(q.requiredSats).toBe(q.amountSats);
    const split = mod.splitLinkBtcSettlement(q.requiredSats, q.feeSats);
    expect(split.platformFeeSats).toBe(97);
    expect(split.merchantCreditSats).toBe(3847 - 97);
  });

  it("buyer mode: the fee rides on top; the merchant nets the full amount's sats", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 100, rateFiatPerBtc: ZMW_RATE, feePercent: 2.5, feePayer: "buyer" });
    expect(q.requiredSats).toBe(q.amountSats + q.feeSats);
    const split = mod.splitLinkBtcSettlement(q.requiredSats, q.feeSats);
    expect(split.merchantCreditSats).toBe(q.amountSats);
    expect(split.platformFeeSats).toBe(q.feeSats);
  });

  it("USD link: $50 at $100,000/BTC", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 50, rateFiatPerBtc: 100_000, feePercent: 2.5, feePayer: "buyer" });
    expect(q.amountSats).toBe(50_000);
    expect(q.feeSats).toBe(1_250);
    expect(q.requiredSats).toBe(51_250);
  });

  it("zero configured fee: no fee sats in either mode", () => {
    const q = mod.quoteLinkBtc({ fiatAmount: 25, rateFiatPerBtc: ZMW_RATE, feePercent: 0, feePayer: "buyer" });
    expect(q.feeSats).toBe(0);
    expect(q.requiredSats).toBe(q.amountSats);
  });

  it("fee rounds half-up to whole minor units like the fiat RPC", () => {
    // 2.5% of K10.20 = K0.255 → K0.26 (half-up), not K0.25.
    expect(mod.feeFiatMinor(1020, 2.5)).toBe(26);
    // 2.5% of K10.01 = K0.25025 → K0.25.
    expect(mod.feeFiatMinor(1001, 2.5)).toBe(25);
  });

  it("overpayment: the excess rides to the merchant unfee'd", () => {
    const split = mod.splitLinkBtcSettlement(5000, 97);
    expect(split.merchantCreditSats).toBe(4903);
    expect(split.platformFeeSats).toBe(97);
  });

  it("the fee can never exceed what was received", () => {
    const split = mod.splitLinkBtcSettlement(50, 97);
    expect(split.platformFeeSats).toBe(50);
    expect(split.merchantCreditSats).toBe(0);
  });

  it("rejects non-positive amounts and rates", () => {
    expect(() => mod.quoteLinkBtc({ fiatAmount: 0, rateFiatPerBtc: ZMW_RATE, feePercent: 2.5, feePayer: "seller" })).toThrow();
    expect(() => mod.quoteLinkBtc({ fiatAmount: 10, rateFiatPerBtc: 0, feePercent: 2.5, feePayer: "seller" })).toThrow();
  });
});

describe("linkBtcDisplayState — the payer page states", () => {
  const open = new Date(Date.now() + 30 * 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const view = (over: Partial<Parameters<typeof mod.linkBtcDisplayState>[0]>) => ({
    status: "waiting",
    seenSats: 0,
    receivedSats: 0,
    requiredSats: 3847,
    expiresAt: open,
    ...over,
  });

  it("waiting: nothing seen, window open", () => {
    expect(mod.linkBtcDisplayState(view({}))).toBe("waiting");
  });
  it("detected: seen but not yet credited (confirming)", () => {
    expect(mod.linkBtcDisplayState(view({ seenSats: 3847 }))).toBe("detected");
  });
  it("underpaid: some credited, more needed", () => {
    expect(mod.linkBtcDisplayState(view({ status: "partial", seenSats: 1000, receivedSats: 1000 }))).toBe("underpaid");
  });
  it("fully covered but not yet settled reads as detected, never underpaid", () => {
    expect(mod.linkBtcDisplayState(view({ status: "partial", seenSats: 3847, receivedSats: 3847 }))).toBe("detected");
  });
  it("paid only from a settled attempt", () => {
    expect(mod.linkBtcDisplayState(view({ status: "settled", receivedSats: 3847 }))).toBe("paid");
  });
  it("expired: window closed, nothing credited", () => {
    expect(mod.linkBtcDisplayState(view({ expiresAt: past }))).toBe("expired");
    expect(mod.linkBtcDisplayState(view({ status: "expired" }))).toBe("expired");
  });
  it("partial_credited: window closed part-paid", () => {
    expect(mod.linkBtcDisplayState(view({ status: "partial_credited", receivedSats: 1000 }))).toBe("partial_credited");
    // Even before the close-out write lands, an expired part-paid
    // attempt presents as partial-credited, not a false 'expired'.
    expect(mod.linkBtcDisplayState(view({ status: "partial", receivedSats: 1000, expiresAt: past }))).toBe("partial_credited");
  });
  it("failed passes through with its crafted reason", () => {
    expect(mod.linkBtcDisplayState(view({ status: "failed" }))).toBe("failed");
  });
});

describe("URI + display formatting", () => {
  it("BIP21 carries the exact required amount", () => {
    expect(mod.bip21Uri("bc1qexample", 3847)).toBe("bitcoin:bc1qexample?amount=0.00003847");
    expect(mod.bip21Uri("bc1qexample", 100_000_000)).toBe("bitcoin:bc1qexample?amount=1");
  });
  it("sats format trims to the significant decimals", () => {
    expect(mod.satsToBtcString(0)).toBe("0");
    expect(mod.satsToBtcString(1)).toBe("0.00000001");
    expect(mod.satsToBtcString(150_000_000)).toBe("1.5");
    expect(mod.satsToBtcString(-250_000_000)).toBe("-2.5");
  });
  it("the attempt window is 60 minutes", () => {
    expect(mod.LINK_BTC_ATTEMPT_WINDOW_MINUTES).toBe(60);
  });
});
