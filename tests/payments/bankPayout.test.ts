// Tests for BANK WITHDRAWALS (cash out to a Zambian bank account)
// — the Payoneer-gap programme's bank cash-out leg (CEO order
// 2026-10-28), migration 20261245.
//
// Layers, mirroring the PayPal payout suite:
//   1. The pure decision module (_shared/bank-payout.ts) — the
//      exact file the edge function runs: the rail gate (fails
//      closed), settings-driven minimum/fee, bank list, account
//      number validation + masking, the account-name match rule,
//      and the admin gate.
//   2. Client mirror parity (src/utils/bankPayout.ts): the bank
//      list and fee math must never drift from the shared module.
//   3. Migration structure pins: table + lifecycle CHECK, scoped
//      grants (GRANT rule), RLS, the reserve/transition RPCs'
//      exactly-once shape, service_role-only EXECUTE, and the
//      treasury liabilities gate.
//   4. Wiring pins: the edge function refuses create BEFORE the
//      reserve while the flag is off, the Wallet page offers the
//      Bank option beside PayPal, and the admin queue route exists.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANK_ADMIN_REFUSAL_MESSAGE,
  BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE,
  bankAccountNameMatches,
  bankPayoutFeePercent,
  bankPayoutMinZmw,
  bankPayoutsEnabled,
  bankWithdrawalStatusLabel,
  canUseBankAdmin,
  computeBankPayoutFee,
  isBankAdminAction,
  isKnownZambianBankCode,
  isPlausibleAccountNumber,
  maskAccountNumber,
  ZAMBIAN_BANKS,
  zambianBankName,
} from "../../supabase/functions/_shared/bank-payout";
import {
  ZAMBIAN_BANKS as CLIENT_BANKS,
  computeBankPayoutFee as computeBankPayoutFeeClient,
  bankAccountNameMatches as bankAccountNameMatchesClient,
  maskAccountNumber as maskAccountNumberClient,
} from "../../src/utils/bankPayout";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read("../../supabase/migrations/20261245_bank_withdrawals.sql");
const bankFn = read("../../supabase/functions/bank-payout/index.ts");
const walletPage = read("../../src/pages/Wallet.tsx");
const bankComponent = read("../../src/components/wallet/BankWithdraw.tsx");
const routes = read("../../src/components/AnimatedRoutes.tsx");
const bankTransfersPage = read("../../src/pages/BankTransfers.tsx");

describe("bank rail gate", () => {
  it("is on only for a literal true", () => {
    expect(bankPayoutsEnabled({ bank_payouts_enabled: true })).toBe(true);
    expect(bankPayoutsEnabled({ bank_payouts_enabled: false })).toBe(false);
    expect(bankPayoutsEnabled({ bank_payouts_enabled: "true" })).toBe(false);
    expect(bankPayoutsEnabled({})).toBe(false);
    expect(bankPayoutsEnabled(null)).toBe(false);
    expect(bankPayoutsEnabled(undefined)).toBe(false);
  });

  it("refusal copy says nothing was reserved or sent", () => {
    expect(BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE).toContain("being activated");
    expect(BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE).toContain(
      "No money has been reserved or sent",
    );
  });

  it("settings readers fall back to the migration defaults", () => {
    expect(bankPayoutMinZmw(null)).toBe(50);
    expect(bankPayoutMinZmw({ bank_payout_min_zmw: 100 })).toBe(100);
    expect(bankPayoutMinZmw({ bank_payout_min_zmw: -5 })).toBe(50);
    expect(bankPayoutFeePercent(null)).toBe(0);
    expect(bankPayoutFeePercent({ bank_payout_fee_percent: 1.5 })).toBe(1.5);
    expect(bankPayoutFeePercent({ bank_payout_fee_percent: -1 })).toBe(0);
  });
});

describe("bank payout fee", () => {
  it("is a percent of the amount, rounded to ngwee, on top", () => {
    expect(computeBankPayoutFee(1000, 1)).toBe(10);
    expect(computeBankPayoutFee(333.33, 1.5)).toBe(5);
    expect(computeBankPayoutFee(100, 0)).toBe(0);
    expect(computeBankPayoutFee(0, 2)).toBe(0);
    expect(computeBankPayoutFee(-50, 2)).toBe(0);
  });

  it("client mirror computes identically", () => {
    for (const [amount, rate] of [[1000, 1], [333.33, 1.5], [75.5, 0], [9999, 2.25]] as const) {
      expect(computeBankPayoutFeeClient(amount, rate)).toBe(computeBankPayoutFee(amount, rate));
    }
  });
});

