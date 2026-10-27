// Custodial unified paste-anything parsing (close-out B1).
//
// classifySendInput (src/lib/unifiedSendInput.ts) is the single
// classifier the custodial send tabs share. These tests pin:
//   1. Every class: bolt11 (decoded against the REAL Coinos vectors
//      from bolt11.test.ts, and cross-checked against btc-core's own
//      decodeBolt11 so the client mirror can never drift from the
//      server decoder), lightning address, LNURL, on-chain (legacy /
//      P2SH / bc1q / bc1p), and invalid with a plain-language reason.
//   2. The normalisation rules: whitespace, case, lightning: /
//      lnurl:// prefixes, and BIP21 URIs — including the unified
//      form whose `lightning` parameter carries the payment request.
//   3. The money-safety edges: an expired invoice still classifies
//      as bolt11 with `expired` flagged; an amount-less invoice
//      classifies with a null amount; testnet destinations are
//      refused as the wrong network; nothing raw (bech32 / decoder
//      text) ever appears in an invalid reason.
//   4. The wiring: both custodial send tabs classify before they
//      fill or review, route bolt11 → LightningSend and on-chain →
//      the on-chain form, and surface LNURL intents through the
//      onLnurlIntent callback with truthful "being switched on"
//      copy — never a fake send path.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { bech32 } from "@scure/base";
import {
  classifySendInput,
  lnurlIntentOf,
  type UnifiedSendInput,
} from "../../src/lib/unifiedSendInput";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// ── Cross-check loader for the server decoder (same rewrite-and-
// transpile trick as bolt11.test.ts: btc-core carries npm: specifiers).
type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  const body = spec.slice("npm:".length);
  const versionAt = body.indexOf("@", 1);
  if (versionAt === -1) return body;
  const slashAt = body.indexOf("/", versionAt);
  return slashAt === -1
    ? body.slice(0, versionAt)
    : body.slice(0, versionAt) + body.slice(slashAt);
}

beforeAll(async () => {
  const coreSourcePath = path.resolve(here, "../../supabase/functions/_shared/btc-core.ts");
  const tmpModulePath = path.join(here, ".tmp-btc-core-unified.mjs");
  const source = fs.readFileSync(coreSourcePath, "utf8");
  const rewritten = source.replace(
    /from\s+"(npm:[^"]+)"/g,
    (_all, spec: string) => `from "${bareSpecifier(spec)}"`,
  );
  const { outputText } = ts.transpileModule(rewritten, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(tmpModulePath, outputText);
  core = await import(tmpModulePath);
});

// Real 100-sat Coinos invoices (see bolt11.test.ts for provenance).
const INVOICE_A =
  "lnbc1u1p4dexwnsp5agzpxmkqmu6dzf07wpnzazf3gqrjrvzuj99d3qhe80eqa347eu8spp5d7uqmylmwjn6sccyyq5muwrzsazn89uwsrja8z08dph55e3fa9cqhp58lmzukpn9acc0wx03afm03aldggs7m6cqqqy88jxqml3k7a52evsxq9z0rgqcqpnrzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxrktsuqqptgqqqqqqqqqqqqqqqqq9q9qxpqysgqeuw443jnskfra75dvxdc6tnnwl2nscas6xdsr4qf38rhhjwuwr8pudklaemqj3aj86g9jygzxpz99xhqd3xrdsgwn7ekmmthse2trdgqrsec4h";
const HASH_A = "6fb80d93fb74a7a863042029be3862874533978e80e5d389e7686f4a6629e970";
const INVOICE_B =
  "lnbc1u1p4dex3jsp5ynsux39fq397yhyda67a2why030kztw5kz9xm9pvwl8gfd8xj6uqpp5d2jqgyzxhcnxsmpznjfju9qt37ndz3wkdydfp6cgmtqw27gcql5qhp5nyp9lyt8vedp87a3rxq94ya0eufnlz4jw8msq8ddqu2ftzcx44vsxq9z0rgqcqpnrzjqw22kc09xj0dm65ew5h5r003vtn72eyzchdgjag66l0yhwdudfmuzr4335qq0fcqqgqqqqqqqqqqq9qq2q9qxpqysgqsl50d7s43p9cnctg5u8zynsdjjen0vxk4dcawkrhldnsvh6h9z4ypf468cmryh8n3hh52yezfx9elyxkqtg4kmmlza77yk5gp9mkhgspj2tkpk";
