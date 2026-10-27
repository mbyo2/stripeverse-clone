// Tests for the rendered-check polish fixes (2026-10-28):
//   1. Recent Activity renders each row in the TRANSACTION's own
//      currency — a 5 USD PayPal deposit read "+K5.00" because the
//      lists formatted every amount in the viewer's display
//      currency (ZMW default), ignoring the row's currency.
//   2. A PayPal deposit the payer cancels no longer lingers as
//      "pending / awaiting confirmation": the cancel return reports
//      to paypal-deposit-capture (action 'cancel'), which verifies
//      the claim against PayPal's own order state and only then
//      flips the row to 'cancelled' (migration 20261242 widened the
//      status check). The pure decision table itself is pinned in
//      depositCapture.test.ts (planCancellation); here we pin the
//      wiring.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { toSupportedCurrency } from "../../src/contexts/CurrencyContext";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("toSupportedCurrency — rows keep their own currency", () => {
  it("passes supported codes through", () => {
    expect(toSupportedCurrency("USD")).toBe("USD");
    expect(toSupportedCurrency("ZMW")).toBe("ZMW");
    expect(toSupportedCurrency("EUR")).toBe("EUR");
    expect(toSupportedCurrency("GBP")).toBe("GBP");
  });

  it("returns undefined for anything else, so formatting falls back instead of throwing", () => {
    expect(toSupportedCurrency("BTC")).toBeUndefined();
    expect(toSupportedCurrency("usd")).toBeUndefined();
    expect(toSupportedCurrency("")).toBeUndefined();
    expect(toSupportedCurrency(null)).toBeUndefined();
    expect(toSupportedCurrency(undefined)).toBeUndefined();
  });
});

describe("Recent Activity formats amounts in the row's currency (source pins)", () => {
  it("Wallet page history passes the transaction currency to formatAmount", () => {
    const history = read("../../src/components/wallet/TransactionHistory.tsx");
    expect(history).toContain(
      "formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))",
    );
    expect(history).not.toContain("{formatAmount(transaction.amount)}");
  });

  it("Dashboard recent activity does the same", () => {
    const dashboard = read("../../src/pages/Dashboard.tsx");
    expect(dashboard).toContain(
      "formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))",
    );
  });

  it("the receipt opened from a row uses the row's currency too", () => {
    const receipt = read("../../src/components/TransactionReceipt.tsx");
    expect(receipt).toContain(
      "formatAmount(transaction.amount, toSupportedCurrency(transaction.currency))",
    );
    expect(receipt).not.toContain("${formatAmount(transaction.amount)}");
    expect(receipt).not.toContain("{formatAmount(transaction.amount)}");
  });
});

describe("cancelled deposits render as cancelled (source pins)", () => {
  it("the history knows the cancelled status: badge colour + filter", () => {
    const history = read("../../src/components/wallet/TransactionHistory.tsx");
    expect(history).toContain("case 'cancelled':");
    expect(history).toContain('<SelectItem value="cancelled">Cancelled</SelectItem>');
    expect(history).toContain("'pending' | 'completed' | 'failed' | 'cancelled'");
  });

  it("the transactions hook types the cancelled status", () => {
    const hook = read("../../src/hooks/useTransactions.ts");
    expect(hook).toContain("'pending' | 'completed' | 'failed' | 'cancelled'");
  });

  it("migration 20261242 widens the transactions status check to include 'cancelled'", () => {
    const migration = read(
      "../../supabase/migrations/20261242_transactions_cancelled_status.sql",
    );
    expect(migration).toContain("DROP CONSTRAINT transactions_status_check");
    expect(migration).toContain("'pending', 'completed', 'failed', 'cancelled'");
  });
});

describe("cancel-return wiring (source pins)", () => {
  it("the wallet return hook reports the cancel to the capture function", () => {
    const hook = read("../../src/hooks/usePayPalDepositReturn.ts");
    expect(hook).toContain("action: 'cancel'");
    expect(hook).toContain("body: { order_id: cancelledOrderId, action: 'cancel' }");
    // State changed server-side → activity/balance surfaces refresh.
    expect(hook).toContain("data?.status === 'cancelled' || data?.status === 'completed'");
  });

  it("the capture function routes 'cancel' to cancelPayPalDeposit and fails closed otherwise", () => {
    const fn = read("../../supabase/functions/paypal-deposit-capture/index.ts");
    expect(fn).toContain("cancelPayPalDeposit");
    expect(fn).toContain('body.action === "cancel" ? "cancel" : "confirm"');
    expect(fn).toContain('status: "cancelled"');
  });

  it("the shared cancel verifies with PayPal and flips under a pending-only guard", () => {
    const shared = read("../../supabase/functions/_shared/paypal-deposit.ts");
    expect(shared).toContain("export async function cancelPayPalDeposit");
    expect(shared).toContain("planCancellation(row.status, {");
    // Money in flight → the confirmation path governs, untouched.
    expect(shared).toContain('if (plan === "confirm_instead")');
    expect(shared).toContain("return confirmPayPalDeposit(admin, orderId, opts);");
    // The flip is guarded so a completion that lands first wins.
    expect(shared).toContain('status: "cancelled"');
    expect(shared).toContain('.eq("status", "pending")');
    expect(shared).toContain("Wallet deposit via PayPal (cancelled)");
    // An unverifiable claim flips nothing.
    expect(shared).toContain('return { kind: "unverified", transactionId: row.uuid_id };');
  });
});
