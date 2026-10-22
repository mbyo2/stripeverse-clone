// Tests for PayPal provenance FOLLOWS THE MONEY (CEO decision
// 2026-10-23, migration 20261028_paypal_provenance_follows.sql) —
// reversing the strict per-user rule of 20261024 the same evening.
//
// The model: PayPal-sourced money is a marked portion of a user's
// balance (paypal_provenance_balances.sourced_amount). Marks are
// created ONLY by verified PayPal captures, move spent-first with
// the money, and are consumed by PayPal withdrawals — so total
// payouts can never exceed total PayPal inflow, while a receiver of
// PayPal-sourced money can themselves withdraw it.
//
// This repo proves SQL at source level (the readFileSync pattern):
// each rewritten RPC is extracted from 20261028 and pinned for its
// taint hook — presence, arguments, and position relative to the
// money it marks and the idempotency guards that must precede it.
// Each 20261028 body is its pre-20261028 definition plus ONLY these
// hooks (verified by diff during the build); these pins keep that
// true. Client copy pins cover the reversed strict-rule wording.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const mig = read("../../supabase/migrations/20261028_paypal_provenance_follows.sql");

/** Extract one CREATE OR REPLACE FUNCTION body from the migration. */
function fnBody(name: string): string {
  const start = mig.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `function ${name} present`).toBeGreaterThan(-1);
  const end = mig.indexOf("\n$$;", start);
  return mig.slice(start, end);
}

