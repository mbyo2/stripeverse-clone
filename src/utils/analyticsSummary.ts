// Server-side analytics aggregation — client half (scalability fix #4,
// migration 20261114_analytics_summary_rpc.sql).
//
// Analytics.tsx used to pull up to 5,000 transaction rows into the
// browser and aggregate them there; PostgREST's default 1,000-row cap
// silently truncated the pull, so the figures were wrong at volume.
// The page now calls public.get_user_analytics(p_from, p_to) — four
// small calls (current period, previous period, last 6 calendar
// months, current week) — and shapes the returned aggregates here.
// Every definition below mirrors the page's previous client-side
// computation exactly; the SQL side is pinned against the same
// definitions by tests/analytics/analyticsSummary.test.ts.

export interface AnalyticsSummary {
  tx_count: number;
  completed_count: number;
  failed_count: number;
  revenue_zmw: number;
  sent_zmw: number;
  by_status: { status: string; count: number; volume: number }[];
  by_direction: { direction: string; count: number; volume: number }[];
  by_payment_method: { payment_method: string; count: number; volume: number }[];
  by_currency: { currency: string; count: number; volume: number }[];
  monthly: {
    month_start: string; // 'YYYY-MM-DD' (Africa/Lusaka)
    transactions: number;
    revenue: number;
    successful: number;
    failed: number;
  }[];
  daily: {
    day: string; // 'YYYY-MM-DD' (Africa/Lusaka)
    revenue: number;
    transactions: number;
    successful: number;
    failed: number;
  }[];
  top_counterparties: { name: string; volume: number; transactions: number }[];
  counterparty_total_volume: number;
}

export const EMPTY_SUMMARY: AnalyticsSummary = {
  tx_count: 0,
  completed_count: 0,
  failed_count: 0,
  revenue_zmw: 0,
  sent_zmw: 0,
  by_status: [],
  by_direction: [],
  by_payment_method: [],
  by_currency: [],
  monthly: [],
  daily: [],
  top_counterparties: [],
  counterparty_total_volume: 0,
};

export const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

const METHOD_LABELS: Record<string, string> = {
  mobile_money: 'Mobile Money',
  card: 'Card Payment',
  card_payment: 'Card Payment',
  bank_transfer: 'Bank Transfer',
  bitcoin: 'Bitcoin',
  bitcoin_onchain: 'Bitcoin',
  bitcoin_trade: 'Bitcoin',
  lightning: 'Lightning',
  ussd: 'USSD',
  paypal: 'PayPal',
  wallet: 'Wallet Transfer',
};