describe("zambian banks", () => {
  it("client list is identical to the shared list", () => {
    expect(CLIENT_BANKS).toEqual(ZAMBIAN_BANKS);
  });

  it("includes the major Zambian banks", () => {
    const codes = ZAMBIAN_BANKS.map((b) => b.code);
    for (const code of ["ZANACO", "FNB", "STANBIC", "ABSA", "SBZ", "INDO", "ACCESS", "ATLAS", "UBA", "ZICB", "FCB", "ECOBANK", "INVESTRUST", "CAVMONT"]) {
      expect(codes).toContain(code);
    }
  });

  it("keeps the Bank Transfers page's standing nine as its first entries", () => {
    for (const code of ["ZANACO", "FNB", "STANBIC", "ABSA", "SBZ", "INDO", "ACCESS", "ATLAS", "UBA"]) {
      expect(bankTransfersPage).toContain(`code: '${code}'`);
      expect(isKnownZambianBankCode(code)).toBe(true);
    }
    expect(isKnownZambianBankCode("HSBC")).toBe(false);
    expect(isKnownZambianBankCode("")).toBe(false);
    expect(zambianBankName("zanaco")).toBe("Zanaco");
    expect(zambianBankName("NOPE")).toBeNull();
  });
});

describe("account numbers", () => {
  it("accepts plausible Zambian account numbers and refuses the rest", () => {
    expect(isPlausibleAccountNumber("1234567890")).toBe(true);
    expect(isPlausibleAccountNumber("0123 4567 89")).toBe(true);
    expect(isPlausibleAccountNumber("12345")).toBe(false);
    expect(isPlausibleAccountNumber("123456789012345678901")).toBe(false);
    expect(isPlausibleAccountNumber("12AB567890")).toBe(false);
    expect(isPlausibleAccountNumber(1234567890)).toBe(false);
  });

  it("masks all but the last four, identically on the client", () => {
    expect(maskAccountNumber("1234567890")).toBe("•••• 7890");
    expect(maskAccountNumber("1234")).toBe("1234");
    expect(maskAccountNumber(null)).toBe("");
    expect(maskAccountNumberClient("1234567890")).toBe(maskAccountNumber("1234567890"));
  });
});

describe("account-name match", () => {
  it("matches token subsets in either direction", () => {
    expect(bankAccountNameMatches("Mabvuto Banda", "Mabvuto Banda")).toBe(true);
    expect(bankAccountNameMatches("M Banda", "Mabvuto Banda")).toBe(true); // initials ignored, surname carries
    expect(bankAccountNameMatches("Mabvuto", "Mabvuto Banda")).toBe(true);
    expect(bankAccountNameMatches("Banda Mabvuto", "Mabvuto Banda")).toBe(true);
    expect(bankAccountNameMatches("Chanda Mwila", "Mabvuto Banda")).toBe(false);
    expect(bankAccountNameMatches("", "Mabvuto Banda")).toBe(false);
    expect(bankAccountNameMatchesClient("Banda Mabvuto", "Mabvuto Banda")).toBe(
      bankAccountNameMatches("Banda Mabvuto", "Mabvuto Banda"),
    );
  });
});

describe("admin gate", () => {
  it("admits admin and super_admin only", () => {
    expect(canUseBankAdmin(["admin"])).toBe(true);
    expect(canUseBankAdmin(["user", "super_admin"])).toBe(true);
    expect(canUseBankAdmin(["user"])).toBe(false);
    expect(canUseBankAdmin([])).toBe(false);
    expect(BANK_ADMIN_REFUSAL_MESSAGE).toContain("admin team");
  });

  it("knows the transition actions", () => {
    expect(isBankAdminAction("approve")).toBe(true);
    expect(isBankAdminAction("mark_paid")).toBe(true);
    expect(isBankAdminAction("delete")).toBe(false);
    expect(isBankAdminAction("")).toBe(false);
  });

  it("status labels are plain language", () => {
    expect(bankWithdrawalStatusLabel("pending_review")).toBe("Waiting for review");
    expect(bankWithdrawalStatusLabel("paid_out")).toContain("Paid to your bank");
    expect(bankWithdrawalStatusLabel("rejected")).toContain("money returned");
  });
});

