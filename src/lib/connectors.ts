/**
 * The BMaGlass Pay connectors directory — the data behind
 * /developers/connectors.
 *
 * Source of truth: the PUBLIC connectors repository
 * (github.com/mbyo2/bmaglasspay-connectors, MIT). Every folder and
 * README link below was verified against the live repo tree on
 * 2026-10-30 (repo commit ddf5f26): integrations/{wordpress, odoo,
 * magento, prestashop, opencart, embed, automation} and
 * sdk/{typescript, python, php, react-native, flutter}, each with a
 * README.md at its root.
 *
 * Honesty rules (do not weaken):
 *  - Shopify is NOT listed: integrations/shopify holds an
 *    ASSESSMENT.md only — checkout payments are gated by Shopify's
 *    payments partner programme, so no connector exists.
 *  - The SDKs are distributed from the repository only. They are NOT
 *    published to npm, PyPI, Packagist or pub.dev — never present a
 *    registry listing that does not exist. The Flutter SDK is
 *    source-available from the repo.
 *  - Version ranges and the install-tested claims are the ones the
 *    connectors programme verified on genuine installs on
 *    2026-10-26 (see VERSIONS.md in the repo for the full matrix).
 */

export const CONNECTORS_REPO_URL =
  "https://github.com/mbyo2/bmaglasspay-connectors";
export const CONNECTORS_REPO_LICENSE_URL = `${CONNECTORS_REPO_URL}/blob/main/LICENSE`;
export const CONNECTORS_REPO_VERSIONS_URL = `${CONNECTORS_REPO_URL}/blob/main/VERSIONS.md`;
export const CONNECTORS_REPO_README_URL = `${CONNECTORS_REPO_URL}/blob/main/README.md`;

const tree = (p: string) => `${CONNECTORS_REPO_URL}/tree/main/${p}`;
const blob = (p: string) => `${CONNECTORS_REPO_URL}/blob/main/${p}`;

export interface ConnectorEntry {
  /** Display name of the platform / artefact. */
  name: string;
  /** One line: what it does. */
  blurb: string;
  /** Supported versions, only where verified. */
  versions: string;
  /** Proof/status line, only what was actually verified. */
  proof: string;
  /** Link to the artefact's folder in the repo. */
  folderUrl: string;
  /** Link to the artefact's README / getting-started doc. */
  readmeUrl: string;
}

