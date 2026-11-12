// Automatic collection of the 1% mobile-money service charges
// (CEO, 2026-11-12: "collect the 1% charges from the merchant's
// wallet automatically"; build = migration 20261263).
//
// Before 20261263 the 1% charge from settle_momo_collection was a
// recorded receivable forever — the status CHECK allowed only
// 'recorded' and nothing ever moved the money. These pins lock
// the collection semantics in source (the repo pattern for
// database behaviour — cf. signupNoPhone: a runtime test cannot
// prove a money path's shape); the end-to-end behaviour itself
// was proven live in sandbox (full settle → −1% debit → platform
// credit; partial FIFO; replay; sweep-after-funding; failure).
//
// Semantics pinned here:
//   1. A successful settle still credits IN FULL and records the
//      1% charge exactly as before (20261259 is untouched); the
//      settle then collects outstanding charges for that wallet
//      in the same transaction, inside an exception guard so a
//      collection error can never fail a settlement.
//   2. Collection is oldest-first, WHOLE charges only, stopping
//      at the first charge the balance cannot cover in full.
//   3. The collected total moves ONCE: merchant debit
//      (category 'momo_service_charge') → platform owner credit
//      (category 'platform_fee', earliest-admin Main ZMW wallet,
//      the same destination as the transfer fee legs), with
//      PayPal provenance following spent-first.
//   4. Double collection is impossible: only rows still
//      'recorded' are transitioned, under wallet-then-charge row
//      locks; the public RPC is service-role only and the helper
//      is granted to no API role at all.
//   5. An hourly cron sweep retries charges that settle-time
//      collection could not cover.
//   6. A failed collection creates no charge and no collection.
//   7. Merchant surfaces report each charge's state and the
//      collected / outstanding totals truthfully.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migration = read(
  "supabase/migrations/20261263_momo_charge_auto_collection.sql",
);
const settleBody = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.settle_momo_collection"),
  migration.indexOf(
    "REVOKE ALL ON FUNCTION public.settle_momo_collection",
  ),
);
const helperBody = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public._momo_collect_wallet_charges"),
  migration.indexOf("CREATE OR REPLACE FUNCTION public.collect_momo_charges"),
);

describe("schema — charges can actually be collected", () => {
  it("widens the status CHECK to recorded + collected", () => {
    expect(migration).toContain(
      "CHECK (status IN ('recorded', 'collected'))",
    );
  });
  it("stamps collection evidence on the charge row", () => {
    expect(migration).toContain("collected_at timestamptz");
    expect(migration).toContain("collected_transaction_id uuid");
    expect(migration).toContain("momo_platform_charges_outstanding_idx");
    expect(migration).toContain("WHERE status = 'recorded'");
  });
});

describe("settle — credit in full, charge as before, collect after", () => {
  it("keeps the full credit and the exact 1% charge insert", () => {
    expect(settleBody).toMatch(
      /SET balance = balance \+ v_collection\.amount/,
    );
    expect(settleBody).toContain("round(v_collection.amount * 0.01, 2)");
    expect(settleBody).toContain("ON CONFLICT (collection_id) DO NOTHING");
    // Terminal guards and exact matching are preserved verbatim.
    expect(settleBody).toContain("already_terminal");
    expect(settleBody).toContain("amount_mismatch");
    expect(settleBody).toContain("currency_mismatch");
  });
  it("collects for the settled wallet after the charge exists", () => {
    const chargeAt = settleBody.indexOf(
      "INSERT INTO public.momo_platform_charges",
    );
    const collectAt = settleBody.indexOf(
      "PERFORM public._momo_collect_wallet_charges(v_collection.user_id, v_collection.wallet_id)",
    );
    expect(chargeAt).toBeGreaterThan(-1);
    expect(collectAt).toBeGreaterThan(chargeAt);
  });
  it("can never fail the settlement when collection errors", () => {
    expect(settleBody).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(settleBody).toContain("RAISE WARNING 'momo charge collection failed");
  });
  it("reports the wallet's true balance after collection", () => {
    const collectAt = settleBody.indexOf("PERFORM public._momo_collect_wallet_charges");
    const refreshAt = settleBody.indexOf(
      "SELECT w.balance INTO v_wallet_balance",
      collectAt,
    );
    expect(refreshAt).toBeGreaterThan(collectAt);
  });
  it("a failed collection creates no charge and no collection", () => {
    const failedBranch = settleBody.slice(
      settleBody.indexOf("-- FAILED terminal"),
    );
    expect(failedBranch).not.toContain("momo_platform_charges");
    expect(failedBranch).not.toContain("_momo_collect_wallet_charges");
  });
});

