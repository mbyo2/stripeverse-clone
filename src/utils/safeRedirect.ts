// Safe-redirect guard (Workstream D, 2026-11-15).
//
// Payment-link redirect_url values reach the checkout pages from the
// server (payment-link-checkout describe) and are rendered as
// <a href>. The database CHECK (migration 20261269) and the
// developer-api validation both require absolute http(s) URLs, but
// rows written before the constraint — or through any future write
// path that skips validation — must never turn a checkout page into
// a javascript:/data: launchpad. This is the render-side choke point:
// a value that fails this check is treated as "no redirect".
//
// A merchant-chosen https destination is still the merchant's own
// store URL (same model as any payment-link return URL); this guard
// only blocks non-http(s) schemes and malformed values.

/** True only for an absolute http(s) URL of at most 2048 characters. */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

/** The URL to render, or null when the stored value is not a safe http(s) URL. */
export function safeRedirectUrl(value: unknown): string | null {
  return isSafeHttpUrl(value) ? value : null;
}
