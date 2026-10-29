// Pins for the 2026-10-29 crash-proofing + skeleton-fidelity sweep
// (CEO: "no page is crashing and the skeleton loader matches the
// elements being loaded — like YouTube").
//
// What is pinned here:
//   1. EVERY routed page resolves to its own skeleton twin via
//      lib/routeSkeleton (no route falls back to the generic shape
//      unless it is on the explicit allowlist below).
//   2. The twin chosen for key routes is the right component
//      (element-type identity), including prefix routes and the
//      card-fund special case.
//   3. The wiring: AnimatedRoutes' Suspense fallback is the
//      route-aware RouteSkeleton, every route renders inside a
//      PageErrorBoundary that resets on navigation, and
//      ProtectedRoute's auth bootstrap shows the DESTINATION
//      route's twin (never the dashboard twin for every page).
//   4. The crash fixes: unknown/legacy status values can no longer
//      dereference an empty lookup in the dispute components, the
//      payment-status badge, or the P2P profile KYC badge.
//   5. The removed anti-patterns stay removed: no bare full-screen
//      spinners on the admin pages, no "Loading...</p>" page states,
//      no bare spinner in BusinessRouteGuard.
//   6. Skeletons never carry plausible-looking fake data (no
//      currency amounts baked into the kit).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { skeletonForRoute } from "../../src/lib/routeSkeleton";
import { isChunkLoadError } from "../../src/components/PageErrorBoundary";
import {
  AuthFormSkeleton,
  BitcoinWalletSkeleton,
  CardCreateSkeleton,
  CardPageSkeleton,
  CheckoutSkeleton,
  DashboardSkeleton,
  DetailPageSkeleton,
  FormPageSkeleton,
  GenericPageSkeleton,
  StatGridPageSkeleton,
  TablePageSkeleton,
  TradeRoomSkeleton,
} from "../../src/components/ui/skeletons";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const typeOf = (p: string) => (skeletonForRoute(p) as { type: unknown }).type;

// Routes whose element is a bare <Navigate> (eager, never lazy, so
// the Suspense fallback never shows for them) + the landing page,
// whose own auth gate (Index) already picks its shell. Everything
// else MUST resolve to a page-specific twin.
const GENERIC_ALLOWLIST = new Set([
  "/",
  "/privacy",
  "/terms",
  "/profile",
  "/cards",
  "/virtual-cards",
  "/splits",
  "/admin",
  "/admin/analytics",
  "/admin/compliance",
  "/admin/disputes",
]);

describe("route skeleton coverage", () => {
  const routesSource = read("../../src/components/AnimatedRoutes.tsx");
  const paths = [...routesSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);

  it("finds the full route table", () => {
    expect(paths.length).toBeGreaterThan(100);
  });

  it("every routed page has its own twin", () => {
    const uncovered: string[] = [];
    for (const raw of paths) {
      if (raw === "*") continue;
      const concrete = raw
        .replace(/:[^/]+/g, "sample")
        .replace(/\*$/, "sample");
      if (GENERIC_ALLOWLIST.has(concrete)) continue;
      if (typeOf(concrete) === GenericPageSkeleton) uncovered.push(raw);
    }
    expect(uncovered).toEqual([]);
  });

  it("maps key routes to the right twin", () => {
    expect(typeOf("/dashboard")).toBe(DashboardSkeleton);
    expect(typeOf("/bitcoin-wallet")).toBe(BitcoinWalletSkeleton);
    expect(typeOf("/card/new")).toBe(CardCreateSkeleton);
    expect(typeOf("/card/abc123")).toBe(CardPageSkeleton);
    expect(typeOf("/card/abc123/fund")).toBe(FormPageSkeleton);
    expect(typeOf("/p2p/orders/xyz")).toBe(TradeRoomSkeleton);
    expect(typeOf("/pay/CODE9")).toBe(CheckoutSkeleton);
    expect(typeOf("/invoice/CODE9")).toBe(CheckoutSkeleton);
    expect(typeOf("/login")).toBe(AuthFormSkeleton);
    expect(typeOf("/admin/treasury")).toBe(StatGridPageSkeleton);
    expect(typeOf("/admin/users")).toBe(TablePageSkeleton);
    expect(typeOf("/admin/users/u1")).toBe(DetailPageSkeleton);
    expect(typeOf("/no-such-route")).toBe(GenericPageSkeleton);
  });
});

describe("chunk-load error classification", () => {
  it("recognises stale-chunk failures", () => {
    expect(isChunkLoadError(new Error("Loading chunk 421 failed"))).toBe(true);
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("ChunkLoadError: something"))).toBe(true);
  });
  it("does not misclassify ordinary errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("wiring pins", () => {
  it("AnimatedRoutes uses the route-aware fallback + per-route boundary", () => {
    const src = read("../../src/components/AnimatedRoutes.tsx");
    expect(src).toContain("RouteSkeleton");
    expect(src).toContain("PageErrorBoundary");
    expect(src).toContain("resetKey={location.pathname}");
  });

  it("ProtectedRoute bootstraps into the destination route's twin", () => {
    const src = read("../../src/components/ProtectedRoute.tsx");
    expect(src).toContain("skeletonForRoute(location.pathname)");
    expect(src).not.toContain("<DashboardSkeleton />");
  });

  it("BusinessRouteGuard has no bare spinner", () => {
    const src = read("../../src/components/business/BusinessRouteGuard.tsx");
    expect(src).not.toContain("animate-spin");
    expect(src).toContain("BusinessDashboardSkeleton");
  });
});

