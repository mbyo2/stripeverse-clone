// Source proofs for the custodial Lightning SEND build
// (migration 20261224 + lightning-service + LightningSend UI).
//
// The money invariants of the send path live in SQL the unit tests
// cannot execute, so — following the house pattern (e.g.
// frozenSendAndInternalLabels' migration proof) — they are pinned
// against the migration source here, and proven behaviourally
// against the live database in the mission's QA pass:
//   - a send's sats are HELD (available only) at reserve, debited
//     from the total only at settle, and returned in full only by
//     the release path;
//   - settle/release refuse any row that is not 'processing', so an
//     unknown outcome can never be auto-refunded or double-settled;
//   - one (user, idempotency key) and one live invoice hash can
//     never produce two payments;
//   - the RPCs are service-role only (fresh-CREATE default
//     privileges revoked from PUBLIC, anon and authenticated).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const sql = read("../../supabase/migrations/20261224_custodial_lightning_send.sql");
const service = read("../../supabase/functions/lightning-service/index.ts");
const provider = read("../../supabase/functions/_shared/lightning-provider.ts");
const ui = read("../../src/components/bitcoin/LightningSend.tsx");
const walletPage = read("../../src/pages/BitcoinWallet.tsx");

describe("migration 20261224 (SQL source proof)", () => {
  it("adds 'processing' to the payment status set", () => {
    expect(sql).toContain("'pending', 'processing', 'paid', 'expired', 'failed'");
  });

  it("anchors idempotency: key column + per-user unique index", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS idempotency_key TEXT");
    expect(sql).toContain("idx_lightning_payments_idempotency");
    expect(sql).toContain("ON public.lightning_payments (user_id, idempotency_key)");
    expect(sql).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("reserve holds AVAILABLE sats only — the total is untouched until settle", () => {
    expect(sql).toContain("btc_adjust_crypto_wallet(p_user_id, 0, -p_amount_sats)");
  });

  it("reserve replays an idempotency key instead of double-paying", () => {
    expect(sql).toContain("WHERE lp.idempotency_key = p_idempotency_key");
    expect(sql).toContain("replayed := TRUE");
    expect(sql).toContain("Idempotency key already used");
  });

  it("reserve refuses to pay an invoice that is already in flight or paid", () => {
    expect(sql).toContain("AND lp.payment_hash = p_payment_hash");
    expect(sql).toContain("AND lp.status IN ('processing', 'paid')");
  });

  it("reserve enforces the rolling daily cap inside the RPC", () => {
    expect(sql).toContain("Daily Lightning payment limit exceeded");
    expect(sql).toContain("interval '24 hours'");
  });

  it("settle debits the total exactly once, from 'processing' only", () => {
    expect(sql).toContain("btc_adjust_crypto_wallet(v_row.user_id, -v_row.amount_sats, 0)");
    expect(sql).toContain("Cannot settle lightning payment in status %");
    expect(sql).toContain("already_settled");
  });

  it("settle writes the ledger row in the same transaction, keyed per payment", () => {
    expect(sql).toContain("'ln-out:' || v_row.id::text");
    // The live idempotency index is PARTIAL — the conflict target
    // must restate its predicate or the insert raises 42P10 at
    // runtime (caught by the live ledger-math proof, 2026-10-26).
    expect(sql).toContain("ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING");
  });

  it("release returns the hold in full, from 'processing' only", () => {
    expect(sql).toContain("btc_adjust_crypto_wallet(v_row.user_id, 0, v_row.amount_sats)");
    expect(sql).toContain("Cannot release lightning payment in status %");
    expect(sql).toContain("already_released");
  });

  it("all three RPCs are service-role only — fresh-CREATE grants revoked", () => {
    expect(sql).toContain("FROM PUBLIC;");
    expect(sql).toContain("FROM anon, authenticated;");
    for (const fn of [
      "btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT)",
      "btc_settle_lightning_send(UUID, TEXT)",
      "btc_release_lightning_send(UUID, TEXT)",
    ]) {
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role`);
    }
  });
});

describe("lightning-service send path (source proof)", () => {
  it("no longer refuses pay_invoice behind the unconfirmed-pay flag", () => {
    expect(service).not.toContain("if (!PROVIDER_PAY_CONFIRMED)");
    expect(provider).toContain("export const PROVIDER_PAY_CONFIRMED = true");
  });

  it("validates the invoice before reserving: decode, hash, expiry", () => {
    expect(service).toContain("decodeSendInvoice");
    expect(service).toContain("That Lightning invoice has expired");
    expect(service).toContain("doesn't state an amount");
    expect(service).toContain("missing its payment reference");
    // decode happens before the reserve RPC in the pay flow
    const payAt = service.indexOf('action === "pay_invoice"');
    const decodeAt = service.indexOf("decodeSendInvoice(bolt11.trim())", payAt);
    const reserveAt = service.indexOf("btc_reserve_lightning_send", payAt);
    expect(decodeAt).toBeGreaterThan(payAt);
    expect(reserveAt).toBeGreaterThan(decodeAt);
  });

  it("keeps the freeze guard ahead of the reserve", () => {
    const payAt = service.indexOf('action === "pay_invoice"');
    const freezeAt = service.indexOf("assertAccountNotFrozen", payAt);
    const reserveAt = service.indexOf("btc_reserve_lightning_send", payAt);
    expect(freezeAt).toBeGreaterThan(payAt);
    expect(reserveAt).toBeGreaterThan(freezeAt);
  });

  it("requires a per-attempt idempotency key", () => {
    expect(service).toContain("idempotency_key required");
    expect(service).toContain("p_idempotency_key: idempotency_key.trim()");
  });

  it("an unknown outcome holds — the processing copy says don't pay again", () => {
    expect(service).toContain("don't pay this invoice again");
    expect(service).toContain('status: "processing"');
  });

  it("exposes decode_invoice (no money) and outbound check_status", () => {
    expect(service).toContain('action === "decode_invoice"');
    expect(service).toContain('payment.direction === "outbound"');
    expect(service).toContain("resolveOutboundSend");
  });

  it("reconcile_payment is service-role only and fails closed", () => {
    expect(service).toContain('action === "reconcile_payment"');
    expect(service).toContain("Service role required");
    expect(service).toContain('token !== serviceKey');
  });

  it("settlement trusts only the provider read-back, never the pay response", () => {
    expect(provider).toContain("providerGetOutgoingPayment");
    expect(provider).toContain("parseCoinosOutgoingPayment");
    expect(service).toContain("resolveOutboundSend(admin");
  });
});

describe("LightningSend UI (source proof)", () => {
  it("reviews via decode_invoice before offering Pay", () => {
    expect(ui).toContain('action: "decode_invoice"');
    expect(ui).toContain("Review payment");
  });

  it("sends with an idempotency key and polls check_status while processing", () => {
    expect(ui).toContain('action: "pay_invoice"');
    expect(ui).toContain("idempotency_key: idemKeyRef.current");
    expect(ui).toContain('action: "check_status"');
  });

  it("states the fee policy plainly: exactly the invoice amount, no fee", () => {
    expect(ui).toContain("Exactly the invoice amount leaves your wallet");
  });

  it("the processing state warns against paying again, in plain language", () => {
    expect(ui).toContain("do not");
    expect(ui).toContain("pay this invoice again");
    expect(ui).toContain("held safely");
  });

  it("never renders raw ids, hashes, or provider text", () => {
    expect(ui).not.toContain("payment_hash");
    expect(ui).not.toContain("{result.paymentId");
  });
});

describe("BitcoinWallet send dialog (source proof)", () => {
  it("Send is a two-tab dialog: On-chain + Lightning", () => {
    expect(walletPage).toContain("<LightningSend onDone={handleDone} />");
    expect(walletPage).toContain("<DialogTitle>Send Bitcoin</DialogTitle>");
    expect(walletPage).not.toContain("<DialogTitle>Send Bitcoin (on-chain)</DialogTitle>");
  });

  it("the on-chain scan toast no longer claims Lightning lives only in self-custody", () => {
    expect(walletPage).not.toContain("pay Lightning codes from your self-custody wallet");
    expect(walletPage).toContain("open the Lightning tab above to pay a Lightning invoice");
  });
});
