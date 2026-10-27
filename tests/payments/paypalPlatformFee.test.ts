// PayPal platform fee = 1% (CEO decision 2026-10-28 00:03 CAT:
// "Set our PayPal fee to 1%").
//
// The PayPal rail gets its own rate —
// platform_settings.paypal_platform_fee_percent — applied on the
// two merchant-collection paths:
//   - payment links settled with external PayPal money
//     (execute_payment_link_settlement, method 'paypal'): 1%,
//     where the generic link rate (2.5%) used to catch it;
//   - PayPal checkout payments (complete_checkout_payment):
//     a 1% fee leg where settlement used to take no fee.
// Wallet and Bitcoin link settlements keep 2.5%; send / transfer
// / P2P / buy-sell rates are untouched; the PayPal WITHDRAWAL
// rate (paypal_payout_fee_percent, 0) is a separate setting this
// change deliberately does not touch.
//
// These tests pin the migration text, the shared per-rail rate
// resolver the edge functions quote from, the fee math at both
// rates, and the truthful Pricing display. Behavioural proof
// (live settlement probes at both rates) is recorded in
// goals/bmaglass-pay-completion-sweep/hidden_files/
// paypal-fee-1pct-2026-10-28.md.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  linkFeeRateForMethod,
  paymentLinkAmounts,
} from "../../supabase/functions/_shared/fee-math.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const mig = read("../../supabase/migrations/20261241_paypal_platform_fee.sql");
const pricing = read("../../src/pages/Pricing.tsx");
const linkCheckout = read("../../supabase/functions/payment-link-checkout/index.ts");
const devApi = read("../../supabase/functions/developer-api/index.ts");

describe("the PayPal rail rate (migration 20261241)", () => {
  it("adds paypal_platform_fee_percent with a default of 1", () => {
    expect(mig).toContain(
      "ADD COLUMN IF NOT EXISTS paypal_platform_fee_percent numeric NOT NULL DEFAULT 1",
    );
  });

  it("does not touch the withdrawal rate or any other rail's rate", () => {
    expect(mig).not.toContain("SET paypal_payout_fee_percent");
    expect(mig).not.toContain("UPDATE public.platform_settings");
    expect(mig).not.toContain("split_platform_fee_percent = ");
    expect(mig).not.toContain("send_money_fee_percent = ");
    expect(mig).not.toContain("transfer_fee_percent = ");
    expect(mig).not.toContain("p2p_fee_percent = ");
  });

  it("resolves the link settlement rate per rail: PayPal 1%, the rest the link rate", () => {
    expect(mig).toContain(
      "CASE WHEN lower(COALESCE(p_payment_method, '')) = 'paypal'\n                 THEN paypal_platform_fee_percent\n                 ELSE split_platform_fee_percent END",
    );
    expect(mig).toContain(
      "CASE WHEN lower(COALESCE(p_payment_method, '')) = 'paypal'\n         THEN 1 ELSE 2.5 END",
    );
    // The resolved rate is stamped into the settlement fee truth.
    expect(mig).toContain("'fee_rate_percent', v_fee_rate,");
  });

  it("keeps the link settlement's bearer, split, provenance and replay rules intact", () => {
    expect(mig).toContain("v_fee_payer := COALESCE(v_link.fee_payer, 'seller');");
    expect(mig).toContain("public.paypal_taint_debit(");
    expect(mig).toContain("'Idempotency key already used'");
    expect(mig).toContain("RETURNS TABLE(transaction_id uuid, owner_transaction_id uuid, owner_new_balance numeric, payer_new_balance numeric, fee_amount numeric, fee_payer text, total_charged numeric)");
  });
});

