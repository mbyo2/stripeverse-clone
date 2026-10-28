// Source-level tests for the virtual-cards "Coming soon" gate and
// the /contact address removal (CEO decisions, 2026-10-22).
//
// Virtual cards stay admin-only until the Mastercard
// developer-platform integration is built and tested: the three card
// pages render a Coming Soon panel for non-admins, and the two card
// edge functions refuse non-admins server-side. The /contact page no
// longer publishes the specific street address.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const cardNew = read("../../src/pages/VirtualCardNew.tsx");
const cardDetails = read("../../src/pages/VirtualCardDetails.tsx");
const cardFund = read("../../src/pages/VirtualCardFund.tsx");
const comingSoon = read("../../src/components/VirtualCardsComingSoon.tsx");
const createFn = read("../../supabase/functions/create-virtual-card/index.ts");
const fundFn = read("../../supabase/functions/fund-virtual-card/index.ts");
const contact = read("../../src/pages/Contact.tsx");

describe("virtual card pages are gated to admins", () => {
  it.each([
    ["VirtualCardNew", cardNew],
    ["VirtualCardDetails", cardDetails],
    ["VirtualCardFund", cardFund],
  ])("%s renders Coming Soon for non-admins", (_name, page) => {
    expect(page).toContain("VirtualCardsComingSoon");
    expect(page).toContain('hasRole("admin")');
    expect(page).toContain("useRoles");
  });

  it("the Coming Soon copy is honest about what exists today", () => {
    expect(comingSoon).toContain("coming soon");
    expect(comingSoon).toContain("Mastercard developer");
    // No fake launch date promised in the rendered copy (the code
    // comment above the component cites the decision date — the date
    // check applies to the JSX only).
    const jsx = comingSoon.slice(comingSoon.indexOf("const VirtualCardsComingSoon"));
    expect(jsx).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  });
});

describe("virtual card edge functions refuse non-admins server-side", () => {
  it.each([
    ["create-virtual-card", createFn],
    ["fund-virtual-card", fundFn],
  ])("%s checks the admin role before acting", (_name, fn) => {
    expect(fn).toContain('from("user_roles")');
    // SweepB 2026-10-28: super_admin is additive over admin (the card
    // pages and manage-virtual-card already treat it so) — a
    // super_admin-only holder passed the UI gate but was refused
    // here with the public "coming soon" message. The gate now checks
    // both roles; everyone else still gets the 403 below.
    expect(fn).toContain('.in("role", ["admin", "super_admin"])');
    expect(fn).toContain("Virtual cards are coming soon");
    expect(fn).toContain("status: 403");
  });
});

describe("no 'Monthly Maintenance K5.00' claim exists", () => {
  it("card pages and functions carry no maintenance-fee claim", () => {
    for (const source of [cardNew, cardDetails, cardFund, createFn, fundFn]) {
      expect(source.toLowerCase()).not.toContain("monthly maintenance");
    }
  });
});

describe("/contact address removal", () => {
  it("no longer publishes the specific street address or postal code", () => {
    expect(contact).not.toContain("123 Cairo Road");
    expect(contact).not.toContain("10101");
  });

  it("keeps the general location wording and the contact form", () => {
    expect(contact).toContain("Lusaka, Zambia");
    expect(contact).toContain("Send Message");
    expect(contact).toContain("Contact Information");
  });
});
