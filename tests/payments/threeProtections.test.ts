// Source pins for the three network-fee protections (CEO approved
// 2026-10-26, from the gas / network-fee audit appended to
// pay-with-bitcoin-addendum-2026-10-26.md):
//
//  P1 — the Lightning settle path must classify what the provider
//       ACTUALLY received and settle in-band deductions on the
//       actual amount, with the SQL mirroring the band + the
//       fee-absorbed split. A regression to exact-equality anywhere
//       in the chain (TS classifier, record RPC, settlement guard)
//       re-opens audit row 2's brittleness.
//  P2a — the minimum Bitcoin link amount must be enforced
//       SERVER-SIDE in btc_create_attempt (never client-only), with
//       the crafted message the pay page shows verbatim.
//  P2b — the consolidation duty must exist as a service-role action
//       driven by the pure planner, audited in its own table, and
//       scheduled daily; the fee booking must run through the
//       btc_record_consolidation RPC (operator's fee income only).
//  P3 — the withdrawal form must fetch and show the fee ESTIMATE
//       before confirming, labelled as an estimate.
//  P4 — the shared fee-window policy values (consolidation cap 2,
//       batch cap 5 sat/vB) live in platform_settings.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read("../../supabase/migrations/20261223_three_protections.sql");
const checkout = read("../../supabase/functions/payment-link-checkout/index.ts");
const onchain = read("../../supabase/functions/btc-onchain/index.ts");
const walletPage = read("../../src/pages/BitcoinWallet.tsx");

describe("P4 — shared fee-window policy + P2a minimum live in platform_settings", () => {
  it("adds the policy columns with the approved defaults", () => {
    expect(migration).toContain("btc_link_min_amount NUMERIC NOT NULL DEFAULT 5.00");
    expect(migration).toContain("btc_consolidation_enabled BOOLEAN NOT NULL DEFAULT true");
    expect(migration).toContain("btc_fee_window_consolidation_max_sat_vb NUMERIC NOT NULL DEFAULT 2");
    expect(migration).toContain("btc_fee_window_batch_max_sat_vb NUMERIC NOT NULL DEFAULT 5");
    expect(migration).toContain("btc_consolidation_min_inputs INTEGER NOT NULL DEFAULT 10");
    expect(migration).toContain("btc_consolidation_small_max_sats BIGINT NOT NULL DEFAULT 10000");
  });
});

describe("P1 — Lightning receive tolerance is wired end-to-end", () => {
  it("the checkout status path classifies the actual received amount", () => {
    expect(checkout).toContain("classifyLightningReceipt(requiredSats, receivedSats)");
    expect(checkout).toContain('cls === "full" || cls === "absorbed"');
    expect(checkout).toContain("p_received_sats: recordSats");
  });
  it("settlement coverage admits the validated deduction — and only it", () => {
    expect(checkout).toContain(
      "Number(attempt.required_sats) - Number(attempt.provider_deduction_sats ?? 0)",
    );
    expect(migration).toContain(
      "v_attempt.received_sats < v_attempt.required_sats - v_attempt.provider_deduction_sats",
    );
  });
  it("the SQL split absorbs the shortfall out of the platform fee first", () => {
    expect(migration).toContain("v_fee := GREATEST(0, v_fee - v_shortfall)");
    expect(migration).toContain("'provider_deduction_sats', v_attempt.provider_deduction_sats");
    expect(migration).toContain("'absorbed_shortfall_sats', v_shortfall");
  });
  it("the record RPC re-validates the band server-side (same numbers as link-btc.ts)", () => {
    expect(migration).toContain("v_band := LEAST(v_attempt.required_sats / 100, 100)");
    expect(migration).toContain("IF v_deduction > v_band THEN");
    expect(migration).toContain("provider_deduction_sats BIGINT NOT NULL DEFAULT 0");
  });
  it("the old exact-credit Lightning RPC signature is gone", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.btc_record_link_attempt_lightning(UUID);");
    expect(checkout).not.toContain('rpc("btc_record_link_attempt_lightning", { p_attempt_id: attempt.id })');
  });
});

describe("P2a — minimum enforced server-side with the crafted message", () => {
  it("btc_create_attempt checks the configured minimum before quoting", () => {
    expect(checkout).toContain("btcLinkBelowMinimum(fiatAmount, btcMinAmount)");
    expect(checkout).toContain('status: "below_minimum"');
    expect(checkout).toContain("for smaller amounts, pay with the BMaGlass wallet instead.");
    expect(checkout).toContain("btc_link_min_amount");
  });
});

describe("P2b — consolidation duty: action, audit, booking, schedule", () => {
  it("btc-onchain exposes a service-role consolidate action on the pure planner", () => {
    expect(onchain).toContain('action === "consolidate"');
    expect(onchain).toContain("planConsolidation(");
    expect(onchain).toContain("buildConsolidationTx({");
    expect(onchain).toContain('supabase.rpc("btc_record_consolidation"');
  });
  it("the audit table and the once-a-day, cheap-window discipline are in the migration", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.btc_consolidation_runs");
    expect(migration).toContain("btc_record_consolidation");
    expect(onchain).toContain("skipped_daily_limit");
    expect(onchain).toContain("skipped_fee_window");
    expect(onchain).toContain("skipped_min_inputs");
  });
  it("a daily cron drives it alongside the deposit-detection job", () => {
    expect(migration).toContain("'btc-consolidate-utxos'");
    expect(migration).toContain("'23 2 * * *'");
    expect(migration).toContain('\'{"action": "consolidate"}\'::jsonb');
    expect(migration).toContain("vault.decrypted_secrets WHERE name = 'service_role_key'");
  });
  it("the fee is booked against the operator only — never a user", () => {
    expect(migration).toContain("PERFORM public.btc_adjust_crypto_wallet(");
    expect(migration).toContain("p_operator_user_id, -p_fee_sats, -p_fee_sats");
    expect(migration).toContain("'btc_consolidation'");
  });
  it("gatherUtxos keeps attempt + consolidation-output coins spendable", () => {
    expect(onchain).toContain("maxAttempt");
    expect(onchain).toContain("maxCons");
  });
});

describe("P3 — withdrawal fee estimate before confirming", () => {
  it("btc-onchain exposes the read-only estimate on the send path's own math", () => {
    expect(onchain).toContain('action === "estimate_send"');
    expect(onchain).toContain("async function estimateSend(");
    expect(onchain).toContain("estimated_fee_sats");
  });
  it("the wallet send form fetches it and labels it an estimate", () => {
    expect(walletPage).toContain('action: "estimate_send"');
    expect(walletPage).toContain("Estimated network fee:");
    expect(walletPage).toContain(
      "the exact fee is confirmed when your withdrawal broadcasts",
    );
  });
});
