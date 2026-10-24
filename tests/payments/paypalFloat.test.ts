// Tests for the PLATFORM FLOAT (CEO directive 2026-10-24 — "Make
// something that can be withdrawn in PayPal"; migration
// 20261213_paypal_float_withdrawals.sql).
//
// The model: a USD withdrawal is funded provenance-FIRST (the
// user's own PayPal-sourced mark, 20261028) and the platform float
// covers only the remainder, capped by a super_admin-set allowance
// (platform_settings.paypal_float_allowance_usd, DEFAULT 0). Every
// withdrawal row records its split (provenance_amount +
// float_amount = amount); float "used" is DERIVED from non-failed
// rows, so a failed payout releases its float automatically, and a
// refund restores only the provenance part to the counter.
//
// Pure split math is exercised directly against
// _shared/paypal-payout.ts (the exact code the edge functions run);
// the SQL and function wiring is pinned at source level, the same
// readFileSync pattern as paypalPayout.test.ts.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canSetPaypalFloatAllowance,
  canUsePaypalAdmin,
  floatAvailable,
  planWithdrawalSplit,
  withdrawalRefusalMessage,
} from "../../supabase/functions/_shared/paypal-payout";
import {
  floatAvailable as floatAvailableClient,
  planWithdrawalSplit as planWithdrawalSplitClient,
} from "../../src/utils/paypalPayout";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const mig = read("../../supabase/migrations/20261213_paypal_float_withdrawals.sql");
const payoutFn = read("../../supabase/functions/paypal-payout/index.ts");
const adminFn = read("../../supabase/functions/paypal-admin/index.ts");
const withdrawComponent = read("../../src/components/wallet/PayPalWithdraw.tsx");
const adminPage = read("../../src/pages/AdminPaypal.tsx");

function fnBody(name: string): string {
  const start = mig.indexOf(`FUNCTION public.${name}(`);
  expect(start, `function ${name} present`).toBeGreaterThan(-1);
  const end = mig.indexOf("\n$$;", start);
  return mig.slice(start, end);
}

describe("float availability (allowance minus derived usage)", () => {
  it("is the allowance when nothing is committed", () => {
    expect(floatAvailable(50, 0)).toBe(50);
  });

  it("nets out committed float and never goes negative", () => {
    expect(floatAvailable(50, 20)).toBe(30);
    expect(floatAvailable(50, 50)).toBe(0);
    // The owner lowers the allowance below what's already out:
    // remaining room is zero, never a negative promise.
    expect(floatAvailable(10, 30)).toBe(0);
  });

  it("defaults to no float (allowance 0) and tolerates garbage", () => {
    expect(floatAvailable(0, 0)).toBe(0);
    expect(floatAvailable(Number.NaN, 5)).toBe(0);
    expect(floatAvailable(50, Number.NaN)).toBe(50);
  });
});

describe("withdrawal split planning (provenance first, float covers the rest)", () => {
  it("pure provenance when the mark covers the amount", () => {
    expect(planWithdrawalSplit(10, 25, 50)).toEqual({
      ok: true,
      totalAvailable: 75,
      provenancePart: 10,
      floatPart: 0,
    });
  });

  it("splits across both sources, provenance spent first", () => {
    // The proof-(c) shape: 10 of PayPal money + float room — a 25
    // withdrawal takes all 10 of provenance and 15 of float.
    expect(planWithdrawalSplit(25, 10, 50)).toEqual({
      ok: true,
      totalAvailable: 60,
      provenancePart: 10,
      floatPart: 15,
    });
  });

  it("is fully float-funded for a zero-provenance user (the conversion case)", () => {
    expect(planWithdrawalSplit(20, 0, 50)).toEqual({
      ok: true,
      totalAvailable: 50,
      provenancePart: 0,
      floatPart: 20,
    });
  });

  it("refuses one cent over the combined total and reports the true total", () => {
    const plan = planWithdrawalSplit(30.01, 0, 30);
    expect(plan.ok).toBe(false);
    expect(plan.totalAvailable).toBe(30);
  });

  it("with no float (allowance 0) it reduces to the provenance-only rule", () => {
    expect(planWithdrawalSplit(20, 0, 0).ok).toBe(false);
    expect(planWithdrawalSplit(20, 20, 0)).toEqual({
      ok: true,
      totalAvailable: 20,
      provenancePart: 20,
      floatPart: 0,
    });
  });

  it("client mirror computes identical splits", () => {
    for (const [amount, prov, float] of [
      [10, 25, 50],
      [25, 10, 50],
      [20, 0, 50],
      [30.01, 0, 30],
      [7.77, 3.33, 4.44],
    ] as const) {
      expect(planWithdrawalSplitClient(amount, prov, float)).toEqual(
        planWithdrawalSplit(amount, prov, float),
      );
      expect(floatAvailableClient(50, 20)).toBe(floatAvailable(50, 20));
    }
  });
});

