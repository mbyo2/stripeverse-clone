// Global-repositioning fix (2026-11-04): the first-visit display
// currency is no longer hard-defaulted to ZMW for the whole world.
// With NO saved preference, the default comes from the browser
// locale (Zambia → ZMW, a supported-currency locale → that currency,
// anything else → USD). A saved `preferred_currency` ALWAYS wins.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { detectDefaultCurrency } from "../../src/contexts/CurrencyContext";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const ctx = read("../../src/contexts/CurrencyContext.tsx");

describe("detectDefaultCurrency — locale-derived first-visit default", () => {
  it("maps a Zambian locale to ZMW", () => {
    expect(detectDefaultCurrency("en-ZM")).toBe("ZMW");
    expect(detectDefaultCurrency("bem-ZM")).toBe("ZMW");
  });

  it("maps a US locale to USD", () => {
    expect(detectDefaultCurrency("en-US")).toBe("USD");
  });

  it("maps euro-area locales to EUR", () => {
    expect(detectDefaultCurrency("de-DE")).toBe("EUR");
    expect(detectDefaultCurrency("fr-FR")).toBe("EUR");
  });

  it("maps a UK locale to GBP", () => {
    expect(detectDefaultCurrency("en-GB")).toBe("GBP");
  });

  it("falls back to USD for unsupported, unknown or missing locales", () => {
    expect(detectDefaultCurrency("ja-JP")).toBe("USD");
    expect(detectDefaultCurrency("xx-XX")).toBe("USD");
    expect(detectDefaultCurrency("not a locale")).toBe("USD");
    expect(detectDefaultCurrency("")).toBe("USD");
    expect(detectDefaultCurrency(null)).toBe("USD");
    expect(detectDefaultCurrency(undefined)).toBe("USD");
  });
});

describe("CurrencyProvider — saved preference always wins", () => {
  it("reads localStorage BEFORE falling back to the locale default", () => {
    const storedIdx = ctx.indexOf("localStorage.getItem(STORAGE_KEY)");
    const detectIdx = ctx.indexOf("detectDefaultCurrency(navigator.language)");
    expect(storedIdx).toBeGreaterThan(-1);
    expect(detectIdx).toBeGreaterThan(storedIdx);
  });

  it("no longer returns the ZMW constant as the provider fallback", () => {
    const start = ctx.indexOf("useState<SupportedCurrency>");
    const initializer = ctx.slice(start, start + 900);
    expect(initializer).not.toContain("return DEFAULT_CURRENCY");
    expect(initializer).toContain("detectDefaultCurrency(navigator.language)");
  });
});
