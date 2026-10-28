// Treasury & Reports console — client-side helpers for
// src/pages/AdminTreasury.tsx.
//
// The NUMBERS all come from the server-side aggregates in
// supabase/migrations/20261222_superadmin_treasury_reports.sql
// (treasury_overview / treasury_report, SECURITY DEFINER, gated to
// super_admin inside Postgres). This module only owns the parts
// that are legitimately the client's: the period presets, labels,
// money formatting and the CSV rendering of a report the server
// already filtered and totalled.
//
// Period convention (mirrors the migration header): windows are
// [from, to) — start inclusive, end exclusive. "Today" and "This
// month" are computed in Africa/Lusaka, the platform's home
// timezone (the analytics RPC buckets there too); Zambia is
// UTC+2 year-round with no DST, so Lusaka midnights are a fixed
// offset from UTC.

import { supabase } from "@/integrations/supabase/client";
import { formatCurrencyStandalone, type SupportedCurrency } from "@/contexts/CurrencyContext";
import { formatBtcFromSats, formatSats } from "@/utils/p2pUi";

export type TreasuryPreset = "today" | "7d" | "30d" | "month" | "custom";

export const TREASURY_PRESETS: { value: TreasuryPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
];

const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date (y/m/d) it currently is in Africa/Lusaka. */
export function lusakaDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lusaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** The UTC instant of Lusaka midnight at the start of the Lusaka day containing `now`. */
export function startOfLusakaDay(now: Date): Date {
  const { year, month, day } = lusakaDateParts(now);
  return new Date(Date.UTC(year, month - 1, day) - LUSAKA_OFFSET_MS);
}

/** The UTC instant of Lusaka midnight on the 1st of the Lusaka month containing `now`. */
export function startOfLusakaMonth(now: Date): Date {
  const { year, month } = lusakaDateParts(now);
  return new Date(Date.UTC(year, month - 1, 1) - LUSAKA_OFFSET_MS);
}

/** Lusaka midnight at the start of a yyyy-mm-dd calendar date (as picked in a date input). */
export function lusakaDayStartFromInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) - LUSAKA_OFFSET_MS);
}

export interface TreasuryRange {
  from: Date;
  to: Date;
}

/**
 * Resolve a preset to its [from, to) window. For "custom", from/to
 * are yyyy-mm-dd date-input values interpreted as Lusaka calendar
 * days; the end day is INCLUSIVE (the window ends at the next
 * Lusaka midnight). An unparseable custom range falls back to the
 * last 30 days rather than producing an empty console.
 */
export function periodRange(
  preset: TreasuryPreset,
  now: Date,
  custom?: { from: string; to: string },
): TreasuryRange {
  switch (preset) {
    case "today":
      return { from: startOfLusakaDay(now), to: now };
    case "7d":
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
    case "month":
      return { from: startOfLusakaMonth(now), to: now };
    case "custom": {
      if (custom?.from && custom?.to) {
        const from = lusakaDayStartFromInput(custom.from);
        const to = new Date(lusakaDayStartFromInput(custom.to).getTime() + DAY_MS);
        if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && to > from) {
          return { from, to };
        }
      }
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
    }
    case "30d":
    default:
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  }
}

// ---------------------------------------------------------------------
// Shapes returned by the treasury RPCs (see the migration).
// ---------------------------------------------------------------------

export interface CurrencyBalance {
  currency: string;
  balance: number;
  wallets: number;
}

export interface FeeRailRow {
  rail: string;
  currency: string;
  amount: number | null;
  amount_sats: number | null;
  count: number;
}

export interface FeeTotal {
  currency: string;
  amount: number | null;
  amount_sats: number | null;
  count: number;
}

export interface StatusVolume {
  status: string;
  currency: string;
  count: number;
  volume: number;
}

export interface TypeVolume {
  category: string;
  currency: string;
  count: number;
  completed_volume: number;
}

export interface CurrencyVolume {
  currency: string;
  count: number;
  completed_volume: number;
}

