// Scan-to-send (CEO ask, 2026-10-25: "For sending bitcoin where is
// scanning of the qr code?"). These tests pin:
//   1. parseQrPayload — the classifier that turns raw scanned text
//      into a destination the send forms can fill in, including
//      exact BTC→sats BIP21 amount conversion, and garbage rejection.
//   2. The wiring — a Scan button (QrScanButton) beside the
//      destination field in BOTH Bitcoin send forms (self-custody
//      unified send and custodial on-chain send), filling the field
//      only: a scan never parses, prepares, or sends by itself.
//   3. The lazy decoder — html5-qrcode is reached only through a
//      dynamic import() inside the scanner component, so it can
//      never land in the initial or wallet chunks.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseQrPayload, btcAmountToSats } from "../../src/lib/qrScan";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// Bech32 data tails built from the charset itself, so the synthetic
// invoices / LNURLs below are charset-valid by construction.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const TAIL = (CHARSET + CHARSET).slice(0, 60);
const BOLT11 = `lnbc2500u1${TAIL}`;
const LNURL = `lnurl1${TAIL}`;
const BC1Q = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"; // BIP-173 example
const BC1P = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"; // BIP-341 example
const LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";

describe("btcAmountToSats — exact decimal conversion", () => {
  it("converts whole and fractional BTC exactly", () => {
    expect(btcAmountToSats("1")).toBe(100_000_000);
    expect(btcAmountToSats("0.001")).toBe(100_000);
    expect(btcAmountToSats("0.5")).toBe(50_000_000);
    expect(btcAmountToSats(".5")).toBe(50_000_000);
    expect(btcAmountToSats("1.23456789")).toBe(123_456_789);
    expect(btcAmountToSats("21000000")).toBe(2_100_000_000_000_000);
  });

  it("handles the one-satoshi floor exactly (no float drift)", () => {
    expect(btcAmountToSats("0.00000001")).toBe(1);
    expect(btcAmountToSats("0.00000010")).toBe(10);
  });

  it("refuses amounts that cannot be represented exactly", () => {
    expect(btcAmountToSats("0.000000001")).toBeUndefined(); // 9 dp
    expect(btcAmountToSats("abc")).toBeUndefined();
    expect(btcAmountToSats("1e-3")).toBeUndefined();
    expect(btcAmountToSats("-1")).toBeUndefined();
    expect(btcAmountToSats("")).toBeUndefined();
    expect(btcAmountToSats("0")).toBeUndefined();
    expect(btcAmountToSats("0.0")).toBeUndefined();
  });
});

describe("parseQrPayload — plain addresses", () => {
  it("accepts bech32 (bc1q) and taproot (bc1p) addresses", () => {
    expect(parseQrPayload(BC1Q)).toEqual({ kind: "address", destination: BC1Q });
    expect(parseQrPayload(BC1P)).toEqual({ kind: "address", destination: BC1P });
  });

  it("accepts legacy base58 addresses", () => {
    expect(parseQrPayload(LEGACY)).toEqual({ kind: "address", destination: LEGACY });
    expect(parseQrPayload(P2SH)).toEqual({ kind: "address", destination: P2SH });
  });

  it("trims surrounding whitespace and newlines from the scan", () => {
    expect(parseQrPayload(`  ${BC1Q}\n`)).toEqual({ kind: "address", destination: BC1Q });
  });
});

describe("parseQrPayload — BIP21 URIs", () => {
  it("extracts the address and converts the amount to sats", () => {
    expect(parseQrPayload(`bitcoin:${BC1Q}?amount=0.001`)).toEqual({
      kind: "bip21",
      destination: BC1Q,
      amountSats: 100_000,
    });
  });

  it("works without an amount, and ignores label/message params", () => {
    const bare = parseQrPayload(`bitcoin:${LEGACY}`);
    expect(bare.kind).toBe("bip21");
    expect(bare.kind === "bip21" && bare.amountSats).toBeUndefined();
    expect(parseQrPayload(`bitcoin:${P2SH}?amount=0.5&label=Lunch&message=Thanks`)).toEqual({
      kind: "bip21",
      destination: P2SH,
      amountSats: 50_000_000,
    });
  });

  it("drops an unrepresentable amount but keeps the address", () => {
    const parsed = parseQrPayload(`bitcoin:${BC1Q}?amount=abc`);
    expect(parsed.kind).toBe("bip21");
    expect(parsed.kind === "bip21" && parsed.amountSats).toBeUndefined();
    const subSat = parseQrPayload(`bitcoin:${BC1Q}?amount=0.000000001`);
    expect(subSat.kind === "bip21" && subSat.amountSats).toBeUndefined();
  });

  it("accepts an uppercase scheme and address", () => {
    expect(parseQrPayload(`BITCOIN:${BC1Q.toUpperCase()}?amount=0.002`)).toEqual({
      kind: "bip21",
      destination: BC1Q.toUpperCase(),
      amountSats: 200_000,
    });
  });

  it("reads the payment request from a unified QR's lightning parameter", () => {
    expect(parseQrPayload(`bitcoin:?lightning=${BOLT11}`)).toEqual({
      kind: "bolt11",
      destination: BOLT11,
    });
  });

  it("rejects a BIP21 URI whose address part is garbage", () => {
    expect(parseQrPayload("bitcoin:not-an-address!!").kind).toBe("unknown");
    expect(parseQrPayload("bitcoin:").kind).toBe("unknown");
  });
});

