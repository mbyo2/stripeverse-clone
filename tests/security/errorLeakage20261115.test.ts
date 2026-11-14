// Source pins for the Workstream D (2026-11-15) fixes.
//
// These pin the code contracts, not live behaviour (live re-proofs are
// in the mission report). Each pin fails loudly if a future edit
// reintroduces a raw-error return or an unguarded redirect render.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const fn = (p: string) => read(`supabase/functions/${p}`);

// Every money-path function whose catch used to return a raw message.
const GATED_FUNCTIONS = [
  "atomic-transfer/index.ts",
  "internal-transfer/index.ts",
  "savings-transfer/index.ts",
  "wallet-deposit/index.ts",
  "process-payment/index.ts",
  "payment-link-checkout/index.ts",
  "invoice-checkout/index.ts",
  "developer-api/index.ts",
  "btc-onchain/index.ts",
  "btc-trade/index.ts",
  "p2p/index.ts",
  "lightning-service/index.ts",
  "fund-virtual-card/index.ts",
  "create-virtual-card/index.ts",
  "btc-payment/index.ts",
  "currency-convert/index.ts",
  "escrow-settle/index.ts",
];

describe("error leakage — no raw error text reaches a client", () => {
  // btc-payment is excluded here: its fix was dropping the `details`
  // field from a static 500 response, so it needs no helper import.
  const HELPER_FUNCTIONS = GATED_FUNCTIONS.filter((f) => f !== "btc-payment/index.ts");

  it.each(HELPER_FUNCTIONS)("uses the crafted-error gate: %s", (f) => {
    const src = fn(f);
    expect(src).toContain("public-error.ts");
    expect(src).toContain("publicErrorMessage");
  });

  it("btc-payment returns a static error with no details field", () => {
    const src = fn("btc-payment/index.ts");
    expect(src).not.toContain("details: error.message");
    expect(src).toContain("error: 'Internal server error'");
  });

  it("no function throws the raw database error message", () => {
    for (const f of GATED_FUNCTIONS) {
      const src = fn(f);
      expect(src, f).not.toContain("throw new Error(error.message)");
      expect(src, f).not.toContain("throw new Error(linkError.message)");
      expect(src, f).not.toContain("details: error.message");
    }
  });

  it("no function returns a raw caught message as its error field", () => {
    for (const f of GATED_FUNCTIONS) {
      const src = fn(f);
      // A caught message may reach a response ONLY through a
      // sanctioned passthrough: a P0001-gated RPC refusal (our own
      // crafted RAISE text) or a LnurlUserError (crafted LNURL-layer
      // refusal). Anything else is a leak.
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (/error: (e|error)\.message/.test(line)) {
          const ctx = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
          expect(ctx, `${f}:${i + 1}`).toMatch(/P0001|LnurlUserError/);
        }
      });
      expect(src, f).not.toContain("error: errorMessage");
    }
  });

  it("create-virtual-card no longer passes errors through on a substring check", () => {
    const src = fn("create-virtual-card/index.ts");
    expect(src).not.toContain('includes("Invalid")');
  });

  it("RPC failures go through throwRpcError (P0001 discriminator)", () => {
    for (const f of [
      "atomic-transfer/index.ts",
      "internal-transfer/index.ts",
      "savings-transfer/index.ts",
      "payment-link-checkout/index.ts",
      "invoice-checkout/index.ts",
      "currency-convert/index.ts",
    ]) {
      expect(fn(f), f).toContain("throwRpcError");
    }
  });
});

describe("open redirect — payment-link redirect_url", () => {
  it("a migration enforces http(s)-only redirect_url at the database layer", () => {
    const migrations = readdirSync(resolve(root, "supabase/migrations"));
    const migration = migrations.find((m) => m.includes("payment_link_redirect_url"));
    expect(migration).toBeDefined();
    const sql = read(`supabase/migrations/${migration}`);
    expect(sql).toContain("payment_links_redirect_url_https_ck");
    expect(sql).toContain("^https?://");
  });

  it("checkout pages guard the redirect render with isSafeHttpUrl", () => {
    expect(read("src/pages/PublicCheckout.tsx")).toContain("isSafeHttpUrl");
    expect(read("src/components/payments/BitcoinLinkPayment.tsx")).toContain(
      "isSafeHttpUrl(redirectUrl)",
    );
  });

  it("redirect links render only inside an isSafeHttpUrl-gated branch", () => {
    // The href itself is unchanged; the guard lives in the render
    // condition, so a stored javascript:/data: value renders no link.
    const checkout = read("src/pages/PublicCheckout.tsx");
    expect(checkout).toContain("isSafeHttpUrl(linkData?.redirect_url) ? (");
    expect(checkout).not.toContain("{linkData?.redirect_url ? (");
    const btc = read("src/components/payments/BitcoinLinkPayment.tsx");
    const guarded = btc.split("isSafeHttpUrl(redirectUrl) && (").length - 1;
    expect(guarded).toBe(2);
    expect(btc).not.toContain("{redirectUrl && (");
  });
});
