// PayPal-blue palette pins (CEO order, 2026-11-11): "use paypal blue
// on both apps even inside" and no gradient sections inside the
// product.
//
// The system these tests pin:
//   - --primary is PayPal blue #0070E0 (HSL 210 100% 44%) — primary
//     buttons, links, active/selected states and focus rings read
//     from it; --ring is the same blue.
//   - Navy #003087 (HSL 219 100% 26%, --paypal-dark) is the family's
//     dark shade, used for emphasis surfaces only — the dashboard and
//     wallet balance bands are navy, never the action blue.
//   - Bitcoin orange stays ONLY in --bitcoin.
//   - No Tailwind default-blue classes (bg-blue-500, text-blue-600…)
//     in components — that royal blue is a different family.
//   - No gradients in the product: the only linear-gradient allowed
//     anywhere in src is the skeleton shimmer sweep in index.css.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const css = read("src/index.css");
const lightTokens = css.slice(css.indexOf(":root"), css.indexOf(".dark"));

const walkTsx = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkTsx(p);
    return e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [p] : [];
  });
const srcFiles = walkTsx(path.join(repoRoot, "src"));

describe("PayPal blue is the one action colour", () => {
  it("light --primary and --ring are PayPal blue #0070E0", () => {
    expect(lightTokens).toContain("--primary: 210 100% 44%");
    expect(lightTokens).toContain("--ring: 210 100% 44%");
  });

  it("navy #003087 remains the emphasis token; bitcoin orange is untouched", () => {
    expect(lightTokens).toContain("--paypal-dark: 219 100% 26%");
    expect(lightTokens).toContain("--bitcoin: 33 93% 54%");
    // chart series lead with the action blue, navy second
    expect(lightTokens).toContain("--chart-1: 210 100% 44%");
    expect(lightTokens).toContain("--chart-2: 219 100% 26%");
  });

  it("balance bands are navy emphasis surfaces, not action blue", () => {
    expect(read("src/pages/Dashboard.tsx")).toContain(
      'className="bg-[#003087] rounded-lg px-6 py-6 md:px-8 mb-6"',
    );
    const walletBalance = read("src/components/wallet/WalletBalance.tsx");
    expect(walletBalance).toContain('className="bg-[#003087] p-6 md:p-8"');
    expect(walletBalance).not.toContain('className="bg-primary p-6');
  });

  it("no Tailwind default-blue classes survive in components", () => {
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const src = fs.readFileSync(f, "utf8");
      // strip comments — a historical note in KycVerificationStatus
      // names the old classes it replaced; prose is not usage.
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(?:bg|text|border|ring)-blue-\d/.test(code)) {
        offenders.push(path.relative(repoRoot, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("no gradients inside the product", () => {
  it("no gradient utilities or gradient functions in any component", () => {
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const src = fs.readFileSync(f, "utf8");
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (
        /bg-gradient-/.test(code) ||
        /(?:linear|radial|conic)-gradient\(/.test(code)
      ) {
        offenders.push(path.relative(repoRoot, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("index.css gradients are only the skeleton shimmer (light + dark)", () => {
    const hits = css.match(/linear-gradient\(/g) ?? [];
    expect(hits.length).toBe(2);
    expect(css).not.toMatch(/bg-gradient-/);
  });
});