export const METHOD_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export const methodLabel = (raw: string) =>
  METHOD_LABELS[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const pctChange = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

export interface AnalyticsWindows {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
  months: { from: Date; to: Date };
  week: { from: Date; to: Date };
}

/** The four windows the page aggregates over, computed exactly as the
 *  old client-side model computed them (browser-local calendar). */
export function analyticsWindows(period: string, nowMs: number): AnalyticsWindows {
  const days = PERIOD_DAYS[period] ?? 180;

  // Monthly series window: first of the month 5 months back through
  // the end of the current month (the old loop's bucket bounds).
  const monthsFrom = new Date(nowMs);
  monthsFrom.setDate(1);
  monthsFrom.setMonth(monthsFrom.getMonth() - 5);
  monthsFrom.setHours(0, 0, 0, 0);
  const monthsTo = new Date(nowMs);
  monthsTo.setDate(1);
  monthsTo.setMonth(monthsTo.getMonth() + 1);
  monthsTo.setHours(0, 0, 0, 0);

  // Current week (Mon–Sun), as the old daily-revenue block computed it.
  const weekFrom = new Date(nowMs);
  const dayIdx = (weekFrom.getDay() + 6) % 7; // Monday = 0
  weekFrom.setHours(0, 0, 0, 0);
  weekFrom.setDate(weekFrom.getDate() - dayIdx);
  const weekTo = new Date(weekFrom.getTime() + 7 * 86400000);

  return {
    current: { from: new Date(nowMs - days * 86400000), to: new Date(nowMs + 1) },
    previous: {
      from: new Date(nowMs - 2 * days * 86400000),
      to: new Date(nowMs - days * 86400000),
    },
    months: { from: monthsFrom, to: monthsTo },
    week: { from: weekFrom, to: weekTo },
  };
}

export interface AnalyticsModel {
  currentCount: number;
  prevCount: number;
  revenue: number;
  prevRevenue: number;
  sent: number;
  prevSent: number;
  successRate: number;
  prevSuccessRate: number | null;
  monthly: { month: string; transactions: number; revenue: number; successful: number; failed: number }[];
  paymentMethods: { name: string; value: number; color: string }[];
  dailyRevenue: { day: string; amount: number }[];
  topCounterparties: { name: string; volume: number; transactions: number; share: number }[];
}

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Shape the four RPC summaries into the page's view model. Pure:
 *  the same summaries always produce the same model. */
export function buildAnalyticsModel(
  current: AnalyticsSummary,
  previous: AnalyticsSummary,
  months: AnalyticsSummary,
  week: AnalyticsSummary,
  weekFrom: Date,
): AnalyticsModel {
  const successRate = current.tx_count
    ? (current.completed_count / current.tx_count) * 100
    : 0;
  const prevSuccessRate = previous.tx_count
    ? (previous.completed_count / previous.tx_count) * 100
    : null;

  const monthly = months.monthly.map((b) => ({
    // Midday avoids any date-line edge when labelling the bucket.
    month: new Date(`${b.month_start}T12:00:00`).toLocaleString('en', { month: 'short' }),
    transactions: b.transactions,
    revenue: b.revenue,
    successful: b.successful,
    failed: b.failed,
  }));

  // The old page grouped by display label (card + card_payment are
  // both "Card Payment"); the RPC groups by the raw method value, so
  // the label merge happens here — same totals, same labels.
  const byLabel = new Map<string, number>();
  current.by_payment_method.forEach((m) => {
    const label = methodLabel(m.payment_method ?? '');
    byLabel.set(label, (byLabel.get(label) || 0) + m.count);
  });
  const paymentMethods = Array.from(byLabel.entries()).map(([name, value], i) => ({
    name,
    value,
    color: METHOD_COLORS[i % METHOD_COLORS.length],
  }));

  const byDay = new Map(week.daily.map((d) => [d.day, d.revenue]));
  const dailyRevenue = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => {
    const date = new Date(weekFrom.getTime() + i * 86400000);
    return { day, amount: byDay.get(localDateKey(date)) ?? 0 };
  });

  const totalVolume = current.counterparty_total_volume;
  const topCounterparties = current.top_counterparties.map((p) => ({
    name: p.name,
    volume: p.volume,
    transactions: p.transactions,
    share: totalVolume ? (p.volume / totalVolume) * 100 : 0,
  }));

  return {
    currentCount: current.tx_count,
    prevCount: previous.tx_count,
    revenue: current.revenue_zmw,
    prevRevenue: previous.revenue_zmw,
    sent: current.sent_zmw,
    prevSent: previous.sent_zmw,
    successRate,
    prevSuccessRate,
    monthly,
    paymentMethods,
    dailyRevenue,
    topCounterparties,
  };
}

/** Structural client type (the adminConsole pattern) so this module
 *  does not depend on the generated types knowing the RPC yet. */
export interface AnalyticsRpcClient {
  rpc: (
    fn: string,
    args: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

async function callSummary(
  client: AnalyticsRpcClient,
  window: { from: Date; to: Date },
): Promise<AnalyticsSummary> {
  const { data, error } = await client.rpc('get_user_analytics', {
    p_from: window.from.toISOString(),
    p_to: window.to.toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data ?? EMPTY_SUMMARY) as AnalyticsSummary;
}

/** The page's four aggregation calls (current / previous / months /
 *  week) — small fixed-size results instead of up to 5,000 rows.
 *  The windows are computed here so the caller shapes the model
 *  against the exact same bounds the RPC aggregated over. */
export async function fetchAnalyticsSummaries(
  client: AnalyticsRpcClient,
  period: string,
  nowMs: number,
): Promise<{
  windows: AnalyticsWindows;
  current: AnalyticsSummary;
  previous: AnalyticsSummary;
  months: AnalyticsSummary;
  week: AnalyticsSummary;
}> {
  const windows = analyticsWindows(period, nowMs);
  const [current, previous, months, week] = await Promise.all([
    callSummary(client, windows.current),
    callSummary(client, windows.previous),
    callSummary(client, windows.months),
    callSummary(client, windows.week),
  ]);
  return { windows, current, previous, months, week };
}