describe("parseQrPayload — Lightning payloads", () => {
  it("accepts BOLT11 invoices in lower or upper case", () => {
    expect(parseQrPayload(BOLT11)).toEqual({ kind: "bolt11", destination: BOLT11 });
    const upper = BOLT11.toUpperCase();
    expect(parseQrPayload(upper)).toEqual({ kind: "bolt11", destination: upper });
  });

  it("accepts BOLT11 behind a lightning: prefix", () => {
    expect(parseQrPayload(`lightning:${BOLT11}`)).toEqual({
      kind: "bolt11",
      destination: BOLT11,
    });
    const upper = `LIGHTNING:${BOLT11.toUpperCase()}`;
    expect(parseQrPayload(upper).kind).toBe("bolt11");
  });

  it("accepts LNURLs in lower or upper case, with or without the prefix", () => {
    expect(parseQrPayload(LNURL)).toEqual({ kind: "lnurl", destination: LNURL });
    expect(parseQrPayload(LNURL.toUpperCase()).kind).toBe("lnurl");
    expect(parseQrPayload(`lightning:${LNURL}`)).toEqual({
      kind: "lnurl",
      destination: LNURL,
    });
  });

  it("accepts Lightning addresses and Spark addresses", () => {
    expect(parseQrPayload("satoshi@bmaglasspay.online")).toEqual({
      kind: "lightningAddress",
      destination: "satoshi@bmaglasspay.online",
    });
    const spark = `spark1${TAIL}`;
    expect(parseQrPayload(spark)).toEqual({ kind: "sparkAddress", destination: spark });
  });
});

describe("parseQrPayload — garbage is rejected", () => {
  it("returns unknown for non-destination text", () => {
    for (const junk of [
      "hello world",
      "https://example.com/pay-me",
      "",
      "   ",
      "12345",
      "not-an-email@",
      "bc1qbio", // bech32 shape, forbidden characters (b, i, o)
      "lnbc1qq", // invoice shape, data far too short
      "lnurl1abc", // lnurl shape, invalid characters / too short
      "bitcoin:garbage!!",
    ]) {
      expect(parseQrPayload(junk).kind, junk).toBe("unknown");
    }
  });
});

describe("scan-to-send wiring — both Bitcoin send forms", () => {
  const selfCustody = read("../../src/pages/SelfCustodyWallet.tsx");
  const bitcoinWallet = read("../../src/pages/BitcoinWallet.tsx");
  const scanner = read("../../src/components/QrScanButton.tsx");

  it("self-custody: Scan button sits with the send destination field", () => {
    const sendBlock = selfCustody.slice(
      selfCustody.indexOf("Send to — paste or scan any destination") - 200,
      selfCustody.indexOf('id="sp-send"') + 200,
    );
    expect(sendBlock).toContain("QrScanButton");
    expect(selfCustody).toContain('import { parseQrPayload } from "@/lib/qrScan"');
  });

  it("self-custody: a scan FILLS the field only — no parse, prepare, or send", () => {
    const handler = selfCustody.slice(
      selfCustody.indexOf("const handleScanned"),
      selfCustody.indexOf("const doParseSend"),
    );
    expect(handler).toContain("setSendText(payload.destination)");
    expect(handler).toContain('payload.kind === "bip21"');
    expect(handler).toContain("setSendAmountSats(String(payload.amountSats))");
    // The money path stays user-driven: the handler must not invoke
    // the recogniser or any send step on its own.
    expect(handler).not.toContain("sparkParseInput");
    expect(handler).not.toContain("doPrepareSend");
    expect(handler).not.toContain("doConfirmSend");
    expect(handler).not.toContain("sparkSendPrepared");
  });

  it("custodial: Scan button sits with the on-chain destination field", () => {
    const sendBlock = bitcoinWallet.slice(
      bitcoinWallet.indexOf("function SendOnchain"),
      bitcoinWallet.indexOf("type TradeQuote"),
    );
    expect(sendBlock).toContain("QrScanButton");
    expect(sendBlock).toContain("parseQrPayload");
    expect(sendBlock).toContain('htmlFor="dest"');
  });

  it("custodial: only address payloads are filled; scans never send", () => {
    const handler = bitcoinWallet.slice(
      bitcoinWallet.indexOf("const handleScanned"),
      bitcoinWallet.indexOf("const send = async"),
    );
    expect(handler).toContain("setAddress(payload.destination)");
    expect(handler).toContain("setSats(String(payload.amountSats))");
    expect(handler).not.toContain("supabase");
    expect(handler).not.toContain("invoke");
  });
});

describe("the decoder is lazy — wallet chunks stay lean", () => {
  const scanner = read("../../src/components/QrScanButton.tsx");
  const selfCustody = read("../../src/pages/SelfCustodyWallet.tsx");
  const bitcoinWallet = read("../../src/pages/BitcoinWallet.tsx");

  it("html5-qrcode is reached only through a dynamic import in the scanner", () => {
    expect(scanner).toContain('await import("html5-qrcode")');
    // The only static reference allowed is the erased type-only import.
    for (const line of scanner.split("\n")) {
      if (line.includes('from "html5-qrcode"')) {
        expect(line).toContain("import type");
      }
    }
  });

  it("neither send page references the decoder at all", () => {
    expect(selfCustody).not.toContain("html5-qrcode");
    expect(bitcoinWallet).not.toContain("html5-qrcode");
  });

  it("the scanner prefers the rear camera and always stops the stream", () => {
    expect(scanner).toContain('facingMode: "environment"');
    expect(scanner).toContain("await scanner.stop()");
    expect(scanner).toContain("Scan from an image");
    expect(scanner).toContain("Cancel");
  });
});