describe("crash-fix pins (unknown status values)", () => {
  it("dispute components fall back on unmapped statuses", () => {
    expect(read("../../src/components/disputes/DisputeList.tsx")).toContain(
      "?? FALLBACK_STATUS",
    );
    expect(read("../../src/components/disputes/DisputeDetail.tsx")).toContain(
      "?? FALLBACK_STATUS",
    );
  });
  it("payment-status badge falls back on unmapped statuses", () => {
    expect(read("../../src/components/ui/payment-status.tsx")).toContain(
      "?? FALLBACK_STATUS",
    );
  });
  it("P2P profile KYC badge falls back on unmapped statuses", () => {
    expect(read("../../src/pages/P2PProfile.tsx")).toContain(
      "?? KYC_LABELS.not_started",
    );
  });
  it("P2P order/ad status lookups go through the fallback accessor", () => {
    expect(read("../../src/utils/p2pUi.ts")).toContain("ORDER_STATUS_FALLBACK");
    expect(read("../../src/utils/p2pUi.ts")).toContain("export function orderStatusMeta");
    expect(read("../../src/pages/P2PTradeRoom.tsx")).toContain("orderStatusMeta(status)");
    expect(read("../../src/pages/P2POrders.tsx")).toContain("orderStatusMeta(order.status)");
    expect(read("../../src/pages/P2PDispute.tsx")).toContain("orderStatusMeta(order.status)");
    expect(read("../../src/pages/P2PMyAds.tsx")).toContain('?? { label: ad.status.replace');
  });
  it("AdminIdentity tolerates nullable document_type and malformed dedupe jsonb", () => {
    const src = read("../../src/pages/AdminIdentity.tsx");
    expect(src).toContain('document_type ?? "Document"');
    expect(src).toContain("Array.isArray(selected.dedupe?.hits)");
    expect(src).not.toContain("{item.document_type.replace(");
  });
  it("money surfaces validate/coerce response shapes before rendering them", () => {
    expect(read("../../src/pages/BitcoinWallet.tsx")).toContain("Malformed quote response");
    expect(read("../../src/pages/VirtualCardDetails.tsx")).toContain("if (!data.card)");
    expect(read("../../src/pages/InvoiceCheckout.tsx")).toContain(
      "Number(invoice?.total_amount ?? 0).toFixed(2)",
    );
    expect(read("../../src/pages/RequestCheckout.tsx")).toContain(
      "Number(request?.amount ?? 0).toFixed(2)",
    );
  });
});

describe("removed anti-patterns stay removed", () => {
  it("no bare full-screen spinner remains on the swept admin pages", () => {
    for (const f of [
      "AdminDashboard",
      "AdminMastercardMove",
      "AdminMoonpay",
      "AdminRefunds",
      "AdminRoleRequests",
      "AdminTransactions",
      "AdminUserDetail",
      "AdminUsers",
    ]) {
      expect(read(`../../src/pages/${f}.tsx`)).not.toContain(
        "animate-spin rounded-full h-12 w-12",
      );
    }
  });

  it("no 'Loading...</p>' page states remain on the swept list pages", () => {
    for (const f of ["BankTransfers", "BulkPayments", "Refunds", "SplitPayments"]) {
      expect(read(`../../src/pages/${f}.tsx`)).not.toContain(">Loading...</p>");
    }
  });

  it("no bare full-screen spinner remains on the checkout pages", () => {
    for (const f of ["PublicCheckout", "InvoiceCheckout", "RequestCheckout"]) {
      expect(read(`../../src/pages/${f}.tsx`)).not.toContain(
        'Loader2 className="h-8 w-8 animate-spin',
      );
    }
  });

  it("no bare list-area spinner/text remains on the swept admin pages", () => {
    expect(read("../../src/pages/WebhookLogs.tsx")).not.toContain(
      "animate-spin rounded-full h-8 w-8",
    );
    for (const f of ["AdminBankPayouts", "AdminPaypal"]) {
      expect(read(`../../src/pages/${f}.tsx`)).not.toContain(">Loading…</p>");
    }
    expect(read("../../src/pages/FeedbackDashboard.tsx")).not.toContain(
      "Loading feedback items...",
    );
    expect(read("../../src/pages/QrPayments.tsx")).not.toContain(
      "Loading history…",
    );
  });

  it("the skeleton kit carries no plausible fake amounts", () => {
    const src = read("../../src/components/ui/skeletons.tsx");
    expect(src).not.toMatch(/\$[0-9]/);
    expect(src).not.toMatch(/K[0-9]/);
    expect(src).not.toMatch(/[0-9]\s*sats/);
  });
});
