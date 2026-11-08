// Source-wiring pins for the cross-rail rebalancing build
// (migration 20261251; CEO decision 2026-11-04: one unified balance,
// sendable on either rail). These pins exist so a future refactor
// cannot silently unwire the money-safety properties:
//
//   - the migration creates the ledger + treasury tables with
//     service_role-only grants, extends BOTH status vocabularies,
//     adds 'awaiting_rebalance' to EVERY fund-committing cap list
//     (a queued send that escapes the daily-cap sums would let a
//     user double-commit past the cap), and schedules both
//     processor crons;
//   - the send paths queue on POOL_SHORT_REBALANCE_NEEDED and only
//     there — INSUFFICIENT_PLATFORM_FUNDS stays a refusal;
//   - the processors resume through the existing exactly-once
//     paths (executeReservedWithdrawal / attemptOutboundPayment),
//     never a second send implementation;
//   - the custodial Send visibility gate was retired by the CEO
//     standing rule 2026-11-08 (Send always visible); the queue and
//     refusal behaviour this file pins is unchanged by that.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const migration = read("supabase/migrations/20261251_btc_cross_rail_rebalancing.sql");
const onchain = read("supabase/functions/btc-onchain/index.ts");
const lightning = read("supabase/functions/lightning-service/index.ts");
const provider = read("supabase/functions/_shared/lightning-provider.ts");
const visibility = read("src/lib/featureVisibility.ts");

