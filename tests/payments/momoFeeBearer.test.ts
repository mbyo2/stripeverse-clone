// Fee-bearer choice for mobile-money collections (CEO decision
// 2026-11-12: "Make it put if the additional charges be deducted
// from the buyer or the seller just like the way Lenco does it so
// as the seller just receives the amount of the product";
// build = migration 20261266).
//
// The merchant chooses, once, who pays the 1% service charge:
//   seller (default, today's behaviour) — the buyer pays the
//     product amount; the 1% is collected from the seller's wallet
//     after settlement (migration 20261263).
//   buyer — the buyer is charged the product amount PLUS the 1%
//     service charge on top; the seller receives the full product
//     amount (wallet credited with the grossed collection, the 1%
//     auto-collected from it — net exactly the product amount).
//
// Semantics pinned here (source pins, the repo pattern for
// database behaviour; the end-to-end behaviour itself is proven
// live in sandbox: buyer K100 → K101 → net K100; seller K100 →
// net K99; replay; developer-API create):
//   1. The charge is ALWAYS 1% of the product (base) amount —
//      never of the grossed total a buyer-bears collection charges
//      on top (K100 product → K1.00, not 1% of K101 = K1.01).
//   2. The gross-up lives in ONE place (momoBuyerTotalFor) and is
//      applied in ONE choke point (startCollection): every caller
//      — website checkout, payment links, developer API — inherits
//      the same amounts and the same rail bearer.
//   3. The rail bearer follows the choice: buyer → 'customer',
//      seller → 'merchant'. Nothing hardcodes 'merchant' any more.
//   4. The ledger records base_amount on every collection; settle
//      charges on it, counts it in payment-link totals, and returns
//      it; every payment_link.paid dispatch reports the fee from
//      the base amount.
//   5. The setting is merchant-level, server-side, default seller;
//      the connector config exposes it read-only so plugins render
//      the buyer's true total; the checkout shows product + service
//      charge + total before the buyer pays.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  momoBuyerTotalFor,
  platformChargeFor,
} from "../../supabase/functions/_shared/momo-rail";
import {
  buildConnectorConfig,
  type BusinessFacts,
} from "../../supabase/functions/_shared/connector-config";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migration = read("supabase/migrations/20261266_momo_fee_bearer.sql");
const rail = read("supabase/functions/_shared/momo-rail.ts");
const railServer = read("supabase/functions/_shared/momo-rail-server.ts");
const settings = read("supabase/functions/momo-settings/index.ts");
const checkout = read("supabase/functions/payment-link-checkout/index.ts");
const webhook = read("supabase/functions/momo-webhook/index.ts");
const requery = read("supabase/functions/momo-requery/index.ts");
const collections = read("supabase/functions/momo-collections/index.ts");
const developerApi = read("supabase/functions/developer-api/index.ts");
const settingsUi = read("src/components/business/MobileMoneySettings.tsx");
const linkPayment = read("src/components/payments/MobileMoneyLinkPayment.tsx");
const publicCheckout = read("src/pages/PublicCheckout.tsx");
const openapi = read("public/openapi.json");

const facts = (over: Partial<BusinessFacts> = {}): BusinessFacts => ({
  hasBusinessRecord: true,
  displayName: "QA Store",
  countryIso: "ZM",
  businessStatus: "pending",
  frozen: false,
  mobileMoneyToggleOn: true,
  ...over,
});

describe("buyer totals — the arithmetic", () => {
  it("buyer mode: K100 product → K101 collection, K1.00 charge, seller nets K100", () => {
    const b = momoBuyerTotalFor(100, "buyer");
    expect(b).toEqual({ baseAmount: 100, serviceCharge: 1, total: 101 });
    // The seller is credited the grossed 101 and the 1% charge is
    // auto-collected from it: net exactly the product amount.
    expect(b.total - b.serviceCharge).toBe(100);
  });

  it("seller mode: K100 product → K100 collection, no charge on top, seller nets K99", () => {
    const b = momoBuyerTotalFor(100, "seller");
    expect(b).toEqual({ baseAmount: 100, serviceCharge: 0, total: 100 });
    expect(b.total - platformChargeFor(b.baseAmount)).toBe(99);
  });

  it("buyer mode: K10 product → K10.10 collection, K0.10 charge", () => {
    expect(momoBuyerTotalFor(10, "buyer")).toEqual({ baseAmount: 10, serviceCharge: 0.1, total: 10.1 });
  });

  it("rounds the charge to the ngwee (K33.33 → K0.33 charge, K33.66 total)", () => {
    expect(momoBuyerTotalFor(33.33, "buyer")).toEqual({ baseAmount: 33.33, serviceCharge: 0.33, total: 33.66 });
  });

  it("the charge is 1% of the PRODUCT amount, never of the grossed total", () => {
    // 1% of the grossed K101 would be K1.01 — the charge on a K100
    // product in buyer mode is K1.00, computed on the base.
    expect(platformChargeFor(101)).toBe(1.01);
    expect(momoBuyerTotalFor(100, "buyer").serviceCharge).toBe(1);
    expect(platformChargeFor(100)).toBe(1);
  });
});

