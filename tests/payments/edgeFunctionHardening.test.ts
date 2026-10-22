// Source pins for the edge-function hardening batch (audit M1 + L1 +
// the virtual-card CVV finding). The edge functions run on Deno and
// cannot be executed by vitest, so — the repo's established pattern —
// these tests pin the security-relevant wiring in the function
// sources: the properties that must not regress when the files are
// edited later.
//
//   M1  btc-onchain send(): the reservation is the serialization
//       point — coin selection excludes outpoints committed to other
//       in-flight withdrawals, the daily cap is re-checked after the
//       reservation (and any refund still happens BEFORE broadcast,
//       the v45 rule), and unresolved broadcasts record their txid.
//   L1  No PayPal function logs a raw payload or provider body:
//       the webhook logs event trace identifiers only, and provider
//       error logs go through paypalErrorTrace (status/name/debug_id).
//   CVV create-virtual-card never logs or persists the CVV; it is
//       revealed once in the creation response only.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const onchain = read("../../supabase/functions/btc-onchain/index.ts");
const webhook = read("../../supabase/functions/paypal-webhook/index.ts");
const payoutServer = read("../../supabase/functions/_shared/paypal-payout-server.ts");
const sharedDeposit = read("../../supabase/functions/_shared/paypal-deposit.ts");
const sharedCheckout = read("../../supabase/functions/_shared/paypal-checkout.ts");
const walletDeposit = read("../../supabase/functions/wallet-deposit/index.ts");
const processPayment = read("../../supabase/functions/process-payment/index.ts");
const createCard = read("../../supabase/functions/create-virtual-card/index.ts");
const cvvMigration = read("../../supabase/migrations/20261026_virtual_cards_cvv_hygiene.sql");

