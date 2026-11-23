// SEO / GEO pins for BMaGlass Pay (2026-11-23).
//
// What is pinned:
//   1. index.html carries the global, wallet-first title, the canonical
//      https://bmaglasspay.online/ URL, absolute Open Graph / Twitter
//      image URLs pointing at the real /og-image.png, and JSON-LD with
//      an Organization and a SoftwareApplication (no price claims).
//   2. public/robots.txt explicitly allows the major AI crawlers and
//      references the sitemap.
//   3. public/sitemap.xml lists exactly the public routes in
//      src/lib/pageMeta.ts (SITEMAP_PATHS) — no authenticated routes.
//   4. public/llms.txt states the quotable facts: global Bitcoin wallet,
//      wallet first, founder Mabvuto Banda, Lusaka home base, worldwide.
//   5. No metadata or crawler file talks about pricing/fees, invents
//      statistics, or names the founder's consultancy.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PUBLIC_PAGE_META, SITEMAP_PATHS, SITE_URL } from "../../src/lib/pageMeta";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const FORBIDDEN = [/fee/i, /Mabvuto Banda Science/i, /zero[- ]cost/i, /\d[\d,]*\+?\s+users/i];

describe("index.html head", () => {
  const html = read("index.html");

  it("leads with the Bitcoin wallet in a global title", () => {
    expect(html).toContain("<title>BMaGlass Pay — Bitcoin Wallet & Payments for Everyone</title>");
    expect(html).not.toContain("Zambia's Premier");
    expect(html).not.toContain("bmaglasspay.com");
    expect(html).toContain('<html lang="en">');
  });

  it("has the canonical URL and absolute social images", () => {
    expect(html).toContain('<link rel="canonical" href="https://bmaglasspay.online/" />');
    expect(html).toContain('<meta property="og:image" content="https://bmaglasspay.online/og-image.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://bmaglasspay.online/og-image.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(existsSync(resolve(process.cwd(), "public/og-image.png"))).toBe(true);
  });

  it("carries Organization + SoftwareApplication JSON-LD with truthful attributes only", () => {
    expect(html).toContain('"@type": "Organization"');
    expect(html).toContain('"@type": "SoftwareApplication"');
    expect(html).toContain('"applicationCategory": "FinanceApplication"');
    expect(html).toContain('"name": "Mabvuto Banda"');
    expect(html).toContain('"areaServed": "Worldwide"');
    expect(html).not.toContain('"offers"');
    expect(html).not.toContain('"price"');
  });

  it("keeps forbidden claims out of the head", () => {
    for (const pattern of FORBIDDEN) expect(html).not.toMatch(pattern);
  });
});

describe("crawler files", () => {
  it("robots.txt allows search + AI crawlers and references the sitemap", () => {
    const robots = read("public/robots.txt");
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"]) {
      expect(robots).toContain(`User-agent: ${bot}`);
    }
    expect(robots).toContain("Sitemap: https://bmaglasspay.online/sitemap.xml");
    expect(robots).not.toMatch(/Disallow:\s+\//);
  });

  it("sitemap.xml lists exactly the public page-meta routes", () => {
    const sitemap = read("public/sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>(https:\/\/bmaglasspay\.online[^<]*)<\/loc>/g)].map((m) =>
      m[1].replace(SITE_URL, "") || "/",
    );
    expect(locs.sort()).toEqual([...SITEMAP_PATHS].sort());
    for (const authed of ["/dashboard", "/wallet", "/admin", "/p2p", "/login"]) {
      expect(sitemap).not.toContain(`<loc>${SITE_URL}${authed}</loc>`);
    }
  });

  it("llms.txt states the quotable facts with no forbidden claims", () => {
    const llms = read("public/llms.txt");
    expect(llms).toContain("# BMaGlass Pay");
    expect(llms).toContain("Bitcoin wallet");
    expect(llms).toContain("everyone in the world");
    expect(llms).toContain("Mabvuto Banda");
    expect(llms).toContain("Lusaka, Zambia");
    expect(llms).toContain("Virtual cards: coming soon");
    for (const pattern of FORBIDDEN) expect(llms).not.toMatch(pattern);
  });
});

describe("per-route meta map", () => {
  it("gives every public route a wallet-aware title and description", () => {
    for (const [path, meta] of Object.entries(PUBLIC_PAGE_META)) {
      expect(meta.title, path).toContain("BMaGlass Pay");
      expect(meta.description.length, path).toBeGreaterThan(50);
      for (const pattern of FORBIDDEN) {
        expect(meta.title, path).not.toMatch(pattern);
        expect(meta.description, path).not.toMatch(pattern);
      }
    }
  });
});