describe("checkout completion gains the 1% fee leg", () => {
  it("resolves the fee from the PayPal rate with the link settlement's skip rules", () => {
    expect(mig).toContain(
      "(SELECT paypal_platform_fee_percent FROM public.platform_settings WHERE id),\n    1)",
    );
    expect(mig).toContain(
      "v_platform_fee := LEAST(round(v_tx.amount * v_fee_rate / 100, 2), v_tx.amount);",
    );
    expect(mig).toContain("IF v_platform_user IS NULL OR v_platform_user = v_tx.user_id THEN");
    expect(mig).toContain("IF v_platform_wallet.status = 'closed' THEN");
  });

  it("ledgers the fee merchant → platform in the link settlement's row shape", () => {
    expect(mig).toContain("'Platform fee — PayPal checkout payment'");
    expect(mig).toContain("'checkout:' || v_tx.uuid_id::text || ':platform_fee:out'");
    expect(mig).toContain("'checkout:' || v_tx.uuid_id::text || ':platform_fee:in'");
    expect(mig).toContain("'platform_fee_amount', v_platform_fee,");
    expect(mig).toContain("'net_credited', v_tx.amount - v_platform_fee");
  });

  it("marks provenance on what the merchant received — the fee leg carries no mark", () => {
    expect(mig).toContain(
      "PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount - v_platform_fee);",
    );
  });

  it("preserves the settlement's exactly-once shape (same signature, ACL re-asserted)", () => {
    expect(mig).toContain(
      "GRANT EXECUTE ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) TO service_role;",
    );
    expect(mig).toContain("outcome := 'already_completed';");
  });
});

describe("per-rail rate resolution (shared fee-math)", () => {
  const settings = { split_platform_fee_percent: 2.5, paypal_platform_fee_percent: 1 };

  it("PayPal resolves to the PayPal rate; everything else to the link rate", () => {
    expect(linkFeeRateForMethod("paypal", settings)).toBe(1);
    expect(linkFeeRateForMethod("PayPal", settings)).toBe(1);
    expect(linkFeeRateForMethod("wallet", settings)).toBe(2.5);
    expect(linkFeeRateForMethod("bitcoin_onchain", settings)).toBe(2.5);
    expect(linkFeeRateForMethod(null, settings)).toBe(2.5);
  });

  it("string settings (PostgREST numerics) resolve the same way", () => {
    expect(
      linkFeeRateForMethod("paypal", {
        split_platform_fee_percent: "2.5",
        paypal_platform_fee_percent: "1",
      }),
    ).toBe(1);
  });

  it("a missing PayPal column yields null — no guessed fee picture", () => {
    expect(linkFeeRateForMethod("paypal", { split_platform_fee_percent: 2.5 })).toBeNull();
    expect(linkFeeRateForMethod("paypal", null)).toBeNull();
    expect(linkFeeRateForMethod("wallet", {})).toBeNull();
  });
});

describe("fee math at the two rates", () => {
  it("a K100 PayPal collection costs the seller K1.00; a wallet/BTC one K2.50", () => {
    const paypal = paymentLinkAmounts(100, 1, "seller");
    expect(paypal.fee_amount).toBe(1);
    expect(paypal.seller_receives).toBe(99);
    expect(paypal.buyer_total).toBe(100);

    const wallet = paymentLinkAmounts(100, 2.5, "seller");
    expect(wallet.fee_amount).toBe(2.5);
    expect(wallet.seller_receives).toBe(97.5);
  });

  it("buyer-pays at the PayPal rate adds exactly the 1% on top", () => {
    const a = paymentLinkAmounts(100, 1, "buyer");
    expect(a.fee_amount).toBe(1);
    expect(a.buyer_total).toBe(101);
    expect(a.seller_receives).toBe(100);
  });
});

describe("truthful display + API surface", () => {
  it("Pricing shows PayPal at 1% and links at 2.5%, each from its named source", () => {
    expect(pricing).toContain("Accept PayPal Payments");
    expect(pricing).toContain("paypal_platform_fee_percent");
    expect(pricing).toContain("split_platform_fee_percent");
    expect(pricing).toContain("A link paid through PayPal carries the 1% PayPal fee instead.");
  });

  it("link describe quotes the PayPal rate alongside the link rate", () => {
    expect(linkCheckout).toContain('select("split_platform_fee_percent, paypal_platform_fee_percent")');
    expect(linkCheckout).toContain("paypal_fee_rate_percent: paypalFeeRate");
    expect(linkCheckout).toContain('linkFeeRateForMethod("paypal", settingsRow)');
  });

  it("the developer API exposes the PayPal rate in GET /settings", () => {
    expect(devApi).toContain("paypal_platform_fee_percent: paypalRate");
    expect(devApi).toContain('linkFeeRateForMethod("paypal", settings)');
  });
});