const HASH_B = "6aa4041046be26686c229c932e140b8fa6d145d6691a90eb08dac0e5791807e8";

// In-test invoice builder (same construction as bolt11.test.ts).
function timestampWords(ts: number): number[] {
  const words = new Array(7).fill(0);
  let v = ts;
  for (let i = 6; i >= 0; i--) {
    words[i] = v % 32;
    v = Math.floor(v / 32);
  }
  return words;
}
function valueWords(value: number): number[] {
  const words: number[] = [];
  let v = value;
  do {
    words.unshift(v % 32);
    v = Math.floor(v / 32);
  } while (v > 0);
  return words;
}
function tagged(tag: number, data: number[]): number[] {
  return [tag, Math.floor(data.length / 32), data.length % 32, ...data];
}
function buildInvoice(hrp: string, opts: {
  timestamp: number;
  hashHex?: string;
  expirySeconds?: number;
  description?: string;
}): string {
  const words: number[] = [...timestampWords(opts.timestamp)];
  if (opts.hashHex) {
    const bytes = new Uint8Array(
      (opts.hashHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)),
    );
    words.push(...tagged(1, Array.from(bech32.toWords(bytes))));
  }
  if (opts.expirySeconds !== undefined) {
    words.push(...tagged(6, valueWords(opts.expirySeconds)));
  }
  if (opts.description) {
    words.push(...tagged(13, Array.from(bech32.toWords(new TextEncoder().encode(opts.description)))));
  }
  words.push(...new Array(104).fill(0));
  return bech32.encode(hrp, words, 4096);
}

function buildLnurl(url: string): string {
  return bech32.encode(
    "lnurl",
    Array.from(bech32.toWords(new TextEncoder().encode(url))),
    4096,
  );
}

const LNURL_URL = "https://bmaglasspay.online/.well-known/lnurlp/satoshi";
const LNURL = buildLnurl(LNURL_URL);

const BC1Q = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"; // BIP-173 example
const BC1P = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"; // BIP-341 example
const LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";

const NOW = 1_800_000_000; // fixed "now" so expiry flags are deterministic

function expectInvalid(input: string, code: string): void {
  const c = classifySendInput(input, NOW);
  expect(c.kind, input).toBe("invalid");
  if (c.kind === "invalid") {
    expect(c.code, input).toBe(code);
    // Plain language only — never raw decoder / bech32 text.
    expect(c.reason).not.toMatch(/bech32|checksum|hrp|exception|error:/i);
    expect(c.reason.length).toBeGreaterThan(20);
  }
}