describe("the provenance counter (table, RLS, helpers)", () => {
  it("creates the counter with a non-negative mark and (user, currency) key", () => {
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS public.paypal_provenance_balances");
    expect(mig).toContain("sourced_amount numeric NOT NULL DEFAULT 0 CHECK (sourced_amount >= 0)");
    expect(mig).toContain("PRIMARY KEY (user_id, currency)");
  });

  it("lets owners read only their own row and grants NO authenticated writes", () => {
    expect(mig).toContain("ON public.paypal_provenance_balances FOR SELECT TO authenticated");
    expect(mig).toContain("USING (user_id = auth.uid())");
    expect(mig).not.toContain("ON public.paypal_provenance_balances FOR INSERT");
    expect(mig).not.toContain("ON public.paypal_provenance_balances FOR UPDATE");
    expect(mig).not.toContain("ON public.paypal_provenance_balances FOR DELETE");
  });

  it("defines credit/debit/move as service-role-only SECURITY DEFINER helpers", () => {
    for (const fn of ["paypal_taint_credit", "paypal_taint_debit", "paypal_taint_move"]) {
      expect(mig).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(mig).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`);
      expect(mig).toContain(`REVOKE ALL ON FUNCTION public.${fn}(`);
    }
    expect(mig).toContain("SECURITY DEFINER");
    expect(mig).toContain("SET search_path TO 'public'");
  });

  it("debit is spent-first: it removes LEAST(amount, the mark)", () => {
    const debit = fnBody("paypal_taint_debit");
    expect(debit).toContain("v_moved := LEAST(p_amount, COALESCE(v_current, 0))");
    expect(debit).toContain("FOR UPDATE");
  });

  it("move = debit the sender, credit a real recipient the moved amount", () => {
    const move = fnBody("paypal_taint_move");
    expect(move).toContain("public.paypal_taint_debit(p_from_user, p_currency, p_amount)");
    expect(move).toContain("IF v_moved > 0 AND p_to_user IS NOT NULL THEN");
    expect(move).toContain("public.paypal_taint_credit(p_to_user, p_currency, v_moved)");
  });
});

describe("withdrawal hooks (reserve consumes, refund restores)", () => {
  it("refund restores the full payout amount to the counter", () => {
    const refund = fnBody("refund_paypal_withdrawal");
    expect(refund).toContain(
      "PERFORM public.paypal_taint_credit(v_wd.user_id, v_wd.currency, v_wd.amount);",
    );
  });

  it("refund restore happens only on the refunding path (after the exactly-once guard)", () => {
    const refund = fnBody("refund_paypal_withdrawal");
    const guard = refund.indexOf("outcome := 'already_refunded'");
    const restore = refund.indexOf("paypal_taint_credit");
    expect(guard).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(guard);
  });

  it("completion moves no mark (consumed at reserve, nothing to restore)", () => {
    // complete_paypal_withdrawal is NOT rewritten by 20261028.
    expect(mig).not.toContain(
      "CREATE OR REPLACE FUNCTION public.complete_paypal_withdrawal(",
    );
  });
});

describe("user-to-user transfer hooks (mark moves, fee carries none)", () => {
  for (const fn of ["execute_send_money_transfer", "execute_transfer_with_fee"]) {
    it(`${fn} moves the mark spent-first by the amount`, () => {
      const body = fnBody(fn);
      expect(body).toContain("public.paypal_taint_move(");
      expect(body).toContain("p_from_user_id, p_to_user_id, p_currency, p_amount");
    });

    it(`${fn} hooks AFTER the idempotent-replay return (a replay moves nothing)`, () => {
      const body = fnBody(fn);
      const replay = body.indexOf("IF v_existing_id IS NOT NULL THEN");
      const hook = body.indexOf("paypal_taint_move");
      expect(replay).toBeGreaterThan(-1);
      expect(hook).toBeGreaterThan(replay);
    });
  }

  it("the generic atomic transfer moves the mark, NULL recipient included", () => {
    const body = fnBody("execute_atomic_transfer");
    expect(body).toContain("public.paypal_taint_move(");
    expect(body).toContain("p_from_user_id, p_to_user_id, p_currency, p_amount");
  });
});

describe("payment-link settlement hooks (pro-rata / fresh money)", () => {
  const settle = fnBody("execute_payment_link_settlement");

  it("collects the platform-fee leg with a NULL recipient (its share is destroyed)", () => {
    expect(settle).toContain("array_append(v_taint_users, NULL::uuid)");
    expect(settle).toContain("array_append(v_taint_amounts, v_platform_fee)");
  });

  it("collects each executed split leg and the owner's residual", () => {
    expect(settle).toContain("array_append(v_taint_users, v_recipient_user)");
    expect(settle).toContain("array_append(v_taint_users, v_link.user_id)");
    expect(settle).toContain("array_append(v_taint_amounts, v_remaining)");
  });

  it("wallet-paid: debits the payer spent-first and distributes pro-rata", () => {
    expect(settle).toContain(
      "public.paypal_taint_debit(\n        p_payer_user_id, v_link.currency, p_amount)",
    );
    expect(settle).toContain(
      "round(\n            v_taint_total * v_taint_amounts[i] / p_amount, 2)",
    );
    // Rounding residue lands on the largest leg, floored at zero.
    expect(settle).toContain("v_taint_shares[v_largest_idx] := GREATEST(0,");
    expect(settle).toContain("+ (v_taint_total - v_taint_assigned))");
  });

  it("fresh PayPal money: every user leg is credited in full, fee leg none", () => {
    expect(settle).toContain("lower(COALESCE(p_payment_method, '')) = 'paypal'");
    expect(settle).toContain(
      "public.paypal_taint_credit(\n            v_taint_users[i], v_link.currency, v_taint_amounts[i])",
    );
    // Credits in BOTH branches skip NULL (fee) legs.
    expect(settle).toContain("IF v_taint_users[i] IS NOT NULL THEN");
    expect(settle).toContain("IF v_taint_users[i] IS NOT NULL AND v_taint_shares[i] > 0 THEN");
  });
});

describe("capture hooks (marks are created only by verified captures)", () => {
  it("wallet deposits credit the mark on the credited path only", () => {
    const deposit = fnBody("complete_wallet_deposit");
    const credit = deposit.indexOf("SET balance = w.balance + v_tx.amount");
    const hook = deposit.indexOf(
      "PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount);",
    );
    const outcome = deposit.indexOf("outcome := 'credited'");
    expect(credit).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(credit);
    expect(hook).toBeLessThan(outcome);
  });

  it("checkout payments credit the merchant's mark the same way", () => {
    const checkout = fnBody("complete_checkout_payment");
    const credit = checkout.indexOf("SET balance = w.balance + v_tx.amount");
    const hook = checkout.indexOf(
      "PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount);",
    );
    const outcome = checkout.indexOf("outcome := 'credited'");
    expect(credit).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(credit);
    expect(hook).toBeLessThan(outcome);
  });
});

describe("conversion + BTC trade hooks", () => {
  it("conversion carries the marked fraction at the conversion's own rate", () => {
    const conv = fnBody("execute_currency_conversion");
    expect(conv).toContain(
      "public.paypal_taint_debit(p_user_id, v_from.currency, p_from_amount)",
    );
    expect(conv).toContain("round(v_taint_from * to_amount / p_from_amount, 2)");
    expect(conv).toContain(
      "PERFORM public.paypal_taint_credit(p_user_id, v_to.currency, v_taint_to);",
    );
  });

  it("buying Bitcoin destroys the spent fiat mark; selling creates none", () => {
    const btc = fnBody("btc_execute_trade");
    expect(btc).toContain(
      "PERFORM public.paypal_taint_debit(p_user_id, 'ZMW', v_quote.amount_zmw);",
    );
    // Exactly one taint call in the whole trade: the buy-side debit.
    expect(btc.match(/paypal_taint/g)).toHaveLength(1);
  });

  it("same-user movements are NOT hooked (no counter change)", () => {
    // Internal transfers / savings moves keep their existing RPCs;
    // 20261028 does not rewrite them.
    expect(mig).not.toContain("CREATE OR REPLACE FUNCTION public.execute_internal_transfer(");
    expect(mig).not.toContain("CREATE OR REPLACE FUNCTION public.execute_savings_transfer(");
  });
});

describe("reversed strict-rule copy is gone from live code", () => {
  const sharedModule = read("../../supabase/functions/_shared/paypal-payout.ts");
  const payoutFn = read("../../supabase/functions/paypal-payout/index.ts");
  const clientUtil = read("../../src/utils/paypalPayout.ts");
  const withdrawComponent = read("../../src/components/wallet/PayPalWithdraw.tsx");

  it("no live surface still says only your own deposits can leave via PayPal", () => {
    for (const source of [sharedModule, payoutFn, clientUtil, withdrawComponent]) {
      expect(source).not.toContain("that's what you've deposited via PayPal");
      expect(source).not.toContain("what you've deposited via PayPal");
      expect(source).not.toContain("at most what PayPal paid into");
    }
  });

  it("the refusal copy names the marked portion of the balance", () => {
    expect(sharedModule).toContain("that's how much of your balance arrived via PayPal");
  });

  it("the deposit disclosure says the right follows the money between users", () => {
    expect(clientUtil).toContain("keeps that right when it's sent between BMaGlass users");
    expect(clientUtil).toContain("withdrawn once other payout methods are live");
  });

  it("the withdraw form shows the counter as the available figure", () => {
    expect(withdrawComponent).toContain("paypal_provenance_balances");
    expect(withdrawComponent).toContain("Available to withdraw to PayPal");
    expect(withdrawComponent).toContain("keeps that right when it's sent");
  });
});
