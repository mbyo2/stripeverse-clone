// Pure decision logic for BANK WITHDRAWALS (cash out to a Zambian
// bank account).
//
// Shared by the `bank-payout` edge function (user create / list /
// methods and the admin queue actions). Deliberately pure — no
// imports, no Deno APIs — so the vitest suite exercises the exact
// code the edge function runs (the _shared/paypal-payout.ts
// pattern).
//
// The money rules this module encodes:
//   - Bank payouts settle in ZMW ONLY, to Zambian banks, from the
//     user's ZMW wallet. A USD wallet cannot pay a Zambian bank —
//     the user converts first (the PayPal ZMW gate's rule, mirrored).
//   - RESERVE FIRST, EXACTLY ONCE: the balance is debited inside
//     reserve_bank_withdrawal (migration 20261245) before anything
//     else happens; admin reject/fail refunds the full reservation
//     (amount + fee) exactly once through the transition RPC, which
//     owns every state change under the row lock.
//   - THE CHANNEL IS OPERATOR-PAID: an admin approves, an operator
//     pays from the platform's bank account, an admin marks paid
//     with the bank's reference. No code here pretends an API moved
//     the money.
//   - THE RAIL GATE (20261242 pattern): while
//     platform_settings.bank_payouts_enabled is off, create is
//     refused BEFORE any reservation with crafted copy. The gate
//     fails closed — an unreadable settings row counts as off.

/** This platform's lifecycle for a bank withdrawal row. */
export type BankWithdrawalStatus =
  | "pending_review"
  | "approved"
  | "paid_out"
  | "rejected"
  | "failed";

/**
 * Zambian banks a payout can be sent to. The first nine are the
 * Bank Transfers page's standing list (src/pages/BankTransfers.tsx
 * — one canonical list, pinned identical by the test suite); the
 * rest are the remaining major Zambian commercial banks.
 */
export interface ZambianBank {
  code: string;
  name: string;
}

export const ZAMBIAN_BANKS: readonly ZambianBank[] = [
  { code: "ZANACO", name: "Zanaco" },
  { code: "FNB", name: "FNB Zambia" },
  { code: "STANBIC", name: "Stanbic Bank" },
  { code: "ABSA", name: "Absa Bank Zambia" },
  { code: "SBZ", name: "Standard Chartered" },
  { code: "INDO", name: "Indo Zambia Bank" },
  { code: "ACCESS", name: "Access Bank Zambia" },
  { code: "ATLAS", name: "Atlas Mara (BancABC)" },
  { code: "UBA", name: "United Bank for Africa" },
  { code: "ZICB", name: "Zambia Industrial Commercial Bank" },
  { code: "FCB", name: "First Capital Bank" },
  { code: "ECOBANK", name: "Ecobank Zambia" },
  { code: "INVESTRUST", name: "Investrust Bank" },
  { code: "CAVMONT", name: "Cavmont Bank" },
];

export function isKnownZambianBankCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  return ZAMBIAN_BANKS.some((b) => b.code === code.trim().toUpperCase());
}

export function zambianBankName(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const bank = ZAMBIAN_BANKS.find((b) => b.code === code.trim().toUpperCase());
  return bank ? bank.name : null;
}

/**
 * Crafted copy for a withdrawal refused because the bank payout
 * rail itself is off (platform_settings.bank_payouts_enabled,
 * migration 20261245). Payouts are operator-paid from the
 * platform's bank account; until that channel and its funding are
 * in place NO withdrawal can settle, so the refusal happens BEFORE
 * any reservation — the copy says exactly that, and never claims
 * money was reserved, sent, or returned.
 */
export const BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE =
  "Bank withdrawals are being activated and aren't available yet. No money has been reserved or sent — your balance stays in your wallet, and withdrawals will open here as soon as activation completes.";

/**
 * The bank rail gate, resolved from a platform_settings row. Only
 * a literal `true` enables the rail: a missing row, a missing
 * column, or any other value is OFF — the gate fails closed.
 */
export function bankPayoutsEnabled(
  settingsRow: Record<string, unknown> | null | undefined,
): boolean {
  if (!settingsRow) return false;
  return settingsRow.bank_payouts_enabled === true;
}

/** Launch defaults — the settings row is authoritative; these are
 *  the fallbacks when it cannot be read (the migration's defaults). */
