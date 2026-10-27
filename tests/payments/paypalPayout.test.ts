// Tests for PayPal withdrawals (payouts) — the fiat exit added
// 2026-10-22 (CEO: "Build PayPal withdrawals first").
//
// Layers, mirroring the repo's existing suites:
//   1. The pure decision module (_shared/paypal-payout.ts) — the
//      exact file the edge functions run: currency gate, fee math,
//      payout payload traceability, the finalization state machine
//      (refund happens on failure states only, terminal states
//      never move — the exactly-once property), POST-failure
//      classification, and the provenance cap arithmetic.
//   2. The provenance rule at the level this repo can prove
//      without a live database: since 20261028 the mark FOLLOWS THE
//      MONEY — the reserve RPC reads the paypal_provenance_balances
//      counter (locked) as the cap, refuses over-cap BEFORE any
//      insert or debit, and decrements the counter by the payout
//      amount only. Pinned by source order in the migration, the
//      same readFileSync approach as
//      tests/payments/sendMoneyFee.test.ts (hook-by-hook pins for
//      every money path live in paypalProvenance.test.ts).
//   3. Client mirror parity (src/utils/paypalPayout.ts) and the
//      webhook / UI wiring, pinned at source level.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPayoutRequest,
  classifyPayoutPostFailure,
  computePayoutFee,
  extractBatchStatus,
  extractPayoutItem,
  formatPayPalMoney,
  isPayPalPayoutCurrency,
  isPlausibleEmail,
  PAYPAL_PAYOUT_CURRENCIES,
  PAYOUT_DAILY_LIMIT,
  PAYOUT_MIN_AMOUNT,
  payoutBatchIdFromWebhookResource,
  payoutFailureReason,
  payoutItemIdFromWebhookResource,
  payoutSenderItemIdFromWebhookResource,
  planPayoutFinalization,
  planProvenance,
  PAYOUTS_NOT_AVAILABLE_MESSAGE,
  payoutsEnabled,
  provenanceAvailable,
  provenanceRefusalMessage,
} from "../../supabase/functions/_shared/paypal-payout";
import {
  computePayoutFee as computePayoutFeeClient,
  isPayPalPayoutCurrency as isPayPalPayoutCurrencyClient,
  PAYPAL_PAYOUT_CURRENCIES as CLIENT_CURRENCIES,
  PAYOUT_DAILY_LIMIT as CLIENT_DAILY_LIMIT,
  PAYOUT_MIN_AMOUNT as CLIENT_MIN_AMOUNT,
} from "../../src/utils/paypalPayout";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read("../../supabase/migrations/20261024_paypal_withdrawals.sql");
const provenanceMigration = read(
  "../../supabase/migrations/20261028_paypal_provenance_follows.sql",
);
const payoutFn = read("../../supabase/functions/paypal-payout/index.ts");
const webhookFn = read("../../supabase/functions/paypal-webhook/index.ts");
const walletPage = read("../../src/pages/Wallet.tsx");
const withdrawComponent = read("../../src/components/wallet/PayPalWithdraw.tsx");

describe("currency gate (PayPal cannot pay out ZMW)", () => {
  it("accepts the supported payout currencies", () => {
    for (const c of ["USD", "EUR", "GBP", "AUD", "CAD", "CHF"]) {
      expect(isPayPalPayoutCurrency(c)).toBe(true);
    }
    expect(isPayPalPayoutCurrency("usd")).toBe(true);
  });

  it("refuses ZMW and anything not on the list", () => {
    expect(isPayPalPayoutCurrency("ZMW")).toBe(false);
    expect(isPayPalPayoutCurrency("JPY")).toBe(false); // zero-decimal: excluded by design
    expect(isPayPalPayoutCurrency("XXX")).toBe(false);
    expect(isPayPalPayoutCurrency("")).toBe(false);
    expect(isPayPalPayoutCurrency(null)).toBe(false);
    expect(isPayPalPayoutCurrency(undefined)).toBe(false);
  });
});

