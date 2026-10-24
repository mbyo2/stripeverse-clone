// FIX-3 tests: audit actor labels fall back to EMAIL when the profile
// name is blank (no profile on the platform populates first/last
// name, so the console showed uuid + blank for every actor).
import { describe, it, expect } from "vitest";
import {
  attachProfileNames,
  auditActorLabel,
  auditRowActorLabel,
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

// BUG-7: the row-level label the /audit-logs page renders. It must
// NEVER be blank — previously the page rendered the actor only when
// a profile resolved, so rows whose user_id was null (the audit
// trigger stamps auth.uid(), which is null under the service-role
// writes that dominate the platform) showed no actor at all.
describe("auditRowActorLabel (BUG-7)", () => {
  it("shows the resolved email for an actor row (fq3's freeze rows)", () => {
    const merged = attachProfileNames(
      [{ id: "l1", user_id: "479fb30c-db3e-4771-bfc7-b077d8ef1cab" }],
      [{ id: "479fb30c-db3e-4771-bfc7-b077d8ef1cab", first_name: null, last_name: null, email: "fq3@bmaglasspay.online" }],
    );
    expect(auditRowActorLabel(merged[0])).toBe("fq3@bmaglasspay.online");
  });
  it("prefers a resolved profile name over the email", () => {
    expect(
      auditRowActorLabel({
        user_id: "u1",
        profiles: { id: "u1", first_name: "Ada", last_name: "Lovelace", email: "ada@x.io" },
      }),
    ).toBe("Ada Lovelace");
  });
  it("falls back to the actor id fragment when the actor cannot be resolved", () => {
    expect(auditRowActorLabel({ user_id: "141dc806-4c86-43e2-969c-79285d0d5a1d", profiles: null })).toBe("141dc806...");
    expect(
      auditRowActorLabel({
        user_id: "141dc806-4c86-43e2-969c-79285d0d5a1d",
        profiles: { id: "141dc806-4c86-43e2-969c-79285d0d5a1d", first_name: null, last_name: null, email: null },
      }),
    ).toBe("141dc806...");
  });
  it("labels actor-less rows System (service-role writes carry no end-user id)", () => {
    expect(auditRowActorLabel({ user_id: null, profiles: null })).toBe("System");
    expect(auditRowActorLabel({ user_id: null })).toBe("System");
  });
  it("attachProfileNames rows for actor-less logs take the System tier", () => {
    const merged = attachProfileNames([{ id: "l1", user_id: null }], []);
    expect(auditRowActorLabel(merged[0])).toBe("System");
  });
});
