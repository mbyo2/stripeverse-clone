import { describe, it, expect } from "vitest";
import { formatCardExpiry } from "../../src/utils/cardDisplay";

// Live virtual_cards.expiry_date is a DATE (verified 2026-10-23), so
// rows arrive as ISO 'YYYY-MM-DD'; card surfaces display MM/YY.
describe("formatCardExpiry", () => {
  it("renders an ISO date as MM/YY", () => {
    expect(formatCardExpiry("2029-10-31")).toBe("10/29");
    expect(formatCardExpiry("2030-01-15")).toBe("01/30");
    expect(formatCardExpiry("2028-12-01")).toBe("12/28");
  });

  it("tolerates a full timestamp", () => {
    expect(formatCardExpiry("2029-10-31T00:00:00.000Z")).toBe("10/29");
  });

  it("passes through anything that is not an ISO date unchanged", () => {
    expect(formatCardExpiry("10/29")).toBe("10/29");
    expect(formatCardExpiry("")).toBe("");
  });
});