describe("bank withdrawals migration (structure)", () => {
  it("adds the settings with the launch defaults", () => {
    expect(migration).toContain("bank_payouts_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("bank_payout_fee_percent numeric NOT NULL DEFAULT 0");
    expect(migration).toContain("bank_payout_min_zmw numeric NOT NULL DEFAULT 50");
  });

  it("creates the ledger with the full lifecycle", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.bank_withdrawals");
    expect(migration).toContain(
      "'pending_review', 'approved', 'paid_out', 'rejected', 'failed'",
    );
    expect(migration).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(migration).toContain("currency text NOT NULL DEFAULT 'ZMW' CHECK (currency = 'ZMW')");
    expect(migration).toContain("external_reference text");
  });

  it("carries scoped grants and RLS (the GRANT rule)", () => {
    expect(migration).toContain("REVOKE ALL ON public.bank_withdrawals FROM anon");
    expect(migration).toContain("GRANT SELECT ON public.bank_withdrawals TO authenticated");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_withdrawals TO service_role");
    expect(migration).toContain("ALTER TABLE public.bank_withdrawals ENABLE ROW LEVEL SECURITY");
    // Never GRANT ... TO public (the bare role), in any statement.
    expect(/GRANT[^;]*\bTO\s+public\b/i.test(migration)).toBe(false);
  });

  it("reserve is idempotent and refuses before debiting on replay", () => {
    const reserveAt = migration.indexOf("CREATE OR REPLACE FUNCTION public.reserve_bank_withdrawal");
    const replayAt = migration.indexOf("already_reserved", reserveAt);
    const debitAt = migration.indexOf("SET balance = balance - p_amount - v_fee", reserveAt);
    expect(reserveAt).toBeGreaterThan(-1);
    expect(replayAt).toBeGreaterThan(reserveAt);
    expect(debitAt).toBeGreaterThan(replayAt);
  });

  it("RPCs are service_role-only; the refund helper is callable by no role", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.reserve_bank_withdrawal(uuid, uuid, uuid, numeric, text) TO service_role",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.transition_bank_withdrawal(uuid, uuid, text, text, text) TO service_role",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.refund_bank_withdrawal_internal(uuid, text) FROM service_role",
    );
  });

  it("transitions enforce the lifecycle in one function", () => {
    expect(migration).toContain("p_action = 'approve' AND v_wd.status = 'pending_review'");
    expect(migration).toContain("p_action = 'mark_paid' AND v_wd.status = 'approved'");
    expect(migration).toContain("p_action = 'reject' AND v_wd.status = 'pending_review'");
    expect(migration).toContain("v_wd.status IN ('pending_review', 'approved')");
    expect(migration).toContain("outcome := 'invalid_transition'");
    // Refund is exactly-once: the internal helper early-returns on refunded_at.
    expect(migration).toContain("IF v_wd.refunded_at IS NOT NULL THEN");
    // The role gate lives inside the RPC, not only in the function.
    expect(migration).toContain("ur.role IN ('admin'::app_role, 'super_admin'::app_role)");
  });

  it("treasury liabilities RPC is super_admin-gated inside", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.treasury_bank_payout_liabilities()");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::app_role)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.treasury_bank_payout_liabilities() TO authenticated");
  });
});

describe("bank-payout function wiring", () => {
  it("refuses create BEFORE the reserve while the flag is off", () => {
    const gateAt = bankFn.indexOf("BANK_PAYOUTS_NOT_AVAILABLE_MESSAGE");
    const reserveAt = bankFn.indexOf('admin.rpc("reserve_bank_withdrawal"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(reserveAt).toBeGreaterThan(gateAt);
    expect(bankFn).toContain('"not_configured"');
  });

  it("checks the freeze guard and the caller's role for admin actions", () => {
    expect(bankFn).toContain("isAccountFrozen");
    expect(bankFn).toContain("canUseBankAdminFor");
    expect(bankFn).toContain('admin.rpc("transition_bank_withdrawal"');
  });

  it("audits every successful transition and surfaces audit failure", () => {
    expect(bankFn).toContain('action: `bank_withdrawal_${verb}`');
    expect(bankFn).toContain("AUDIT INSERT FAILED after transition");
  });

  it("carries the transition verb in its own field, not the router's", () => {
    // body.action routes ("admin_transition"); body.transition is
    // the verb — one field cannot carry both (pinned after a live
    // probe caught the collision).
    expect(bankFn).toContain("const verb = body.transition;");
    expect(bankFn).toContain("p_action: verb,");
  });

  it("never returns a full account number to the owner view", () => {
    expect(bankFn).toContain("account_number_masked: maskAccountNumber(row.account_number)");
  });
});

describe("wallet + admin wiring", () => {
  it("the Wallet withdraw surface offers Bank beside PayPal", () => {
    expect(walletPage).toContain('import BankWithdraw from "@/components/wallet/BankWithdraw"');
    expect(walletPage).toContain('setWithdrawMethod("bank")');
    expect(walletPage).toContain('setWithdrawMethod("paypal")');
    expect(walletPage).toContain("<BankWithdraw wallet={wallet ?? null} />");
  });

  it("the withdraw component fails closed on the rail gate", () => {
    expect(bankComponent).toContain("settingsQuery.isSuccess && !payoutsEnabled");
    expect(bankComponent).toContain("BANK_PAYOUTS_ACTIVATING_MESSAGE");
    expect(bankComponent).toContain('action: "settings"');
    expect(bankComponent).toContain('action: "create"');
  });

  it("the admin queue is routed behind the admin roles", () => {
    expect(routes).toContain('path="/admin/bank-payouts"');
    expect(routes).toContain("AdminBankPayouts");
  });
});
