import { describe, expect, it } from "vitest";
import {
  merchantMatchesSearch,
  merchantStatusLabel,
  mergeMerchants,
  type MerchantRow,
} from "../../src/lib/merchantDirectory";

const merchant = (over: Partial<MerchantRow> = {}): MerchantRow => ({
  id: "m1",
  user_id: "u1",
  business_name: "MABVUTO BANDA SCIENCE, INFORMATION TECHNICAL CONSULTANCY",
  trading_name: "BMaGlass Pay",
  business_type: "consultancy",
  registration_number: "320261067236",
  status: "pending",
  mobile_money_enabled: true,
  momo_fee_bearer: "seller",
  created_at: "2026-11-12T00:00:00Z",
  ...over,
});

const directory = [
  {
    user_id: "u1",
    email: "owner@example.com",
    first_name: "Mabvuto",
    last_name: "Banda",
  },
];

describe("mergeMerchants", () => {
  it("prefers the trading name and keeps the registered name as the secondary line", () => {
    const [view] = mergeMerchants([merchant()], directory);
    expect(view.display_name).toBe("BMaGlass Pay");
    expect(view.registered_name).toContain("MABVUTO BANDA");
    expect(view.owner_email).toBe("owner@example.com");
    expect(view.owner_name).toBe("Mabvuto Banda");
  });

  it("falls back to the registered name when there is no trading name", () => {
    const [view] = mergeMerchants(
      [merchant({ trading_name: null })],
      directory,
    );
    expect(view.display_name).toContain("MABVUTO BANDA");
    expect(view.registered_name).toBeNull();
  });

  it("a merchant whose owner is missing from the directory still renders", () => {
    const [view] = mergeMerchants([merchant({ user_id: "ghost" })], directory);
    expect(view.owner_email).toBeNull();
    expect(view.owner_name).toBeNull();
    expect(view.display_name).toBe("BMaGlass Pay");
  });
});

describe("merchantMatchesSearch", () => {
  const [view] = mergeMerchants([merchant()], directory);

  it("matches business, owner, email and registration number", () => {
    expect(merchantMatchesSearch(view, "bmaglass")).toBe(true);
    expect(merchantMatchesSearch(view, "Mabvuto")).toBe(true);
    expect(merchantMatchesSearch(view, "owner@example")).toBe(true);
    expect(merchantMatchesSearch(view, "320261067236")).toBe(true);
  });

  it("an empty search matches everything; a miss matches nothing", () => {
    expect(merchantMatchesSearch(view, "")).toBe(true);
    expect(merchantMatchesSearch(view, "nonexistent")).toBe(false);
  });
});

describe("merchantStatusLabel", () => {
  it("labels the known statuses in plain language", () => {
    expect(merchantStatusLabel("active")).toBe("Active");
    expect(merchantStatusLabel("pending")).toBe("Pending review");
    expect(merchantStatusLabel("suspended")).toBe("Suspended");
    expect(merchantStatusLabel(null)).toBe("Unknown");
  });
});
