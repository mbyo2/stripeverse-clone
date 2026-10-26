// Unit tests for supabase/functions/_shared/lightning-provider.ts —
// the Coinos provider leg behind the breez-lightning edge function.
// The module is dependency-free, so it is imported directly (same
// pattern as tests/admin/accountFreeze.test.ts). Fetch is stubbed;
// no network is touched.

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  LightningNotConfiguredError,
  LightningUpstreamError,
  PROVIDER_PAY_CONFIRMED,
  lightningProviderConfigured,
  parseCoinosInvoice,
  parseCoinosInvoiceAmounts,
  parseCoinosInvoiceState,
  parseCoinosOutgoingPayment,
  parseCoinosPaymentHash,
  providerCreateInvoice,
  providerGetInvoice,
  providerGetOutgoingPayment,
  providerPayInvoice,
  readLightningProviderConfig,
} from "../../supabase/functions/_shared/lightning-provider";

// decodeBolt11Msat lives in btc-core.ts, whose `npm:` specifiers Node
// cannot resolve — load it with the same rewrite-and-transpile trick
// as tests/bitcoin/btc-core.test.ts.
type Core = typeof import("../../supabase/functions/_shared/btc-core");
let core: Core;

function bareSpecifier(spec: string): string {
  const m = spec.match(/^npm:((?:@[^/]+\/)?[^@/]+)(?:@[^/"]+)?(\/.*)?$/);
  if (!m) return spec;
  return m[1] + (m[2] ?? "");
}

beforeAll(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coreSourcePath = path.resolve(here, "../../supabase/functions/_shared/btc-core.ts");
  const tmpModulePath = path.join(here, ".tmp-btc-core-ln.mjs");
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

const CFG = { provider: "coinos", token: "test-token", base: "https://coinos.test/api" };

// HRP-only bolt11 strings: decodeBolt11Msat reads the amount from the
// human-readable part, which is all the amount guard in breez-lightning
// looks at. lnbc1000n = 100 sats, lnbc2000n = 200 sats.
const BOLT11_100 = "lnbc1000n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9qy9qsq";
const BOLT11_200 = "lnbc2000n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9qy9qsq";

function stubFetch(status: number, payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider configuration gate", () => {
  it("is configured only for coinos with a token", () => {
    expect(lightningProviderConfigured(CFG)).toBe(true);
    expect(lightningProviderConfigured({ ...CFG, token: null })).toBe(false);
    expect(lightningProviderConfigured({ ...CFG, token: "  " })).toBe(false);
    expect(lightningProviderConfigured({ ...CFG, provider: "breez" })).toBe(false);
    expect(lightningProviderConfigured({ ...CFG, provider: null })).toBe(false);
  });

  it("reads config from an env map with the Coinos default base", () => {
    const cfg = readLightningProviderConfig({
      LIGHTNING_PROVIDER: "Coinos",
      COINOS_API_TOKEN: "tok",
    });
    expect(cfg.provider).toBe("coinos");
    expect(cfg.token).toBe("tok");
    expect(cfg.base).toBe("https://coinos.io/api");
    const override = readLightningProviderConfig({
      LIGHTNING_PROVIDER: "coinos",
      COINOS_API_TOKEN: "tok",
      COINOS_API_BASE: "https://example.test/api/",
    });
    expect(override.base).toBe("https://example.test/api");
  });
});

describe("Coinos invoice response mapping", () => {
  // The live-verified Coinos shape (2026-10-24): bolt11 in `text`,
  // payment hash in `paymentHash`, lookup key in `id` — and the
  // `hash` field is a DUPLICATE of the bolt11 string, not a hash.
  const HASH64 = "a".repeat(64);

  it("maps the live invoice shape (id = lookup key, paymentHash = hash)", () => {
    const inv = parseCoinosInvoice({
      id: "69c5e5d1-0b16-44b2-95f3-8cea33dba6ed",
      text: BOLT11_100,
      hash: BOLT11_100,
      paymentHash: HASH64,
      amount: 100,
    });
    expect(inv).toEqual({
      bolt11: BOLT11_100,
      providerId: "69c5e5d1-0b16-44b2-95f3-8cea33dba6ed",
      paymentHash: HASH64,
    });
  });

  it("never treats the bolt11-duplicate `hash` field as a payment hash", () => {
    const inv = parseCoinosInvoice({ id: "inv-1", text: BOLT11_100, hash: BOLT11_100 });
    expect(inv?.providerId).toBe("inv-1");
    expect(inv?.paymentHash).toBeNull();
  });

  it("accepts a genuine 64-hex `hash` field as the payment hash", () => {
    const inv = parseCoinosInvoice({ id: "inv-2", text: BOLT11_100, hash: HASH64 });
    expect(inv?.paymentHash).toBe(HASH64);
  });

  it("maps a response nested under `invoice`", () => {
    const inv = parseCoinosInvoice({ invoice: { id: "inv-3", text: BOLT11_100, paymentHash: HASH64 } });
    expect(inv?.bolt11).toBe(BOLT11_100);
    expect(inv?.providerId).toBe("inv-3");
    expect(inv?.paymentHash).toBe(HASH64);
  });

  it("returns null when no invoice id is present — the payment hash is never a lookup key", () => {
    // The contract proves GET /invoice/<paymentHash> returns 500:
    // the hash is an identity for matching, not a status key. An
    // invoice payload without an `id` is incomplete.
    expect(parseCoinosInvoice({ text: BOLT11_100, paymentHash: HASH64 })).toBeNull();
  });

  it("ignores a non-64-hex `paymentHash` field — the guard applies to it as to `hash`", () => {
    const inv = parseCoinosInvoice({ id: "inv-4", text: BOLT11_100, paymentHash: "not-a-hash" });
    expect(inv?.paymentHash).toBeNull();
    // A genuine 64-hex `hash` still wins over a bogus paymentHash.
    const inv2 = parseCoinosInvoice({
      id: "inv-5", text: BOLT11_100, paymentHash: "not-a-hash", hash: HASH64,
    });
    expect(inv2?.paymentHash).toBe(HASH64);
  });

  it("returns null for incomplete or malformed payloads", () => {
    expect(parseCoinosInvoice({ paymentHash: HASH64 })).toBeNull();
    expect(parseCoinosInvoice({ text: BOLT11_100 })).toBeNull();
    expect(parseCoinosInvoice(null)).toBeNull();
    expect(parseCoinosInvoice("nope")).toBeNull();
    expect(parseCoinosInvoice([])).toBeNull();
  });
});

describe("Coinos invoice state mapping", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");

  it("maps received >= amount to paid (the live-verified shape)", () => {
    expect(parseCoinosInvoiceState({ amount: 100, received: 100 }, now)).toBe("paid");
    expect(parseCoinosInvoiceState({ amount: 100, received: 150 }, now)).toBe("paid");
    expect(parseCoinosInvoiceState({ amount: 100, received: 99 }, now)).toBe("pending");
    expect(parseCoinosInvoiceState({ amount: 100, received: 0 }, now)).toBe("pending");
    expect(parseCoinosInvoiceState({ amount: 0, received: 0 }, now)).toBe("pending");
  });

  it("maps settled invoices to paid", () => {
    expect(parseCoinosInvoiceState({ settled: true }, now)).toBe("paid");
    expect(parseCoinosInvoiceState({ status: "paid" }, now)).toBe("paid");
    expect(parseCoinosInvoiceState({ preimage: "00ff" }, now)).toBe("paid");
  });

  it("maps explicitly expired invoices to expired", () => {
    expect(parseCoinosInvoiceState({ status: "expired" }, now)).toBe("expired");
    expect(parseCoinosInvoiceState({ expired: true }, now)).toBe("expired");
  });

  it("maps an unpaid invoice past its expiry window to expired", () => {
    // created 2h ago (epoch seconds), expiry 3600s → expired 1h ago.
    const created = Math.floor(now / 1000) - 7200;
    expect(parseCoinosInvoiceState({ created, expiry: 3600 }, now)).toBe("expired");
  });

  it("maps the LIVE epoch-milliseconds `created` shape against the expiry window", () => {
    // The live-verified contract: `created` is epoch MILLISECONDS
    // and `expiry` a duration in seconds (2592000 = 30 days).
    const createdMs = now - 7_200_000; // 2h ago, in ms
    expect(parseCoinosInvoiceState({ created: createdMs, expiry: 3600 }, now)).toBe("expired");
    expect(parseCoinosInvoiceState({ created: createdMs, expiry: 2592000 }, now)).toBe("pending");
    const createdRecentMs = now - 600_000; // 10 min ago, in ms
    expect(parseCoinosInvoiceState({ created: createdRecentMs, expiry: 3600 }, now)).toBe("pending");
  });

  it("never reads `expiry` as an absolute timestamp — without `created` it cannot expire", () => {
    // A duration misread as an epoch would call this long-expired;
    // per the contract `expiry` is seconds-from-created only.
    expect(parseCoinosInvoiceState({ expiry: 1_700_000_000 }, now)).toBe("pending");
    expect(parseCoinosInvoiceState({ expiry: 2592000 }, now)).toBe("pending");
  });

  it("still honours an absolute `expires_at` timestamp", () => {
    expect(parseCoinosInvoiceState({ expires_at: "2026-10-24T11:00:00Z" }, now)).toBe("expired");
    expect(parseCoinosInvoiceState({ expires_at: "2026-10-24T13:00:00Z" }, now)).toBe("pending");
  });

  it("maps an unpaid invoice inside its expiry window to pending", () => {
    const created = Math.floor(now / 1000) - 600;
    expect(parseCoinosInvoiceState({ created, expiry: 3600 }, now)).toBe("pending");
    expect(parseCoinosInvoiceState({ settled: false }, now)).toBe("pending");
    expect(parseCoinosInvoiceState({}, now)).toBe("pending");
    expect(parseCoinosInvoiceState(null, now)).toBe("pending");
  });

  it("paid wins over an elapsed expiry window", () => {
    const created = Math.floor(now / 1000) - 7200;
    expect(parseCoinosInvoiceState({ settled: true, created, expiry: 3600 }, now)).toBe("paid");
  });
});

describe("Coinos payment hash mapping", () => {
  it("extracts the hash from flat and nested payment payloads", () => {
    expect(parseCoinosPaymentHash({ hash: "d".repeat(64) })).toBe("d".repeat(64));
    expect(parseCoinosPaymentHash({ paymentHash: "e".repeat(64) })).toBe("e".repeat(64));
    expect(parseCoinosPaymentHash({ payment: { payment_hash: "f".repeat(64) } })).toBe("f".repeat(64));
    // A bolt11-shaped `hash` field is not a payment hash.
    expect(parseCoinosPaymentHash({ hash: BOLT11_100 })).toBeNull();
    // Neither is a non-64-hex `paymentHash` field — same guard.
    expect(parseCoinosPaymentHash({ paymentHash: "not-a-hash" })).toBeNull();
    expect(parseCoinosPaymentHash({})).toBeNull();
    expect(parseCoinosPaymentHash(null)).toBeNull();
  });
});

describe("provider calls (stubbed fetch)", () => {
  it("creates an invoice with the Coinos request shape and maps the response", async () => {
    const fetchMock = stubFetch(200, {
      id: "inv-uuid-1",
      text: BOLT11_100,
      hash: BOLT11_100,
      paymentHash: "b".repeat(64),
      amount: 100,
    });
    const inv = await providerCreateInvoice(100, "Deposit test", CFG);
    expect(inv).toEqual({ bolt11: BOLT11_100, providerId: "inv-uuid-1", paymentHash: "b".repeat(64) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://coinos.test/api/invoice");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(JSON.parse(init.body as string)).toEqual({
      invoice: { amount: 100, currency: "SAT", memo: "Deposit test" },
    });
  });

  it("maps an upstream error to LightningUpstreamError without leaking through", async () => {
    stubFetch(500, "internal coinos detail");
    await expect(providerCreateInvoice(100, "x", CFG)).rejects.toBeInstanceOf(LightningUpstreamError);
  });

  it("refuses an incomplete invoice payload as an upstream error", async () => {
    stubFetch(200, { amount: 100 });
    await expect(providerCreateInvoice(100, "x", CFG)).rejects.toBeInstanceOf(LightningUpstreamError);
  });

  it("throws LightningNotConfiguredError when unconfigured", async () => {
    stubFetch(200, {});
    await expect(
      providerCreateInvoice(100, "x", { provider: null, token: null, base: CFG.base }),
    ).rejects.toBeInstanceOf(LightningNotConfiguredError);
  });

  it("fetches invoice state by invoice id; the payment hash is never fabricated from the id", async () => {
    const fetchMock = stubFetch(200, { id: "inv-uuid-1", amount: 100, received: 0 });
    const res = await providerGetInvoice("inv-uuid-1", CFG);
    expect(res.state).toBe("pending");
    // The invoice id is a UUID, not a payment hash — when the payload
    // carries no paymentHash, none is invented.
    expect(res.paymentHash).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://coinos.test/api/invoice/inv-uuid-1");
    expect(init.method).toBe("GET");
  });

  it("returns the payload's own payment hash when the invoice carries one", async () => {
    stubFetch(200, {
      id: "inv-uuid-2", text: BOLT11_100, paymentHash: "a".repeat(64), amount: 100, received: 100,
    });
    const res = await providerGetInvoice("inv-uuid-2", CFG);
    expect(res.state).toBe("paid");
    expect(res.paymentHash).toBe("a".repeat(64));
  });

  it("pays an invoice: a 2xx is classified accepted, with the hash when present", async () => {
    const fetchMock = stubFetch(200, { paymentHash: "c".repeat(64) });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res).toEqual({ kind: "accepted", paymentHash: "c".repeat(64) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://coinos.test/api/payments");
    expect(JSON.parse(init.body as string)).toEqual({ payment: { text: BOLT11_100 } });
  });
});

describe("providerPayInvoice outcome classification (send-path safety)", () => {
  // The classification IS the money safety: only "rejected" may
  // release a reservation. Everything ambiguous must stay "unknown"
  // so the sats hold for reconciliation — never auto-refunded.
  it("the pay leg is confirmed wired (the designed 503 era is over)", () => {
    expect(PROVIDER_PAY_CONFIRMED).toBe(true);
  });

  it("a 2xx with an EMPTY body is accepted with no hash (the probed Coinos shape)", async () => {
    stubFetch(200, "");
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res).toEqual({ kind: "accepted", paymentHash: null });
  });

  it("a 400 with a structured provider JSON error body is a definitive rejection", async () => {
    stubFetch(400, { message: "insufficient balance" });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("rejected");
  });

  it("a 422 with a structured provider JSON error body is a definitive rejection", async () => {
    stubFetch(422, { error: "invoice is not payable" });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("rejected");
  });

  it("a 408 (request timeout) is unknown — the payment may have been taken", async () => {
    stubFetch(408, { message: "request timeout" });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("a 429 (rate limited) is unknown — never a rejection", async () => {
    stubFetch(429, { message: "too many requests" });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("a 4xx with an HTML body (Cloudflare/proxy answer) is unknown — not a provider verdict", async () => {
    stubFetch(403, "<html><head><title>Attention Required! | Cloudflare</title></head></html>");
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("a 400 with a non-JSON body is unknown — no structured provider verdict", async () => {
    stubFetch(400, "Bad Request");
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("a 400 whose JSON body carries no error field is unknown", async () => {
    stubFetch(400, { unexpected: "shape" });
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("other 4xx statuses are unknown even with a JSON error body (401/404 are not pay verdicts)", async () => {
    stubFetch(401, { message: "unauthorized" });
    expect((await providerPayInvoice(BOLT11_100, CFG)).kind).toBe("unknown");
    stubFetch(404, { message: "not found" });
    expect((await providerPayInvoice(BOLT11_100, CFG)).kind).toBe("unknown");
  });

  it("a 5xx is unknown — never a rejection", async () => {
    stubFetch(500, "internal coinos detail");
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("a network failure is unknown — never a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const res = await providerPayInvoice(BOLT11_100, CFG);
    expect(res.kind).toBe("unknown");
  });

  it("throws LightningNotConfiguredError when unconfigured", async () => {
    stubFetch(200, {});
    await expect(
      providerPayInvoice(BOLT11_100, { provider: null, token: null, base: CFG.base }),
    ).rejects.toBeInstanceOf(LightningNotConfiguredError);
  });
});

describe("parseCoinosOutgoingPayment (the read-back a send settles on)", () => {
  const HASH = "a".repeat(64);

  it("finds no payment in an empty list", () => {
    expect(parseCoinosOutgoingPayment({ payments: [] }, { paymentHash: HASH }))
      .toEqual({ state: "not_found", feeSats: null, paymentHash: null });
  });

  it("ignores payments for other invoices", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ paymentHash: "b".repeat(64), preimage: "ab".repeat(32) }] },
      { paymentHash: HASH },
    );
    expect(res.state).toBe("not_found");
  });

  it("a preimage proves paid; the provider fee is extracted", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ paymentHash: HASH, amount: 100, preimage: "ab".repeat(32), fee: 0 }] },
      { paymentHash: HASH },
    );
    expect(res).toEqual({ state: "paid", feeSats: 0, paymentHash: HASH });
  });

  it("an invoice-shaped entry paid in full reads paid via received ≥ amount", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ text: BOLT11_100, amount: 100, received: 100 }] },
      { bolt11: BOLT11_100 },
    );
    expect(res.state).toBe("paid");
  });

  it("an invoice-shaped entry not yet paid stays pending", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ text: BOLT11_100, amount: 100, received: 0 }] },
      { bolt11: BOLT11_100 },
    );
    expect(res.state).toBe("pending");
  });

  it("a failed status word reads failed", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ paymentHash: HASH, status: "failed" }] },
      { paymentHash: HASH },
    );
    expect(res.state).toBe("failed");
  });

  it("the most terminal state wins across duplicate entries", () => {
    const res = parseCoinosOutgoingPayment(
      {
        payments: [
          { paymentHash: HASH, status: "failed" },
          { paymentHash: HASH, preimage: "cd".repeat(32) },
        ],
      },
      { paymentHash: HASH },
    );
    expect(res.state).toBe("paid");
  });

  it("the `hash` field is NOT trusted as a payment hash when it holds the bolt11", () => {
    // The documented Coinos trap: on invoice objects `hash`
    // duplicates the bolt11 text. Matching must fall back to text.
    const res = parseCoinosOutgoingPayment(
      { payments: [{ hash: BOLT11_100, text: BOLT11_100, amount: 100, received: 100 }] },
      { paymentHash: HASH, bolt11: BOLT11_100 },
    );
    expect(res.state).toBe("paid");
    expect(res.paymentHash).toBeNull();
  });

  it("a non-64-hex `paymentHash` on a payment entry is not trusted as its hash", () => {
    const res = parseCoinosOutgoingPayment(
      { payments: [{ paymentHash: "not-a-hash", text: BOLT11_100, amount: 100, received: 100 }] },
      { paymentHash: HASH, bolt11: BOLT11_100 },
    );
    expect(res.state).toBe("paid");
    expect(res.paymentHash).toBeNull();
  });

  it("providerGetOutgoingPayment reads the payments list and parses it", async () => {
    const fetchMock = stubFetch(200, {
      payments: [{ paymentHash: HASH, preimage: "ab".repeat(32) }],
    });
    const res = await providerGetOutgoingPayment({ paymentHash: HASH }, CFG);
    expect(res.state).toBe("paid");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://coinos.test/api/payments");
    expect(init.method).toBe("GET");
  });

  it("providerGetOutgoingPayment throws upstream on a 5xx (caller holds the send)", async () => {
    stubFetch(500, "boom");
    await expect(providerGetOutgoingPayment({ paymentHash: HASH }, CFG))
      .rejects.toBeInstanceOf(LightningUpstreamError);
  });
});

