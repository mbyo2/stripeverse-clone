// Connectors-directory pins (CEO directive, 2026-10-30: "make the
// repository for connectors be available on bmaglasspay.online as
// developers will need it").
//
// What is pinned:
//   1. The directory data (src/lib/connectors.ts) lists EVERY
//      verified connector + SDK from the public
//      bmaglasspay-connectors repo — and nothing else. Every folder
//      and README link points at the real, verified repo tree.
//   2. Shopify is NOT presented as an available connector anywhere
//      in the directory data (assessment only — no plugin exists).
//   3. SDK availability stays honest: distributed from the repo
//      only; the Flutter SDK is source-available, never claimed as
//      a pub.dev listing.
//   4. The page is wired: route in AnimatedRoutes, a skeleton twin,
//      and one-click inbound links from the Developers page, the
//      SDK docs, the in-app API-key manager and the header menu.
//   5. The connectors surface is a WORKING feature: it is not in
//      any feature-visibility gate (visible to guests and all
//      roles) — DeveloperConnectors renders no role/flag checks.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONNECTORS_REPO_URL,
  SDKS,
  STORE_CONNECTORS,
} from "../../src/lib/connectors";
import { skeletonForRoute } from "../../src/lib/routeSkeleton";
import { ContentPageSkeleton } from "../../src/components/ui/skeletons";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const EXPECTED_FOLDERS = [
  "integrations/wordpress",
  "integrations/odoo",
  "integrations/magento",
  "integrations/prestashop",
  "integrations/opencart",
  "integrations/embed",
  "integrations/automation",
  "sdk/typescript",
  "sdk/python",
  "sdk/php",
  "sdk/react-native",
  "sdk/flutter",
];

describe("connectors directory data", () => {
  it("points at the real public repository", () => {
    expect(CONNECTORS_REPO_URL).toBe(
      "https://github.com/mbyo2/bmaglasspay-connectors",
    );
  });

  it("lists every verified store connector and SDK — no more, no less", () => {
    expect(STORE_CONNECTORS.map((c) => c.name)).toEqual([
      "WooCommerce",
      "Odoo",
      "Magento 2",
      "PrestaShop",
      "OpenCart",
      "Embed button — any website",
      "Zapier / Make automation",
    ]);
    expect(SDKS.map((s) => s.name)).toEqual([
      "TypeScript / JavaScript",
      "Python",
      "PHP",
      "React Native / Expo",
      "Flutter (Dart)",
    ]);
  });

  it("every entry links to its verified repo folder and README", () => {
    const entries = [
      ...STORE_CONNECTORS.map((c) => ({
        folderUrl: c.folderUrl,
        readmeUrl: c.readmeUrl,
      })),
      ...SDKS.map((s) => ({ folderUrl: s.folderUrl, readmeUrl: s.readmeUrl })),
    ];
    expect(entries).toHaveLength(EXPECTED_FOLDERS.length);
    const folders = entries.map((e) =>
      e.folderUrl.replace(`${CONNECTORS_REPO_URL}/tree/main/`, ""),
    );
    expect(folders.sort()).toEqual([...EXPECTED_FOLDERS].sort());
    for (const e of entries) {
      const folder = e.folderUrl.replace(
        `${CONNECTORS_REPO_URL}/tree/main/`,
        "",
      );
      expect(e.readmeUrl).toBe(
        `${CONNECTORS_REPO_URL}/blob/main/${folder}/README.md`,
      );
    }
  });

  it("Shopify is not presented as an available connector", () => {
    const data = JSON.stringify({ STORE_CONNECTORS, SDKS }).toLowerCase();
    expect(data).not.toContain("shopify");
    const page = read("src/pages/DevelopersConnectors.tsx");
    // No connector/SDK card data for Shopify is rendered from the data.
    expect(page).toContain("STORE_CONNECTORS.map");
    expect(page).toContain("SDKS.map");
  });

  it("SDK availability is honest — repo distribution only, no registry claims", () => {
    for (const sdk of SDKS) {
      expect(sdk.availability).toMatch(/^Source/);
      expect(sdk.availability.toLowerCase()).toContain("not");
    }
    const flutter = SDKS.find((s) => s.name === "Flutter (Dart)");
    expect(flutter?.availability).toContain("not published to pub.dev");
    const page = read("src/pages/DevelopersConnectors.tsx").replace(/\s+/g, " ");
    expect(page).toContain(
      "not yet published to npm, PyPI, Packagist or pub.dev",
    );
  });

  it("states the verified design facts (shop-side pricing, order-total payments, multivendor, ZMW/USD)", () => {
    const page = read("src/pages/DevelopersConnectors.tsx").replace(/\s+/g, " ");
    expect(page).toContain("keeps its own catalogue and its own prices");
    expect(page).toContain("exact order total");
    expect(page).toContain("Dokan, WCFM");
    expect(page).toContain("operator's BMaGlass Pay account");
    expect(page).toContain("ZMW and USD");
    expect(page).toContain("payment_link.paid");
  });
});

describe("connectors page wiring", () => {
  it("is routed at /developers/connectors", () => {
    const routes = read("src/components/AnimatedRoutes.tsx");
    expect(routes).toContain("import('@/pages/DevelopersConnectors')");
    expect(routes).toContain('path="/developers/connectors"');
  });

  it("has its own skeleton twin", () => {
    expect(
      (skeletonForRoute("/developers/connectors") as { type: unknown }).type,
    ).toBe(ContentPageSkeleton);
  });

  it("is linked from every developer-facing surface", () => {
    expect(read("src/pages/Developers.tsx")).toContain("/developers/connectors");
    expect(read("src/pages/SdkDocs.tsx")).toContain("/developers/connectors");
    expect(read("src/components/business/ApiKeyManager.tsx")).toContain(
      "/developers/connectors",
    );
    expect(read("src/components/Header.tsx")).toContain("/developers/connectors");
  });

  it("is visible to everyone — the page carries no role or flag gate", () => {
    const page = read("src/pages/DevelopersConnectors.tsx");
    expect(page).not.toContain("useFeatureVisibility");
    expect(page).not.toContain("featureVisibility");
    expect(page).not.toContain("super_admin");
    expect(page).not.toContain("ProtectedRoute");
  });
});