describe("migration 20261251 — schema and grant discipline", () => {
  it("creates the rebalance ledger, links and treasury tables", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.btc_rebalance_requests");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.btc_rebalance_links");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.btc_platform_addresses");
  });

  it("keeps the new tables service_role-only (Oct-30 grant rule)", () => {
    for (const table of ["btc_rebalance_requests", "btc_rebalance_links", "btc_platform_addresses"]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
      expect(migration).toContain(`GRANT ALL ON TABLE public.${table} TO service_role`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("extends both status vocabularies with awaiting_rebalance", () => {
    expect(migration).toContain("'queued', 'batched', 'cancelled', 'awaiting_rebalance'");
    expect(migration).toContain("'pending', 'processing', 'paid', 'expired', 'failed',");
    expect(migration).toContain("'awaiting_rebalance')");
  });

  it("counts awaiting_rebalance in every fund-committing cap list", () => {
    // btc_reserve_withdrawal + btc_queue_batched_withdrawal +
    // btc_reserve_lightning_send (x2 lists: identity replay + cap).
    const occurrences = migration.split("'awaiting_rebalance'").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(6);
    expect(migration).toContain(
      "w.status IN ('reserved', 'broadcast', 'confirmed', 'queued', 'batched', 'awaiting_rebalance')",
    );
    expect(migration).toContain(
      "lp.status IN ('processing', 'paid', 'awaiting_rebalance')",
    );
  });

  it("provides the exactly-once request RPC with per-direction join semantics", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.btc_request_rebalance(");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('btc_rebalance:' || p_direction))");
    expect(migration).toContain("ON CONFLICT (kind, ref_id)");
  });

  it("provides the queue/resume/fail RPCs and locks every new RPC to service_role", () => {
    for (const fn of [
      "btc_mark_withdrawal_awaiting_rebalance",
      "btc_resume_awaiting_withdrawal",
      "btc_fail_awaiting_withdrawal",
      "btc_adjust_withdrawal_fee",
      "btc_queue_lightning_send",
      "btc_resume_lightning_send",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(`);
    }
  });

  it("the fail path refunds amount + the mode's committed fee in full", () => {
    expect(migration).toContain("v_refund := v_row.amount_sats +");
    expect(migration).toContain("COALESCE(v_row.reserved_fee_sats, v_row.fee_sats)");
  });

  it("schedules both processor crons", () => {
    expect(migration).toContain("'btc-process-rebalance'");
    expect(migration).toContain("'btc-process-rebalance-lightning'");
    expect(migration).toContain('\'{"action":"process_rebalance"}\'::jsonb');
  });

  it("carries the operator policy columns incl. the Coinos address fallback", () => {
    for (const col of [
      "btc_rebalance_enabled",
      "btc_rebalance_buffer_sats",
      "btc_rebalance_min_sats",
      "btc_rebalance_max_daily_sats",
      "btc_rebalance_cooldown_minutes",
      "btc_rebalance_max_wait_minutes",
      "btc_rebalance_target_lightning_sats",
      "btc_rebalance_target_onchain_sats",
      "btc_coinos_deposit_address",
    ]) {
      expect(migration).toContain(col);
    }
  });
});

describe("btc-onchain — queue, engine, resume", () => {
  it("queues instant sends only on POOL_SHORT_REBALANCE_NEEDED", () => {
    expect(onchain).toContain('reason === "POOL_SHORT_REBALANCE_NEEDED"');
    expect(onchain).toContain("queueWithdrawalForRebalance");
    expect(onchain).toContain('code: "INSUFFICIENT_PLATFORM_FUNDS"');
  });

  it("queues batch sends behind the same bridge path", () => {
    expect(onchain).toContain("parkWithdrawalBehindBridge");
    expect(onchain).toContain('failMode: "batch"');
    expect(onchain).toContain('status: "awaiting_rebalance"');
  });

  it("resumes instant sends through the shared exactly-once executor", () => {
    expect(onchain).toContain("async function executeReservedWithdrawal(");
    expect(onchain).toContain("adjustFeeOnMismatch: true");
    expect(onchain).toContain("adjustFeeOnMismatch: false");
    expect(onchain).toContain('btc_adjust_withdrawal_fee');
  });

  it("runs the processor as a service-role action", () => {
    expect(onchain).toContain('action === "process_rebalance"');
    expect(onchain).toContain("async function processRebalance(");
    expect(onchain).toContain("rebalanceExpired(");
    expect(onchain).toContain("REBALANCE_TIMEOUT_MESSAGE");
  });

  it("bridges Coinos → Sparrow via the provider bitcoin send to a treasury address", () => {
    expect(onchain).toContain("providerBitcoinSend({");
    expect(onchain).toContain("ensureTreasuryAddress");
    expect(onchain).toContain('"coinos_bridge"');
  });

  it("bridges Sparrow → Coinos by building a pool transaction to the provider address", () => {
    expect(onchain).toContain("providerGetBitcoinAddress()");
    expect(onchain).toContain("btc_coinos_deposit_address");
    expect(onchain).toContain('"awaiting_operator"');
  });

  it("never credits a bridge arrival to a user (no btc_record_deposit in the completion path)", () => {
    const completion = onchain.slice(
      onchain.indexOf("async function checkBridgeCompletion"),
      onchain.indexOf("async function resumeAwaitingWithdrawals"),
    );
    expect(completion).toContain("notePoolUtxo");
    expect(completion).not.toContain("btc_record_deposit");
    expect(completion).not.toContain("btc_adjust_crypto_wallet");
  });

  it("counts in-flight bridges in reconciliation", () => {
    expect(onchain).toContain("in_flight_rebalance_sats");
    expect(onchain).toContain("inTransitSats: inFlightSats");
  });

  it("keeps platform treasury indices inside the pool scan bound", () => {
    expect(onchain).toContain("btc_platform_addresses");
    expect(onchain).toContain("maxPlatform");
  });
});

describe("lightning-service — queue, processor, resume", () => {
  it("queues pays only on POOL_SHORT_REBALANCE_NEEDED", () => {
    expect(lightning).toContain('reason === "POOL_SHORT_REBALANCE_NEEDED"');
    expect(lightning).toContain("queueLightningPaymentBehindBridge");
    expect(lightning).toContain('p_direction: "onchain_to_lightning"');
  });

  it("resumes through the shared payment attempt (no second pay path)", () => {
    expect(lightning).toContain("async function attemptOutboundPayment(");
    expect(lightning).toContain("btc_resume_lightning_send");
  });

  it("releases queued payments whose bridge failed, with the crafted messages", () => {
    expect(lightning).toContain('action === "process_rebalance"');
    expect(lightning).toContain("REBALANCE_TIMEOUT_MESSAGE");
    expect(lightning).toContain("REBALANCE_FAILED_MESSAGE");
  });

  it("reports the queued state on check_status and on idempotent replays", () => {
    expect(lightning).toContain('payment.status === "awaiting_rebalance"');
    expect(lightning).toContain('reserve.status === "awaiting_rebalance"');
  });
});

describe("lightning-provider — bridge legs", () => {
  it("sends on-chain through POST /bitcoin/send with classified outcomes", () => {
    expect(provider).toContain("providerBitcoinSend");
    expect(provider).toContain("/bitcoin/send");
    expect(provider).toContain('{ kind: "sent"');
    expect(provider).toContain('{ kind: "rejected"');
  });

  it("reads the account's bitcoin deposit address from /me when exposed", () => {
    expect(provider).toContain("providerGetBitcoinAddress");
    expect(provider).toContain("parseCoinosBitcoinAddress");
  });
});

describe("custodial Send gate — retired (CEO standing rule 2026-11-08)", () => {
  it("no longer carries a custodialSend registry entry: Send is always visible, settlement stays server-side", () => {
    expect(visibility).not.toMatch(/custodialSend:\s*\{/);
    expect(visibility).toContain("ALWAYS_VISIBLE_WALLET_ACTIONS");
  });
});
