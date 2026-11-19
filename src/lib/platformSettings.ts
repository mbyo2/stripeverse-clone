// Pure logic for the superadmin Platform Settings surface
// (/admin/settings): the editable-settings model, patch building
// with validation, plain-language error mapping, and the platform
// health judgements (BTC price snapshot freshness, FX rate
// validity, webhook delivery health).
//
// The editable model MIRRORS the server-side whitelist in
// public.admin_update_platform_settings (migration
// 20261274_superadmin_admin_tier_parity.sql): exactly the keys the
// RPC accepts — the operational kill switches, the platform fee
// percents, and two amount settings. Anything else in the
// platform_settings row (BTC custody limits, P2P SLA timings, the
// Coinos deposit address, dead rails' flags) is deliberately NOT
// editable from the console: those change through reviewed
// migrations, not a settings form. The RPC re-validates everything
// server-side and refuses non-super_admin callers; this module only
// shapes and pre-validates what the page sends.
//
// Kept dependency-light and pure so the rules are unit-testable
// without a browser or a database (the adminConsole.ts pattern).

import { toUserFacingError } from "@/utils/userFacingError";

export type SettingKind = "toggle" | "fee" | "amount";

export interface SettingField {
  key: string;
  label: string;
  help: string;
  kind: SettingKind;
  /** Unit shown after a numeric input ("%" for fees). */
  suffix?: string;
}

export const TOGGLE_FIELDS: SettingField[] = [
  { key: "p2p_enabled", label: "P2P marketplace", help: "Lets users buy and sell Bitcoin with each other.", kind: "toggle" },
  { key: "pos_enabled", label: "Bitcoin POS", help: "Lets merchants take Bitcoin payments in person.", kind: "toggle" },
  { key: "mtn_momo_enabled", label: "MTN Mobile Money", help: "Mobile-money collections and payouts over MTN.", kind: "toggle" },
  { key: "airtel_money_enabled", label: "Airtel Money", help: "Mobile-money collections and payouts over Airtel.", kind: "toggle" },
  { key: "moonpay_enabled", label: "MoonPay card purchases", help: "Lets users buy Bitcoin by card through MoonPay.", kind: "toggle" },
  { key: "moonpay_selfcustody_enabled", label: "MoonPay to self-custody", help: "MoonPay purchases delivered straight to a user's own wallet.", kind: "toggle" },
  { key: "paypal_payouts_enabled", label: "PayPal payouts", help: "Lets users withdraw to PayPal.", kind: "toggle" },
  { key: "bank_payouts_enabled", label: "Bank payouts", help: "Withdrawals to Zambian bank accounts.", kind: "toggle" },
  { key: "receiving_accounts_enabled", label: "Receiving accounts", help: "Issued bank details for receiving money in.", kind: "toggle" },
  { key: "face_verification_enabled", label: "Face verification", help: "Requires a live face check as part of identity verification.", kind: "toggle" },
  { key: "btc_rebalance_enabled", label: "BTC auto-rebalancing", help: "Moves Bitcoin between the Lightning and on-chain pools automatically.", kind: "toggle" },
  { key: "btc_batch_enabled", label: "BTC withdrawal batching", help: "Groups on-chain withdrawals into batches to save network fees.", kind: "toggle" },
  { key: "btc_consolidation_enabled", label: "BTC consolidation", help: "Periodically consolidates small wallet inputs.", kind: "toggle" },
];

export const FEE_FIELDS: SettingField[] = [
  { key: "send_money_fee_percent", label: "Send Money fee", help: "Platform fee on wallet-to-wallet sends.", kind: "fee", suffix: "%" },
  { key: "transfer_fee_percent", label: "Transfer fee", help: "Platform fee on transfers.", kind: "fee", suffix: "%" },
  { key: "split_platform_fee_percent", label: "Split payment fee", help: "Platform share taken on split payments.", kind: "fee", suffix: "%" },
  { key: "p2p_fee_percent", label: "P2P trade fee", help: "Platform fee on completed P2P trades.", kind: "fee", suffix: "%" },
  { key: "paypal_platform_fee_percent", label: "PayPal collection fee", help: "Platform fee on PayPal collections.", kind: "fee", suffix: "%" },
  { key: "paypal_payout_fee_percent", label: "PayPal payout fee", help: "Platform fee on PayPal payouts.", kind: "fee", suffix: "%" },
  { key: "bank_payout_fee_percent", label: "Bank payout fee", help: "Platform fee on bank withdrawals.", kind: "fee", suffix: "%" },
];

export const AMOUNT_FIELDS: SettingField[] = [
  { key: "bank_payout_min_zmw", label: "Bank payout minimum", help: "Smallest bank withdrawal a user can request.", kind: "amount", suffix: "ZMW" },
  { key: "paypal_float_allowance_usd", label: "PayPal float allowance", help: "How much of the platform PayPal float payouts may use.", kind: "amount", suffix: "USD" },
];

export const ALL_SETTING_FIELDS: SettingField[] = [
  ...TOGGLE_FIELDS,
  ...FEE_FIELDS,
  ...AMOUNT_FIELDS,
];

const FIELD_BY_KEY = new Map(ALL_SETTING_FIELDS.map((f) => [f.key, f]));

export type SettingsValues = Record<string, boolean | number>;

/** The editable values out of a platform_settings row: only the
 *  whitelisted keys, coerced to the field's type. Missing or
 *  unparseable values fall back to the fail-closed default for the
 *  kind (toggle off, number 0). */
export function readEditableValues(
  row: Record<string, unknown> | null | undefined,
): SettingsValues {
  const values: SettingsValues = {};
  for (const field of ALL_SETTING_FIELDS) {
    const raw = row?.[field.key];
    if (field.kind === "toggle") {
      values[field.key] = raw === true;
    } else {
      const n = typeof raw === "number" ? raw : Number(raw);
      values[field.key] = Number.isFinite(n) ? n : 0;
    }
  }
  return values;
}

