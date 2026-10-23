// Scalability fix #5 — tame client polling.
//
// Pins the shared polling discipline (src/lib/polling.ts):
//  - hand-rolled pollers NEVER fire while the document is hidden and
//    refresh once immediately when the tab becomes visible again;
//  - react-query pollers stop at terminal states (pollUntil);
//  - the hot surfaces are actually wired to the helper (source pins):
//    POS status, Bitcoin checkout status, and the P2P trade room
//    (order / messages / claim / dispute).
//
// The poller is driven through an injected environment (fake
// visibility + vitest fake timers) so the behaviour is tested
// exactly, in node, with no DOM.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVisibilityPoller,
  isDocumentHidden,
  pollUntil,
  type PollingEnvironment,
} from "../../src/lib/polling";
import {
  isTerminalP2pDisputeStatus,
  isTerminalP2pOrderStatus,
  TERMINAL_P2P_ORDER_STATUSES,
} from "../../src/utils/p2pUi";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) =>
  fs.readFileSync(path.resolve(here, "../../", rel), "utf8");

// ---------------------------------------------------------------------
// Fake polling environment
// ---------------------------------------------------------------------

function makeEnv() {
  let hidden = false;
  const listeners = new Set<() => void>();
  const env: PollingEnvironment = {
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
  return {
    env,
    setHidden(v: boolean) {
      hidden = v;
      [...listeners].forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

describe("createVisibilityPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately on start, then on cadence while visible", () => {
    const { env } = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, env);
    poller.start();
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(cb).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("never fires while the document is hidden", () => {
    const fake = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, fake.env);
    poller.start();
    expect(cb).toHaveBeenCalledTimes(1);
    fake.setHidden(true);
    vi.advanceTimersByTime(120_000);
    expect(cb).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("refreshes once immediately when the tab becomes visible again", () => {
    const fake = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, fake.env);
    poller.start();
    fake.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    fake.setHidden(false);
    // The resume refresh is synchronous with the visibility flip —
    // no waiting out the remainder of the interval.
    expect(cb).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15_000);
    expect(cb).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("started while hidden stays silent until the tab is shown", () => {
    const fake = makeEnv();
    fake.setHidden(true);
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, fake.env);
    poller.start();
    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(45_000);
    expect(cb).toHaveBeenCalledTimes(0);
    fake.setHidden(false);
    expect(cb).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("immediate:false waits for the first interval tick", () => {
    const { env } = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, { immediate: false }, env);
    poller.start();
    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(15_000);
    expect(cb).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("stop() clears the interval and unsubscribes the listener", () => {
    const fake = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, fake.env);
    poller.start();
    expect(fake.listenerCount()).toBe(1);
    poller.stop();
    expect(fake.listenerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    fake.setHidden(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("start() is idempotent — no doubled intervals", () => {
    const { env } = makeEnv();
    const cb = vi.fn();
    const poller = createVisibilityPoller(cb, 15_000, {}, env);
    poller.start();
    poller.start();
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(cb).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});

describe("isDocumentHidden", () => {
  it("reports visible outside a DOM (node/tests)", () => {
    expect(isDocumentHidden()).toBe(false);
  });
});

// ---------------------------------------------------------------------
// pollUntil — react-query terminal stop
// ---------------------------------------------------------------------

describe("pollUntil", () => {
  const q = (data: unknown) => ({ state: { data } });

  it("without a terminal predicate it is the plain interval number", () => {
    expect(pollUntil(60_000)).toBe(60_000);
  });

  it("keeps the cadence while data is missing or live, stops at terminal", () => {
    const fn = pollUntil<{ status: string }>(8_000, (d) => d?.status === "done");
    expect(typeof fn).toBe("function");
    const interval = fn as (query: { state: { data: unknown } }) => number | false;
    expect(interval(q(undefined))).toBe(8_000);
    expect(interval(q({ status: "live" }))).toBe(8_000);
    expect(interval(q({ status: "done" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Terminal status helpers (the trade room's stop conditions)
// ---------------------------------------------------------------------

describe("P2P terminal statuses", () => {
  it("order: exactly the four settled statuses are terminal", () => {
    expect([...TERMINAL_P2P_ORDER_STATUSES].sort()).toEqual(
      ["cancelled_unpaid", "completed", "expired_unpaid", "refunded"].sort(),
    );
    for (const s of TERMINAL_P2P_ORDER_STATUSES) {
      expect(isTerminalP2pOrderStatus(s)).toBe(true);
    }
    for (const s of ["escrow_locked", "paid_marked", "disputed"]) {
      expect(isTerminalP2pOrderStatus(s)).toBe(false);
    }
    expect(isTerminalP2pOrderStatus(undefined)).toBe(false);
    expect(isTerminalP2pOrderStatus(null)).toBe(false);
  });

  it("dispute: everything except open (and not-yet-loaded) is terminal", () => {
    expect(isTerminalP2pDisputeStatus("open")).toBe(false);
    for (const s of [
      "ruled_release",
      "ruled_refund",
      "negotiated_release",
      "negotiated_refund",
    ]) {
      expect(isTerminalP2pDisputeStatus(s)).toBe(true);
    }
    expect(isTerminalP2pDisputeStatus(undefined)).toBe(false);
    expect(isTerminalP2pDisputeStatus(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Wiring pins — the hot surfaces actually use the helper
// ---------------------------------------------------------------------

describe("wiring pins (fix #5)", () => {
  it("POS status poll runs on useVisibilityPolling, gated on awaiting_payment", () => {
    const src = readSrc("src/pages/BitcoinPos.tsx");
    expect(src).toContain("useVisibilityPolling");
    expect(src).toContain("active.status === 'awaiting_payment'");
    expect(src).not.toContain("pollRef");
    expect(src).not.toContain("setInterval");
  });

  it("Bitcoin checkout status poll runs on useVisibilityPolling and stops on confirmation", () => {
    const src = readSrc("src/components/payments/BitcoinPayment.tsx");
    expect(src).toContain("useVisibilityPolling");
    expect(src).not.toContain("statusInterval");
    expect(src).toContain("setPaymentConfirmed(true)");
    expect(src).toContain("!paymentConfirmed");
  });

  it("trade-room queries poll through pollUntil with terminal stops", () => {
    const src = readSrc("src/hooks/useP2p.ts");
    expect(src).toContain("pollUntil");
    // Order: cadence kept at 10s, terminal-gated on the order status.
    expect(src).toContain("pollUntil<P2pOrder | null>(10_000");
    expect(src).toContain("isTerminalP2pOrderStatus(o?.status)");
    // Disputes: cadence kept at 15s, terminal-gated on the dispute.
    expect(src).toContain("pollUntil<P2pDispute | null>(15_000");
    expect(src).toContain("isTerminalP2pDisputeStatus(d.status)");
    // Claim: caller-gated, cadence unchanged.
    expect(src).toContain("refetchInterval: poll ? pollUntil(15_000) : undefined");
    // Messages: caller-gated, cadence unchanged at 8s.
    expect(src).toContain("refetchInterval: poll ? pollUntil(8_000) : undefined");
  });

  it("trade chat polls messages only while the chat is not read-only", () => {
    const src = readSrc("src/components/p2p/TradeChat.tsx");
    expect(src).toContain("useP2pMessages(order.id, !readOnly)");
    expect(src).toContain("isTerminalP2pOrderStatus(order.status)");
  });

  it("trade room + dispute pages gate claim polling on live state", () => {
    const room = readSrc("src/pages/P2PTradeRoom.tsx");
    expect(room).toContain("!isTerminalP2pOrderStatus(order?.status)");
    const dispute = readSrc("src/pages/P2PDispute.tsx");
    expect(dispute).toContain("!isTerminalP2pDisputeStatus(dispute?.status)");
  });
});
