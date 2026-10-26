// Pins for the checkout-clarity presentation (CEO order 2026-10-26
// 15:05 CAT): "Make sure that the checkout widget you make it clear
// that it's only bitcoin available for now. And make it both lightning
// and bitcoin so as some who love lightning won't feel left out."
//
// The defect this prevents: card / mobile money / bank are NOT
// connected rails (no Lenco/Broadpay keys, no PayPal Payouts yet) but
// the pay page presented them as ordinary selectable methods whose
// only truth arrived AFTER clicking Pay, as the server's
// not_configured failure — "available until it fails". A guest's
// default selection was literally "Card".
//
// Layers pinned here (source pins, the house style for this page —
// see paymentLinkFeeBreakdown.test.ts):
//  1. The Bitcoin-only notice renders at the payment-method step.
//  2. Bitcoin AND Lightning are first-class method-level tiles, and
//     the Lightning tile drives the attempt component's rail.
//  3. Card / mobile money / bank render disabled with a "Not
//     available yet" label; the old "availability is confirmed when
//     you click Pay" copy is gone; the Pay button exists only for
//     the wallet flow, so no fiat tile can ever be submitted.
//  4. The Lightning invoice is visible copyable TEXT (mirroring the
//     on-chain address), not only a QR + copy button — desktop
//     Lightning users paste invoices.
//  5. The fee-bearer render contract survives the restructure:
//     buyer-pays breakdown lines + seller-pays classic view intact.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const pageSource = read("../../src/pages/PublicCheckout.tsx");
const btcComponentSource = read("../../src/components/payments/BitcoinLinkPayment.tsx");

describe("PublicCheckout — Bitcoin-only notice (source pin)", () => {
  it("states plainly that the checkout takes Bitcoin only, for now", () => {
    expect(pageSource).toContain("For now, this checkout takes Bitcoin only");
    expect(pageSource).toContain("pay on-chain or with Lightning");
    expect(pageSource).toContain("Card and mobile money are coming later.");
  });

  it("the notice sits at the payment-method step, for guests", () => {
    const labelIdx = pageSource.indexOf("<Label>Payment Method</Label>");
    const noticeIdx = pageSource.indexOf("For now, this checkout takes Bitcoin only");
    const gridIdx = pageSource.indexOf("methods.map");
    expect(labelIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeGreaterThan(labelIdx);
    expect(gridIdx).toBeGreaterThan(noticeIdx);
  });

  it("a guest defaults to Bitcoin when the platform can receive it — never to Card", () => {
    expect(pageSource).toContain("if (bitcoinAvailable && !payerId) setBitcoinSelected(true);");
  });
});

describe("PublicCheckout — Bitcoin and Lightning as first-class method tiles", () => {
  it("both rails are method-level tiles when Bitcoin is available", () => {
    expect(pageSource).toContain("id: 'bitcoin' as const, icon: Bitcoin, label: 'Bitcoin', available: true");
    expect(pageSource).toContain("id: 'lightning' as const, icon: Zap, label: 'Lightning', available: true");
  });

  it("each tile selects its rail and the page passes the rail into the attempt flow", () => {
    expect(pageSource).toContain("setBitcoinRail('onchain');");
    expect(pageSource).toContain("setBitcoinRail('lightning');");
    expect(pageSource).toContain("initialRail={bitcoinRail}");
  });

  it("the signed-in BMaGlass Wallet tile stays a live method", () => {
    expect(pageSource).toContain("id: 'wallet' as const, icon: Wallet, label: 'BMaGlass Wallet', available: true");
  });
});

describe("PublicCheckout — unconnected fiat methods can no longer read as available", () => {
  it("card, mobile money and bank are declared unavailable", () => {
    expect(pageSource).toContain("id: 'card' as const, icon: CreditCard, label: 'Card', available: false");
    expect(pageSource).toContain("id: 'mobile_money' as const, icon: Smartphone, label: 'Mobile Money', available: false");
    expect(pageSource).toContain("id: 'bank' as const, icon: Building2, label: 'Bank', available: false");
  });

  it("unavailable tiles render disabled with a plain label", () => {
    expect(pageSource).toContain("disabled={!m.available}");
    expect(pageSource).toContain(">Not available yet</span>");
  });

  it("the 'available until it fails' explainer copy is gone", () => {
    expect(pageSource).not.toContain("Availability is confirmed when you click Pay");
    expect(pageSource).not.toContain("Pay by debit or credit card.");
    expect(pageSource).not.toContain("Pay by mobile money.");
    expect(pageSource).not.toContain("Pay by bank transfer.");
  });

  it("the fiat Pay button renders only for the wallet flow", () => {
    expect(pageSource).toContain("{!bitcoinSelected && paymentMethod === 'wallet' && (");
    expect(pageSource).toContain("Pay ${linkData?.currency} ${payTotal.toFixed(2)}");
  });
});

describe("BitcoinLinkPayment — rail follows the method-level choice", () => {
  it("accepts an initialRail prop and drives the tabs from it", () => {
    expect(btcComponentSource).toContain("initialRail?: 'onchain' | 'lightning';");
    expect(btcComponentSource).toContain("if (initialRail) setRail(initialRail);");
    expect(btcComponentSource).toContain("value={rail}");
    expect(btcComponentSource).toContain("onValueChange={(v) => setRail(v as 'onchain' | 'lightning')}");
    expect(btcComponentSource).not.toContain('defaultValue="onchain"');
  });
});

describe("BitcoinLinkPayment — the Lightning invoice is visible, copyable text", () => {
  it("renders the invoice in a read-only field, mirroring the address treatment", () => {
    expect(btcComponentSource).toContain('id="link-btc-invoice"');
    expect(btcComponentSource).toContain("value={attempt.lightning_invoice}");
    expect(btcComponentSource).toContain('aria-label="Copy Lightning invoice"');
  });

  it("the on-chain address keeps its visible copyable field", () => {
    expect(btcComponentSource).toContain('id="link-btc-address"');
    expect(btcComponentSource).toContain("value={attempt.onchain_address}");
    expect(btcComponentSource).toContain('aria-label="Copy Bitcoin address"');
  });

  it("open-in-wallet survives for Lightning", () => {
    expect(btcComponentSource).toContain("`lightning:${attempt.lightning_invoice}`");
    expect(btcComponentSource).toContain("Open in Lightning wallet");
  });
});

describe("PublicCheckout — fee-bearer render contract survives the restructure", () => {
  it("buyer-pays breakdown still renders through the pinned helper", () => {
    expect(pageSource).toContain("feeBreakdownForLink(linkData, priceAmount)");
    expect(pageSource).toContain(">Price</span>");
    expect(pageSource).toContain(">Platform fee</span>");
    expect(pageSource).toContain(">Total to pay</span>");
  });

  it("seller-pays classic single-total view is still the fallback", () => {
    expect(pageSource).toContain(">Amount Due</p>");
  });
});
