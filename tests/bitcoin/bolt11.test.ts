// Unit tests for decodeBolt11 / isBolt11Expired in
// supabase/functions/_shared/btc-core.ts — the full invoice decode
// the custodial Lightning SEND path validates with before reserving
// any balance (amount, payment hash, description, expiry).
//
// btc-core.ts carries `npm:` specifiers Node cannot resolve, so it
// is loaded with the same rewrite-and-transpile trick as
// tests/bitcoin/btc-core.test.ts / lightning-provider.test.ts.
//
// The two long vectors are REAL invoices issued by the platform's
// own Coinos receive path during the 2026-10-24 contract probes
// (recorded in the Coinos API contract notes): 100 sats each, with
// independently documented payment hashes — the decode is pinned
// against values known outside this codebase.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { bech32 } from "@scure/base";

type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  // "npm:@scure/base@2.4.0" → "@scure/base";
  // "npm:@scure/bip39@2.4.0/wordlists/english.js" → "@scure/bip39/wordlists/english.js"
  const body = spec.slice("npm:".length);
  const versionAt = body.indexOf("@", 1);
  if (versionAt === -1) return body;
  const slashAt = body.indexOf("/", versionAt);
  return slashAt === -1
    ? body.slice(0, versionAt)
    : body.slice(0, versionAt) + body.slice(slashAt);
}

