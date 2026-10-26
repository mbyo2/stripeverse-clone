// Pins for the buyer-pays fee breakdown on the public pay page
// (/pay/:code) — the regression of 2026-10-26.
//
// What broke: the feature (a1376aa) was live and correct in the
// dashboard, but the DEPLOYED payment-link-checkout bundle had been
// assembled from the pre-fee-bearer branch state, so its describe
// action returned the link WITHOUT fee_payer / fee_amount /
// buyer_total. The pay page gates the breakdown on those fields, so
// a buyer-pays K100 link silently rendered the classic single
// "Amount Due — ZMW 100.00" view and a "Pay ZMW 100.00" button —
// the buyer was never shown the K2.50 fee or the K102.50 total.
//
// Layers pinned here:
//  1. feeBreakdownForLink (the exact helper the page calls) against
//     a buyer-pays describe fixture: price 100, fee 2.5, total 102.5;
//     seller-pays and field-less payloads return null (classic view).
//  2. The describe contract in the edge function source: the link
//     object describe returns MUST carry the fee fields. If a future
//     change drops them, this file fails before the page can lie.
//  3. The page render wiring: breakdown lines (Price / Platform fee /
//     Total to pay) exist, the Pay button charges the breakdown
//     total, and the classic seller-pays "Amount Due" view remains.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { feeBreakdownForLink } from "../../src/utils/paymentLinkSettlement";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const pageSource = read("../../src/pages/PublicCheckout.tsx");
const checkoutFnSource = read("../../supabase/functions/payment-link-checkout/index.ts");

// The describe payload for the live repro link efc64a758df1e434
// (buyer-pays, K100 at the 2.5% platform rate), as describe returns
// it once the fee fields are present.
const BUYER_PAYS_DESCRIBE_LINK = {
  id: "d96c38b8-703b-4044-96e9-fc616c4d201f",
  title: "Fee render QA",
  description: "",
  amount: 100,
  currency: "ZMW",
  status: "active",
  user_id: "ce9d4e3f-8cdf-4fd5-9384-da4074b7d7ee",
  account_id: null,
  fee_payer: "buyer",
  fee_rate_percent: 2.5,
  fee_amount: 2.5,
  buyer_total: 102.5,
  seller_receives: 100,
};

// The same link as describe returned it from the stale deployed
// bundle (function v29, 2026-10-26): bitcoin fields present, every
// fee field missing. The page cannot render a breakdown from this —
// it falls back to the classic view, which is the defect.
const STALE_DESCRIBE_LINK = {
  id: "d96c38b8-703b-4044-96e9-fc616c4d201f",
  title: "Fee render QA",
  description: "",
  amount: 100,
  currency: "ZMW",
  status: "active",
  user_id: "ce9d4e3f-8cdf-4fd5-9384-da4074b7d7ee",
  account_id: null,
};

describe("feeBreakdownForLink — buyer-pays breakdown math", () => {
  it("buyer-pays K100 fixture: price 100, fee 2.50, total 102.50", () => {
    expect(feeBreakdownForLink(BUYER_PAYS_DESCRIBE_LINK, 100)).toEqual({
      price: 100,
      fee: 2.5,
      total: 102.5,
    });
  });

  it("uses the server-computed fee for fixed-price links", () => {
    // fee_rate_percent deliberately disagrees: the server's
    // fee_amount is the truth for a fixed price.
    const link = { ...BUYER_PAYS_DESCRIBE_LINK, fee_rate_percent: 9.9 };
    expect(feeBreakdownForLink(link, 100)?.fee).toBe(2.5);
  });

  it("computes the fee live on any-amount buyer-pays links", () => {
    const link = {
      ...BUYER_PAYS_DESCRIBE_LINK,
      amount: null,
      fee_amount: null,
      buyer_total: null,
      seller_receives: null,
    };
    expect(feeBreakdownForLink(link, 200)).toEqual({ price: 200, fee: 5, total: 205 });
  });

  it("seller-pays links return null — the classic single-total view", () => {
    const link = { ...BUYER_PAYS_DESCRIBE_LINK, fee_payer: "seller", seller_receives: 97.5, buyer_total: 100 };
    expect(feeBreakdownForLink(link, 100)).toBeNull();
  });

  it("a describe payload without fee fields returns null (the 2026-10-26 regression shape)", () => {
    expect(feeBreakdownForLink(STALE_DESCRIBE_LINK, 100)).toBeNull();
  });

  it("no link or no positive price returns null", () => {
    expect(feeBreakdownForLink(null, 100)).toBeNull();
    expect(feeBreakdownForLink(undefined, 100)).toBeNull();
    expect(feeBreakdownForLink(BUYER_PAYS_DESCRIBE_LINK, 0)).toBeNull();
  });
});

describe("payment-link-checkout describe contract (source pin)", () => {
  const describeStart = checkoutFnSource.indexOf('body.action === "describe"');
  const describeEnd = checkoutFnSource.indexOf('body.action === "btc_create_attempt"');
  const describeBlock = checkoutFnSource.slice(describeStart, describeEnd);

  it("the describe branch exists and precedes the bitcoin actions", () => {
    expect(describeStart).toBeGreaterThan(-1);
    expect(describeEnd).toBeGreaterThan(describeStart);
  });

  it("describe returns the fee fields the pay page renders from", () => {
    expect(describeBlock).toContain("fee_payer: feePayer");
    expect(describeBlock).toContain("fee_rate_percent:");
    expect(describeBlock).toContain("fee_amount:");
    expect(describeBlock).toContain("buyer_total:");
    expect(describeBlock).toContain("seller_receives:");
  });

  it("the link query selects the stored fee_payer column", () => {
    expect(checkoutFnSource).toContain("account_id, fee_payer,");
  });
});

describe("PublicCheckout render wiring (source pin)", () => {
  it("the page computes its breakdown through the pinned helper", () => {
    expect(pageSource).toContain("feeBreakdownForLink(linkData, priceAmount)");
  });

  it("renders Price / Platform fee / Total to pay lines from the breakdown", () => {
    expect(pageSource).toContain(">Price</span>");
    expect(pageSource).toContain(">Platform fee</span>");
    expect(pageSource).toContain(">Total to pay</span>");
    expect(pageSource).toContain("bd.price.toFixed(2)");
    expect(pageSource).toContain("bd.fee.toFixed(2)");
    expect(pageSource).toContain("bd.total.toFixed(2)");
  });

  it("the Pay button charges the breakdown total when one exists", () => {
    expect(pageSource).toContain("payTotal = bd?.total ?? amount");
    expect(pageSource).toContain("Pay ${linkData?.currency} ${payTotal.toFixed(2)}");
  });

  it("the classic seller-pays Amount Due view is still the fallback", () => {
    expect(pageSource).toContain(">Amount Due</p>");
  });
});