describe("combined refusal copy", () => {
  it("names ONE true figure (provenance + float combined)", () => {
    const message = withdrawalRefusalMessage(30, "USD");
    expect(message).toContain("up to 30.00 USD");
    expect(message).toContain("arrived via PayPal");
    expect(message).toContain("its own PayPal account");
  });
});

describe("admin gates", () => {
  it("admins and super_admins may view; only super_admin may set", () => {
    expect(canUsePaypalAdmin(["admin"])).toBe(true);
    expect(canUsePaypalAdmin(["super_admin"])).toBe(true);
    expect(canUsePaypalAdmin(["user"])).toBe(false);
    expect(canSetPaypalFloatAllowance(["super_admin"])).toBe(true);
    expect(canSetPaypalFloatAllowance(["admin"])).toBe(false);
    expect(canSetPaypalFloatAllowance(["user", "admin"])).toBe(false);
  });
});

describe("float migration (structure)", () => {
  it("adds the allowance to platform_settings, default 0 (off until the owner sets it)", () => {
    expect(mig).toContain(
      "ADD COLUMN IF NOT EXISTS paypal_float_allowance_usd numeric NOT NULL DEFAULT 0",
    );
  });

  it("records the split on every withdrawal, summing to the amount", () => {
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS provenance_amount numeric NOT NULL DEFAULT 0");
    expect(mig).toContain("ADD COLUMN IF NOT EXISTS float_amount numeric NOT NULL DEFAULT 0");
    expect(mig).toContain("CHECK (provenance_amount + float_amount = amount)");
    // Pre-split history was all provenance under the old rule.
    expect(mig).toContain("SET provenance_amount = amount");
  });

  it("derives float used from non-failed USD rows — no stored counter to drift", () => {
    const used = fnBody("paypal_float_used_usd");
    expect(used).toContain("SUM(w.float_amount)");
    expect(used).toContain("w.currency = 'USD'");
    expect(used).toContain("w.status NOT IN ('failed', 'refunded')");
    expect(used).not.toContain("UPDATE");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.paypal_float_used_usd() TO service_role");
  });
});

