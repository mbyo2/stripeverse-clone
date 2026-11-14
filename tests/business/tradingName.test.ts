// Trading name for merchant accounts (CEO decision 2026-11-14):
// the Business portal shows the merchant's TRADING name, not the
// legally registered business name. The platform owner's portal
// shows "BMaGlass Pay" (trading_name on their merchant_accounts
// row) while the row keeps the registered name
// ("MABVUTO BANDA SCIENCE, INFORMATION TECHNICAL CONSULTANCY")
// exactly as registered.
//
// Pins:
//   1. displayBusinessName: trading name wins; blank trading name
//      falls back to business_name; both missing falls back to the
//      caller-supplied fallback. Whitespace is trimmed.
//   2. hasDistinctTradingName: true only when a trading name is set
//      AND differs from the registered name — i.e. the profile card
//      must also show the "Registered business name: …" line.
//   3. Migration shape (20261268): adds trading_name to
//      merchant_accounts AND to the merchant_accounts_safe view the
//      portal reads through; the view keeps security_invoker and
//      does NOT re-grant anon (20261257 left anon with no SELECT).
//   4. The three display surfaces use the helper (never render
//      business_name directly): Business portal header,
//      BusinessDashboard subhead, Business Profile card (with the
//      registered-name secondary line). The settings sheet writes
//      trading_name only — it must never write business_name on
//      update, so the registered name cannot be renamed from the UI.
//   5. Checkout, receipts and POS never render a business name:
//      Checkout's merchantName is never populated in-app, the POS
//      statement uses the operator's personal name, and no
//      business_name reference exists in any of those files.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  displayBusinessName,
  hasDistinctTradingName,
} from "../../src/utils/merchantDisplay";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const REGISTERED = "MABVUTO BANDA SCIENCE, INFORMATION TECHNICAL CONSULTANCY";
const TRADING = "BMaGlass Pay";

describe("displayBusinessName", () => {
  it("prefers the trading name when set (the CEO's portal case)", () => {
    expect(
      displayBusinessName({ trading_name: TRADING, business_name: REGISTERED }),
    ).toBe(TRADING);
  });

  it("falls back to the registered name when no trading name is set", () => {
    expect(displayBusinessName({ trading_name: null, business_name: "Acme Ltd" })).toBe("Acme Ltd");
    expect(displayBusinessName({ business_name: "Acme Ltd" })).toBe("Acme Ltd");
  });

  it("treats a blank trading name as unset", () => {
    expect(
      displayBusinessName({ trading_name: "   ", business_name: "Acme Ltd" }),
    ).toBe("Acme Ltd");
  });

  it("trims surrounding whitespace", () => {
    expect(
      displayBusinessName({ trading_name: "  BMaGlass Pay  ", business_name: REGISTERED }),
    ).toBe(TRADING);
  });

  it("falls back to the caller-supplied fallback when both names are missing", () => {
    expect(displayBusinessName(null)).toBe("Business Portal");
    expect(displayBusinessName({})).toBe("Business Portal");
    expect(displayBusinessName(null, "Your business")).toBe("Your business");
    expect(displayBusinessName({ trading_name: null, business_name: null })).toBe(
      "Business Portal",
    );
  });
});

describe("hasDistinctTradingName", () => {
  it("is true when the trading name differs from the registered name", () => {
    expect(
      hasDistinctTradingName({ trading_name: TRADING, business_name: REGISTERED }),
    ).toBe(true);
  });

  it("is false when there is no trading name, or it equals the registered name", () => {
    expect(hasDistinctTradingName({ trading_name: null, business_name: "Acme Ltd" })).toBe(false);
    expect(hasDistinctTradingName({ business_name: "Acme Ltd" })).toBe(false);
    expect(
      hasDistinctTradingName({ trading_name: "Acme Ltd", business_name: "Acme Ltd" }),
    ).toBe(false);
    expect(hasDistinctTradingName(null)).toBe(false);
  });
});

describe("migration 20261268 shape", () => {
  const migration = read("supabase/migrations/20261268_merchant_trading_name.sql");

  it("adds trading_name to merchant_accounts", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS trading_name TEXT/i);
  });

  it("recreates merchant_accounts_safe with the new column", () => {
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.merchant_accounts_safe/i);
    // trading_name is last in the select list: CREATE OR REPLACE VIEW
    // matches columns by position, so inserting it mid-list renames
    // business_type (42P16) — that exact mistake was caught live.
    expect(migration).toMatch(/trading_name\s*\nFROM public\.merchant_accounts/);
  });

  it("keeps the view security_invoker and does not re-grant anon", () => {
    expect(migration).toMatch(/security_invoker = true/i);
    expect(migration).toMatch(/GRANT SELECT ON public\.merchant_accounts_safe TO authenticated/i);
    expect(migration).not.toMatch(/TO anon/i);
  });
});

describe("display surfaces use the trading-name helper", () => {
  const business = read("src/pages/Business.tsx");
  const dashboard = read("src/pages/BusinessDashboard.tsx");
  const settings = read("src/components/business/BusinessSettings.tsx");

  it("portal header shows the display name, not business_name", () => {
    expect(business).toContain("displayBusinessName(merchantAccount)");
    expect(business).not.toMatch(/\{merchantAccount\?\.business_name \|\| 'Business Portal'\}/);
  });

  it("profile card shows the display name plus the registered-name line", () => {
    expect(business).toContain("Registered business name: ${merchantAccount.business_name}");
    expect(business).toContain("hasDistinctTradingName(merchantAccount)");
  });

  it("dashboard subhead shows the display name", () => {
    expect(dashboard).toContain("displayBusinessName(merchantAccount, 'Your business')");
    expect(dashboard).not.toContain("merchantAccount?.business_name");
  });

  it("settings sheet writes trading_name and never business_name on update", () => {
    expect(settings).toContain("trading_name: tradingName");
    expect(settings).not.toMatch(/\.update\(\{\s*[^}]*business_name:/s);
    expect(settings).toContain('name="tradingName"');
  });
});

describe("checkout / receipts / POS show no business name", () => {
  const files = [
    "src/pages/Checkout.tsx",
    "src/pages/BitcoinPos.tsx",
    "src/pages/PaymentSuccess.tsx",
    "src/utils/posStatement.ts",
  ];
  for (const f of files) {
    it(`${f} has no business_name reference`, () => {
      expect(read(f)).not.toContain("business_name");
    });
  }

  it("Checkout's merchantName is never populated in-app", () => {
    for (const f of ["src/pages/Checkout.tsx", "src/pages/PaymentLinks.tsx"]) {
      expect(read(f)).not.toMatch(/merchantName:\s*\S/);
    }
  });
});
