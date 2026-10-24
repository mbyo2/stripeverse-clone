// FIX-3 tests: audit actor labels fall back to EMAIL when the profile
// name is blank (no profile on the platform populates first/last
// name, so the console showed uuid + blank for every actor).
import { describe, it, expect } from "vitest";
import {
  attachProfileNames,
  auditActorLabel,
} from "../../src/utils/auditLogProfiles";

describe("auditActorLabel (FIX-3)", () => {
  it("prefers a real profile name", () => {
    expect(auditActorLabel({ id: "u1", first_name: "Ada", last_name: "Lovelace", email: "ada@x.io" })).toBe("Ada Lovelace");
  });
  it("falls back to email when names are empty strings (the live fleet shape)", () => {
    expect(auditActorLabel({ id: "u1", first_name: "", last_name: "", email: "fq3@bmaglasspay.online" })).toBe("fq3@bmaglasspay.online");
  });
  it("falls back to email when names are null", () => {
    expect(auditActorLabel({ id: "u1", first_name: null, last_name: null, email: "a@b.co" })).toBe("a@b.co");
  });
  it("returns blank only when neither name nor email exists", () => {
    expect(auditActorLabel({ id: "u1", first_name: null, last_name: null })).toBe("");
    expect(auditActorLabel(null)).toBe("");
    expect(auditActorLabel(undefined)).toBe("");
  });
  it("attachProfileNames carries the email through the merge", () => {
    const merged = attachProfileNames(
      [{ id: "l1", user_id: "u1" }],
      [{ id: "u1", first_name: "", last_name: "", email: "fq3@bmaglasspay.online" }],
    );
    expect(auditActorLabel(merged[0].profiles)).toBe("fq3@bmaglasspay.online");
  });
});