beforeAll(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coreSourcePath = path.resolve(here, "../../supabase/functions/_shared/btc-core.ts");
  const tmpModulePath = path.join(here, ".tmp-btc-core-bolt11.mjs");
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

// 100 sats, memo "BMaGlass contract probe" (contract notes, 2026-10-24).
const INVOICE_A =
  "lnbc1u1p4dexwnsp5agzpxmkqmu6dzf07wpnzazf3gqrjrvzuj99d3qhe80eqa347eu8spp5d7uqmylmwjn6sccyyq5muwrzsazn89uwsrja8z08dph55e3fa9cqhp58lmzukpn9acc0wx03afm03aldggs7m6cqqqy88jxqml3k7a52evsxq9z0rgqcqpnrzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxrktsuqqptgqqqqqqqqqqqqqqqqq9q9qxpqysgqeuw443jnskfra75dvxdc6tnnwl2nscas6xdsr4qf38rhhjwuwr8pudklaemqj3aj86g9jygzxpz99xhqd3xrdsgwn7ekmmthse2trdgqrsec4h";
const HASH_A = "6fb80d93fb74a7a863042029be3862874533978e80e5d389e7686f4a6629e970";
// 100 sats, memo "BMaGlass QA funding target (payer leg)".
const INVOICE_B =
  "lnbc1u1p4dex3jsp5ynsux39fq397yhyda67a2why030kztw5kz9xm9pvwl8gfd8xj6uqpp5d2jqgyzxhcnxsmpznjfju9qt37ndz3wkdydfp6cgmtqw27gcql5qhp5nyp9lyt8vedp87a3rxq94ya0eufnlz4jw8msq8ddqu2ftzcx44vsxq9z0rgqcqpnrzjqw22kc09xj0dm65ew5h5r003vtn72eyzchdgjag66l0yhwdudfmuzr4335qq0fcqqgqqqqqqqqqqq9qq2q9qxpqysgqsl50d7s43p9cnctg5u8zynsdjjen0vxk4dcawkrhldnsvh6h9z4ypf468cmryh8n3hh52yezfx9elyxkqtg4kmmlza77yk5gp9mkhgspj2tkpk";
const HASH_B = "6aa4041046be26686c229c932e140b8fa6d145d6691a90eb08dac0e5791807e8";

// ── In-test invoice builder (for the shapes no live vector covers:
// amount-less, expired, hash-less). The decoder ignores the
// signature words, so zero words stand in for them. ──
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

describe("decodeBolt11 — real provider invoices", () => {
  it("decodes invoice A: 100 sats, documented hash, exact timestamp + 30-day expiry", () => {
    const d = core.decodeBolt11(INVOICE_A);
    expect(d).not.toBeNull();
    expect(d!.amountMsat).toBe(100_000n);
    expect(d!.paymentHash).toBe(HASH_A);
    // Coinos does not embed the memo as a plaintext description
    // field — it is held server-side — so the decode is honestly null.
    expect(d!.description).toBeNull();
    // Created 2026-10-24T11:43:15Z (the contract-probe moment).
    expect(d!.timestampSeconds).toBe(1_792_842_195);
    expect(d!.expirySeconds).toBe(2_592_000);
    expect(d!.expiresAtSeconds).toBe(1_795_434_195);
  });

  it("decodes invoice B: 100 sats, documented hash", () => {
    const d = core.decodeBolt11(INVOICE_B);
    expect(d).not.toBeNull();
    expect(d!.amountMsat).toBe(100_000n);
    expect(d!.paymentHash).toBe(HASH_B);
    expect(d!.description).toBeNull();
    expect(d!.expiresAtSeconds).toBe(d!.timestampSeconds + d!.expirySeconds);
  });

  it("expiry boundary on the real vector: live at creation, expired at expiresAt", () => {
    const d = core.decodeBolt11(INVOICE_A)!;
    expect(core.isBolt11Expired(d, d.timestampSeconds)).toBe(false);
    expect(core.isBolt11Expired(d, d.expiresAtSeconds - 1)).toBe(false);
    expect(core.isBolt11Expired(d, d.expiresAtSeconds)).toBe(true);
  });

  it("accepts the all-uppercase form", () => {
    const d = core.decodeBolt11(INVOICE_A.toUpperCase());
    expect(d?.paymentHash).toBe(HASH_A);
    expect(d?.amountMsat).toBe(100_000n);
  });
});

describe("decodeBolt11 — refusals and edge shapes", () => {
  it("returns null for garbage and for a corrupted checksum", () => {
    expect(core.decodeBolt11("not-an-invoice")).toBeNull();
    expect(core.decodeBolt11("")).toBeNull();
    const corrupted = INVOICE_A.slice(0, -1) + (INVOICE_A.endsWith("q") ? "p" : "q");
    expect(core.decodeBolt11(corrupted)).toBeNull();
  });

  it("decodes an amount-less invoice with amountMsat null (the send path refuses these)", () => {
    const inv = buildInvoice("lnbc", { timestamp: 1_760_000_000, hashHex: HASH_A });
    const d = core.decodeBolt11(inv);
    expect(d).not.toBeNull();
    expect(d!.amountMsat).toBeNull();
    expect(d!.paymentHash).toBe(HASH_A);
  });

  it("decodes a hash-less invoice with paymentHash null (the send path refuses these)", () => {
    const inv = buildInvoice("lnbc1000n", { timestamp: 1_760_000_000, description: "no hash" });
    const d = core.decodeBolt11(inv);
    expect(d).not.toBeNull();
    expect(d!.amountMsat).toBe(100_000n);
    expect(d!.paymentHash).toBeNull();
  });

  it("keeps sub-sat precision: a 10-pico invoice decodes to exactly 1 msat", () => {
    const inv = buildInvoice("lnbc10p", { timestamp: 1_760_000_000, hashHex: HASH_A });
    expect(core.decodeBolt11(inv)!.amountMsat).toBe(1n);
  });

  it("defaults expiry to 3600s when the invoice carries no expiry field", () => {
    const inv = buildInvoice("lnbc1000n", { timestamp: 1_760_000_000, hashHex: HASH_A });
    const d = core.decodeBolt11(inv)!;
    expect(d.expirySeconds).toBe(3600);
    expect(d.expiresAtSeconds).toBe(1_760_000_000 + 3600);
  });

  it("honours an explicit expiry field and the expiry boundary", () => {
    const inv = buildInvoice("lnbc1000n", {
      timestamp: 1_700_000_000,
      hashHex: HASH_A,
      expirySeconds: 60,
    });
    const d = core.decodeBolt11(inv)!;
    expect(d.expirySeconds).toBe(60);
    expect(core.isBolt11Expired(d, 1_700_000_059)).toBe(false);
    expect(core.isBolt11Expired(d, 1_700_000_060)).toBe(true);
    expect(core.isBolt11Expired(d, Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("a freshly built invoice is not expired and its description round-trips", () => {
    const now = Math.floor(Date.now() / 1000);
    const inv = buildInvoice("lnbc2500n", {
      timestamp: now,
      hashHex: HASH_B,
      expirySeconds: 3600,
      description: "Coffee — café ☕",
    });
    const d = core.decodeBolt11(inv)!;
    expect(d.amountMsat).toBe(250_000n);
    expect(d.description).toBe("Coffee — café ☕");
    expect(core.isBolt11Expired(d, now)).toBe(false);
  });
});
