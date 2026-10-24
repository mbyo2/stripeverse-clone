// Unit tests for supabase/functions/_shared/pos-core.ts (Bitcoin POS
// data bridge pure logic).
//
// Same transpile-loader style as tests/bitcoin/btc-core.test.ts: load
// the REAL pos-core.ts source, transpile it, and test the resulting
// module — the code under test is byte-identical to what Deno runs.
// pos-core is import-free by design, so no specifier rewriting is
// needed (the replace is kept as a harmless no-op for consistency).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSourcePath = path.resolve(
  here,
  "../../supabase/functions/_shared/pos-core.ts",
);
const tmpModulePath = path.join(here, ".tmp-pos-core.mjs");

type Core = typeof import("../../supabase/functions/_shared/pos-core");
let core: Core;

beforeAll(async () => {
  const source = fs.readFileSync(coreSourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  fs.writeFileSync(tmpModulePath, outputText);
  core = await import(tmpModulePath);
});

describe("fiat → sats conversion (floored, raw index, no spread)", () => {
  it("converts at the P2P fixture rate: K100 at K10,000,000/BTC = 1,000 sats", () => {
    expect(core.fiatZmwToSats(100, 10_000_000)).toBe(1000);
  });

  it("converts a round amount exactly", () => {
    expect(core.fiatZmwToSats(26_000, 2_600_000)).toBe(1_000_000);
  });

  it("floors fractional sats — expected never exceeds the fiat value", () => {
    // 100 ZMW at 2,600,000 ZMW/BTC = 3846.1538… sats → 3846.
    expect(core.fiatZmwToSats(100, 2_600_000)).toBe(3846);
    // 1 ZMW at 3 ZMW/BTC = 33333333.33… → 33333333.
    expect(core.fiatZmwToSats(1, 3)).toBe(33_333_333);
  });

  it("rejects non-positive inputs", () => {
    expect(() => core.fiatZmwToSats(0, 2_600_000)).toThrow();
    expect(() => core.fiatZmwToSats(100, 0)).toThrow();
    expect(() => core.fiatZmwToSats(-5, 2_600_000)).toThrow();
  });
});

describe("payment classification (exact integer comparison)", () => {
  it("exact amount is paid", () => {
    expect(core.classifyPayment(1000, 1000)).toBe("paid");
  });
  it("one sat short is underpaid", () => {
    expect(core.classifyPayment(1000, 999)).toBe("underpaid");
  });
  it("one sat over is overpaid", () => {
    expect(core.classifyPayment(1000, 1001)).toBe("overpaid");
  });
  it("zero received is underpaid, not an error", () => {
    expect(core.classifyPayment(1000, 0)).toBe("underpaid");
  });
  it("rejects a non-positive expectation", () => {
    expect(() => core.classifyPayment(0, 0)).toThrow();
  });
});

describe("sats → BTC string + BIP21", () => {
  it("formats exact decimal amounts without floats", () => {
    expect(core.satsToBtcString(0)).toBe("0");
    expect(core.satsToBtcString(100_000_000)).toBe("1");
    expect(core.satsToBtcString(150_000_000)).toBe("1.5");
    expect(core.satsToBtcString(1000)).toBe("0.00001");
    expect(core.satsToBtcString(3846)).toBe("0.00003846");
    expect(core.satsToBtcString(1)).toBe("0.00000001");
    expect(core.satsToBtcString(123_456_789)).toBe("1.23456789");
  });

  it("builds a BIP21 URI with amount and encoded reference label", () => {
    const uri = core.bip21Uri("bc1qexampleaddress", 1000, "Till 4 / order #9");
    expect(uri).toBe(
      "bitcoin:bc1qexampleaddress?amount=0.00001&label=Till%204%20%2F%20order%20%239",
    );
  });

  it("omits the label when none is given", () => {
    expect(core.bip21Uri("bc1qexampleaddress", 100_000_000)).toBe(
      "bitcoin:bc1qexampleaddress?amount=1",
    );
  });
});

describe("merchant reference + fiat normalisation", () => {
  it("trims and accepts ordinary till references", () => {
    expect(core.normaliseMerchantReference("  TILL4-0091 ")).toBe("TILL4-0091");
    expect(core.normaliseMerchantReference("Order #4521 (counter)")).toBe("Order #4521 (counter)");
  });
  it("rejects empty, over-long and control-character references", () => {
    expect(core.normaliseMerchantReference("   ")).toBeNull();
    expect(core.normaliseMerchantReference("x".repeat(65))).toBeNull();
    expect(core.normaliseMerchantReference("bad\nref")).toBeNull();
    expect(core.normaliseMerchantReference(42)).toBeNull();
  });
  it("rounds fiat to whole ngwee and enforces the cap", () => {
    expect(core.normaliseFiatZmw(25.5)).toBe(25.5);
    expect(core.normaliseFiatZmw("25.554")).toBe(25.55);
    expect(core.normaliseFiatZmw(0)).toBeNull();
    expect(core.normaliseFiatZmw(-1)).toBeNull();
    expect(core.normaliseFiatZmw(1_000_001)).toBeNull();
    expect(core.normaliseFiatZmw("abc")).toBeNull();
  });
});

describe("API keys (hashing + generation)", () => {
  it("sha256Hex matches the published SHA-256 test vector for 'abc'", async () => {
    await expect(core.sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("generates bmp_pos_ keys whose stored hash never equals the plain key", async () => {
    const { plain, displayPrefix } = core.generatePosApiKey();
    expect(plain.startsWith("bmp_pos_")).toBe(true);
    expect(plain.length).toBe(8 + 64);
    expect(displayPrefix).toBe(plain.slice(0, 16));
    const hash = await core.sha256Hex(plain);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(plain);
    expect(core.isPosApiKey(plain)).toBe(true);
    expect(core.isPosApiKey("bmp_live_something")).toBe(false);
    expect(core.timingSafeEqual(hash, hash)).toBe(true);
    expect(core.timingSafeEqual(hash, await core.sha256Hex(plain + "x"))).toBe(false);
  });

  it("two generated keys differ", () => {
    expect(core.generatePosApiKey().plain).not.toBe(core.generatePosApiKey().plain);
  });
});

describe("statement summary + txid shortening", () => {
  // K100 at K10,000,000/BTC = 1,000 sats (the P2P fixture rate).
  const rows = [
    { status: "paid", fiat_amount_zmw: 100, sats_expected: 1000, sats_received: 1000, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
    { status: "underpaid", fiat_amount_zmw: 100, sats_expected: 1000, sats_received: 500, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
    { status: "overpaid", fiat_amount_zmw: 50, sats_expected: 500, sats_received: 600, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
    { status: "awaiting_payment", fiat_amount_zmw: 75, sats_expected: 750, sats_received: null, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
    { status: "expired", fiat_amount_zmw: 20, sats_expected: 200, sats_received: null, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
  ];

  it("collects the kwacha value of what ARRIVED, at the locked rates", () => {
    const s = core.summarisePosRequests(rows);
    expect(s.requestCount).toBe(5);
    expect(s.paidCount).toBe(1);
    expect(s.settledCount).toBe(3);
    // (1000 + 500 + 600) sats at K10,000,000/BTC = K210.00 exactly.
    expect(s.totalReceivedSats).toBe(2100);
    expect(s.totalCollectedZmw).toBe(210);
    expect(s.averageRateZmw).toBe(10_000_000);
  });

  it("an empty period summarises to zeros and a null average rate", () => {
    const s = core.summarisePosRequests([]);
    expect(s).toEqual({
      requestCount: 0, paidCount: 0, settledCount: 0,
      totalCollectedZmw: 0, totalReceivedSats: 0, averageRateZmw: null,
    });
  });

  it("shortens long txids and leaves short ones whole", () => {
    const txid = "a".repeat(64);
    expect(core.shortenTxid(txid)).toBe("aaaaaaaaaa…aaaaaaaa");
    expect(core.shortenTxid("abc123")).toBe("abc123");
    expect(core.shortenTxid(null)).toBe("");
  });
});

describe("frontend statement mirror parity (src/utils/posStatement)", () => {
  it("summariseForStatement agrees with pos-core on shared fixtures", async () => {
    const stmtPath = path.resolve(here, "../../src/utils/posStatement.ts");
    const source = fs.readFileSync(stmtPath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    const tmp = path.join(here, ".tmp-pos-statement.mjs");
    fs.writeFileSync(tmp, outputText);
    const stmt = await import(tmp);
    const rows = [
      { status: "paid", fiat_amount_zmw: 100, sats_expected: 1000, sats_received: 1000, btc_zmw_rate: 10_000_000, btc_zmw_rate_at_payment: null },
      { status: "underpaid", fiat_amount_zmw: 100, sats_expected: 1000, sats_received: 999, btc_zmw_rate: 9_500_000, btc_zmw_rate_at_payment: 9_500_000 },
      { status: "cancelled", fiat_amount_zmw: 10, sats_expected: 100, sats_received: null, btc_zmw_rate: 9_500_000, btc_zmw_rate_at_payment: null },
    ];
    expect(stmt.summariseForStatement(rows)).toEqual(core.summarisePosRequests(rows));
    // The HTML builders produce complete standalone documents.
    const html = stmt.buildPosStatementHtml({
      merchantName: "Proof Shop", merchantEmail: "proof@example.com",
      periodFrom: "2026-10-01T00:00:00.000Z", periodTo: "2026-10-31T23:59:59.999Z",
      generatedAt: new Date("2026-10-23T10:00:00.000Z"),
      rows: rows.map((r, i) => ({
        ...r, created_at: "2026-10-20T09:00:00.000Z",
        merchant_reference: `TILL-${i + 1}`, txid: "a".repeat(64),
        confirmations_at_detection: 1, paid_at: "2026-10-20T09:11:00.000Z",
      })),
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("BMaGlass Pay");
    expect(html).toContain("TILL-1");
    expect(html).toContain("Page ");
  });
});

describe("CSV export shape", () => {
  const row = {
    created_at: "2026-10-23T09:15:00.000Z",
    merchant_reference: "TILL4-0091",
    status: "paid",
    fiat_amount_zmw: 100,
    sats_expected: 1000,
    sats_received: 1000,
    btc_zmw_rate: 10_000_000,
    txid: "abc123",
    confirmations_at_detection: 1,
    paid_at: "2026-10-23T09:26:11.000Z",
  };

  it("emits the contracted header and one line per request", () => {
    const csv = core.requestsToCsv([row]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "date,reference,status,fiat_zmw,sats_expected,sats_received,btc_zmw_rate,txid,confirmations,paid_at",
    );
    expect(lines[1]).toBe(
      "2026-10-23T09:15:00.000Z,TILL4-0091,paid,100.00,1000,1000,10000000.00,abc123,1,2026-10-23T09:26:11.000Z",
    );
  });

  it("leaves payment fields blank for an unpaid request", () => {
    const csv = core.requestsToCsv([
      { ...row, status: "awaiting_payment", sats_received: null, txid: null, confirmations_at_detection: null, paid_at: null },
    ]);
    const line = csv.trimEnd().split("\n")[1];
    expect(line).toBe(
      "2026-10-23T09:15:00.000Z,TILL4-0091,awaiting_payment,100.00,1000,,10000000.00,,,",
    );
  });

  it("quotes and escapes references containing commas and quotes", () => {
    const csv = core.requestsToCsv([
      { ...row, merchant_reference: 'Order "A", counter' },
    ]);
    const line = csv.trimEnd().split("\n")[1];
    expect(line).toContain('"Order ""A"", counter"');
  });

  it("an empty export is just the header", () => {
    expect(core.requestsToCsv([])).toBe(core.POS_CSV_HEADER + "\n");
  });
});
