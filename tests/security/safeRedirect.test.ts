// Pins for the Workstream D (2026-11-15) open-redirect fix.
//
// Live-proven 2026-11-15: payment_links.redirect_url accepted
// 'https://evil.example.test/phish?x=1' and 'javascript:alert(...)' via
// direct PostgREST (bypassing developer-api validation), and
// payment-link-checkout describe returned both to the buyer; the
// checkout pages rendered the value as <a href> ("Return to store").
// Fixed in three layers: DB CHECK (migration 20261269), developer-api
// validation (already present), and this render-side guard.
import { describe, it, expect } from "vitest";
import { isSafeHttpUrl, safeRedirectUrl } from "../../src/utils/safeRedirect";

describe("isSafeHttpUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isSafeHttpUrl("https://example.com/store?x=1")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000/return")).toBe(true);
  });

  it("rejects scheme abuse and non-URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(document.domain)")).toBe(false);
    expect(isSafeHttpUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("//evil.example.test/phish")).toBe(false);
    expect(isSafeHttpUrl("/relative/path")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(12345)).toBe(false);
  });

  it("rejects over-long values (API limit is 2048)", () => {
    expect(isSafeHttpUrl("https://example.com/" + "a".repeat(2048))).toBe(false);
  });
});

describe("safeRedirectUrl", () => {
  it("returns the URL when safe, null otherwise", () => {
    expect(safeRedirectUrl("https://example.com/ok")).toBe("https://example.com/ok");
    expect(safeRedirectUrl("javascript:alert(1)")).toBeNull();
  });
});