export const BANK_PAYOUT_MIN_ZMW_DEFAULT = 50;
export const BANK_PAYOUT_FEE_PERCENT_DEFAULT = 0;

export function bankPayoutMinZmw(
  settingsRow: Record<string, unknown> | null | undefined,
): number {
  const value = Number(settingsRow?.bank_payout_min_zmw);
  return Number.isFinite(value) && value > 0 ? value : BANK_PAYOUT_MIN_ZMW_DEFAULT;
}

export function bankPayoutFeePercent(
  settingsRow: Record<string, unknown> | null | undefined,
): number {
  const value = Number(settingsRow?.bank_payout_fee_percent);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Round to 2dp the way the SQL round(x, 2) does for these magnitudes. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The platform bank-payout fee: a percent of the payout amount,
 * charged ON TOP (the recipient receives the full amount; the
 * wallet is debited amount + fee) — the PayPal payout fee's shape.
 * The rate comes from platform_settings.bank_payout_fee_percent,
 * whose DEFAULT is 0 until the CEO sets a commercial rate.
 */
export function computeBankPayoutFee(amount: number, ratePercent: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  return roundMoney((amount * ratePercent) / 100);
}

/**
 * A Zambian bank account number's plausible shape: digits (spaces
 * and dashes tolerated as separators), 6–20 digits once stripped.
 * The receiving bank is the real validator — this only stops
 * obvious typos at the door.
 */
export function isPlausibleAccountNumber(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const digits = value.replace(/[\s-]/g, "");
  return /^[0-9]{6,20}$/.test(digits);
}

/** The masked form a user ever sees: all but the last four hidden. */
export function maskAccountNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return `•••• ${trimmed.slice(-4)}`;
}

/**
 * Does the saved account's name match the wallet holder's name?
 * Account-name match is a WARNING, never a hard gate (people bank
 * under maiden names, middle names, business names) — but a payout
 * to an account in a completely different name is the classic
 * fraud/mule shape, so the form surfaces the difference plainly
 * and the admin queue shows both names. Comparison is token-based:
 * every token of the shorter name appearing in the longer counts
 * as a match.
 */
export function bankAccountNameMatches(
  accountName: unknown,
  holderName: unknown,
): boolean {
  const tokens = (v: unknown) =>
    typeof v === "string"
      ? v.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1)
      : [];
  const a = tokens(accountName);
  const b = tokens(holderName);
  if (a.length === 0 || b.length === 0) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((t) => longer.includes(t));
}

// ── Admin gates (bank-payout admin actions) ──────────────────────

/** Roles that may work the bank payout queue. */
export const BANK_ADMIN_ROLES = ["admin", "super_admin"] as const;

export function canUseBankAdmin(roles: readonly string[]): boolean {
  return roles.some((r) => (BANK_ADMIN_ROLES as readonly string[]).includes(r));
}

type RolesReader = {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
};

/** Resolve a caller's roles and apply the admin gate. */
export async function canUseBankAdminFor(
  client: RolesReader,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(`Role lookup failed: ${error.message}`);
  const roles = ((data ?? []) as Array<{ role: string }>).map((r) => r.role);
  return canUseBankAdmin(roles);
}

export const BANK_ADMIN_REFUSAL_MESSAGE =
  "This area is for the BMaGlass Pay admin team. If you need a hand with a bank withdrawal, contact support and we'll help.";

/** The admin actions the transition RPC accepts. */
export const BANK_ADMIN_ACTIONS = ["approve", "reject", "mark_paid", "fail"] as const;
export type BankAdminAction = (typeof BANK_ADMIN_ACTIONS)[number];

export function isBankAdminAction(value: unknown): value is BankAdminAction {
  return typeof value === "string" &&
    (BANK_ADMIN_ACTIONS as readonly string[]).includes(value);
}

/** Plain-language status labels for the user's withdrawal history. */
export const BANK_WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  pending_review: "Waiting for review",
  approved: "Approved — being paid to your bank",
  paid_out: "Paid to your bank account",
  rejected: "Not approved — money returned to your wallet",
  failed: "Couldn't be completed — money returned to your wallet",
};

export function bankWithdrawalStatusLabel(status: string): string {
  return BANK_WITHDRAWAL_STATUS_LABELS[status] ?? status;
}
