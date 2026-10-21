// Unit tests for src/utils/displayName.ts — greeting name resolution.
// Regression target (QA Wave 4): the dashboard greeted from auth
// user_metadata only, so a user who saved First "QA" / Last "Three"
// in Settings was still greeted "Welcome back, there".

import { describe, it, expect } from "vitest";
import { resolveFirstName } from "../../src/utils/displayName";

describe("resolveFirstName", () => {
  it("prefers the profiles row over auth metadata", () => {
    expect(
      resolveFirstName({ first_name: "QA" }, { user_metadata: { first_name: "Other" } }),
    ).toBe("QA");
  });

  it("uses the saved profile name when metadata has none (the QA Wave 4 case)", () => {
    expect(resolveFirstName({ first_name: "QA" }, { user_metadata: {} })).toBe("QA");
    expect(resolveFirstName({ first_name: "QA" }, null)).toBe("QA");
  });

  it("falls back to metadata first_name when the profile has none", () => {
    expect(
      resolveFirstName({ first_name: null }, { user_metadata: { first_name: "Mabvuto" } }),
    ).toBe("Mabvuto");
    expect(resolveFirstName(null, { user_metadata: { first_name: "Mabvuto" } })).toBe("Mabvuto");
  });

  it("falls back to the first word of metadata full_name", () => {
    expect(
      resolveFirstName({ first_name: "  " }, { user_metadata: { full_name: "QA Three" } }),
    ).toBe("QA");
  });

  it("falls back to 'there' when no source has a name", () => {
    expect(resolveFirstName(null, null)).toBe("there");
    expect(resolveFirstName({ first_name: null }, { user_metadata: {} })).toBe("there");
    expect(resolveFirstName(undefined, undefined)).toBe("there");
  });

  it("trims whitespace from the profile name", () => {
    expect(resolveFirstName({ first_name: "  QA  " }, null)).toBe("QA");
  });
});
