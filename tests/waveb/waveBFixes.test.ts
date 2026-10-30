// Wave B QA fixes (verified live 2026-10-24):
//   1. "Split Payments" menu item reported as landing on the branded
//      404. Investigation: the page is real and full-featured
//      (src/pages/SplitPayments.tsx — recipients, rules, settlement
//      preview) and its route /split-payments has been registered
//      since 2026-10-21, with both menus already pointing at it; no
//      code path in the current tree can 404 that URL (the live
//      sighting is consistent with a stale production bundle from
//      before the route existed). The genuinely missing piece was
//      /splits — the natural short URL — which DID hit the catch-all.
//      It now redirects to /split-payments, and the route + menu
//      wiring is pinned here so it cannot silently regress.
//   2. /cards and /virtual-cards 404'd; the real route is /card/new.
//      No inbound link used the dead variants (every menu, footer,
//      search and dashboard link already targets /card/new) — the
//      redirects are added anyway as natural URLs.
//   3. A K2.00 payment-link payment credited the seller K1.95: the
//      2.5% platform fee comes out of the SELLER's side inside
//      execute_payment_link_settlement, and was disclosed nowhere
//      before the fact. The fee and its side are unchanged — the
//      create/edit link forms and the link list now disclose what
//      the seller receives, computed by the same client-side mirror
//      of the SQL fee step the Split Payments page already uses.
//   4. /bitcoin-wallet/self-custody once rendered completely blank
//      (white, no header/content) and recovered after a reload. No
//      page-level code cause exists: the page renders synchronously,
//      its only lazy load (the Spark SDK dynamic import) already has
//      a guarded one-reload recovery, and the app-level ErrorBoundary
//      turns render errors into a crafted state, not a blank. A
//      totally blank viewport is the signature of the app bundle
//      itself failing to load (stale cached HTML pointing at assets
//      a redeploy removed) — which nothing inside the bundle can
//      catch. index.html now carries an inline boot watchdog: an
//      empty #root past a grace period reloads ONCE, and if the app
//      still hasn't mounted it shows a plain explanation with a
//      working reload button instead of a silent white page.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computePaymentLinkNet } from "../../src/utils/splitPayments";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const routes = read("../../src/components/AnimatedRoutes.tsx");
const header = read("../../src/components/Header.tsx");
const paymentLinks = read("../../src/pages/PaymentLinks.tsx");
const indexHtml = read("../../index.html");

// ---------------------------------------------------------------------
// 1. Split Payments: real page, registered route, menus wired, and
//    the natural /splits URL now redirects instead of 404ing
// ---------------------------------------------------------------------

describe("split payments routing", () => {
  it("the real page stays registered at /split-payments behind sign-in", () => {
    expect(routes).toContain(
      '<Route path="/split-payments" element={<ProtectedPage><SplitPayments /></ProtectedPage>} />'
    );
  });

  it("/splits redirects to /split-payments", () => {
    expect(routes).toContain(
      '<Route path="/splits" element={<Navigate to="/split-payments" replace />} />'
    );
  });

  it("both menus point at the real page", () => {
    expect(header).toContain('<Link to="/split-payments"');
    expect(header).toContain('<MobileNavLink to="/split-payments"');
  });
});

// ---------------------------------------------------------------------
// 2. Virtual cards: natural URLs redirect to the real /card/new page
// ---------------------------------------------------------------------

describe("virtual card natural URLs", () => {
  it("the create page stays at /card/new", () => {
    // The element now carries the feature gate (CEO directive
    // 2026-10-30: virtual cards are admin-tier only) — the PATH is
    // what this pin protects: still /card/new, never renamed.
    expect(routes).toContain(
      '<Route path="/card/new" element={<ProtectedPage><FeatureRouteGate feature="virtualCards"><VirtualCardNew /></FeatureRouteGate></ProtectedPage>} />'
    );
  });

  it("/cards redirects to /card/new", () => {
    expect(routes).toContain(
      '<Route path="/cards" element={<Navigate to="/card/new" replace />} />'
    );
  });

  it("/virtual-cards redirects to /card/new", () => {
    expect(routes).toContain(
      '<Route path="/virtual-cards" element={<Navigate to="/card/new" replace />} />'
    );
  });

  it("the card detail/fund routes are untouched by the redirects", () => {
    expect(routes).toContain('<Route path="/card/:id"');
    expect(routes).toContain('<Route path="/card/:id/fund"');
  });

  it("no menu or footer link uses the dead variants", () => {
    expect(header).not.toContain('to="/cards"');
    expect(header).not.toContain('to="/virtual-cards"');
    expect(read("../../src/components/Footer.tsx")).not.toContain("'/cards'");
    expect(read("../../src/components/Footer.tsx")).not.toContain(
      "'/virtual-cards'"
    );
  });
});

// ---------------------------------------------------------------------
// 3. Payment-link fee disclosure
// ---------------------------------------------------------------------