describe("schema — migration 20261266", () => {
  it("stores the merchant's choice on merchant_accounts, default seller", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS momo_fee_bearer TEXT NOT NULL DEFAULT 'seller'",
    );
    expect(migration).toContain("CHECK (momo_fee_bearer IN ('seller', 'buyer'))");
  });

  it("adds base_amount to momo_collections and backfills it from amount", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS base_amount NUMERIC(14, 2)");
    expect(migration).toContain("SET base_amount = amount");
    expect(migration).toContain("ALTER COLUMN base_amount SET NOT NULL");
  });

  it("begin accepts the base amount, validates it, and stores it", () => {
    expect(migration).toContain("p_base_amount NUMERIC DEFAULT NULL");
    expect(migration).toContain("p_base_amount > p_amount");
    expect(migration).toContain("v_base_amount := COALESCE(p_base_amount, p_amount);");
    expect(migration).toContain("OR v_existing.base_amount <> v_base_amount");
    expect(migration).toContain("'base_amount', v_base_amount");
  });

  it("drops the superseded 10-argument begin overload (only one begin exists)", () => {
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT);",
    );
  });

  it("settle charges 1% of the base amount, counts the base in link totals, returns the base", () => {
    expect(migration).toContain("v_charge := round(v_collection.base_amount * 0.01, 2);");
    expect(migration).toContain(
      "total_collected = COALESCE(total_collected, 0) + v_collection.base_amount,",
    );
    expect(migration).toContain("base_amount NUMERIC)");
    // The return-type change needs a drop first — in place replace
    // is refused by Postgres.
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT);",
    );
  });

  it("does not change the 1% rate or the full-credit rule", () => {
    expect(migration).toContain("round(v_collection.base_amount * 0.01, 2)");
    expect(migration).toContain("SET balance = balance + v_collection.amount");
    expect(migration).not.toContain("0.025");
    expect(migration).not.toContain("0.015");
  });
});

describe("rail — one choke point, bearer follows the choice", () => {
  it("defines the bearer type and the gross-up helper in the pure module", () => {
    expect(rail).toContain('export type MomoFeeBearer = "seller" | "buyer";');
    expect(rail).toContain("export function momoBuyerTotalFor(");
    expect(rail).toContain('feeBearer === "buyer" ? platformChargeFor(baseAmount) : 0');
  });

  it("loads the merchant's choice server-side, defaulting to seller", () => {
    expect(railServer).toContain("export async function loadFeeBearer(");
    expect(railServer).toContain('.select("momo_fee_bearer")');
    expect(railServer).toContain('data?.momo_fee_bearer === "buyer" ? "buyer" : "seller"');
  });

  it("startCollection grosses up once and passes the base amount to begin", () => {
    expect(railServer).toContain("const feeBearer = await loadFeeBearer(db, input.merchantUserId);");
    expect(railServer).toContain("const breakdown = momoBuyerTotalFor(input.amount, feeBearer);");
    expect(railServer).toContain("p_amount: breakdown.total,");
    expect(railServer).toContain("p_base_amount: breakdown.baseAmount,");
  });

  it("passes the rail bearer from the choice — customer for buyer, merchant for seller", () => {
    expect(railServer).toContain('bearer: feeBearer === "buyer" ? "customer" : "merchant",');
    expect(railServer).toContain("bearer: input.bearer,");
  });

  it("carries base_amount through the settle outcome on every path", () => {
    expect(railServer).toContain("base_amount: number | null;");
    expect(railServer).toContain(
      "base_amount: rpc?.base_amount != null ? Number(rpc.base_amount) : null,",
    );
    expect(railServer).toContain(
      "base_amount: row.base_amount != null ? Number(row.base_amount) : null,",
    );
  });
});