export interface SettingsPatchResult {
  /** Only the keys that changed, shaped for the RPC. */
  patch: Record<string, boolean | number>;
  /** Plain-language problems, keyed by field key. */
  errors: Record<string, string>;
}

/** Diff the edited values against the loaded ones and validate.
 *  Returns only real changes (an unchanged form saves nothing) and
 *  a per-field error for anything the RPC would refuse, so the page
 *  can say what is wrong before anything is sent. */
export function buildSettingsPatch(
  original: SettingsValues,
  edited: SettingsValues,
): SettingsPatchResult {
  const patch: Record<string, boolean | number> = {};
  const errors: Record<string, string> = {};
  for (const field of ALL_SETTING_FIELDS) {
    const next = edited[field.key];
    if (next === undefined) continue;
    if (field.kind === "toggle") {
      if (typeof next !== "boolean") {
        errors[field.key] = `${field.label} must be on or off.`;
        continue;
      }
    } else {
      if (typeof next !== "number" || !Number.isFinite(next)) {
        errors[field.key] = `${field.label} must be a number.`;
        continue;
      }
      if (field.kind === "fee" && (next < 0 || next > 100)) {
        errors[field.key] = `${field.label} must be between 0% and 100%.`;
        continue;
      }
      if (field.kind === "amount" && next < 0) {
        errors[field.key] = `${field.label} can't be less than zero.`;
        continue;
      }
    }
    if (next !== original[field.key]) {
      patch[field.key] = next;
    }
  }
  return { patch, errors };
}

/** Plain-language message for a failed settings save — the
 *  error-presentation rule: never a raw database message. */
export function settingsErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";
  if (/only a super admin/i.test(raw)) {
    return "Only a super admin can change platform settings. Your changes weren't saved.";
  }
  if (/unknown or read-only setting/i.test(raw)) {
    return "One of those settings can't be changed from here. Refresh the page and try again — nothing was saved.";
  }
  if (/must be (true or false|a number between)/i.test(raw)) {
    return "One of the values isn't valid. Check the highlighted fields and try again — nothing was saved.";
  }
  return toUserFacingError(
    error,
    "We couldn't save those settings. Please try again.",
  );
}

// ---------------------------------------------------------------------
// Platform health judgements — pure functions of the latest rows, so
// the page (and its tests) agree on what "healthy" means.
// ---------------------------------------------------------------------

export type HealthStatus = "healthy" | "attention" | "down" | "unknown";

export interface HealthJudgement {
  status: HealthStatus;
  /** One plain-language sentence for the operator. */
  detail: string;
}

/** The BTC price index: the writer lands a snapshot every minute.
 *  Healthy = newest snapshot is fresh (not flagged stale) and no
 *  more than 10 minutes old. A stale flag or an old snapshot means
 *  quotes are refusing — that is "down" for trading purposes. */
export function judgeSnapshotHealth(
  latest: { created_at: string; is_stale: boolean } | null,
  now: Date,
): HealthJudgement {
  if (!latest) {
    return {
      status: "unknown",
      detail: "No Bitcoin price snapshots found yet.",
    };
  }
  const ageMinutes =
    (now.getTime() - new Date(latest.created_at).getTime()) / 60000;
  if (latest.is_stale) {
    return {
      status: "down",
      detail:
        "The newest Bitcoin price is marked stale — the price sources disagree, so new quotes are paused.",
    };
  }
  if (!Number.isFinite(ageMinutes) || ageMinutes > 10) {
    return {
      status: "down",
      detail: "The newest Bitcoin price is over 10 minutes old — the price writer may have stopped.",
    };
  }
  return {
    status: "healthy",
    detail: "Bitcoin price index is updating every minute.",
  };
}

/** The USD→ZMW rate: healthy while the newest stored rate is still
 *  inside its validity window (the refresher runs every 10 minutes
 *  with a 1-hour validity). */
export function judgeFxHealth(
  latest: { rate: number; valid_until: string } | null,
  now: Date,
): HealthJudgement {
  if (!latest) {
    return { status: "unknown", detail: "No exchange rate stored yet." };
  }
  if (new Date(latest.valid_until).getTime() <= now.getTime()) {
    return {
      status: "down",
      detail:
        "The stored USD–ZMW rate has expired — conversions are paused until the refresher lands a new one.",
    };
  }
  return {
    status: "healthy",
    detail: `USD–ZMW rate ${latest.rate} is current.`,
  };
}

export interface WebhookHealth extends HealthJudgement {
  total: number;
  failed: number;
}

/** Merchant webhook deliveries over the last 24 hours. Any failed
 *  delivery needs a look (it can be requeued); a clean window or no
 *  traffic at all is healthy. */
export function judgeWebhookHealth(
  rows: { status: string | null }[],
): WebhookHealth {
  const total = rows.length;
  const failed = rows.filter((r) => /fail/i.test(r.status ?? "")).length;
  if (total === 0) {
    return {
      status: "healthy",
      total,
      failed,
      detail: "No merchant webhook deliveries in the last 24 hours.",
    };
  }
  if (failed > 0) {
    return {
      status: "attention",
      total,
      failed,
      detail: `${failed} of ${total} webhook deliveries failed in the last 24 hours. Failed deliveries can be requeued.`,
    };
  }
  return {
    status: "healthy",
    total,
    failed,
    detail: `All ${total} webhook deliveries in the last 24 hours went through.`,
  };
}

/** The field model lookup the page uses for labels in summaries. */
export function settingFieldLabel(key: string): string {
  return FIELD_BY_KEY.get(key)?.label ?? key;
}
