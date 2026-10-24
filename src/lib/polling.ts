// Shared polling discipline — scalability fix #5 (see
// goals/bmaglass-pay-completion-sweep/files/scalability-audit-2026-10-23.md).
//
// Polling was the platform's largest self-inflicted load: hand-rolled
// setInterval loops kept firing on hidden tabs, and react-query
// intervals kept polling long after the underlying trade/payment had
// settled. Two mechanisms, one home:
//
// 1. useVisibilityPolling / createVisibilityPoller — for hand-rolled
//    loops. The callback NEVER runs while the document is hidden, and
//    runs once immediately when the tab becomes visible again, so a
//    returning user sees fresh state without waiting out an interval.
//
// 2. pollUntil — for react-query's refetchInterval. React-query
//    already refuses to execute an interval fetch while the window is
//    unfocused (its timer checks focusManager.isFocused() and
//    refetchIntervalInBackground defaults to false), so visibility
//    needs no help there; what it lacked was a stop condition.
//    pollUntil returns a refetchInterval function that keeps the
//    cadence while the data is live and returns false once the data
//    reaches a terminal state the caller names — a settled trade or a
//    ruled dispute never polls again, however long the page stays
//    open. Mount, focus and invalidation refetches are unaffected:
//    freshness while the user is looking is unchanged.

import { useEffect, useRef } from "react";

/** True when the document is hidden (tab not visible). Safe in
 *  non-DOM environments (tests, SSR): reports visible. */
export function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" &&
    (document.hidden || document.visibilityState === "hidden")
  );
}

// ---------------------------------------------------------------------
// Hand-rolled polling: visibility-gated interval controller
// ---------------------------------------------------------------------

export interface VisibilityPollerOptions {
  /** Run the callback once as soon as the poller starts (and the tab
   *  is visible). Default true. */
  immediate?: boolean;
}

export interface PollingEnvironment {
  isHidden: () => boolean;
  /** Subscribe to visibility flips; returns an unsubscribe function. */
  onVisibilityChange: (listener: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}

function defaultPollingEnvironment(): PollingEnvironment {
  return {
    isHidden: isDocumentHidden,
    onVisibilityChange: (listener) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
}

export interface VisibilityPoller {
  start: () => void;
  stop: () => void;
}

/**
 * An interval poller that never fires while the document is hidden.
 * The interval timer itself keeps running (browsers throttle hidden
 * timers anyway) but every tick is gated, so a hidden tab produces
 * ZERO callback executions — and therefore zero network requests.
 * When the tab becomes visible again the callback runs once
 * immediately (resume freshness), then the cadence continues.
 */
export function createVisibilityPoller(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: VisibilityPollerOptions = {},
  env: PollingEnvironment = defaultPollingEnvironment(),
): VisibilityPoller {
  const { immediate = true } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;

  const tick = () => {
    if (!running || env.isHidden()) return;
    void callback();
  };

  return {
    start() {
      if (running) return;
      running = true;
      if (immediate) tick();
      timer = env.setInterval(tick, intervalMs);
      unsubscribe = env.onVisibilityChange(() => {
        // Became visible → refresh now instead of waiting out the
        // remainder of the interval. Became hidden → ticks gate off.
        if (!env.isHidden()) tick();
      });
    },
    stop() {
      running = false;
      if (timer !== null) {
        env.clearInterval(timer);
        timer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };
}

export interface UseVisibilityPollingOptions extends VisibilityPollerOptions {
  /** Master switch: false means no polling at all (terminal states,
   *  missing prerequisites). Toggling it starts/stops the poller.
   *  Default true. */
  enabled?: boolean;
}

/**
 * React wrapper over createVisibilityPoller. The latest callback is
 * always used (no stale closures, no interval resets when the
 * callback's identity changes); the poller restarts only when
 * enabled/immediate/intervalMs change.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: UseVisibilityPollingOptions = {},
): void {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createVisibilityPoller(() => callbackRef.current(), intervalMs, {
      immediate,
    });
    poller.start();
    return () => poller.stop();
  }, [enabled, immediate, intervalMs]);
}

// ---------------------------------------------------------------------
// React-query polling: cadence with a terminal stop
// ---------------------------------------------------------------------

/** Minimal structural shape of a react-query Query for interval
 *  purposes — all pollUntil needs is the latest data. */
export interface PollQueryLike<TData> {
  state: { data: TData | undefined };
}

/**
 * Build a react-query `refetchInterval` value that polls every
 * `intervalMs` until the query's data reaches a terminal state.
 *
 * Without `isTerminal` this returns the plain interval number (the
 * pre-existing behaviour, including react-query's built-in
 * hidden-tab pause). With it, the returned function yields the
 * interval while the data is live (or not yet loaded) and `false`
 * once terminal, so settled resources stop generating standing load.
 */
export function pollUntil(intervalMs: number): number;
export function pollUntil<TData>(
  intervalMs: number,
  isTerminal: (data: TData | undefined) => boolean,
): (query: PollQueryLike<TData>) => number | false;
export function pollUntil<TData>(
  intervalMs: number,
  isTerminal?: (data: TData | undefined) => boolean,
): number | ((query: PollQueryLike<TData>) => number | false) {
  if (!isTerminal) return intervalMs;
  return (query) => (isTerminal(query.state.data) ? false : intervalMs);
}