describe("classifySendInput — bolt11", () => {
  it("decodes the real vectors: amount, hash, timestamp, expiry", () => {
    const c = classifySendInput(INVOICE_A, 1_792_842_195);
    expect(c.kind).toBe("bolt11");
    if (c.kind !== "bolt11") return;
    expect(c.destination).toBe(INVOICE_A);
    expect(c.amountMsat).toBe(100_000n);
    expect(c.amountSats).toBe(100);
    expect(c.paymentHash).toBe(HASH_A);
    expect(c.timestampSeconds).toBe(1_792_842_195);
    expect(c.expiresAtSeconds).toBe(1_795_434_195);
    expect(c.expired).toBe(false);
  });

  it("agrees with the server decoder (btc-core decodeBolt11) on both vectors", () => {
    for (const [inv, hash] of [[INVOICE_A, HASH_A], [INVOICE_B, HASH_B]] as const) {
      const server = core.decodeBolt11(inv)!;
      const c = classifySendInput(inv, server.timestampSeconds);
      expect(c.kind).toBe("bolt11");
      if (c.kind !== "bolt11") continue;
      expect(c.amountMsat).toBe(server.amountMsat);
      expect(c.paymentHash).toBe(hash);
      expect(c.paymentHash).toBe(server.paymentHash);
      expect(c.description).toBe(server.description);
      expect(c.timestampSeconds).toBe(server.timestampSeconds);
      expect(c.expiresAtSeconds).toBe(server.expiresAtSeconds);
    }
  });

  it("an expired invoice still classifies as bolt11, with expired flagged", () => {
    const old = buildInvoice("lnbc2500u", {
      timestamp: 1_700_000_000,
      hashHex: HASH_A,
      expirySeconds: 60,
    });
    const c = classifySendInput(old, NOW);
    expect(c.kind).toBe("bolt11");
    if (c.kind !== "bolt11") return;
    expect(c.expired).toBe(true);
    expect(c.expiresAtSeconds).toBe(1_700_000_060);
    // …and the same invoice was live inside its window.
    const live = classifySendInput(old, 1_700_000_030);
    expect(live.kind === "bolt11" && live.expired).toBe(false);
  });

  it("an amount-less invoice classifies with a null amount", () => {
    const inv = buildInvoice("lnbc", { timestamp: NOW - 60, hashHex: HASH_B });
    const c = classifySendInput(inv, NOW);
    expect(c.kind).toBe("bolt11");
    if (c.kind !== "bolt11") return;
    expect(c.amountMsat).toBeNull();
    expect(c.amountSats).toBeNull();
    expect(c.paymentHash).toBe(HASH_B);
    expect(c.expired).toBe(false); // default 3600s window
  });

  it("keeps sub-sat amounts honest: msat exact, sats null", () => {
    const inv = buildInvoice("lnbc10p", { timestamp: NOW - 60, hashHex: HASH_A });
    const c = classifySendInput(inv, NOW);
    expect(c.kind === "bolt11" && c.amountMsat).toBe(1n);
    expect(c.kind === "bolt11" && c.amountSats).toBeNull();
  });

  it("accepts the all-uppercase form and the lightning: prefix", () => {
    expect(classifySendInput(INVOICE_A.toUpperCase(), NOW).kind).toBe("bolt11");
    expect(classifySendInput(`lightning:${INVOICE_A}`, NOW).kind).toBe("bolt11");
    expect(classifySendInput(`LIGHTNING:${INVOICE_A.toUpperCase()}`, NOW).kind).toBe("bolt11");
  });

  it("trims whitespace and rescues a line-wrapped invoice", () => {
    expect(classifySendInput(`  ${INVOICE_A}\n`, NOW).kind).toBe("bolt11");
    const wrapped = `${INVOICE_A.slice(0, 60)}\n${INVOICE_A.slice(60)}`;
    expect(classifySendInput(wrapped, NOW).kind).toBe("bolt11");
  });

  it("a corrupted invoice is a malformed-invoice refusal, never a guess", () => {
    const corrupted = INVOICE_A.slice(0, -1) + (INVOICE_A.endsWith("q") ? "p" : "q");
    expectInvalid(corrupted, "malformed-invoice");
    expectInvalid("lnbc1qq", "malformed-invoice");
    expectInvalid("lnbc2500u1qqqq", "malformed-invoice");
  });

  it("a testnet invoice is refused as the wrong network", () => {
    const tb = buildInvoice("lntb2500u", { timestamp: NOW - 60, hashHex: HASH_A });
    expectInvalid(tb, "wrong-network");
    expectInvalid(`lightning:${tb}`, "wrong-network");
  });
});