describe("fee math (on top, rate from platform_settings, default 0)", () => {
  it("is zero at the default rate", () => {
    expect(computePayoutFee(100, 0)).toBe(0);
    expect(computePayoutFee(250, 0)).toBe(0);
  });

  it("computes a percent of the amount, rounded to 2dp", () => {
    expect(computePayoutFee(100, 2.5)).toBe(2.5);
    expect(computePayoutFee(10, 2.5)).toBe(0.25);
    expect(computePayoutFee(33.33, 2.5)).toBe(0.83);
    expect(computePayoutFee(0, 2.5)).toBe(0);
    expect(computePayoutFee(-5, 2.5)).toBe(0);
  });

  it("formats PayPal money values as 2dp strings", () => {
    expect(formatPayPalMoney(5)).toBe("5.00");
    expect(formatPayPalMoney(12.3)).toBe("12.30");
  });
});

describe("payout request payload (traceability)", () => {
  const request = buildPayoutRequest({
    withdrawalId: "wd-123",
    recipientEmail: "  user@example.com ",
    amount: 42.5,
    currency: "usd",
  });

  it("uses the withdrawal id as BOTH batch id and item id", () => {
    expect(request.sender_batch_header.sender_batch_id).toBe("wd-123");
    expect(request.items[0].sender_item_id).toBe("wd-123");
  });

  it("sends one EMAIL item for the exact amount and currency", () => {
    expect(request.items).toHaveLength(1);
    expect(request.items[0].recipient_type).toBe("EMAIL");
    expect(request.items[0].receiver).toBe("user@example.com");
    expect(request.items[0].amount).toEqual({ value: "42.50", currency_code: "USD" });
  });
});

describe("batch reading", () => {
  const batch = {
    batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" },
    items: [
      {
        payout_item_id: "ITEM-OTHER",
        transaction_status: "SUCCESS",
        payout_item: { sender_item_id: "someone-else", amount: { value: "1.00", currency_code: "USD" } },
      },
      {
        payout_item_id: "ITEM-OURS",
        transaction_status: "FAILED",
        transaction_id: "TXN9",
        payout_item: { sender_item_id: "wd-123", amount: { value: "42.50", currency_code: "USD" } },
        errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
      },
    ],
  };

  it("extracts OUR item by sender_item_id, not position", () => {
    const item = extractPayoutItem(batch, "wd-123");
    expect(item?.payoutItemId).toBe("ITEM-OURS");
    expect(item?.transactionStatus).toBe("FAILED");
    expect(item?.errorName).toBe("RECEIVER_UNREGISTERED");
    expect(item?.errorMessage).toBe("Receiver is unregistered");
  });

  it("returns null when no item is identifiable", () => {
    expect(extractPayoutItem(batch, "wd-unknown")).toBeNull();
    expect(extractPayoutItem(null, "wd-123")).toBeNull();
    expect(extractPayoutItem({}, "wd-123")).toBeNull();
  });

  it("reads the batch status", () => {
    expect(extractBatchStatus(batch)).toBe("SUCCESS");
    expect(extractBatchStatus({})).toBeNull();
  });
});

