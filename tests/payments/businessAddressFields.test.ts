// Global-repositioning fix (2026-11-04): BusinessSettings used to save
// EVERY merchant's address as { street, city: "Lusaka", country:
// "Zambia" } because the form only collected a street. The form now
// collects City and Country, pre-fills them from the saved address
// (defaulting to Lusaka/Zambia only when nothing is saved) and saves
// exactly what the merchant enters.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const src = read("../../src/components/business/BusinessSettings.tsx");

describe("BusinessSettings — merchant-entered city and country", () => {
  it("no longer hardcodes Lusaka/Zambia into the saved address", () => {
    expect(src).not.toContain('city: "Lusaka", country: "Zambia"');
    expect(src).toContain(
      "address = { street: data.businessAddress, city: data.businessCity, country: data.businessCountry }",
    );
  });

  it("validates city and country in the form schema", () => {
    expect(src).toContain("businessCity: z.string()");
    expect(src).toContain("businessCountry: z.string()");
  });

  it("renders City and Country fields in the form", () => {
    expect(src).toContain('name="businessCity"');
    expect(src).toContain('name="businessCountry"');
  });

  it("pre-fills from the saved address, defaulting only when unsaved", () => {
    expect(src).toContain('businessCity: address.city || "Lusaka"');
    expect(src).toContain('businessCountry: address.country || "Zambia"');
  });
});