describe("reserve RPC (split-aware)", () => {
  const reserve = fnBody("reserve_paypal_withdrawal");

  it("spends provenance first and lets the float cover only the remainder", () => {
    expect(reserve).toContain("v_provenance_part := LEAST(p_amount, provenance_available)");
    expect(reserve).toContain("v_float_part := p_amount - v_provenance_part");
  });

  it("float exists only for USD, drawn against allowance minus derived used", () => {
    expect(reserve).toContain("IF v_currency = 'USD' THEN");
    expect(reserve).toContain("s.paypal_float_allowance_usd");
    expect(reserve).toContain("public.paypal_float_used_usd()");
  });

  it("serializes float draws on the settings row lock", () => {
    const settingsRead = reserve.indexOf("FROM public.platform_settings s");
    expect(settingsRead).toBeGreaterThan(-1);
    expect(reserve.slice(settingsRead, settingsRead + 120)).toContain("FOR UPDATE");
  });

  it("refuses over the COMBINED cap before creating the row or debiting", () => {
    const capCheck = reserve.indexOf("IF v_float_part > float_available THEN");
    const insert = reserve.indexOf("INSERT INTO public.paypal_withdrawals");
    const debit = reserve.indexOf("SET balance = balance - p_amount - v_fee");
    expect(capCheck).toBeGreaterThan(-1);
    expect(capCheck).toBeLessThan(insert);
    expect(capCheck).toBeLessThan(debit);
    expect(reserve).toContain("outcome := 'over_provenance_cap'");
  });

  it("stores the split and consumes the counter by the provenance part ONLY", () => {
    expect(reserve).toContain("provenance_amount, float_amount");
    expect(reserve).toContain("v_provenance_part, v_float_part");
    expect(reserve).toContain("SET sourced_amount = sourced_amount - v_provenance_part");
    expect(reserve).not.toContain("SET sourced_amount = sourced_amount - p_amount");
  });

  it("reports both sides of the cap for honest refusal copy", () => {
    expect(reserve).toContain("float_available numeric");
    expect(mig).toContain(
      "GRANT EXECUTE ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) TO service_role",
    );
  });
});

describe("refund RPC (split-aware restore)", () => {
  const refund = fnBody("refund_paypal_withdrawal");

  it("restores ONLY the provenance part to the counter", () => {
    expect(refund).toContain(
      "PERFORM public.paypal_taint_credit(v_wd.user_id, v_wd.currency, v_wd.provenance_amount);",
    );
    expect(refund).not.toContain(
      "PERFORM public.paypal_taint_credit(v_wd.user_id, v_wd.currency, v_wd.amount);",
    );
  });

  it("still refunds the full amount + fee to the wallet, exactly once", () => {
    expect(refund).toContain("v_wd.amount + v_wd.fee_amount");
    expect(refund).toContain("outcome := 'already_refunded'");
    // The float release is structural: the row becomes 'failed',
    // which removes it from the derived used sum.
    expect(refund).toContain("SET status = 'failed'");
  });
});

describe("edge functions + UI wiring", () => {
  it("paypal-payout answers over-cap with the combined figure when float is in play", () => {
    expect(payoutFn).toContain("withdrawalRefusalMessage");
    expect(payoutFn).toContain("reserve.float_available");
    // …and keeps the original provenance copy for the no-float case.
    expect(payoutFn).toContain("provenanceRefusalMessage");
    expect(payoutFn).toContain("over_provenance_cap");
  });

  it("paypal-payout exposes the float preview action", () => {
    expect(payoutFn).toContain('action === "float"');
    expect(payoutFn).toContain("paypal_float_used_usd");
    expect(payoutFn).toContain("remaining_usd");
  });

  it("paypal-admin gates the set to super_admin and audit-logs it", () => {
    expect(adminFn).toContain("canSetPaypalFloatAllowanceFor");
    expect(adminFn).toContain("canUsePaypalAdminFor");
    expect(adminFn).toContain('action === "set_allowance"');
    expect(adminFn).toContain("audit_logs");
    expect(adminFn).toContain("set_paypal_float_allowance");
    expect(adminFn).toContain("paypal_float_allowance_usd");
  });

  it("the withdraw form shows ONE combined available figure", () => {
    expect(withdrawComponent).toContain("Available to withdraw to PayPal");
    expect(withdrawComponent).toContain('action: "float"');
    expect(withdrawComponent).toContain("paypal_provenance_balances");
    expect(withdrawComponent).toContain("floatQuery");
  });

  it("the admin page shows allowance / committed / remaining and the split", () => {
    expect(adminPage).toContain("Platform float (USD)");
    expect(adminPage).toContain("provenance_amount");
    expect(adminPage).toContain("float_amount");
    expect(adminPage).toContain("canSetAllowance");
    expect(adminPage).toContain("set_allowance");
  });
});
