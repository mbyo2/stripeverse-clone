// "Active users" for the admin dashboard — an honest, computable
// definition instead of a copied total.
//
// The dashboard previously displayed active_users = total_users with a
// "// Simplified" comment: every registered user was presented as
// active, which the platform's data does not support. The definition
// now used everywhere this number appears:
//
//   a user is active if they have at least one row in `transactions`
//   with created_at inside the trailing ACTIVITY_WINDOW_DAYS window.
//
// That is exactly what the label says ("Active Users (last 30 days)")
// and exactly what is counted here — distinct user_ids, nothing else.

export const ACTIVITY_WINDOW_DAYS = 30;

export interface ActivityRow {
  user_id?: string | null;
  created_at?: string | null;
}

/** Start (inclusive) of the trailing activity window. */
export function activityWindowStart(now: Date, windowDays = ACTIVITY_WINDOW_DAYS): Date {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

/** Distinct users with at least one transaction inside the window. */
export function countActiveUsers(
  rows: ActivityRow[],
  now: Date,
  windowDays = ACTIVITY_WINDOW_DAYS,
): number {
  const start = activityWindowStart(now, windowDays).getTime();
  const end = now.getTime();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.user_id || !row.created_at) continue;
    const t = new Date(row.created_at).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= start && t <= end) seen.add(row.user_id);
  }
  return seen.size;
}
