// Tests for the Superadmin Treasury & Reports console
// (migration 20261222 + src/pages/AdminTreasury.tsx +
// src/utils/treasury.ts).
//
// Layers:
//  1. SQL source pins — the migration carries the super_admin gate,
//     the ACL split (entry points vs impl), the platform resolver
//     and every fee-income discriminator the console's numbers
//     depend on. If a future migration quietly changes one of
//     those, this file fails before the console can lie.
//  2. Period math — the presets are computed in Africa/Lusaka
//     (UTC+2, no DST); the windows are [from, to).
//  3. Labels / money formatting / CSV — the client-side rendering
//     of figures the server already computed.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  periodRange,
  startOfLusakaDay,
  startOfLusakaMonth,
  lusakaDayStartFromInput,
  categoryLabel,
  feeRailLabel,
  formatMoney,
  formatFeeAmount,
  buildTreasuryCsv,
  isSuperAdminRefusal,
  type TreasuryReportRow,
} from "../../src/utils/treasury";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read("../../supabase/migrations/20261222_superadmin_treasury_reports.sql");
const pageSource = read("../../src/pages/AdminTreasury.tsx");
const routesSource = read("../../src/components/AnimatedRoutes.tsx");
const dashboardSource = read("../../src/pages/AdminDashboard.tsx");

// ---------------------------------------------------------------------
// 1. SQL source pins
// ---------------------------------------------------------------------

describe("treasury migration — gate and ACL", () => {
  it("gates both entry points on super_admin via has_role", () => {
    const gates = migration.match(/has_role\(auth\.uid\(\), 'super_admin'::app_role\)/g) ?? [];
    expect(gates.length).toBe(2);
    expect(migration).toContain("RAISE EXCEPTION 'Only a super admin can view treasury data'");
  });

  it("grants the entry points to authenticated only, never PUBLIC or anon", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.treasury_overview(timestamptz, timestamptz) FROM PUBLIC;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.treasury_overview(timestamptz, timestamptz) FROM anon;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.treasury_overview(timestamptz, timestamptz) TO authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.treasury_report(timestamptz, timestamptz, text, text, text, text, text, integer, integer) TO authenticated;",
    );
    // No GRANT to PUBLIC anywhere in the file.
    expect(migration).not.toMatch(/GRANT[^;]*TO PUBLIC/);
  });

  it("keeps the impl + helper functions revoked from client roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.treasury_overview_impl(timestamptz, timestamptz) FROM authenticated;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.treasury_platform_user_id() FROM authenticated;",
    );
  });

  it("resolves the platform operator exactly like the fee RPCs (earliest 'admin')", () => {
    expect(migration).toContain("WHERE ur.role = 'admin'");
    expect(migration).toContain("ORDER BY ur.created_at, ur.user_id");
  });
});

describe("treasury migration — fee income mapping is disjoint and complete", () => {
  it("counts link settlement fees from platform platform_fee receipts", () => {
    expect(migration).toContain("t.category = 'platform_fee' THEN 'payment_link'");
    expect(migration).toContain("t.direction = 'incoming'");
    expect(migration).toContain("t.status = 'completed'");
  });

  it("splits send vs transfer fees by the RPCs' description prefixes", () => {
    expect(migration).toContain("t.description LIKE 'Send fee for transfer to %' THEN 'send_money'");
    expect(migration).toContain("t.description LIKE 'Transfer fee for transfer to %' THEN 'transfer'");
  });

  it("keeps an other_platform_fee bucket so receipts always reconcile", () => {
    expect(migration).toContain("ELSE 'other_platform_fee'");
  });

  it("measures card funding fees from fee_amount on card_funding rows", () => {
    expect(migration).toContain("t.category = 'card_funding'");
    expect(migration).toContain("SUM(t.fee_amount)");
  });

  it("measures instant trade fees from executed quotes only", () => {
    expect(migration).toContain("FROM public.btc_quotes q");
    expect(migration).toContain("q.consumed_at IS NOT NULL");
    expect(migration).toContain("SUM(q.fee_zmw)");
  });

  it("measures P2P fees from released escrow holds in sats", () => {
    expect(migration).toContain("FROM public.p2p_escrow_holds h");
    expect(migration).toContain("h.status = 'released'");
    expect(migration).toContain("SUM(h.fee_minor)");
  });

  it("keeps platform money and customer funds in separate aggregates", () => {
    expect(migration).toContain("'platform_fiat'");
    expect(migration).toContain("'user_fiat'");
    expect(migration).toContain("w.user_id <> v_platform");
    expect(migration).toContain("'btc_treasury_float_sats'");
  });

  it("adds only new objects (no settlement or payment-link code touched)", () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.execute_/);
    expect(migration).not.toMatch(/ALTER TABLE public\.transactions/);
    expect(migration).not.toMatch(/DROP /);
  });
});

describe("treasury wiring — route, link and page", () => {
  it("registers /admin/treasury behind a super_admin-only route gate", () => {
    expect(routesSource).toContain('path="/admin/treasury"');
    expect(routesSource).toContain("roles={['super_admin']}><AdminTreasury />");
  });

  it("links the console from the admin dashboard", () => {
    expect(dashboardSource).toContain('title: "Treasury & Reports"');
    expect(dashboardSource).toContain('link: "/admin/treasury"');
  });

  it("page reads only through the treasury RPC helpers", () => {
    expect(pageSource).toContain("fetchTreasuryOverview");
    expect(pageSource).toContain("fetchTreasuryReport");
    expect(pageSource).not.toContain('.from("transactions")');
  });

  it("page has crafted refusal and error states (no raw errors)", () => {
    expect(pageSource).toContain("Super admin only");
    expect(pageSource).toContain("We couldn&apos;t load the treasury");
  });
});