describe("computePaymentLinkNet (2.5%, the launch rate)", () => {
  it("reproduces the Wave B proof: a K2.00 payment nets the seller K1.95", () => {
    expect(computePaymentLinkNet(2, 2.5)).toEqual({
      platformFee: 0.05,
      sellerReceives: 1.95,
    });
  });

  it("matches the splits preview on a round amount", () => {
    expect(computePaymentLinkNet(100, 2.5)).toEqual({
      platformFee: 2.5,
      sellerReceives: 97.5,
    });
  });

  it("rounds the fee half-up to the ngwee, like Postgres round(numeric, 2)", () => {
    // 2.5% of K5.00 is K0.125 → K0.13 (the qa9 send-fee proof rounded
    // the same way); the seller keeps the rest.
    expect(computePaymentLinkNet(5, 2.5)).toEqual({
      platformFee: 0.13,
      sellerReceives: 4.87,
    });
  });

  it("a zero rate means no fee and the seller keeps everything", () => {
    expect(computePaymentLinkNet(50, 0)).toEqual({
      platformFee: 0,
      sellerReceives: 50,
    });
  });

  it("a non-positive amount yields zeroes, never a negative receipt", () => {
    expect(computePaymentLinkNet(0, 2.5)).toEqual({
      platformFee: 0,
      sellerReceives: 0,
    });
  });

  it("the fee never exceeds the payment itself", () => {
    const net = computePaymentLinkNet(1, 150);
    expect(net.platformFee).toBe(1);
    expect(net.sellerReceives).toBe(0);
  });
});

describe("payment-links page disclosure wiring", () => {
  it("reads the fee rate from platform settings, like the Split Payments page", () => {
    expect(paymentLinks).toContain("usePlatformSettings");
    expect(paymentLinks).toContain("split_platform_fee_percent ?? 2.5");
  });

  // Fee-bearer update (CEO order, 2026-10-26): the Wave B disclosure
  // ("the fee comes out of what you receive") became a CHOICE — the
  // create/edit forms now ask who pays the fee, with live numbers for
  // both sides, defaulting to the merchant's account setting. The
  // disclosure duty these pins guard is unchanged; the copy is the
  // choice's.
  it("computes the disclosed figures with the shared fee mirror", () => {
    expect(paymentLinks).toContain("computePaymentLinkBreakdown");
  });

  it("the create form asks who pays the fee, with live numbers for both sides", () => {
    expect(paymentLinks).toContain("Who pays the {rate}% platform fee?");
    expect(paymentLinks).toContain("You receive ${fmtFee(sellerBd.sellerReceives)} · buyer pays ${fmtFee(sellerBd.buyerPays)}");
    expect(paymentLinks).toContain("You receive ${fmtFee(buyerBd.sellerReceives)} · buyer pays ${fmtFee(buyerBd.buyerPays)}");
    expect(paymentLinks).toContain("value={feePayer} onChange={setFeePayer}");
    // …and the choice starts from the merchant's account default.
    expect(paymentLinks).toContain("useFeePayerDefault");
    expect(paymentLinks).toContain("fee_payer: feePayer");
  });

  it("the edit form asks the same question, seeded from the link's stored choice", () => {
    expect(paymentLinks).toContain("value={editFeePayer} onChange={setEditFeePayer}");
    expect(paymentLinks).toContain("setEditFeePayer(link.fee_payer === 'buyer' ? 'buyer' : 'seller')");
    expect(paymentLinks).toContain("fee_payer: editFeePayer");
  });

  it("open-amount links still disclose the fee and both of its sides", () => {
    expect(paymentLinks).toContain("platform fee comes out of what you receive on each payment");
    expect(paymentLinks).toContain("platform fee is added on top of the amount the buyer enters");
  });

  it("each fixed-amount link in the list shows the money truth for its mode", () => {
    expect(paymentLinks).toContain("You receive {fmtFee(bd.sellerReceives)} of each {fmtFee(bd.price)} payment ({platformFeeRate}% platform fee)");
    expect(paymentLinks).toContain("Buyer pays {fmtFee(bd.buyerPays)} ({fmtFee(bd.price)} + {fmtFee(bd.platformFee)} fee) — you receive the full {fmtFee(bd.sellerReceives)}");
  });
});

// ---------------------------------------------------------------------
// 4. Boot watchdog: a failed bundle can never leave a blank page
// ---------------------------------------------------------------------

describe("boot watchdog in index.html", () => {
  it("watches #root and reloads at most once (sessionStorage-guarded)", () => {
    expect(indexHtml).toContain('var KEY = "bmaglass.bootReload.v1"');
    expect(indexHtml).toContain('sessionStorage.getItem(KEY) === "1"');
    expect(indexHtml).toContain("window.location.reload()");
  });

  it("clears the guard once the app mounts, so recovery re-arms", () => {
    expect(indexHtml).toContain("root.childElementCount > 0");
    expect(indexHtml).toContain("sessionStorage.removeItem(KEY)");
  });

  it("replaces a persistent blank with a plain explanation and a reload button", () => {
    // In the file this is the JS-escaped form didn\'t (single-quoted
    // string inside the inline script).
    expect(indexHtml).toContain("BMaGlass Pay didn\\'t load");
    expect(indexHtml).toContain("Reload BMaGlass Pay");
    expect(indexHtml).toContain("Nothing has been charged or changed.");
  });

  it("the watchdog is a classic inline script — it cannot depend on the bundle it guards", () => {
    const watchdogAt = indexHtml.indexOf("bmaglass.bootReload.v1");
    const bundleAt = indexHtml.indexOf('src="/src/main.tsx"');
    expect(bundleAt).toBeGreaterThan(-1);
    expect(watchdogAt).toBeGreaterThan(bundleAt);
    // A plain <script>, not type="module": it must run even when the
    // module bundle is exactly what failed to load.
    expect(indexHtml).toContain("<script>\n      // Boot watchdog");
  });
});