export interface TreasuryOverview {
  platform_user_id: string | null;
  period: { from: string; to: string };
  balances: {
    platform_fiat: CurrencyBalance[];
    platform_btc_sats: number;
    btc_treasury_float_sats: number;
    user_fiat: CurrencyBalance[];
    user_btc_sats: number;
  };
  fees: {
    by_rail: FeeRailRow[];
    totals: FeeTotal[];
  };
  metrics: {
    tx_count: number;
    by_status: StatusVolume[];
    by_type: TypeVolume[];
    volume: CurrencyVolume[];
    new_users: number;
    users_total: number;
    wallets_total: number;
    wallets_active: number;
    wallets_transacting: number;
  };
}

export interface TreasuryReportRow {
  id: number;
  uuid_id: string;
  transaction_id: string | null;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  direction: string;
  amount: number;
  fee_amount: number | null;
  currency: string;
  status: string;
  category: string;
  payment_method: string | null;
  provider: string | null;
  recipient_name: string | null;
  reference: string | null;
  description: string | null;
}

export interface ReportTotal {
  currency: string;
  count: number;
  incoming: number;
  outgoing: number;
}

export interface TreasuryReport {
  total: number;
  totals: ReportTotal[];
  rows: TreasuryReportRow[];
}

export const EMPTY_OVERVIEW: TreasuryOverview = {
  platform_user_id: null,
  period: { from: "", to: "" },
  balances: {
    platform_fiat: [],
    platform_btc_sats: 0,
    btc_treasury_float_sats: 0,
    user_fiat: [],
    user_btc_sats: 0,
  },
  fees: { by_rail: [], totals: [] },
  metrics: {
    tx_count: 0,
    by_status: [],
    by_type: [],
    volume: [],
    new_users: 0,
    users_total: 0,
    wallets_total: 0,
    wallets_active: 0,
    wallets_transacting: 0,
  },
};

// ---------------------------------------------------------------------
// Labels.
// ---------------------------------------------------------------------

export const FEE_RAIL_LABELS: Record<string, string> = {
  payment_link: "Payment links",
  send_money: "Send money",
  transfer: "Transfers",
  card_funding: "Card funding",
  btc_trade: "Bitcoin buy / sell",
  p2p: "P2P trades",
  other_platform_fee: "Other platform fees",
};

export function feeRailLabel(rail: string): string {
  return FEE_RAIL_LABELS[rail] ?? rail.replace(/_/g, " ");
}