// ---------------------------------------------------------------------
// 2. Period math (Africa/Lusaka = UTC+2, no DST)
// ---------------------------------------------------------------------

describe("treasury period math", () => {
  // Mon 2026-10-26 12:00 UTC = 14:00 in Lusaka.
  const now = new Date("2026-10-26T12:00:00.000Z");

  it("startOfLusakaDay is 22:00 UTC the previous day", () => {
    expect(startOfLusakaDay(now).toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("startOfLusakaDay rolls over at Lusaka midnight (22:00 UTC)", () => {
    const before = new Date("2026-10-26T21:30:00.000Z"); // 23:30 Lusaka, Oct 26
    const after = new Date("2026-10-26T22:30:00.000Z"); // 00:30 Lusaka, Oct 27
    expect(startOfLusakaDay(before).toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(startOfLusakaDay(after).toISOString()).toBe("2026-10-26T22:00:00.000Z");
  });

  it("startOfLusakaMonth is the 1st at Lusaka midnight", () => {
    expect(startOfLusakaMonth(now).toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });

  it("today = [Lusaka midnight, now)", () => {
    const r = periodRange("today", now);
    expect(r.from.toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(r.to.toISOString()).toBe(now.toISOString());
  });

  it("7d and 30d are rolling windows ending now", () => {
    expect(periodRange("7d", now).from.toISOString()).toBe("2026-10-19T12:00:00.000Z");
    expect(periodRange("30d", now).from.toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });

  it("month = [Lusaka month start, now)", () => {
    const r = periodRange("month", now);
    expect(r.from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(r.to.toISOString()).toBe(now.toISOString());
  });

  it("custom range treats the end date as an inclusive Lusaka day", () => {
    const r = periodRange("custom", now, { from: "2026-10-10", to: "2026-10-12" });
    expect(r.from.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-12T22:00:00.000Z");
    expect(lusakaDayStartFromInput("2026-01-01").toISOString()).toBe("2025-12-31T22:00:00.000Z");
  });

  it("an invalid custom range falls back to the last 30 days", () => {
    const r = periodRange("custom", now, { from: "2026-10-12", to: "2026-10-10" });
    expect(r.from.toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------
// 3. Labels, formatting, CSV
// ---------------------------------------------------------------------

describe("treasury labels and formatting", () => {
  it("labels fee rails in plain language", () => {
    expect(feeRailLabel("payment_link")).toBe("Payment links");
    expect(feeRailLabel("send_money")).toBe("Send money");
    expect(feeRailLabel("p2p")).toBe("P2P trades");
    expect(feeRailLabel("other_platform_fee")).toBe("Other platform fees");
  });

  it("labels categories, with a safe fallback", () => {
    expect(categoryLabel("transfer_fee")).toBe("Transfer fee");
    expect(categoryLabel("card_funding")).toBe("Card funding");
    expect(categoryLabel(null)).toBe("Uncategorized");
    expect(categoryLabel("some_new_kind")).toBe("Some new kind");
  });

  it("formats money in the row's own currency", () => {
    expect(formatMoney(12.5, "ZMW")).toContain("12.50");
    expect(formatMoney(0.00001234, "BTC")).toBe("₿0.00001234");
    expect(formatMoney(3, "XAF")).toBe("XAF 3.00");
  });

  it("prefers sats when a fee row is sats-denominated", () => {
    expect(formatFeeAmount({ amount: null, amount_sats: 2500, currency: "BTC" })).toContain(
      "2,500 sats",
    );
    expect(formatFeeAmount({ amount: 1.65, amount_sats: null, currency: "ZMW" })).toContain(
      "1.65",
    );
  });

  it("recognises the super-admin refusal without matching other errors", () => {
    expect(isSuperAdminRefusal(new Error("Only a super admin can view treasury data"))).toBe(true);
    expect(isSuperAdminRefusal({ message: "Only a super admin can view treasury data" })).toBe(true);
    expect(isSuperAdminRefusal(new Error("network unreachable"))).toBe(false);
  });
});

describe("treasury CSV export", () => {
  const row: TreasuryReportRow = {
    id: 1,
    uuid_id: "u-1",
    transaction_id: "TXN-1",
    created_at: "2026-10-26T10:00:00.000Z",
    user_id: "user-1",
    user_name: "Amina, Bwalya",
    user_email: "amina@example.com",
    direction: "incoming",
    amount: 100.5,
    fee_amount: 2.5,
    currency: "ZMW",
    status: "completed",
    category: "transfer",
    payment_method: "wallet",
    provider: null,
    recipient_name: 'Bob "The Builder" Banda',
    reference: "REF\n2",
    description: "Payment, with comma",
  };

  it("emits the header then one line per row", () => {
    const csv = buildTreasuryCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Date,Transaction ID,User,Email,Direction,Amount,Fee,Currency");
    expect(lines).toHaveLength(2);
  });

  it("quotes fields containing commas, quotes or newlines (RFC 4180)", () => {
    const csv = buildTreasuryCsv([row]);
    expect(csv).toContain('"Amina, Bwalya"');
    expect(csv).toContain('"Bob ""The Builder"" Banda"');
    expect(csv).toContain('"REF\n2"');
    expect(csv).toContain('"Payment, with comma"');
  });

  it("renders the category label, not the raw key", () => {
    expect(buildTreasuryCsv([row])).toContain("Transfer");
  });
});