describe("amount-mismatch refusal (the breez-lightning create guard)", () => {
  // breez-lightning refuses a created invoice whose decoded bolt11
  // amount differs from the requested sats:
  //   decodeBolt11Msat(bolt11) !== BigInt(sats) * 1000n → upstream error
  // These cases pin the guard's inputs: a same-amount invoice passes,
  // a different-amount invoice trips it.
  it("accepts an invoice encoding exactly the requested sats", () => {
    expect(core.decodeBolt11Msat(BOLT11_100)).toBe(BigInt(100) * 1000n);
  });

  it("trips the guard when the provider returns a different amount", () => {
    expect(core.decodeBolt11Msat(BOLT11_200)).not.toBe(BigInt(100) * 1000n);
    expect(core.decodeBolt11Msat("not-an-invoice")).toBeNull();
  });
});

describe("Coinos invoice amounts (protection P1 — settle on actual received)", () => {
  it("reads amount + received from a flat invoice payload", () => {
    expect(parseCoinosInvoiceAmounts({ amount: 6304, received: 6241 }))
      .toEqual({ amountSats: 6304, receivedSats: 6241 });
  });
  it("reads them from a nested invoice payload", () => {
    expect(parseCoinosInvoiceAmounts({ invoice: { amount: 307, received: 307 } }))
      .toEqual({ amountSats: 307, receivedSats: 307 });
  });
  it("a deducted receive reports LESS than the amount — the figure P1 settles on", () => {
    const a = parseCoinosInvoiceAmounts({ amount: 100, received: 99 });
    expect(a.receivedSats).toBe(99);
    expect(a.amountSats).toBe(100);
  });
  it("missing or non-numeric figures come back null, never invented", () => {
    expect(parseCoinosInvoiceAmounts({})).toEqual({ amountSats: null, receivedSats: null });
    expect(parseCoinosInvoiceAmounts({ amount: "6304", received: "6241" }))
      .toEqual({ amountSats: null, receivedSats: null });
    expect(parseCoinosInvoiceAmounts(null)).toEqual({ amountSats: null, receivedSats: null });
    expect(parseCoinosInvoiceAmounts("junk")).toEqual({ amountSats: null, receivedSats: null });
  });
  it("providerGetInvoice returns the amounts alongside the state (stubbed fetch)", async () => {
    stubFetch(200, { id: "inv-uuid-9", text: BOLT11_100, amount: 100, received: 99, settled: false });
    const res = await providerGetInvoice("inv-uuid-9", CFG);
    expect(res.amountSats).toBe(100);
    expect(res.receivedSats).toBe(99);
  });
});