describe("classifySendInput — on-chain addresses", () => {
  it("classifies legacy, P2SH, segwit and taproot mainnet addresses", () => {
    const cases = [
      [LEGACY, "legacy"],
      [P2SH, "p2sh"],
      [BC1Q, "segwit"],
      [BC1P, "taproot"],
    ] as const;
    for (const [addr, type] of cases) {
      const c = classifySendInput(addr, NOW);
      expect(c.kind, addr).toBe("onchain");
      if (c.kind !== "onchain") continue;
      expect(c.destination).toBe(addr);
      expect(c.addressType).toBe(type);
      expect(c.viaBip21).toBe(false);
      expect(c.amountSats).toBeUndefined();
    }
  });

  it("accepts an all-uppercase bech32 address", () => {
    const c = classifySendInput(BC1Q.toUpperCase(), NOW);
    expect(c.kind).toBe("onchain");
  });

  it("refuses testnet and regtest addresses as the wrong network", () => {
    expectInvalid("tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "wrong-network");
    expectInvalid("bcrt1qar0srrr7xfkvy5l643lydnw9re59gtzzwfw5mdq", "wrong-network");
    expectInvalid("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", "wrong-network"); // testnet legacy
    expectInvalid("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc", "wrong-network"); // testnet P2SH
  });

  it("refuses a mainnet-looking address with a broken checksum", () => {
    const broken = BC1Q.slice(0, -1) + (BC1Q.endsWith("q") ? "p" : "q");
    expectInvalid(broken, "malformed-address");
    expectInvalid("bc1qbio", "malformed-address"); // forbidden bech32 characters
  });
});

describe("classifySendInput — BIP21 URIs", () => {
  it("extracts the address and the exact amount", () => {
    const c = classifySendInput(`bitcoin:${BC1Q}?amount=0.001`, NOW);
    expect(c.kind).toBe("onchain");
    if (c.kind !== "onchain") return;
    expect(c.destination).toBe(BC1Q);
    expect(c.amountSats).toBe(100_000);
    expect(c.viaBip21).toBe(true);
  });

  it("works bare, with an uppercase scheme, and drops inexact amounts", () => {
    expect(classifySendInput(`bitcoin:${LEGACY}`, NOW).kind).toBe("onchain");
    expect(classifySendInput(`BITCOIN:${BC1Q.toUpperCase()}?amount=0.002`, NOW).kind).toBe("onchain");
    const c = classifySendInput(`bitcoin:${BC1Q}?amount=0.000000001`, NOW);
    expect(c.kind === "onchain" && c.amountSats).toBeUndefined();
  });

  it("a unified BIP21 routes to its lightning parameter", () => {
    const c = classifySendInput(`bitcoin:${BC1Q}?amount=0.001&lightning=${INVOICE_A}`, NOW);
    expect(c.kind).toBe("bolt11");
    const bare = classifySendInput(`bitcoin:?lightning=${INVOICE_A}`, NOW);
    expect(bare.kind).toBe("bolt11");
    const lnurl = classifySendInput(`bitcoin:?lightning=${LNURL}`, NOW);
    expect(lnurl.kind).toBe("lnurl");
  });

  it("falls back to the address when the lightning parameter is unusable", () => {
    const c = classifySendInput(`bitcoin:${BC1Q}?lightning=garbage!!`, NOW);
    expect(c.kind).toBe("onchain");
  });

  it("refuses a BIP21 whose address is testnet or garbage", () => {
    expectInvalid("bitcoin:tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.1", "wrong-network");
    expectInvalid("bitcoin:not-an-address!!", "malformed-address");
    expectInvalid("bitcoin:", "unrecognised");
  });
});

describe("classifySendInput — Lightning addresses", () => {
  it("classifies a Lightning address into a typed LNURL intent", () => {
    const c = classifySendInput("satoshi@bmaglasspay.online", NOW);
    expect(c.kind).toBe("lightningAddress");
    expect(lnurlIntentOf(c)).toEqual({
      type: "lightningAddress",
      address: "satoshi@bmaglasspay.online",
      username: "satoshi",
      domain: "bmaglasspay.online",
    });
  });

  it("normalises the domain's case and accepts the lightning: prefix", () => {
    const c = classifySendInput("lightning:Satoshi@BMaGlassPay.ONLINE", NOW);
    expect(c.kind).toBe("lightningAddress");
    const intent = lnurlIntentOf(c);
    expect(intent?.type).toBe("lightningAddress");
    if (intent?.type === "lightningAddress") expect(intent.domain).toBe("bmaglasspay.online");
  });

  it("accepts plus-addressing and dotted names", () => {
    expect(classifySendInput("first.last+tips@wallet.example.co.zm", NOW).kind).toBe("lightningAddress");
  });

  it("refuses malformed Lightning addresses with the address-specific reason", () => {
    for (const bad of [
      "@bmaglasspay.online", // no name
      "satoshi@", // no domain
      "satoshi@bmaglasspay", // no top-level domain
      "satoshi@bmaglasspay.o", // one-letter TLD
      "satoshi@@bmaglasspay.online", // two @s
      "satoshi banda@bmaglasspay.online", // space in the name
      ".satoshi@bmaglasspay.online", // leading dot
      "satoshi@-bmaglasspay.online", // domain label starting with a hyphen
      "satoshi@bmaglasspay..online", // empty domain label
    ]) {
      expectInvalid(bad, "malformed-lightning-address");
    }
  });
});

describe("classifySendInput — LNURL", () => {
  it("classifies a bech32 LNURL and decodes its URL into the intent", () => {
    const c = classifySendInput(LNURL, NOW);
    expect(c.kind).toBe("lnurl");
    expect(lnurlIntentOf(c)).toEqual({ type: "lnurl", lnurl: LNURL, url: LNURL_URL });
  });

  it("accepts uppercase, the lnurl:// scheme, and the lightning: prefix", () => {
    expect(classifySendInput(LNURL.toUpperCase(), NOW).kind).toBe("lnurl");
    expect(classifySendInput(`lnurl://${LNURL}`, NOW).kind).toBe("lnurl");
    expect(classifySendInput(`lightning:${LNURL}`, NOW).kind).toBe("lnurl");
    const upper = classifySendInput(`LNURL://${LNURL.toUpperCase()}`, NOW);
    expect(upper.kind).toBe("lnurl");
  });

  it("refuses a corrupted or non-URL LNURL", () => {
    const corrupted = LNURL.slice(0, -1) + (LNURL.endsWith("q") ? "p" : "q");
    expectInvalid(corrupted, "malformed-lnurl");
    expectInvalid(buildLnurl("not a url at all"), "malformed-lnurl");
    expectInvalid(buildLnurl("http://example.com/lnurlp/x"), "malformed-lnurl"); // not https
    expectInvalid("lnurl1abc", "malformed-lnurl");
    expectInvalid("lnurl://lnbc2500u1qqqqqqqq", "malformed-lnurl");
  });

  it("allows http only for .onion services", () => {
    const onion = buildLnurl("http://abc123def456.onion/lnurlp/x");
    expect(classifySendInput(onion, NOW).kind).toBe("lnurl");
  });
});

describe("classifySendInput — everything else", () => {
  it("empty input is its own refusal", () => {
    expectInvalid("", "empty");
    expectInvalid("   \n ", "empty");
  });

  it("a Spark address gets the Spark-specific refusal", () => {
    const spark = `spark1${"qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(2)}`;
    expectInvalid(spark, "spark-address");
  });

  it("plain garbage is unrecognised", () => {
    for (const junk of ["hello world", "https://example.com/pay-me", "12345", "send me money please"]) {
      expectInvalid(junk, "unrecognised");
    }
  });

  it("lnurlIntentOf is null for non-LNURL classes", () => {
    expect(lnurlIntentOf(classifySendInput(INVOICE_A, NOW))).toBeNull();
    expect(lnurlIntentOf(classifySendInput(BC1Q, NOW))).toBeNull();
    expect(lnurlIntentOf(classifySendInput("junk", NOW))).toBeNull();
  });
});

describe("unified routing wiring — the custodial send tabs", () => {
  const walletPage = read("../../src/pages/BitcoinWallet.tsx");
  const lightningSend = read("../../src/components/bitcoin/LightningSend.tsx");
  const lib = read("../../src/lib/unifiedSendInput.ts");

  it("both tabs classify with the shared classifier", () => {
    expect(walletPage).toContain("classifySendInput");
    expect(lightningSend).toContain("classifySendInput");
    expect(walletPage).toContain("onLnurlIntent");
    expect(lightningSend).toContain("onLnurlIntent");
  });

  it("the on-chain tab routes a pasted invoice over to LightningSend", () => {
    expect(walletPage).toContain("onRouteBolt11");
    expect(walletPage).toContain("setSendTab(\"lightning\")");
    expect(walletPage).toContain("routedInvoice");
  });

  it("the Lightning tab routes a pasted address over to the on-chain form", () => {
    expect(lightningSend).toContain("onRouteOnchain");
    expect(walletPage).toContain("setSendTab(\"onchain\")");
    expect(walletPage).toContain("routedAddress");
  });

  it("LNURL intents surface truthfully — being switched on, never a fake send", () => {
    expect(walletPage).toContain("Lightning address support is being switched on");
    expect(walletPage).toContain("lnurlIntent");
    // The intent panel offers no send/pay action of its own.
    const panel = walletPage.slice(
      walletPage.indexOf("function LnurlIntentPanel"),
      walletPage.indexOf("function SendOnchain"),
    );
    expect(panel).toContain("being switched on");
    expect(panel).not.toContain("pay_invoice");
    expect(panel).not.toContain("supabase.functions.invoke");
  });

  it("the classifier library itself is pure — no network, no storage, no sends", () => {
    expect(lib).not.toContain("createClient");
    expect(lib).not.toContain("@/integrations");
    expect(lib).not.toContain("fetch(");
    expect(lib).not.toContain("localStorage");
  });
});
