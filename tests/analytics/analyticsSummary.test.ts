// Tests for scalability fix #4 (migration 20261114): server-side
// analytics aggregation behind src/pages/Analytics.tsx.
//
// Three layers:
//  1. SQL source pins — the migration carries the exact aggregate
//     definitions, gates and ACL the page's numbers depend on.
//  2. Semantic equivalence — a faithful re-implementation of the OLD
//     client-side computation (raw rows in, model out) and an
//     independent simulator of the migration's SQL semantics (raw
//     rows in, RPC-shaped JSON out) must produce the SAME page model
//     on the same fixture rows, through the real buildAnalyticsModel.
//     Fixture amounts are binary-exact (x.00/x.25/x.50/x.75) so float
//     sums compare exactly. The one old behaviour NOT simulated: the
//     1,000-row PostgREST truncation and the 365-day fetch bound —
//     those were the bugs being fixed, not definitions.
//  3. Unit tests for the window math, label merging, share math and
//     the RPC fetch wiring.
//
// Timezone: the migration buckets monthly/daily in Africa/Lusaka;
// the old page bucketed in the viewer's local time. Running this
// file under TZ=Africa/Lusaka makes the two the same computation —
// exactly the equivalence the migration header claims for the
// platform's Zambian users.

process.env.TZ = "Africa/Lusaka";

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyticsWindows,
  buildAnalyticsModel,
  fetchAnalyticsSummaries,
  pctChange,
  EMPTY_SUMMARY,
  type AnalyticsSummary,
} from "../../src/utils/analyticsSummary";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(here, "../../supabase/migrations/20261114_analytics_summary_rpc.sql"),
  "utf8",
);
const pageSource = fs.readFileSync(
  path.resolve(here, "../../src/pages/Analytics.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------
// 1. SQL source pins
// ---------------------------------------------------------------------

describe("20261114 migration (source pins)", () => {
  it("creates admin_analytics_summary(p_from, p_to) as a gated SECURITY DEFINER", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_analytics_summary(\n  p_from timestamptz,\n  p_to timestamptz\n)",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("public.has_role(auth.uid(), 'admin'::app_role)");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::app_role)");
    expect(migration).toContain(
      "RAISE EXCEPTION 'Only an admin can view platform analytics'",
    );
  });

  it("creates get_user_analytics scoped to the caller (auth.uid())", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_user_analytics(");
    expect(migration).toContain(
      "RAISE EXCEPTION 'You need to be signed in to view your analytics'",
    );
    expect(migration).toContain(
      "RETURN public.analytics_summary_impl(p_from, p_to, auth.uid());",
    );
    expect(migration).toContain(
      "RETURN public.analytics_summary_impl(p_from, p_to, NULL);",
    );
  });

  it("keeps the internal helper unreachable from client roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.analytics_summary_impl(timestamptz, timestamptz, uuid) FROM PUBLIC;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.analytics_summary_impl(timestamptz, timestamptz, uuid) FROM authenticated;",
    );
  });

  it("follows the admin RPC ACL pattern on both entry points", () => {
    for (const fn of ["admin_analytics_summary", "get_user_analytics"]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${fn}(timestamptz, timestamptz) FROM PUBLIC;`,
      );
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${fn}(timestamptz, timestamptz) FROM anon;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${fn}(timestamptz, timestamptz) TO authenticated;`,
      );
    }
  });

  it("pins the page's revenue/sent definitions verbatim", () => {
    expect(migration).toContain(
      "WHERE direction = 'incoming' AND status = 'completed' AND currency = 'ZMW'",
    );
    expect(migration).toContain(
      "WHERE direction = 'outgoing' AND status = 'completed' AND currency = 'ZMW'",
    );
  });

  it("pins the half-open window and the counterparty rules", () => {
    expect(migration).toContain("t.created_at >= p_from");
    expect(migration).toContain("t.created_at < p_to");
    expect(migration).toContain("recipient_name <> ''");
    expect(migration).toContain("LIMIT 5");
    expect(migration).toContain("'counterparty_total_volume'");
  });

  it("buckets in Africa/Lusaka with zero-filled series", () => {
    expect(migration).toContain("AT TIME ZONE 'Africa/Lusaka'");
    expect(migration).toContain("generate_series");
    expect(migration).toContain("LEFT JOIN month_agg");
    expect(migration).toContain("LEFT JOIN day_agg");
  });

  it("the page no longer pulls raw transaction rows", () => {
    expect(pageSource).not.toContain(".limit(5000)");
    expect(pageSource).not.toContain(".from('transactions')");
    expect(pageSource).not.toContain('.from("transactions")');
    expect(pageSource).toContain("fetchAnalyticsSummaries");
  });
});

