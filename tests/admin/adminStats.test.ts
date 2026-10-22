// Unit tests for src/utils/adminStats.ts — the admin dashboard's
// "Active Users (last 30 days)" count. The regression being pinned:
// the dashboard used to display active_users = total_users (every
// registered user presented as active, behind a "// Simplified"
// comment). The count must be exactly what the label says: distinct
// users with at least one transaction inside the trailing 30 days.

import { describe, it, expect } from "vitest";
import { countActiveUsers, ACTIVITY_WINDOW_DAYS } from "../../src/utils/adminStats";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("countActiveUsers", () => {
  it("counts distinct users, not transactions", () => {
    const rows = [
      { user_id: "a", created_at: daysAgo(1) },
      { user_id: "a", created_at: daysAgo(2) },
      { user_id: "b", created_at: daysAgo(3) },
    ];
    expect(countActiveUsers(rows, NOW)).toBe(2);
  });

  it("excludes users whose only activity is older than the window", () => {
    const rows = [
      { user_id: "a", created_at: daysAgo(ACTIVITY_WINDOW_DAYS + 1) },
      { user_id: "b", created_at: daysAgo(1) },
    ];
    expect(countActiveUsers(rows, NOW)).toBe(1);
  });

  it("includes activity exactly at the window start", () => {
    const rows = [{ user_id: "a", created_at: daysAgo(ACTIVITY_WINDOW_DAYS) }];
    expect(countActiveUsers(rows, NOW)).toBe(1);
  });

  it("excludes future-dated rows, null users and unparseable dates", () => {
    const rows = [
      { user_id: "a", created_at: new Date(NOW.getTime() + 60_000).toISOString() },
      { user_id: null, created_at: daysAgo(1) },
      { user_id: "b", created_at: "not-a-date" },
      { user_id: "c", created_at: null },
    ];
    expect(countActiveUsers(rows, NOW)).toBe(0);
  });

  it("returns 0 for no rows (a new platform reads 0, not the user total)", () => {
    expect(countActiveUsers([], NOW)).toBe(0);
  });
});
