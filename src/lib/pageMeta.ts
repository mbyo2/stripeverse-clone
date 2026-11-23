// Per-route SEO / AI-search metadata for BMaGlass Pay's public pages.
//
// There is no head-management library in this stack, so this module is
// the single source of truth: AnimatedRoutes calls applyPageMeta() on
// every navigation, which updates document.title, the meta description,
// the canonical link and the Open Graph / Twitter tags to match the
// route. Authenticated app routes are deliberately absent — they fall
// back to the site defaults from index.html and are excluded from the
// sitemap. Copy rules (standing): wallet first, global audience, and
// no pricing claims of any kind in metadata.

export interface PageMeta {
  title: string;
  description: string;
}

export const SITE_NAME = "BMaGlass Pay";
export const SITE_URL = "https://bmaglasspay.online";
export const DEFAULT_TITLE = "BMaGlass Pay — Bitcoin Wallet & Payments for Everyone";
export const DEFAULT_DESCRIPTION =
  "BMaGlass Pay is a Bitcoin wallet and payments platform for everyone, everywhere. Sell, send and receive Bitcoin — in a custodial wallet or your own self-custody wallet — and pay or get paid by payment link, PayPal or Bitcoin.";

export const PUBLIC_PAGE_META: Record<string, PageMeta> = {
  "/": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  "/about": {
    title: "About BMaGlass Pay — Bitcoin Wallet & Payments, Built in Lusaka for the World",
    description:
      "BMaGlass Pay is a global Bitcoin wallet and payments platform founded by Mabvuto Banda in Lusaka, Zambia. Learn what BMaGlass Pay is, who it is for, and how its Bitcoin wallet, P2P marketplace and payment tools work.",
  },
  "/pricing": {
    title: "Pricing — BMaGlass Pay",
    description:
      "How BMaGlass Pay pricing works: no subscription plans — you only pay in connection with transactions you actually make through the Bitcoin wallet and payments platform.",
  },
  "/business": {
    title: "BMaGlass Pay for Business — Accept Bitcoin & Mobile Money Payments",
    description:
      "Businesses and merchants use BMaGlass Pay to accept Bitcoin payments, share payment links, use Bitcoin POS, and collect mobile money payments in Zambia — with a Bitcoin wallet at the centre.",
  },
  "/developers": {
    title: "Developers — BMaGlass Pay API, SDKs & Connectors",
    description:
      "Build on BMaGlass Pay: API keys, SDKs, webhooks and ready-made connectors for accepting Bitcoin and wallet payments in your own product or online store.",
  },
  "/developers/connectors": {
    title: "Connectors — BMaGlass Pay for WooCommerce, Odoo, Magento & More",
    description:
      "Ready-made BMaGlass Pay connectors and plugins for popular platforms, so merchants can accept Bitcoin and wallet payments from their existing store or system.",
  },
  "/api": {
    title: "API — BMaGlass Pay",
    description:
      "The BMaGlass Pay API for Bitcoin wallet and payments integration: payment links, checkouts, webhooks and merchant collections, documented for developers.",
  },
  "/sdk-docs": {
    title: "SDK Documentation — BMaGlass Pay",
    description:
      "SDK documentation for integrating BMaGlass Pay Bitcoin wallet payments into websites and applications.",
  },
  "/blog": {
    title: "Blog — BMaGlass Pay",
    description:
      "News, guides and explainers from BMaGlass Pay on Bitcoin, wallets, Lightning payments and getting paid — written for everyone, everywhere.",
  },
  "/faq": {
    title: "FAQ — BMaGlass Pay Bitcoin Wallet & Payments",
    description:
      "Answers to common questions about BMaGlass Pay: the Bitcoin wallet, self-custody, the P2P Bitcoin marketplace, payment links, Bitcoin POS and PayPal payments.",
  },
  "/help": {
    title: "Help Centre — BMaGlass Pay",
    description:
      "Help and guidance for using BMaGlass Pay: setting up your Bitcoin wallet, sending and receiving Bitcoin, payment links, P2P trades and account security.",
  },
  "/support": {
    title: "Support — BMaGlass Pay",
    description:
      "Contact BMaGlass Pay support for help with your Bitcoin wallet, payments, P2P trades, merchant tools and account questions.",
  },
  "/contact": {
    title: "Contact — BMaGlass Pay",
    description:
      "Get in touch with BMaGlass Pay — the global Bitcoin wallet and payments platform headquartered in Lusaka, Zambia and serving users worldwide.",
  },
  "/privacy-policy": {
    title: "Privacy Policy — BMaGlass Pay",
    description:
      "How BMaGlass Pay collects, uses and protects personal data across its Bitcoin wallet and payments platform.",
  },
  "/terms-of-service": {
    title: "Terms of Service — BMaGlass Pay",
    description:
      "The terms that govern use of BMaGlass Pay, the Bitcoin wallet and payments platform for everyone, everywhere.",
  },
};

/** Public routes that belong in sitemap.xml — keep in step with PUBLIC_PAGE_META. */
export const SITEMAP_PATHS: string[] = Object.keys(PUBLIC_PAGE_META);

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Apply the meta for a pathname; unknown (app) routes get the site defaults. */
export function applyPageMeta(pathname: string): void {
  if (typeof document === "undefined") return;
  const meta = PUBLIC_PAGE_META[pathname] ?? {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  };
  const url = pathname === "/" ? `${SITE_URL}/` : `${SITE_URL}${pathname}`;

  document.title = meta.title;
  upsertMeta('meta[name="description"]', "name", "description", meta.description);
  upsertMeta('meta[property="og:title"]', "property", "og:title", meta.title);
  upsertMeta('meta[property="og:description"]', "property", "og:description", meta.description);
  upsertMeta('meta[property="og:url"]', "property", "og:url", url);
  upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", meta.title);
  upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", meta.description);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", url);
}