const CATEGORY_LABELS: Record<string, string> = {
  transfer: "Transfer",
  transfer_fee: "Transfer fee",
  platform_fee: "Platform fee",
  card_funding: "Card funding",
  btc_trade: "Bitcoin trade",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  escrow_hold: "P2P escrow hold",
  split_payment: "Split payment",
  savings_deposit: "Savings deposit",
  savings_withdrawal: "Savings withdrawal",
  internal_transfer: "Internal transfer",
  payment: "Payment",
  uncategorized: "Uncategorized",
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return CATEGORY_LABELS.uncategorized;
  return (
    CATEGORY_LABELS[category] ??
    category.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

// ---------------------------------------------------------------------
// Money formatting — always in the row's OWN currency (a treasury
// console never silently converts). BTC ledger amounts are BTC
// decimals (sats / 1e8, per the trade RPC); sat-denominated figures
// use the sats formatters.
// ---------------------------------------------------------------------

const FIAT_CODES: SupportedCurrency[] = ["ZMW", "USD", "EUR", "GBP"];

export function formatMoney(amount: number, currency: string): string {
  if (currency === "BTC") return `₿${Number(amount).toFixed(8)}`;
  if ((FIAT_CODES as string[]).includes(currency)) {
    return formatCurrencyStandalone(amount, currency as SupportedCurrency);
  }
  return `${currency} ${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSatsAmount(sats: number): string {
  return `${formatSats(sats)} (₿${formatBtcFromSats(sats)})`;
}

/** A fee figure that may be fiat (amount) or sats-denominated (amount_sats). */
export function formatFeeAmount(row: { amount: number | null; amount_sats: number | null; currency: string }): string {
  if (row.amount_sats !== null && row.amount_sats !== undefined) {
    return formatSatsAmount(row.amount_sats);
  }
  return formatMoney(row.amount ?? 0, row.currency);
}

// ---------------------------------------------------------------------
// RPC wiring.
// ---------------------------------------------------------------------

export async function fetchTreasuryOverview(range: TreasuryRange): Promise<TreasuryOverview> {
  const { data, error } = await supabase.rpc("treasury_overview", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw error;
  return (data as TreasuryOverview) ?? EMPTY_OVERVIEW;
}

/**
 * Pending bank-payout liabilities (migration 20261245): user money
 * that has been reserved for a bank withdrawal but not yet paid
 * out to a bank — a liability of the platform until it is paid or
 * refunded. Served by the super_admin-gated
 * treasury_bank_payout_liabilities RPC; the RPC is newer than the
 * generated types, hence the untyped call.
 */
export interface BankPayoutLiabilities {
  pending_review_count: number;
  pending_review_zmw: number;
  approved_count: number;
  approved_zmw: number;
  total_outstanding_zmw: number;
}

export async function fetchBankPayoutLiabilities(): Promise<BankPayoutLiabilities> {
  // deno-lint-ignore no-explicit-any
  const { data, error } = await (supabase as any).rpc("treasury_bank_payout_liabilities");
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    pending_review_count: Number(row.pending_review_count ?? 0),
    pending_review_zmw: Number(row.pending_review_zmw ?? 0),
    approved_count: Number(row.approved_count ?? 0),
    approved_zmw: Number(row.approved_zmw ?? 0),
    total_outstanding_zmw: Number(row.total_outstanding_zmw ?? 0),
  };
}

export interface TreasuryReportFilters {
  currency: string | null;
  category: string | null;
  status: string | null;
  direction: string | null;
  search: string | null;
}

export async function fetchTreasuryReport(
  range: TreasuryRange,
  filters: TreasuryReportFilters,
  limit: number,
  offset: number,
): Promise<TreasuryReport> {
  const { data, error } = await supabase.rpc("treasury_report", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_currency: filters.currency,
    p_category: filters.category,
    p_status: filters.status,
    p_direction: filters.direction,
    p_search: filters.search,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data as TreasuryReport) ?? { total: 0, totals: [], rows: [] };
}

/** True when the RPC refused because the caller is not a super admin. */
export function isSuperAdminRefusal(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  return /only a super admin/i.test(message);
}

// ---------------------------------------------------------------------
// CSV export — renders exactly the rows the server filtered.
// ---------------------------------------------------------------------

export const CSV_EXPORT_LIMIT = 20000;

const CSV_COLUMNS: { header: string; value: (r: TreasuryReportRow) => string }[] = [
  { header: "Date", value: (r) => r.created_at },
  { header: "Transaction ID", value: (r) => r.transaction_id ?? r.uuid_id },
  { header: "User", value: (r) => r.user_name ?? "" },
  { header: "Email", value: (r) => r.user_email ?? "" },
  { header: "Direction", value: (r) => r.direction },
  { header: "Amount", value: (r) => String(r.amount) },
  { header: "Fee", value: (r) => (r.fee_amount === null ? "" : String(r.fee_amount)) },
  { header: "Currency", value: (r) => r.currency },
  { header: "Status", value: (r) => r.status },
  { header: "Type", value: (r) => categoryLabel(r.category) },
  { header: "Method", value: (r) => r.payment_method ?? "" },
  { header: "Provider", value: (r) => r.provider ?? "" },
  { header: "Recipient", value: (r) => r.recipient_name ?? "" },
  { header: "Reference", value: (r) => r.reference ?? "" },
  { header: "Description", value: (r) => r.description ?? "" },
];

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTreasuryCsv(rows: TreasuryReportRow[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(c.value(r))).join(","));
  return [header, ...lines].join("\r\n");
}