describe("finalization state machine (exactly-once)", () => {
  it("completes only on SUCCESS from a non-terminal state", () => {
    expect(planPayoutFinalization("pending", "SUCCESS")).toBe("complete");
    expect(planPayoutFinalization("processing", "SUCCESS")).toBe("complete");
  });

  it("refunds on every failure family state", () => {
    for (const s of ["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "DENIED"]) {
      expect(planPayoutFinalization("processing", s)).toBe("refund");
    }
    expect(planPayoutFinalization("processing", null, "DENIED")).toBe("refund");
  });

  it("does NOT refund while PayPal still holds the outcome", () => {
    expect(planPayoutFinalization("processing", "PENDING")).toBe("none");
    expect(planPayoutFinalization("processing", "ONHOLD")).toBe("none");
    // Unclaimed money returns via RETURNED after PayPal's window —
    // refunding earlier would double-pay if the receiver claims.
    expect(planPayoutFinalization("processing", "UNCLAIMED")).toBe("none");
    expect(planPayoutFinalization("processing", null)).toBe("none");
  });

  it("terminal states never move again (replays are no-ops)", () => {
    expect(planPayoutFinalization("completed", "FAILED")).toBe("none");
    expect(planPayoutFinalization("completed", "SUCCESS")).toBe("none");
    expect(planPayoutFinalization("failed", "SUCCESS")).toBe("none");
    expect(planPayoutFinalization("failed", "FAILED")).toBe("none");
  });

  it("names failures in plain language", () => {
    expect(payoutFailureReason(null)).toContain("could not complete");
    expect(
      payoutFailureReason({
        payoutItemId: "I",
        transactionStatus: "RETURNED",
        transactionId: null,
        errorName: null,
        errorMessage: null,
      }),
    ).toContain("not claimed");
  });
});

describe("synchronous POST failure classification", () => {
  it("maps a 403 / permission answer to not-enabled (never a fake success)", () => {
    expect(classifyPayoutPostFailure(403, { name: "NOT_AUTHORIZED" }).kind).toBe("not_enabled");
    expect(classifyPayoutPostFailure(403, null).kind).toBe("not_enabled");
    expect(classifyPayoutPostFailure(401, { name: "AUTHORIZATION_ERROR" }).kind).toBe("not_enabled");
  });

  it("maps platform-balance failure separately", () => {
    expect(classifyPayoutPostFailure(400, { name: "INSUFFICIENT_FUNDS" }).kind).toBe(
      "insufficient_funds",
    );
  });

  it("keeps the provider's plain message for other rejections", () => {
    const failure = classifyPayoutPostFailure(400, { name: "VALIDATION_ERROR", message: "Invalid email" });
    expect(failure.kind).toBe("rejected");
    if (failure.kind === "rejected") expect(failure.message).toBe("Invalid email");
  });
});

describe("provenance cap (the counter arithmetic)", () => {
  it("available = the marked (PayPal-sourced) portion of the balance", () => {
    // The counter already nets out reserves and payouts (reserve
    // decrements, refund restores) — availability IS its value.
    expect(provenanceAvailable(70)).toBe(70);
    expect(provenanceAvailable(70.5)).toBe(70.5);
    expect(provenanceAvailable(0)).toBe(0);
  });

  it("never goes negative and tolerates garbage input", () => {
    expect(provenanceAvailable(-5)).toBe(0);
    expect(provenanceAvailable(Number.NaN)).toBe(0);
  });

  it("allows a withdrawal up to the cap and refuses one cent over", () => {
    expect(planProvenance(70, 70)).toEqual({ ok: true, available: 70 });
    expect(planProvenance(70.01, 70)).toEqual({ ok: false, available: 70 });
    expect(planProvenance(5, 0)).toEqual({ ok: false, available: 0 });
  });

  it("refusal copy states the true cap and the alternatives", () => {
    const message = provenanceRefusalMessage(70, "USD");
    expect(message).toContain("up to 70.00 USD");
    expect(message).toContain("how much of your balance arrived via PayPal");
    expect(message).toContain("other payout methods are live");
    // The reversed strict-rule wording must not survive anywhere.
    expect(message).not.toContain("that's what you've deposited");
  });

  it("validates recipient emails conservatively", () => {
    expect(isPlausibleEmail("user@example.com")).toBe(true);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@example.com")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });
});

describe("provenance in the reserve RPC (source-pinned SQL)", () => {
  // Since 20261028 the cap is the paypal_provenance_balances
  // counter; extract the rewritten reserve body from that migration.
  const reserveBody = (() => {
    const start = provenanceMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.reserve_paypal_withdrawal(",
    );
    const end = provenanceMigration.indexOf("\n$$;", start);
    return provenanceMigration.slice(start, end);
  })();

  it("reads the counter (locked) as the cap — no ledger sums remain", () => {
    expect(reserveBody).toContain("FROM public.paypal_provenance_balances b");
    expect(reserveBody).toContain("FOR UPDATE");
    expect(reserveBody).toContain(
      "provenance_available := GREATEST(0, COALESCE(v_sourced, 0))",
    );
    expect(reserveBody).not.toContain("v_deposits");
    expect(reserveBody).not.toContain("metadata ->> 'kind'");
  });

  it("refuses over-cap BEFORE creating the row or debiting anything", () => {
    const capCheck = reserveBody.indexOf("outcome := 'over_provenance_cap'");
    const insert = reserveBody.indexOf("INSERT INTO public.paypal_withdrawals");
    const debit = reserveBody.indexOf("SET balance = balance - p_amount - v_fee");
    expect(capCheck).toBeGreaterThan(-1);
    expect(capCheck).toBeLessThan(insert);
    expect(capCheck).toBeLessThan(debit);
  });

  it("consumes the mark by the payout amount AFTER the debit", () => {
    const debit = reserveBody.indexOf("SET balance = balance - p_amount - v_fee");
    const consume = reserveBody.indexOf(
      "SET sourced_amount = sourced_amount - p_amount",
    );
    expect(consume).toBeGreaterThan(debit);
  });

  it("keeps the daily limit counting non-failed withdrawals only", () => {
    const todayAt = reserveBody.indexOf("INTO v_today");
    const todaySum = reserveBody.slice(
      todayAt,
      reserveBody.indexOf("daily_remaining :=", todayAt),
    );
    expect(todaySum).toContain("FROM public.paypal_withdrawals");
    expect(todaySum).toContain("w.status NOT IN ('failed', 'refunded')");
  });

  it("enforces the shared limits in SQL too", () => {
    expect(reserveBody).toContain("p_amount < 5");
    expect(reserveBody).toContain("2000 - v_today");
    expect(PAYOUT_MIN_AMOUNT).toBe(5);
    expect(PAYOUT_DAILY_LIMIT).toBe(2000);
  });

  it("seeds the counter from the old computed definition", () => {
    // The backfill counts the same rows the 20261024 cap counted:
    // completed PayPal wallet deposits + checkout payments, minus
    // withdrawals that are not failed/refunded.
    const seedAt = provenanceMigration.indexOf(
      "INSERT INTO public.paypal_provenance_balances (user_id, currency, sourced_amount)\nSELECT",
    );
    const seed = provenanceMigration.slice(seedAt, provenanceMigration.indexOf("ON CONFLICT", seedAt));
    expect(seed).toContain("metadata ->> 'kind' IN ('wallet_deposit', 'checkout_payment')");
    expect(seed).toContain("status NOT IN ('failed', 'refunded')");
    expect(seed).toContain("GREATEST(0, COALESCE(c.credits, 0) - COALESCE(w.withdrawn, 0))");
  });
});

describe("withdrawal migration (structure)", () => {
  it("creates the table with a unique idempotency key and state check", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.paypal_withdrawals");
    expect(migration).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(migration).toContain("status IN ('pending', 'processing', 'completed', 'failed')");
  });

  it("defaults the payout fee percent to 0 (CEO sets the rate later)", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS paypal_payout_fee_percent numeric NOT NULL DEFAULT 0",
    );
  });

  it("lets owners read only their own rows and grants NO authenticated writes", () => {
    expect(migration).toContain("ON public.paypal_withdrawals FOR SELECT TO authenticated");
    expect(migration).toContain("USING (user_id = auth.uid())");
    expect(migration).not.toContain("FOR INSERT TO authenticated");
    expect(migration).not.toContain("FOR UPDATE TO authenticated");
    expect(migration).not.toContain("FOR DELETE TO authenticated");
  });

  it("defines reserve/refund/complete as service-role-only SECURITY DEFINER RPCs", () => {
    for (const fn of [
      "reserve_paypal_withdrawal",
      "refund_paypal_withdrawal",
      "complete_paypal_withdrawal",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`);
    }
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toMatch(/TO service_role;/);
    expect(migration).toContain("FROM authenticated;");
  });

  it("refunds amount + fee in one keyed ledger row, exactly once", () => {
    expect(migration).toContain("v_wd.amount + v_wd.fee_amount");
    expect(migration).toContain("|| ':refund'");
    expect(migration).toContain("v_wd.status = 'failed' AND v_wd.refunded_at IS NOT NULL");
    expect(migration).toContain("outcome := 'already_refunded'");
  });
});

describe("paypal-payout edge function", () => {
  it("reserves BEFORE sending anything to PayPal", () => {
    const reserveAt = payoutFn.indexOf('rpc("reserve_paypal_withdrawal"');
    const sendAt = payoutFn.indexOf("createPayPalPayout(row)");
    expect(reserveAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(reserveAt);
  });

  it("runs money through the dedicated service-role client", () => {
    expect(payoutFn).toContain("getServiceRoleClient()");
    expect(payoutFn).toContain("getSupabaseClient(req)");
  });

  it("answers the not-enabled case with the honest not-available copy", () => {
    expect(payoutFn).toContain("PayPal withdrawals are not available yet");
    expect(payoutFn).toContain("refundUnsentWithdrawal");
  });

  it("surfaces the provenance refusal copy from the shared module", () => {
    expect(payoutFn).toContain("over_provenance_cap");
    expect(payoutFn).toContain("provenanceRefusalMessage");
  });

  it("pins the $5 payout minimum boundary (CEO decision 2026-10-28)", () => {
    // The CEO-set minimum is USD 5.00. The shared constant is the one
    // value every layer reads: the RPC refuses p_amount < 5 in SQL
    // (pinned above), the function answers the below_minimum outcome
    // with the crafted sentence composed from that same constant, and
    // the client form disables below it while showing it as helper
    // text — so $4.99 can never be submitted and $5.00 always reaches
    // the provenance gate instead.
    expect(PAYOUT_MIN_AMOUNT).toBe(5);
    expect(payoutFn).toContain('case "below_minimum"');
    expect(payoutFn).toContain(
      "The minimum PayPal withdrawal is ${PAYOUT_MIN_AMOUNT.toFixed(2)}",
    );
    expect(withdrawComponent).toContain("parsedAmount < PAYOUT_MIN_AMOUNT");
    expect(withdrawComponent).toContain("Minimum {PAYOUT_MIN_AMOUNT.toFixed(2)}");
  });

  it("gates currencies through the shared list (ZMW never reaches a send)", () => {
    expect(payoutFn).toContain("isPayPalPayoutCurrency");
    expect(payoutFn).toContain("PayPal can't pay out in Zambian kwacha (ZMW)");
  });
});

describe("webhook payout backstop", () => {
  it("handles the payout event family through the shared finalizer", () => {
    for (const eventType of [
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      "PAYMENT.PAYOUTS-ITEM.FAILED",
      "PAYMENT.PAYOUTS-ITEM.RETURNED",
      "PAYMENT.PAYOUTSBATCH.DENIED",
    ]) {
      expect(webhookFn).toContain(eventType);
    }
    expect(webhookFn).toContain("handlePayoutEvent");
    expect(webhookFn).toContain("refreshWithdrawalFromPayPal");
    expect(webhookFn).toContain("payoutSenderItemIdFromWebhookResource");
  });

  it("keeps the verified deposit/checkout handling intact", () => {
    expect(webhookFn).toContain("PAYMENT.CAPTURE.COMPLETED");
    expect(webhookFn).toContain("CHECKOUT.ORDER.APPROVED");
    expect(webhookFn).toContain("confirmPayPalDeposit");
    expect(webhookFn).toContain("verifyPayPalWebhookSignature");
  });
});

describe("client mirror + UI", () => {
  it("client currency list and limits match the server module exactly", () => {
    expect([...CLIENT_CURRENCIES]).toEqual([...PAYPAL_PAYOUT_CURRENCIES]);
    expect(CLIENT_MIN_AMOUNT).toBe(PAYOUT_MIN_AMOUNT);
    expect(CLIENT_DAILY_LIMIT).toBe(PAYOUT_DAILY_LIMIT);
    expect(isPayPalPayoutCurrencyClient("ZMW")).toBe(false);
    expect(computePayoutFeeClient(100, 2.5)).toBe(computePayoutFee(100, 2.5));
  });

  it("wallet page offers the withdraw surface and the deposit disclosure", () => {
    expect(walletPage).toContain("PayPalWithdraw");
    expect(walletPage).toContain("PAYPAL_DEPOSIT_WITHDRAWAL_DISCLOSURE");
  });

  it("withdraw component shows the ZMW explanation and live statuses", () => {
    expect(withdrawComponent).toContain("ZMW_PAYOUT_MESSAGE");
    expect(withdrawComponent).toContain('action: "create"');
    expect(withdrawComponent).toContain('action: "status"');
    expect(withdrawComponent).toContain('action: "list"');
    expect(withdrawComponent).toContain("payoutStatusLabel");
  });
});

describe("payouts rail gate (20261242 — activation honesty)", () => {
  const gateMigration = read(
    "../../supabase/migrations/20261242_paypal_payouts_kill_switch.sql",
  );
  const paypalConfig = read("../../src/config/paypal.ts");

  it("the kill switch ships default OFF", () => {
    expect(gateMigration).toContain("paypal_payouts_enabled");
    expect(gateMigration).toContain("DEFAULT false");
  });

  it("only a literal true opens the rail — the gate fails closed", () => {
    expect(payoutsEnabled({ paypal_payouts_enabled: true })).toBe(true);
    expect(payoutsEnabled({ paypal_payouts_enabled: false })).toBe(false);
    expect(payoutsEnabled({})).toBe(false);
    expect(payoutsEnabled(null)).toBe(false);
    expect(payoutsEnabled(undefined)).toBe(false);
    expect(payoutsEnabled({ paypal_payouts_enabled: "true" })).toBe(false);
    expect(payoutsEnabled({ paypal_payouts_enabled: 1 })).toBe(false);
  });

  it("the refusal copy says activating, unavailable, and that nothing was reserved or sent", () => {
    expect(PAYOUTS_NOT_AVAILABLE_MESSAGE).toContain("being activated");
    expect(PAYOUTS_NOT_AVAILABLE_MESSAGE).toContain("aren't available yet");
    expect(PAYOUTS_NOT_AVAILABLE_MESSAGE).toContain(
      "No money has been reserved or sent",
    );
  });

  it("the function refuses create BEFORE the reserve RPC is called", () => {
    const gateAt = payoutFn.indexOf("payoutsEnabled(gateSettings)");
    const reserveAt = payoutFn.indexOf('rpc("reserve_paypal_withdrawal"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(reserveAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(reserveAt);
    expect(payoutFn).toContain('status: "not_configured"');
    expect(payoutFn).toContain("PAYOUTS_NOT_AVAILABLE_MESSAGE");
  });

  it("the float action carries the gate so form and function cannot disagree", () => {
    expect(payoutFn).toContain("payouts_enabled: payoutsEnabled(settings)");
  });

  it("the withdraw form presents the activating state and cannot submit while the rail is off", () => {
    expect(paypalConfig).toContain("PAYPAL_PAYOUTS_ACTIVATING_MESSAGE");
    expect(paypalConfig).toContain("being activated");
    expect(withdrawComponent).toContain("PAYPAL_PAYOUTS_ACTIVATING_MESSAGE");
    expect(withdrawComponent).toContain("data?.payouts_enabled === true");
    expect(withdrawComponent).toContain("!payoutsEnabled ||");
  });
});