describe("collection — oldest-first, whole charges, one movement", () => {
  it("walks outstanding charges for the wallet in age order under lock", () => {
    expect(helperBody).toContain("c.status = 'recorded'");
    expect(helperBody).toContain("col.wallet_id = p_wallet_id");
    expect(helperBody).toContain("ORDER BY c.created_at, c.id");
    expect(helperBody).toContain("FOR UPDATE OF c");
  });
  it("takes whole charges only and stops at the first unaffordable one", () => {
    // The running total is only ever increased by a full charge
    // amount, and the loop EXITS before exceeding the balance —
    // a charge can never be partly collected.
    expect(helperBody).toContain(
      "EXIT WHEN v_total + v_charge.amount > v_balance",
    );
    expect(helperBody).toContain("v_total := v_total + v_charge.amount");
  });
  it("locks the wallet before reading its balance", () => {
    const walletLockAt = helperBody.indexOf("FOR UPDATE");
    const balanceReadAt = helperBody.indexOf("v_balance := v_wallet.balance");
    expect(walletLockAt).toBeGreaterThan(-1);
    expect(balanceReadAt).toBeGreaterThan(walletLockAt);
  });
  it("moves the total once: merchant debit → platform fee credit", () => {
    expect(helperBody).toContain("'momo_service_charge'");
    expect(helperBody).toContain("'platform_fee'");
    expect(helperBody).toContain("public.treasury_platform_user_id()");
    expect(helperBody).toContain("SET balance = balance - v_total");
    expect(helperBody).toContain("SET balance = balance + v_total");
  });
  it("carries PayPal provenance spent-first with the debit", () => {
    expect(helperBody).toContain(
      "PERFORM public.paypal_taint_move(p_user_id, v_platform_user, 'ZMW', v_total)",
    );
  });
  it("marks exactly the collected charges, with the debit link", () => {
    expect(helperBody).toContain("SET status = 'collected'");
    expect(helperBody).toContain(
      "collected_transaction_id = debit_transaction_id",
    );
    expect(helperBody).toContain("WHERE id = ANY (v_ids)");
  });
  it("collects nothing when the wallet or platform cannot move", () => {
    expect(helperBody).toContain("v_balance <= 0");
    expect(helperBody).toContain("v_platform_wallet_status = 'closed'");
    expect(helperBody).toContain("v_platform_user IS NULL");
  });
});

describe("access + sweep — no double collection, hourly retry", () => {
  it("keeps the helper private and the RPC service-role only", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\._momo_collect_wallet_charges\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.collect_momo_charges(uuid) TO service_role",
    );
  });
  it("schedules an hourly sweep over users with outstanding charges", () => {
    expect(migration).toContain("cron.schedule(");
    expect(migration).toContain("'momo-charge-collection'");
    expect(migration).toContain("'7 * * * *'");
    expect(migration).toContain(
      "SELECT public.collect_momo_charges(u.user_id)",
    );
    expect(migration).toContain("WHERE c.status = 'recorded'");
  });
  it("the RPC only ever touches recorded charges (replay-safe)", () => {
    const rpcBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.collect_momo_charges"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.settle_momo_collection"),
    );
    expect(rpcBody).toContain("c.status = 'recorded'");
    expect(rpcBody).toContain("_momo_collect_wallet_charges(p_user_id, v_wallet_id)");
  });
});

describe("surfaces — merchants see the truth", () => {
  const settings = read("supabase/functions/momo-settings/index.ts");
  const ui = read("src/components/business/MobileMoneySettings.tsx");
  it("the status action returns per-charge state and both totals", () => {
    expect(settings).toContain("status, collected_at");
    expect(settings).toContain("charges_collected_total_zmw");
    expect(settings).toContain("charges_outstanding_total_zmw");
    // The pre-existing total keeps its meaning (all charges).
    expect(settings).toContain("charges_total_zmw");
  });
  it("the UI shows Collected / Outstanding per charge", () => {
    expect(ui).toContain('"Collected" : "Outstanding"');
    expect(ui).toContain("charges_collected_total_zmw");
    expect(ui).toContain("charges_outstanding_total_zmw");
  });
  it("the copy no longer claims charges are only billed separately", () => {
    expect(ui).not.toContain("billed to your business separately");
    expect(ui).toContain("collected afterwards from your");
    expect(ui).toContain("collected automatically from");
  });
});