/** Slice of `src` between two markers (exclusive), for ordering pins. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  expect(a, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
  expect(b, `marker not found: ${end}`).toBeGreaterThan(a);
  return src.slice(a + start.length, b);
}

describe("M1 — btc-onchain send() concurrency hardening", () => {
  const sendBody = between(onchain, "async function send(", "// ── send helpers");

  it("excludes outpoints committed to other in-flight withdrawals after reserving", () => {
    expect(onchain).toContain("filterUncommittedUtxos");
    expect(onchain).toContain("spentOutpointsFromTx");
    // The exclusion runs AFTER the reservation exists.
    const reserveIdx = sendBody.indexOf('rpc("btc_reserve_withdrawal"');
    const exclusionIdx = sendBody.indexOf("filterUncommittedUtxos(utxos, committed)");
    expect(reserveIdx).toBeGreaterThanOrEqual(0);
    expect(exclusionIdx).toBeGreaterThan(reserveIdx);
    // …and the build consumes the FILTERED set, not the raw snapshot.
    expect(sendBody).toContain("utxos: spendableUtxos");
  });

  it("committed-outpoint lookup skips own row and only reads txid-bearing in-flight rows", () => {
    expect(onchain).toContain('.in("status", ["reserved", "broadcast"])');
    expect(onchain).toContain('.not("txid", "is", null)');
    expect(onchain).toContain('.neq("id", excludeWithdrawalId)');
  });

  it("re-selection must reproduce the reserved fee or the withdrawal is failed pre-broadcast", () => {
    expect(sendBody).toContain("reselection.feeSats !== selection.feeSats");
    expect(sendBody).toContain("coin selection changed after reservation");
  });

  it("daily cap is re-checked against reservations (incl. racers) after reserving", () => {
    const reserveIdx = sendBody.indexOf('rpc("btc_reserve_withdrawal"');
    const recheckIdx = sendBody.indexOf("sentAfterReserve > maxDailySats");
    expect(recheckIdx).toBeGreaterThan(reserveIdx);
    expect(sendBody).toContain("daily withdrawal limit exceeded");
    // The cap sum counts 'reserved' rows, so a racer's fresh
    // reservation is on the books for both re-checks.
    expect(onchain).toContain('.in("status", ["reserved", "broadcast", "confirmed"])');
  });

  it("v45 invariant: every automatic refund (btc_fail_withdrawal) happens BEFORE broadcast", () => {
    const broadcastIdx = sendBody.indexOf("broadcastTx(built.hex");
    expect(broadcastIdx).toBeGreaterThanOrEqual(0);
    let idx = sendBody.indexOf("btc_fail_withdrawal");
    expect(idx).toBeGreaterThanOrEqual(0); // pre-broadcast refunds exist
    while (idx !== -1) {
      expect(idx, "btc_fail_withdrawal must precede the broadcast call").toBeLessThan(broadcastIdx);
      idx = sendBody.indexOf("btc_fail_withdrawal", idx + 1);
    }
    // Broadcast classification is still the pure no-refund policy.
    expect(onchain).toContain("classifyBroadcastOutcome");
    // Unknown outcomes still answer 202 and stay reserved.
    expect(sendBody).toContain('return json(202, {');
    expect(sendBody).toContain('"verifying"');
  });

  it("unresolved outcomes record the txid on the row (status untouched)", () => {
    const occurrences = sendBody.split("recordWithdrawalTxid(supabase, withdrawalId, built.txid)").length - 1;
    expect(occurrences).toBe(2); // unknown-broadcast path + finalize-failure path
    const helper = between(onchain, "async function recordWithdrawalTxid", "async function gatherUtxos");
    expect(helper).toContain(".update({ txid,");
    expect(helper).not.toContain("status");
  });
});

describe("L1 — PayPal logs carry trace identifiers, never payloads or raw bodies", () => {
  it("webhook no longer logs the full payload", () => {
    expect(webhook).not.toContain('logStep("Webhook data"');
    // No logStep call receives the payload object itself (property
    // reads for the trace fields are the replacement). The verify
    // call — verifyWebhookSignature(req, webhookData) — is NOT a
    // log and must stay.
    for (const line of webhook.split("\n")) {
      if (line.includes("logStep(")) {
        expect(line, line.trim()).not.toContain("webhookData");
      }
    }
    expect(webhook).toContain('logStep("Webhook event", {');
    expect(webhook).toContain("eventType: webhookData.event_type");
    expect(webhook).toContain("eventId: webhookData.id");
    expect(webhook).toContain("resourceId: webhookData.resource?.id");
  });

  it("webhook verification behaviour is unchanged (fail-closed, official API)", () => {
    expect(webhook).toContain("verifyPayPalWebhookSignature");
    expect(webhook).toContain('status: 401');
    expect(webhook).toContain("Invalid signature");
  });

  it("payout creation failure logs status + error name + debug_id, not the body", () => {
    expect(payoutServer).not.toContain('console.error("PayPal payout create failed:", response.status, body)');
    expect(payoutServer).toContain('console.error("PayPal payout create failed:", response.status, {');
    expect(payoutServer).toContain("debugId:");
  });

  it("order/capture failure logs go through paypalErrorTrace everywhere", () => {
    for (const [label, src] of [
      ["shared deposit capture", sharedDeposit],
      ["shared checkout capture", sharedCheckout],
      ["wallet-deposit order", walletDeposit],
      ["process-payment order", processPayment],
    ] as const) {
      expect(src, label).toContain("paypalErrorTrace(response.status, await response.text())");
      expect(src, label).not.toMatch(/console\.error\("[^"]+", response\.status, await response\.text\(\)\)/);
    }
  });
});

describe("CVV hygiene — create-virtual-card", () => {
  it("never logs the CVV (or the full number)", () => {
    for (const line of createCard.split("\n")) {
      if (line.includes("logStep")) {
        expect(line, line.trim()).not.toContain("cvv");
      }
    }
    expect(createCard).toContain('logStep("Generated card details", { cardNumber: maskedNumber.data })');
  });

  it("does not persist the CVV (stores NULL; migration drops NOT NULL + purges old rows)", () => {
    const insert = between(createCard, ".insert({", "})\n      .select()");
    expect(insert).toContain("cvv: null,");
    expect(insert).not.toContain("cvv: cvv");
    expect(cvvMigration).toContain("ALTER TABLE public.virtual_cards ALTER COLUMN cvv DROP NOT NULL");
    expect(cvvMigration).toContain("UPDATE public.virtual_cards SET cvv = NULL WHERE cvv IS NOT NULL");
  });

  it("reveals the full details exactly once — in the creation response", () => {
    const responseCard = between(createCard, "return new Response(JSON.stringify({", "}), {");
    expect(responseCard).toContain("card_number: cardNumber,");
    expect(responseCard).toContain("cvv: cvv,");
    expect(responseCard).toContain("expiry_date: expiry");
    // The single `cvv: cvv` in the file is that reveal (the insert
    // above stores null; nothing else may carry the value).
    expect(createCard.split("cvv: cvv").length - 1).toBe(1);
    // The masked number remains the stored/displayed form.
    expect(responseCard).toContain("masked_number: newCard.masked_number,");
  });
});
