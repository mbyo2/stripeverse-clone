// Downloads pins — BMaGlass Pay integration ZIPs (CEO order, 2026-11-14:
// developers just want to download a ready-made package and upload it).
//
// What is pinned:
//   1. public/downloads.json is the ONE manifest the Developers page
//      renders its download buttons from. One entry per downloadable
//      integration, version 1.0.0 for this first release, with the real
//      versioned filename and the public Supabase Storage URL.
//   2. Shopify has NO entry and NO download button anywhere: there is no
//      Shopify checkout plugin (payments partner programme gate) —
//      assessment only.
//   3. size/sha256 are filled in by scripts/upload-zips.sh from the real
//      uploaded ZIP. A placeholder hash is never acceptable: when present
//      a hash must be 64 lowercase hex and not all zeros.
//   4. No fee talk in any of the new copy.
//   5. The upload script reads the service_role key from the environment
//      only — no secret value lives in the repo.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const BUCKET_URL =
  "https://hhxwwozpvgktuqutfkhc.supabase.co/storage/v1/object/public/downloads/";

const EXPECTED = [
  { name: "WooCommerce", platform: "woocommerce" },
  { name: "Odoo 16.0", platform: "odoo-16.0" },
  { name: "Odoo 17.0", platform: "odoo-17.0" },
  { name: "Odoo 18.0", platform: "odoo-18.0" },
  { name: "Odoo 19.0", platform: "odoo-19.0" },
  { name: "Odoo 20.0", platform: "odoo-20.0" },
  { name: "Magento 2", platform: "magento" },
  { name: "PrestaShop 1.7", platform: "prestashop-1.7" },
  { name: "PrestaShop 8", platform: "prestashop-8" },
  { name: "PrestaShop 9", platform: "prestashop-9" },
  { name: "OpenCart 3", platform: "opencart-3" },
  { name: "OpenCart 4", platform: "opencart-4" },
  { name: "TypeScript SDK", platform: "sdk-typescript" },
  { name: "Python SDK", platform: "sdk-python" },
  { name: "PHP SDK", platform: "sdk-php" },
  { name: "Flutter SDK", platform: "sdk-flutter" },
  { name: "React Native SDK", platform: "sdk-react-native" },
  { name: "Embed button — any website", platform: "embed-button" },
  { name: "Zapier / Make automation", platform: "automation" },
];

describe("downloads manifest (public/downloads.json)", () => {
  it("lists exactly the nineteen downloadable integrations at version 1.0.0", () => {
    const manifest = JSON.parse(read("public/downloads.json")) as Array<
      Record<string, unknown>
    >;
    expect(manifest.map((e) => ({ name: e.name, platform: e.platform }))).toEqual(
      EXPECTED,
    );
    for (const entry of manifest) {
      expect(entry.version).toBe("1.0.0");
      expect(entry.file).toBe(`bmaglasspay-${entry.platform}-1.0.0.zip`);
      expect(entry.url).toBe(`${BUCKET_URL}${entry.file}`);
      // size/sha256 are optional until the real ZIP is uploaded — but a
      // present value must be real, never a placeholder.
      if (entry.size !== undefined) {
        expect(typeof entry.size).toBe("number");
        expect(entry.size as number).toBeGreaterThan(0);
      }
      if (entry.sha256 !== undefined) {
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.sha256).not.toBe("0".repeat(64));
      }
    }
  });

  it("has no Shopify entry — assessment only, no checkout plugin exists", () => {
    const manifest = JSON.parse(read("public/downloads.json")) as Array<
      Record<string, unknown>
    >;
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain("shopify");
  });

  it("contains no fee talk", () => {
    expect(read("public/downloads.json").toLowerCase()).not.toContain("fee");
  });
});

describe("Downloads section on the Developers page", () => {
  it("renders its buttons from the manifest as real links", () => {
    const section = read("src/components/developers/DownloadsSection.tsx");
    expect(section).toContain('const MANIFEST_URL = "/downloads.json"');
    expect(section).toContain("fetch(MANIFEST_URL)");
    expect(section).toContain("href={entry.url}");
    expect(section).toContain("download={entry.file}");
    // The manifest drives the list — no hard-coded platform list, no
    // hard-coded ZIP URLs in the component.
    expect(section).not.toContain("bmaglasspay-woocommerce");
    expect(section).not.toContain("supabase.co/storage");
  });

  it("keeps Shopify assessment-only, with no download button for it", () => {
    const section = read("src/components/developers/DownloadsSection.tsx");
    expect(section).toContain("Shopify");
    expect(section).toContain("ASSESSMENT.md");
    expect(section).toContain("no downloadable package");
  });

  it("contains no fee talk and never invents buttons on a failed load", () => {
    const section = read("src/components/developers/DownloadsSection.tsx");
    expect(section.toLowerCase()).not.toContain("fee");
    expect(section).toContain("could not be loaded");
    expect(section).not.toContain("mock");
  });

  it("is wired into src/pages/Developers.tsx after the Connectors card", () => {
    const page = read("src/pages/Developers.tsx");
    expect(page).toContain(
      'import DownloadsSection from "@/components/developers/DownloadsSection";',
    );
    expect(page).toContain("<DownloadsSection />");
    expect(page.indexOf("<DownloadsSection />")).toBeGreaterThan(
      page.indexOf("Connectors &amp; integrations"),
    );
  });
});

describe("upload mechanism (scripts/upload-zips.sh)", () => {
  it("exists, is executable, and uploads to the downloads bucket", () => {
    const path = resolve(process.cwd(), "scripts/upload-zips.sh");
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o111).toBeGreaterThan(0);
    const script = read("scripts/upload-zips.sh");
    expect(script).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(script).toContain("/storage/v1/object/");
    expect(script).toContain("downloads");
    expect(script).toContain("upsert=true");
    expect(script).toContain("public/downloads.json");
    expect(script).toContain("sha256sum");
  });

  it("carries no secret value", () => {
    const script = read("scripts/upload-zips.sh");
    expect(script).not.toContain("sbp_");
    expect(script).not.toContain("eyJ");
    expect(script).not.toContain("service_role\":");
  });
});