export const STORE_CONNECTORS: ConnectorEntry[] = [
  {
    name: "WooCommerce",
    blurb:
      "Payment gateway plugin for WooCommerce stores — hosted checkout via payment link, orders completed automatically from the signed webhook, with polling reconciliation as the fallback.",
    versions: "WordPress 6.0+ · WooCommerce 7.0 – 11.2 (HPOS + legacy storage, Checkout Blocks + classic checkout)",
    proof: "Install-tested on a genuine WordPress + WooCommerce install, 2026-10-26",
    folderUrl: tree("integrations/wordpress"),
    readmeUrl: blob("integrations/wordpress/README.md"),
  },
  {
    name: "Odoo",
    blurb:
      "Payment provider module for Odoo — one module per Odoo major, each adapted to that version's payment framework, settling orders from the signed webhook.",
    versions: "Odoo 16.0, 17.0, 18.0, 19.0 and 20.0",
    proof: "Install-tested on genuine installs of all five versions, 2026-10-26",
    folderUrl: tree("integrations/odoo"),
    readmeUrl: blob("integrations/odoo/README.md"),
  },
  {
    name: "Magento 2",
    blurb:
      "Payment method module for Magento 2, installed via Composer and built on the PHP SDK, with webhook capture and exactly-once order processing.",
    versions: "Magento 2.4.6 – 2.4.9",
    proof: "Install-tested on a genuine Magento 2.4.8 install, 2026-10-26",
    folderUrl: tree("integrations/magento"),
    readmeUrl: blob("integrations/magento/README.md"),
  },
  {
    name: "PrestaShop",
    blurb:
      "Payment module for PrestaShop — one build per platform major, each declaring its own compliancy range, built on the PHP SDK.",
    versions: "PrestaShop 1.7, 8.x and 9.x",
    proof: "Install-tested on genuine PrestaShop 9.0.0, 8.1.7 and 1.7.8.11 installs, 2026-10-26",
    folderUrl: tree("integrations/prestashop"),
    readmeUrl: blob("integrations/prestashop/README.md"),
  },
  {
    name: "OpenCart",
    blurb:
      "Payment extension for OpenCart — separate builds for the 3.x and 4.x platform conventions, built on the PHP SDK.",
    versions: "OpenCart 3.0.x and 4.x",
    proof: "Install-tested on genuine OpenCart installs, 2026-10-26",
    folderUrl: tree("integrations/opencart"),
    readmeUrl: blob("integrations/opencart/README.md"),
  },
  {
    name: "Embed button — any website",
    blurb:
      "One small script that renders a “Pay with BMaGlass Pay” button bound to a public payment link. It refuses raw API keys, so nothing secret ever sits in a page.",
    versions: "Any website — including Wix, Squarespace, Webflow and static HTML",
    proof: "Ships with DOM tests in the repository",
    folderUrl: tree("integrations/embed"),
    readmeUrl: blob("integrations/embed/README.md"),
  },
  {
    name: "Zapier / Make automation",
    blurb:
      "Webhook-first recipes that react to BMaGlass Pay events (for example payment_link.paid) using Zapier's and Make's native webhook and HTTP modules.",
    versions: "Zapier and Make, via their native modules",
    proof: "Recipes in the repository — there is no app-store listing; the included Zapier app definition is an unsubmitted draft",
    folderUrl: tree("integrations/automation"),
    readmeUrl: blob("integrations/automation/README.md"),
  },
];

export interface SdkEntry {
  name: string;
  /** Package name as declared in the repo (a repo package name, not a registry listing). */
  packageName: string;
  blurb: string;
  /** Availability note — where the SDK can actually be obtained today. */
  availability: string;
  folderUrl: string;
  readmeUrl: string;
}

export const SDKS: SdkEntry[] = [
  {
    name: "TypeScript / JavaScript",
    packageName: "@bmaglass/sdk",
    blurb:
      "Typed client for the developer API, with BMaGlassError and webhook-signature verification helpers.",
    availability: "Source in the repository — not yet published to npm",
    folderUrl: tree("sdk/typescript"),
    readmeUrl: blob("sdk/typescript/README.md"),
  },
  {
    name: "Python",
    packageName: "bmaglass-sdk",
    blurb:
      "Requests-based client for the developer API, with webhook verification and event parsing helpers.",
    availability: "Source in the repository — not yet published to PyPI",
    folderUrl: tree("sdk/python"),
    readmeUrl: blob("sdk/python/README.md"),
  },
  {
    name: "PHP",
    packageName: "bmaglass/bmaglass-sdk",
    blurb:
      "Framework-free cURL client for the developer API — the same client the shop connectors vendor.",
    availability: "Source in the repository — not yet published to Packagist",
    folderUrl: tree("sdk/php"),
    readmeUrl: blob("sdk/php/README.md"),
  },
  {
    name: "React Native / Expo",
    packageName: "@bmaglass/sdk-react-native",
    blurb: "Client for React Native and Expo apps, mirroring the TypeScript SDK's surface.",
    availability: "Source in the repository — not yet published to npm",
    folderUrl: tree("sdk/react-native"),
    readmeUrl: blob("sdk/react-native/README.md"),
  },
  {
    name: "Flutter (Dart)",
    packageName: "bmaglass_sdk",
    blurb:
      "Pure-Dart client for Flutter apps — no Flutter engine needed to run its test suite.",
    availability: "Source-available in the repository — not published to pub.dev",
    folderUrl: tree("sdk/flutter"),
    readmeUrl: blob("sdk/flutter/README.md"),
  },
];

export const SDK_GUIDE_URL = blob("sdk/README.md");
