import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveScrollAction, type ScrollLocation } from '@/lib/scrollManager';

// Central scroll management for every route change — see
// lib/scrollManager.ts for the measured root cause (navigations kept
// the previous page's scroll offset and clamped to the new page's
// footer). Rendered once by AnimatedRoutes, inside the Router.
//
// - history.scrollRestoration is set to 'manual' so the browser never
//   fights this component on Back/Forward: every pathname change
//   lands at the top, deterministically. (Native 'auto' restoration
//   is unreliable here anyway: routes are lazy chunks behind an exit
//   animation, so restored offsets clamp against a half-built page.)
// - Hash locations scroll to their anchor. The target may not exist
//   yet when the location changes (lazy chunk + AnimatePresence
//   mode="wait"), so the lookup retries briefly until the new page
//   has mounted.
const ScrollManager = () => {
  const location = useLocation();
  const prevRef = useRef<ScrollLocation | null>(null);

  useLayoutEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  useLayoutEffect(() => {
    const next: ScrollLocation = {
      pathname: location.pathname,
      hash: location.hash,
    };
    const action = resolveScrollAction(prevRef.current, next);
    prevRef.current = next;

    if (action.type === 'top') {
      window.scrollTo(0, 0);
      return;
    }
    if (action.type === 'anchor') {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const tryScroll = () => {
        if (cancelled) return;
        const el = document.getElementById(action.id);
        if (el) {
          el.scrollIntoView();
          return;
        }
        // Target not mounted yet — the retries below cover the
        // lazy-chunk + exit-animation window.
      };
      tryScroll();
      for (const delay of [50, 150, 350, 700]) {
        timers.push(setTimeout(tryScroll, delay));
      }
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }
  }, [location]);

  return null;
};

export default ScrollManager;