// ---------------------------------------------------------------------
// 2. Semantic equivalence: old page logic vs simulated SQL semantics
// ---------------------------------------------------------------------

interface FixtureRow {
  amount: number;
  currency: string;
  status: string;
  direction: string;
  payment_method: string;
  recipient_name: string | null;
  created_at: string | null;
}

const row = (
  partial: Partial<FixtureRow> & { created_at: string | null },
): FixtureRow => ({
  amount: 0,
  currency: "ZMW",
  status: "completed",
  direction: "incoming",
  payment_method: "wallet",
  recipient_name: null,
  ...partial,
});

// Wednesday 21 Oct 2026, 12:00 local (Lusaka) — mid-week, mid-month.
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const iso = (d: Date) => d.toISOString();
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min, 0);

const ROWS: FixtureRow[] = [
  // — current '1m' window (21 Sep – 21 Oct) —
  row({ amount: 100, payment_method: "mobile_money", recipient_name: "Shop A", created_at: iso(local(2026, 9, 19, 10)) }), // Mon, revenue
  row({ amount: 50.5, payment_method: "card", recipient_name: "Shop A", created_at: iso(local(2026, 9, 21, 9)) }), // today, revenue
  row({ amount: 25.25, payment_method: "card_payment", created_at: iso(local(2026, 9, 20, 15)) }), // revenue, no recipient
  row({ amount: 200, direction: "outgoing", payment_method: "wallet", recipient_name: "Supplier B", created_at: iso(local(2026, 9, 18, 8)) }),
  row({ amount: 75, status: "failed", payment_method: "mobile_money", created_at: iso(local(2026, 9, 15, 11)) }),
  row({ amount: 60, status: "pending", direction: "outgoing", payment_method: "ussd", created_at: iso(local(2026, 9, 10, 11)) }),
  row({ amount: 500, currency: "USD", payment_method: "paypal", recipient_name: "US Client", created_at: iso(local(2026, 9, 5, 11)) }), // not revenue (USD)
  row({ amount: 40, recipient_name: "", created_at: iso(local(2026, 9, 3, 11)) }), // empty recipient: revenue, not a counterparty
  row({ amount: 30, recipient_name: "Cafe C", created_at: iso(local(2026, 8, 25, 11)) }), // revenue
  row({ amount: 20, recipient_name: "Deli D", created_at: iso(local(2026, 8, 24, 11)) }),
  row({ amount: 15, recipient_name: "Eatery E", created_at: iso(local(2026, 8, 23, 11)) }),
  row({ amount: 10, recipient_name: "Food F", created_at: iso(local(2026, 8, 22, 11)) }), // 6th counterparty — outside top 5
  // exactly at the current-window start (21 Sep 12:00) — included
  row({ amount: 5, payment_method: "bank_transfer", created_at: iso(new Date(NOW - 30 * 86400000)) }),
  // — previous '1m' window (22 Aug – 21 Sep) —
  row({ amount: 80, recipient_name: "Shop A", created_at: iso(local(2026, 8, 10, 11)) }),
  row({ amount: 45, direction: "outgoing", created_at: iso(local(2026, 8, 1, 13)) }),
  row({ amount: 35, status: "failed", created_at: iso(local(2026, 7, 28, 11)) }),
  // — inside the 6-month series but outside both '1m' windows —
  row({ amount: 90, created_at: iso(local(2026, 4, 14, 11)) }), // May revenue
  row({ amount: 55, status: "failed", created_at: iso(local(2026, 5, 9, 11)) }), // June
  row({ amount: 65, direction: "outgoing", created_at: iso(local(2026, 7, 19, 11)) }), // August sent
  // future-dated within this week (Sat) — the old daily block counted it
  row({ amount: 70, created_at: iso(local(2026, 9, 24, 10)) }),
  // — distractors: never counted anywhere —
  row({ amount: 999, created_at: null }),
  row({ amount: 888, created_at: iso(local(2025, 5, 15, 11)) }), // > 1 year old
];

