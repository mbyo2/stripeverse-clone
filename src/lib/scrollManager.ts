// Scroll decision logic for route changes (used by components/ScrollManager).
//
// Why this exists (CEO report, 2026-10-28): the app had NO scroll
// management at all — no ScrollToTop, and the browser's default
// history.scrollRestoration ('auto') does not reset scroll on PUSH
// navigations. Every in-app navigation therefore kept the previous
// page's scroll offset; when the new page was shorter, the browser
// clamped to the maximum scroll, landing the user on the FOOTER of
// the new page. Measured live (headless Chrome, 390px): landing
// scrolled to 1500 -> click Pricing -> /pricing at scrollY 1500;
// footer Pricing link clicked from the bottom of the landing page ->
// /pricing at scrollY 3185 == maxScroll (the footer itself).
//
// Policy: a pathname change lands at the TOP, instantly. A location
// carrying a hash scrolls to that anchor instead (deep links like
// /page#section keep working). Hash/search-only changes on the same
// pathname never yank the page to the top.

export interface ScrollLocation {
  pathname: string;
  hash: string;
}

export type ScrollAction =
  | { type: 'top' }
  | { type: 'anchor'; id: string }
  | { type: 'none' };

export function resolveScrollAction(
  prev: ScrollLocation | null,
  next: ScrollLocation,
): ScrollAction {
  if (next.hash) {
    const id = next.hash.replace(/^#/, '');
    if (id && (!prev || prev.pathname !== next.pathname || prev.hash !== next.hash)) {
      let decoded = id;
      try {
        decoded = decodeURIComponent(id);
      } catch {
        // Malformed escape in the hash — fall back to the raw id.
      }
      return { type: 'anchor', id: decoded };
    }
    return { type: 'none' };
  }
  if (!prev || prev.pathname !== next.pathname) {
    return { type: 'top' };
  }
  return { type: 'none' };
}