describe("setting — read and write", () => {
  it("status returns the merchant's fee_bearer", () => {
    expect(settings).toContain('.select("id, business_name, address, status, mobile_money_enabled, momo_fee_bearer")');
    expect(settings).toContain('fee_bearer: merchant?.momo_fee_bearer === "buyer" ? "buyer" : "seller",');
  });

  it("update_fee_bearer validates, writes, audits, and refuses frozen accounts", () => {
    expect(settings).toContain('action === "update_fee_bearer"');
    expect(settings).toContain(".update({ momo_fee_bearer: feeBearer })");
    expect(settings).toContain('action: "momo_fee_bearer_changed"');
    expect(settings).toContain("Choose who pays the service charge: the buyer or the seller.");
  });
});

describe("surfaces honour the same choice", () => {
  it("connector config exposes fee_bearer read-only (buyer and default seller)", () => {
    const buyer = buildConnectorConfig({
      environment: "sandbox",
      keyId: "key-1",
      keyScopes: ["config:read"],
      facts: facts({ feeBearer: "buyer" }),
    });
    expect(buyer.features.mobile_money.fee_bearer).toBe("buyer");
    const seller = buildConnectorConfig({
      environment: "sandbox",
      keyId: "key-1",
      keyScopes: ["config:read"],
      facts: facts(),
    });
    expect(seller.features.mobile_money.fee_bearer).toBe("seller");
  });

  it("developer-api reads the choice into business facts and reports the breakdown per collection", () => {
    expect(developerApi).toContain("business_name, address, status, mobile_money_enabled, momo_fee_bearer");
    expect(developerApi).toContain('feeBearer: merchant?.momo_fee_bearer === "buyer" ? "buyer" : "seller",');
    expect(developerApi).toContain("base_amount, currency, operator, phone, status");
    expect(developerApi).toContain("base_amount: baseAmount,");
    expect(developerApi).toContain("service_charge: platformChargeFor(baseAmount),");
    expect(developerApi).toContain("fee_bearer: feeBearer,");
  });

  it("payment-link describe returns the momo fee picture", () => {
    expect(checkout).toContain("momo_fee_bearer: momoFeeBearer,");
    expect(checkout).toContain("momo_service_charge: momoServiceCharge,");
    expect(checkout).toContain("momo_buyer_total: momoBuyerTotal,");
    expect(checkout).toContain('momoFeeBearer === "buyer" ? platformChargeFor(Number(link.amount)) : 0');
  });

  it("payment-link momo_create returns the grossed amount and its breakdown", () => {
    expect(checkout).toContain("amount: result.amount,");
    expect(checkout).toContain("base_amount: result.baseAmount,");
    expect(checkout).toContain("service_charge: result.serviceCharge,");
    expect(checkout).toContain("fee_bearer: result.feeBearer,");
  });

  it("every payment_link.paid dispatch reports the fee from the base amount", () => {
    for (const src of [checkout, webhook, requery]) {
      expect(src).toContain("feeAmount: platformChargeFor(outcome.base_amount ?? outcome.amount),");
      expect(src).not.toContain("feeAmount: platformChargeFor(outcome.amount),");
    }
  });

  it("momo-collections create returns the grossed amount and its breakdown", () => {
    expect(collections).toContain("amount: result.amount,");
    expect(collections).toContain("base_amount: result.baseAmount,");
    expect(collections).toContain("service_charge: result.serviceCharge,");
    expect(collections).toContain("fee_bearer: result.feeBearer,");
  });

  it("merchant settings let the merchant choose, with plain-language copy", () => {
    expect(settingsUi).toContain("FeeBearerSection");
    expect(settingsUi).toContain("Who pays the service charge?");
    expect(settingsUi).toContain("The seller pays (me)");
    expect(settingsUi).toContain("The buyer pays");
    expect(settingsUi).toContain('action: "update_fee_bearer"');
    expect(settingsUi).toContain("Your customers pay the product price plus the charge");
  });

  it("public checkout passes the fee picture into the payment panel", () => {
    expect(publicCheckout).toContain('momo_fee_bearer?: "seller" | "buyer";');
    expect(publicCheckout).toContain("feeBearer={momoFeeBearer}");
    expect(publicCheckout).toContain("serviceCharge={momoServiceCharge}");
    expect(publicCheckout).toContain("buyerTotal={momoBuyerTotal}");
  });

  it("the payment panel shows product + service charge + total and charges the total", () => {
    expect(linkPayment).toContain("Service charge");
    expect(linkPayment).toContain("Total you'll pay");
    expect(linkPayment).toContain("Pay ${currency} ${total.toFixed(2)}");
    expect(linkPayment).toContain('{currency} {total.toFixed(2)} with your mobile money');
  });

  it("openapi documents the new fields on the collection and the config", () => {
    expect(openapi).toContain("when the merchant chose buyer-pays, amount = base_amount + service_charge");
    expect(openapi).toContain("features.mobile_money also carries fee_bearer");
  });
});