// The OLD page computation, re-implemented from the pre-fix source.
const OLD_METHOD_LABELS: Record<string, string> = {
  mobile_money: "Mobile Money",
  card: "Card Payment",
  card_payment: "Card Payment",
  bank_transfer: "Bank Transfer",
  bitcoin: "Bitcoin",
  bitcoin_onchain: "Bitcoin",
  bitcoin_trade: "Bitcoin",
  lightning: "Lightning",
  ussd: "USSD",
  paypal: "PayPal",
  wallet: "Wallet Transfer",
};
const oldMethodLabel = (raw: string) =>
  OLD_METHOD_LABELS[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const OLD_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function oldModel(rows: FixtureRow[], period: string, now: number) {
  const days = ({ "7d": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 } as Record<string, number>)[period] ?? 180;
  const inWindow = (t: FixtureRow, startMs: number, endMs: number) => {
    if (!t.created_at) return false;
    const ts = new Date(t.created_at).getTime();
    return ts >= startMs && ts < endMs;
  };
  const isRevenue = (t: FixtureRow) =>
    t.direction === "incoming" && t.status === "completed" && t.currency === "ZMW";
  const isSent = (t: FixtureRow) =>
    t.direction === "outgoing" && t.status === "completed" && t.currency === "ZMW";
  const sum = (rs: FixtureRow[]) => rs.reduce((a, t) => a + Number(t.amount), 0);

  const current = rows.filter((t) => inWindow(t, now - days * 86400000, now + 1));
  const previous = rows.filter((t) =>
    inWindow(t, now - 2 * days * 86400000, now - days * 86400000),
  );

  const monthly: { month: string; transactions: number; revenue: number; successful: number; failed: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const start = d.getTime();
    const endDate = new Date(d);
    endDate.setMonth(endDate.getMonth() + 1);
    const mrows = rows.filter((t) => inWindow(t, start, endDate.getTime()));
    monthly.push({
      month: d.toLocaleString("en", { month: "short" }),
      transactions: mrows.length,
      revenue: sum(mrows.filter(isRevenue)),
      successful: mrows.filter((t) => t.status === "completed").length,
      failed: mrows.filter((t) => t.status === "failed").length,
    });
  }

  const byMethod = new Map<string, number>();
  current.forEach((t) => {
    const label = oldMethodLabel(t.payment_method);
    byMethod.set(label, (byMethod.get(label) || 0) + 1);
  });
  const paymentMethods = Array.from(byMethod.entries()).map(([name, value], i) => ({
    name,
    value,
    color: OLD_COLORS[i % OLD_COLORS.length],
  }));

  const weekStart = new Date(now);
  const dayIdx = (weekStart.getDay() + 6) % 7;
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - dayIdx);
  const dailyRevenue = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
    const start = weekStart.getTime() + i * 86400000;
    const drows = rows.filter((t) => inWindow(t, start, start + 86400000));
    return { day, amount: sum(drows.filter(isRevenue)) };
  });

  const byParty = new Map<string, { volume: number; transactions: number }>();
  current
    .filter((t) => t.currency === "ZMW" && t.recipient_name)
    .forEach((t) => {
      const e = byParty.get(t.recipient_name!) || { volume: 0, transactions: 0 };
      e.volume += Number(t.amount);
      e.transactions += 1;
      byParty.set(t.recipient_name!, e);
    });
  const totalVolume = Array.from(byParty.values()).reduce((a, e) => a + e.volume, 0);
  const topCounterparties = Array.from(byParty.entries())
    .map(([name, e]) => ({
      name,
      volume: e.volume,
      transactions: e.transactions,
      share: totalVolume ? (e.volume / totalVolume) * 100 : 0,
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);

  return {
    currentCount: current.length,
    prevCount: previous.length,
    revenue: sum(current.filter(isRevenue)),
    prevRevenue: sum(previous.filter(isRevenue)),
    sent: sum(current.filter(isSent)),
    prevSent: sum(previous.filter(isSent)),
    successRate: current.length
      ? (current.filter((t) => t.status === "completed").length / current.length) * 100
      : 0,
    prevSuccessRate: previous.length
      ? (previous.filter((t) => t.status === "completed").length / previous.length) * 100
      : null,
    monthly,
    paymentMethods,
    dailyRevenue,
    topCounterparties,
  };
}

// Simulator of the migration's SQL semantics over the same raw rows.
// Runs under TZ=Africa/Lusaka, so local calendar == the SQL's
// Africa/Lusaka bucketing — the equivalence being pinned.
function simulateRpc(rows: FixtureRow[], fromMs: number, toMs: number): AnalyticsSummary {
  const base = rows.filter((t) => {
    if (!t.created_at) return false;
    const ts = new Date(t.created_at).getTime();
    return ts >= fromMs && ts < toMs;
  });
  const isRevenue = (t: FixtureRow) =>
    t.direction === "incoming" && t.status === "completed" && t.currency === "ZMW";
  const isSent = (t: FixtureRow) =>
    t.direction === "outgoing" && t.status === "completed" && t.currency === "ZMW";
  const sum = (rs: FixtureRow[]) => rs.reduce((a, t) => a + Number(t.amount), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const group = <K extends string>(key: (t: FixtureRow) => K) => {
    const m = new Map<K, FixtureRow[]>();
    base.forEach((t) => {
      const k = key(t);
      m.set(k, [...(m.get(k) || []), t]);
    });
    return m;
  };

  // Monthly buckets intersecting [from, to), zero-filled.
  const monthKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const monthly: AnalyticsSummary["monthly"] = [];
  {
    const first = new Date(fromMs);
    first.setDate(1);
    first.setHours(0, 0, 0, 0);
    for (let cur = first.getTime(); cur < toMs; ) {
      const d = new Date(cur);
      const key = monthKey(cur);
      const mrows = base.filter(
        (t) => monthKey(new Date(t.created_at!).getTime()) === key,
      );
      monthly.push({
        month_start: `${key}-${String(d.getDate()).padStart(2, "0")}`,
        transactions: mrows.length,
        revenue: round2(sum(mrows.filter(isRevenue))),
        successful: mrows.filter((t) => t.status === "completed").length,
        failed: mrows.filter((t) => t.status === "failed").length,
      });
      d.setMonth(d.getMonth() + 1);
      cur = d.getTime();
    }
  }

  // Daily buckets intersecting [from, to), zero-filled.
  const dayKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const daily: AnalyticsSummary["daily"] = [];
  {
    const first = new Date(fromMs);
    first.setHours(0, 0, 0, 0);
    for (let cur = first.getTime(); cur < toMs; cur += 86400000) {
      const key = dayKey(cur);
      const drows = base.filter(
        (t) => dayKey(new Date(t.created_at!).getTime()) === key,
      );
      daily.push({
        day: key,
        revenue: round2(sum(drows.filter(isRevenue))),
        transactions: drows.length,
        successful: drows.filter((t) => t.status === "completed").length,
        failed: drows.filter((t) => t.status === "failed").length,
      });
    }
  }

  const parties = Array.from(
    base
      .filter((t) => t.currency === "ZMW" && t.recipient_name)
      .reduce((m, t) => {
        const e = m.get(t.recipient_name!) || { volume: 0, transactions: 0 };
        e.volume += Number(t.amount);
        e.transactions += 1;
        m.set(t.recipient_name!, e);
        return m;
      }, new Map<string, { volume: number; transactions: number }>()),
    ([name, e]) => ({ name, volume: round2(e.volume), transactions: e.transactions }),
  );

  return {
    tx_count: base.length,
    completed_count: base.filter((t) => t.status === "completed").length,
    failed_count: base.filter((t) => t.status === "failed").length,
    revenue_zmw: round2(sum(base.filter(isRevenue))),
    sent_zmw: round2(sum(base.filter(isSent))),
    by_status: Array.from(group((t) => t.status), ([status, rs]) => ({
      status,
      count: rs.length,
      volume: round2(sum(rs)),
    })).sort((a, b) => a.status.localeCompare(b.status)),
    by_direction: Array.from(group((t) => t.direction), ([direction, rs]) => ({
      direction,
      count: rs.length,
      volume: round2(sum(rs)),
    })).sort((a, b) => a.direction.localeCompare(b.direction)),
    by_payment_method: Array.from(group((t) => t.payment_method), ([payment_method, rs]) => ({
      payment_method,
      count: rs.length,
      volume: round2(sum(rs)),
    })).sort((a, b) => b.count - a.count || a.payment_method.localeCompare(b.payment_method)),
    by_currency: Array.from(group((t) => t.currency), ([currency, rs]) => ({
      currency,
      count: rs.length,
      volume: round2(sum(rs)),
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
    monthly,
    daily,
    top_counterparties: [...parties]
      .sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name))
      .slice(0, 5),
    counterparty_total_volume: round2(parties.reduce((a, p) => a + p.volume, 0)),
  };
}

describe("old page logic == RPC semantics (same fixtures)", () => {
  for (const period of ["7d", "1m", "6m"]) {
    it(`period ${period}: identical model from rows and from summaries`, () => {
      const w = analyticsWindows(period, NOW);
      const viaRpc = buildAnalyticsModel(
        simulateRpc(ROWS, w.current.from.getTime(), w.current.to.getTime()),
        simulateRpc(ROWS, w.previous.from.getTime(), w.previous.to.getTime()),
        simulateRpc(ROWS, w.months.from.getTime(), w.months.to.getTime()),
        simulateRpc(ROWS, w.week.from.getTime(), w.week.to.getTime()),
        w.week.from,
      );
      const expected = oldModel(ROWS, period, NOW);

      expect(viaRpc.currentCount).toBe(expected.currentCount);
      expect(viaRpc.prevCount).toBe(expected.prevCount);
      expect(viaRpc.revenue).toBe(expected.revenue);
      expect(viaRpc.prevRevenue).toBe(expected.prevRevenue);
      expect(viaRpc.sent).toBe(expected.sent);
      expect(viaRpc.prevSent).toBe(expected.prevSent);
      expect(viaRpc.successRate).toBeCloseTo(expected.successRate, 10);
      if (expected.prevSuccessRate === null) {
        expect(viaRpc.prevSuccessRate).toBeNull();
      } else {
        expect(viaRpc.prevSuccessRate).toBeCloseTo(expected.prevSuccessRate, 10);
      }
      expect(viaRpc.monthly).toEqual(expected.monthly);
      expect(viaRpc.dailyRevenue).toEqual(expected.dailyRevenue);
      expect(viaRpc.topCounterparties).toEqual(expected.topCounterparties);
      // Method slices: the old page ordered by first appearance in a
      // recency-sorted pull; the RPC orders by count. The slices and
      // totals must match as a SET (colour assignment follows order).
      const sortSlices = (s: { name: string; value: number }[]) =>
        [...s].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, value }) => ({ name, value }));
      expect(sortSlices(viaRpc.paymentMethods)).toEqual(sortSlices(expected.paymentMethods));
    });
  }

  it("documents the one deliberate correction: calendar months, not the old time-of-day shift", () => {
    // The old page built month buckets from `new Date()` with only
    // setDate(1) applied — the time-of-day survived, so its "August"
    // bucket actually spanned Aug 1 12:00 → Sep 1 12:00 (for a noon
    // page load) and a Sep 1 09:00 row was reported as August. The
    // RPC buckets true calendar months; this test pins the old quirk
    // and the corrected behaviour side by side.
    const rows = [
      row({ amount: 45, direction: "outgoing", created_at: iso(local(2026, 8, 1, 9)) }),
    ];
    const old = oldModel(rows, "6m", NOW);
    expect(old.monthly.find((m) => m.month === "Aug")!.transactions).toBe(1);
    expect(old.monthly.find((m) => m.month === "Sep")!.transactions).toBe(0);

    const w = analyticsWindows("6m", NOW);
    const sim = simulateRpc(rows, w.months.from.getTime(), w.months.to.getTime());
    expect(sim.monthly.find((m) => m.month_start === "2026-08-01")!.transactions).toBe(0);
    expect(sim.monthly.find((m) => m.month_start === "2026-09-01")!.transactions).toBe(1);
  });

  it("an empty account produces the old page's zero model", () => {
    const w = analyticsWindows("6m", NOW);
    const model = buildAnalyticsModel(
      EMPTY_SUMMARY, EMPTY_SUMMARY,
      simulateRpc([], w.months.from.getTime(), w.months.to.getTime()),
      simulateRpc([], w.week.from.getTime(), w.week.to.getTime()),
      w.week.from,
    );
    expect(model.currentCount).toBe(0);
    expect(model.prevSuccessRate).toBeNull();
    expect(model.monthly).toHaveLength(6);
    expect(model.monthly.every((m) => m.transactions === 0)).toBe(true);
    expect(model.dailyRevenue).toHaveLength(7);
    expect(model.dailyRevenue.every((d) => d.amount === 0)).toBe(true);
    expect(model.topCounterparties).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 3. Unit tests
// ---------------------------------------------------------------------

describe("analyticsWindows", () => {
  it("computes half-open current/previous windows like the old model", () => {
    const w = analyticsWindows("7d", NOW);
    expect(w.current.from.getTime()).toBe(NOW - 7 * 86400000);
    expect(w.current.to.getTime()).toBe(NOW + 1);
    expect(w.previous.from.getTime()).toBe(NOW - 14 * 86400000);
    expect(w.previous.to.getTime()).toBe(NOW - 7 * 86400000);
  });

  it("falls back to 180 days for an unknown period (old ?? 180)", () => {
    const w = analyticsWindows("bogus", NOW);
    expect(w.current.from.getTime()).toBe(NOW - 180 * 86400000);
  });

  it("week window is Monday 00:00 through next Monday 00:00", () => {
    const w = analyticsWindows("1m", NOW);
    expect(w.week.from.getDay()).toBe(1);
    expect(w.week.from.getHours()).toBe(0);
    expect(w.week.to.getTime() - w.week.from.getTime()).toBe(7 * 86400000);
  });

  it("months window spans exactly the last 6 calendar months", () => {
    const w = analyticsWindows("1m", NOW);
    expect(w.months.from.getDate()).toBe(1);
    expect(w.months.from.getMonth()).toBe(4); // May, for a 21 Oct "now"
    expect(w.months.to.getMonth()).toBe(10); // 1 Nov
    expect(w.months.to.getDate()).toBe(1);
  });
});

describe("buildAnalyticsModel shaping", () => {
  it("merges raw methods that share a display label (card + card_payment)", () => {
    const current: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      by_payment_method: [
        { payment_method: "card", count: 2, volume: 10 },
        { payment_method: "card_payment", count: 3, volume: 10 },
        { payment_method: "mobile_money", count: 1, volume: 10 },
      ],
    };
    const model = buildAnalyticsModel(
      current, EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY, new Date(2026, 9, 19),
    );
    const cardSlice = model.paymentMethods.find((m) => m.name === "Card Payment");
    expect(cardSlice?.value).toBe(5);
    expect(model.paymentMethods).toHaveLength(2);
  });

  it("share is 0 (not NaN) when counterparty volume is 0", () => {
    const current: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      top_counterparties: [{ name: "X", volume: 0, transactions: 1 }],
      counterparty_total_volume: 0,
    };
    const model = buildAnalyticsModel(
      current, EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY, new Date(2026, 9, 19),
    );
    expect(model.topCounterparties[0].share).toBe(0);
  });

  it("pctChange matches the old helper, including the null case", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(50, 100)).toBeCloseTo(-50);
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe("fetchAnalyticsSummaries", () => {
  it("makes exactly four get_user_analytics calls with ISO window bounds", async () => {
    const calls: { fn: string; args: Record<string, string> }[] = [];
    const client = {
      rpc: async (fn: string, args: Record<string, string>) => {
        calls.push({ fn, args });
        return { data: EMPTY_SUMMARY, error: null };
      },
    };
    const result = await fetchAnalyticsSummaries(client, "1m", NOW);
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.fn === "get_user_analytics")).toBe(true);
    const w = analyticsWindows("1m", NOW);
    expect(calls[0].args).toEqual({
      p_from: w.current.from.toISOString(),
      p_to: w.current.to.toISOString(),
    });
    expect(result.windows.current.from.getTime()).toBe(w.current.from.getTime());
  });

  it("propagates an RPC error instead of fabricating figures", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    await expect(fetchAnalyticsSummaries(client, "1m", NOW)).rejects.toThrow("boom");
  });
});
