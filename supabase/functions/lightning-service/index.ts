// lightning-service: custodial Lightning Network via the configured
// Lightning provider (Coinos — see _shared/lightning-provider.ts).
// The function name is historical (the original Breez leg is gone);
// clients invoke it as "lightning-service" and its response shapes are
// unchanged.
// Actions:
//   POST { action: "create_invoice", amount_sats, description } → bolt11 invoice
//   POST { action: "decode_invoice", bolt11 } → invoice summary (no money moves)
//   POST { action: "pay_invoice", bolt11, idempotency_key } → pay from user balance
//   POST { action: "check_status", breez_invoice_id } → poll a payment's status
//        (breez_invoice_id is the lightning_payments row id returned as
//        payment_id by create_invoice / pay_invoice; works for both
//        inbound invoices and outbound sends)
//   POST { action: "reconcile_payment", payment_id, resolution } →
//        service-role ONLY: ops resolution of a held outbound send
//        (resolution "paid" settles, "failed" releases the hold)
//   POST { action: "lnurl_pay_resolve", input } → resolve a Lightning
//        address / LNURL endpoint (no money moves): returns the pay
//        bounds + description, or the withdraw bounds, keyed by kind
//   POST { action: "lnurl_pay", input, amount_sats, comment,
//          idempotency_key } → LNURL-pay (LUD-06/16): resolve, fetch a
//          bolt11 from the endpoint's callback for the chosen amount,
//          then pay it through the SAME reserve-first doctrine as
//          pay_invoice (settlement only on the read-back)
//   POST { action: "lnurl_withdraw", input, amount_sats } →
//          LNURL-withdraw (LUD-03): resolve, create a custodial
//          invoice through the create_invoice path, submit it to the
//          endpoint's callback; settlement arrives through the
//          existing exactly-once check_status deposit settle
//   LNURL-auth (LUD-04/05) is deliberately NOT offered custodially —
//   see _shared/lnurl.ts header for the assessment.
//
// Auth: user JWT required; identity comes from the verified token only.
// (reconcile_payment is the single exception: it requires the
// service-role key itself, never a user token.)
// Balances are integer sats in crypto_wallets, moved ONLY through the
// btc_adjust_crypto_wallet RPC (row-locked, non-negative), the atomic
// btc_settle_lightning_deposit RPC in check_status (single-transaction
// claim + credit — a settled invoice can never be credited twice), or
// the reserve/settle/release RPC trio in pay_invoice
// (btc_reserve_lightning_send / btc_settle_lightning_send /
// btc_release_lightning_send — an outbound payment can never overdraw,
// double-pay an invoice, or auto-refund an unknown outcome).
//
// History note: the previous version decoded invoice amounts with
// floating-point math (mispricing pico-denominated invoices) and did
// read-modify-write balance updates, so two concurrent calls could
// double-credit or double-pay. Amounts are now decoded with BigInt via
// _shared/btc-core.ts (unit-tested).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import { decodeBolt11, decodeBolt11Msat, isBolt11Expired } from "../_shared/btc-core.ts";
import {
  LightningNotConfiguredError,
  LightningUpstreamError,
  lightningProviderConfigured,
  providerCreateInvoice,
  providerGetInvoice,
  providerGetOutgoingPayment,
  providerPayInvoice,
} from "../_shared/lightning-provider.ts";
import {
  ACCOUNT_FROZEN_MESSAGE,
  ACCOUNT_STATUS_UNVERIFIED_MESSAGE,
  assertAccountNotFrozen,
} from "../_shared/account-freeze.ts";
import {
  LnurlUpstreamError,
  LnurlUserError,
  fetchLnurlPayInvoice,
  resolveLnurlParams,
  submitLnurlWithdraw,
  validateLnurlComment,
  validateLnurlPayAmount,
  validateLnurlWithdrawAmount,
} from "../_shared/lnurl.ts";

const MAX_SATS = (() => {
  const raw = Deno.env.get("BREEZ_MAX_SATS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
})();

// Rolling-24h cap across a user's outbound Lightning sends, enforced
// inside btc_reserve_lightning_send — the same env + default as the
// on-chain withdrawal cap in btc-onchain, so both rails share one
// daily ceiling policy.
const MAX_DAILY_SATS = (() => {
  const raw = Deno.env.get("BTC_MAX_DAILY_SATS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5_000_000;
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Designed refusals, in the { error } shape the frontend surfaces
// verbatim. Lightning gates on the provider configuration alone
// (LIGHTNING_PROVIDER + provider token): the provider runs its own
// custodial wallet server-side, so the on-chain seed⇄xpub interlock
// does not apply here and the wording names Lightning, not Bitcoin
// custody. Inbound settlement is exactly-once by construction:
// check_status credits through the single-transaction
// btc_settle_lightning_deposit RPC (migration 20261022), never through
// separate claim/credit calls.
const LIGHTNING_DEPOSITS_NOT_CONFIGURED =
  "Lightning deposits are not available yet — Lightning is not configured on this deployment.";
const LIGHTNING_PAYMENTS_NOT_CONFIGURED =
  "Lightning payments are not available yet — Lightning is not configured on this deployment.";
// Upstream-unreachable refusals: truthful and plain. When the
// provider cannot be reached, the honest answer is that the
// Lightning leg is temporarily unavailable and on-chain Bitcoin
// works — the raw provider/network text never reaches the caller.
const LIGHTNING_DEPOSITS_UNAVAILABLE =
  "Lightning deposits are not available yet — please use an on-chain Bitcoin deposit for now.";
const LIGHTNING_PAYMENTS_UNAVAILABLE =
  "Lightning payments are not available yet — please use an on-chain Bitcoin payment for now.";
// Outbound-send refusals (decode / validation), in the app's voice.
// These are returned BEFORE any balance is reserved.
const INVOICE_INVALID =
  "That doesn't look like a valid Lightning invoice — check the code and try again.";
const INVOICE_AMOUNTLESS =
  "This invoice doesn't state an amount, so it can't be paid from here — ask for an invoice with the amount filled in.";
const INVOICE_EXPIRED =
  "That Lightning invoice has expired — ask for a fresh one and try again.";
const INVOICE_NO_HASH =
  "That invoice is missing its payment reference, so it can't be paid safely from here — ask for a fresh invoice.";
// The provider definitively refused the payment (it provably was not
// made; the reservation has been released in full).
const PAYMENT_REFUSED =
  "The Lightning network refused this payment — no Bitcoin left your wallet. Check the invoice and try again.";
// The payment's outcome is not yet known: the hold stays, the send
// must NOT be repeated, and check_status keeps resolving it.
const PAYMENT_PROCESSING_MESSAGE =
  "Your payment is being confirmed — don't pay this invoice again. We're checking it automatically.";
// LNURL refusals, in the same crafted voice. Endpoint-supplied text
// (an LNURL ERROR reason, a metadata string beyond its description)
// never reaches the caller verbatim.
const LNURL_INPUT_REQUIRED =
  "Enter a Lightning address or LNURL code first.";
const LNURL_UNREACHABLE =
  "We couldn't reach that Lightning service just now — check the address and try again in a moment.";
const LNURL_NOT_A_PAY =
  "That's a withdrawal code, not a payment address — use the withdraw option for it instead.";
const LNURL_NOT_A_WITHDRAW =
  "That's a payment address, not a withdrawal code — use the pay option for it instead.";
const LNURL_AMOUNT_MISMATCH =
  "The Lightning service created an invoice for a different amount, so we didn't pay it. Nothing was sent.";
const LNURL_WITHDRAW_REFUSED =
  "That service didn't accept the withdrawal. Nothing was taken from anywhere — try again or contact the service.";
const LNURL_WITHDRAW_SUBMITTED_MESSAGE =
  "Your withdrawal request was sent. When the service pays, the Bitcoin arrives in your wallet automatically.";

// Returns the designed 503 refusal while the provider is not
// configured, else null.
function lightningProviderGate(refusal: string): Response | null {
  if (!lightningProviderConfigured()) {
    console.error("lightning-service: Lightning provider not configured");
    return json(503, { error: refusal });
  }
  return null;
}

// PostgREST/RPC failures are plain objects with a message, not Error
// instances — an `instanceof Error` test alone collapses them into a
// contentless fallback and the user learns nothing. Extract the real
// message from any thrown value that carries one.
function thrownMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  const m = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof m === "string" && m.trim()) return m;
  return fallback;
}

/**
 * Decode + validate a bolt11 for the SEND path, before any money
 * moves. Returns the decoded details, or a ready refusal Response.
 * Refused, in order: malformed, amount-less, sub-sat remainder,
 * over the per-payment limit, missing its payment hash (the send's
 * identity — an invoice without one can never be tracked or safely
 * de-duplicated), and expired.
 */
function decodeSendInvoice(bolt11: string):
  | { details: NonNullable<ReturnType<typeof decodeBolt11>>; sats: number }
  | { refusal: Response } {
  const details = decodeBolt11(bolt11);
  if (!details) {
    return { refusal: json(400, { error: INVOICE_INVALID }) };
  }
  if (details.amountMsat === null || details.amountMsat <= 0n) {
    return { refusal: json(400, { error: INVOICE_AMOUNTLESS }) };
  }
  if (details.amountMsat % 1000n !== 0n) {
    return { refusal: json(400, { error: "Invoice amount must be a whole number of sats" }) };
  }
  const sats = Number(details.amountMsat / 1000n);
  if (sats > MAX_SATS) {
    return { refusal: json(400, { error: `Invoice exceeds the ${MAX_SATS} sat payment limit` }) };
  }
  if (!details.paymentHash) {
    return { refusal: json(400, { error: INVOICE_NO_HASH }) };
  }
  if (isBolt11Expired(details, Math.floor(Date.now() / 1000))) {
    return { refusal: json(400, { error: INVOICE_EXPIRED }) };
  }
  return { details, sats };
}

type OutboundResolution = "paid" | "processing" | "failed";

/**
 * Resolve a held ('processing') outbound send against the provider's
 * independent read-back — the ONLY evidence a send may settle on.
 * Paid → settle RPC (atomic debit + ledger). Definitively failed →
 * release RPC (hold returned in full). Anything else — still
 * pending at the provider, not yet visible there, or the read-back
 * itself unreachable — stays 'processing': an unknown outcome is
 * never auto-refunded and never re-paid.
 */
async function resolveOutboundSend(
  admin: ReturnType<typeof getServiceRoleClient>,
  payment: { id: string; bolt11: string | null; payment_hash: string | null },
): Promise<OutboundResolution> {
  let readback;
  try {
    readback = await providerGetOutgoingPayment({
      paymentHash: payment.payment_hash,
      bolt11: payment.bolt11,
    });
  } catch (e) {
    console.error(
      "lightning-service: outgoing read-back failed for payment",
      payment.id, thrownMessage(e, "unknown"),
    );
    return "processing";
  }
  if (readback.state === "paid") {
    if (readback.feeSats !== null && readback.feeSats > 0) {
      // Fee-policy tripwire: Coinos's published terms charge 0% on
      // Lightning-out. A reported provider fee is a terms change —
      // log it loudly for ops; the user is still debited exactly
      // the invoice amount (at-cost doctrine), never the fee.
      console.error(
        "CRITICAL: Lightning provider reported a fee on an outbound payment",
        payment.id, readback.feeSats, "sats — review provider terms",
      );
    }
    const { error } = await admin.rpc("btc_settle_lightning_send", {
      p_payment_id: payment.id,
      p_payment_hash: readback.paymentHash ?? undefined,
    });
    if (error) {
      console.error("CRITICAL: Lightning settle failed", payment.id, error);
      return "processing";
    }
    return "paid";
  }
  if (readback.state === "failed") {
    const { error } = await admin.rpc("btc_release_lightning_send", {
      p_payment_id: payment.id,
      p_reason: "Provider reported the payment failed",
    });
    if (error) {
      console.error("CRITICAL: Lightning release failed", payment.id, error);
      return "processing";
    }
    return "failed";
  }
  return "processing";
}

/**
 * Self-custody sell-to-ZMW (migration 20261235): if this inbound
 * payment is bound to a sell intent, convert its just-settled BTC
 * credit to ZMW via btc_settle_selfcustody_sell. Isolated by design:
 * a failure here NEVER affects the deposit settlement above — the
 * BTC stays as a normal custodial credit and the sell function's
 * `check` action retries the conversion.
 */
async function trySettleSellIntent(
  admin: ReturnType<typeof getServiceRoleClient>,
  paymentId: string,
): Promise<void> {
  try {
    const { data: intent } = await admin
      .from("btc_selfcustody_sell_intents")
      .select("id")
      .eq("lightning_payment_id", paymentId)
      .eq("status", "awaiting")
      .maybeSingle();
    if (!intent) return;
    const { error } = await admin.rpc("btc_settle_selfcustody_sell", {
      p_intent_id: intent.id,
      p_deposit_kind: "lightning",
      p_txid: null,
      p_vout: null,
      p_lightning_payment_id: paymentId,
    });
    if (error) {
      console.error("lightning-service: sell-intent conversion failed (deposit unaffected):", error.message);
    }
  } catch (e) {
    console.error("lightning-service: sell-intent conversion failed (deposit unaffected):", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let currentAction = "";
  try {
    const admin = getServiceRoleClient();
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");

    // The body is parsed before auth: reconcile_payment (below) is
    // authorised by the service-role key itself, not by a user JWT.
    const body = await req.json().catch(() => ({}));
    const {
      action, amount_sats, description, bolt11, breez_invoice_id,
      idempotency_key, payment_id, resolution, input, comment,
    } = body ?? {};
    currentAction = typeof action === "string" ? action : "";

    // ── Ops reconciliation of a held outbound send (service role) ──
    // The manual backstop for a send stuck in 'processing': once the
    // true outcome is known out-of-band, ops settle or release it
    // through the same RPCs the automatic paths use. Requires the
    // service-role key as the bearer token — a user JWT never
    // qualifies, and a missing server key fails closed.
    if (action === "reconcile_payment") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!serviceKey || token !== serviceKey) {
        return json(403, { error: "Service role required" });
      }
      if (!payment_id || typeof payment_id !== "string") {
        return json(400, { error: "payment_id required" });
      }
      if (resolution !== "paid" && resolution !== "failed") {
        return json(400, { error: 'resolution must be "paid" or "failed"' });
      }
      const { data, error } = resolution === "paid"
        ? await admin.rpc("btc_settle_lightning_send", { p_payment_id: payment_id })
        : await admin.rpc("btc_release_lightning_send", {
          p_payment_id: payment_id,
          p_reason: "Ops reconciliation: payment confirmed not made",
        });
      if (error) throw error;
      const outcome = Array.isArray(data) ? data[0] : data;
      return json(200, {
        ok: true,
        outcome: outcome?.outcome ?? null,
        status: outcome?.payment_status ?? null,
      });
    }

    const supabase = getSupabaseClient(req);
    // All DB work below runs through the dedicated service-role client:
    // lightning_payments is SELECT-own-only under RLS and the btc_* RPCs
    // are service_role-only, while the request client forwards the
    // caller's JWT (PostgREST would run as `authenticated` and be
    // denied). Identity is verified from the JWT via `supabase`; rows
    // and money move via `admin`. (Pattern: atomic-transfer.)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    // ── Create inbound Lightning invoice ──
    if (action === "create_invoice") {
      const gate = lightningProviderGate(LIGHTNING_DEPOSITS_NOT_CONFIGURED);
      if (gate) return gate;

      const sats = Number(amount_sats);
      if (!Number.isInteger(sats) || sats <= 0 || sats > MAX_SATS) {
        return json(400, { error: `amount_sats must be an integer between 1 and ${MAX_SATS}` });
      }

      const invoice = await providerCreateInvoice(
        sats,
        description || `Deposit for ${user.id.slice(0, 8)}`,
      );

      // Never trust the provider's say-so on the amount: decode the
      // returned bolt11 with integer math and refuse (upstream error)
      // if it does not encode exactly the requested sats — crediting
      // keys off the ledger row amount, so a mismatched invoice must
      // never reach the ledger at all.
      const msat = decodeBolt11Msat(invoice.bolt11);
      if (msat === null || msat !== BigInt(sats) * 1000n) {
        throw new LightningUpstreamError(
          "Lightning provider returned an invoice with a mismatched amount",
        );
      }

      // breez_invoice_id stores the provider's invoice id — it is
      // the status-lookup key for check_status (the Coinos payment
      // hash is kept separately in payment_hash).
      const { data: payment, error } = await admin.from("lightning_payments").insert({
        user_id: user.id,
        direction: "inbound",
        amount_sats: sats,
        breez_invoice_id: invoice.providerId,
        bolt11: invoice.bolt11,
        payment_hash: invoice.paymentHash,
        status: "pending",
      }).select("id").single();

      if (error) throw error;

      return json(200, {
        payment_id: payment.id,
        bolt11: invoice.bolt11,
        payment_hash: invoice.paymentHash,
      });
    }

    // ── Decode an invoice for the send confirm screen (no money) ──
    if (action === "decode_invoice") {
      const gate = lightningProviderGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;

      if (!bolt11 || typeof bolt11 !== "string") {
        return json(400, { error: "bolt11 required" });
      }
      const decoded = decodeSendInvoice(bolt11.trim());
      if ("refusal" in decoded) return decoded.refusal;
      return json(200, {
        amount_sats: decoded.sats,
        description: decoded.details.description,
        payment_hash: decoded.details.paymentHash,
        expires_at: new Date(decoded.details.expiresAtSeconds * 1000).toISOString(),
      });
    }

    // ── Pay an outbound Lightning invoice (from wallet balance) ──
    if (action === "pay_invoice") {
      const gate = lightningProviderGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;

      // Freeze guard: a frozen account cannot send Lightning payments
      // (receiving stays open). Refuse with the shared crafted message
      // BEFORE any balance is reserved. A failed status read fails
      // closed with the unverified message, same as every other
      // money-out function using this helper.
      try {
        await assertAccountNotFrozen(admin, user.id);
      } catch (e) {
        const msg = thrownMessage(e, ACCOUNT_STATUS_UNVERIFIED_MESSAGE);
        if (msg === ACCOUNT_FROZEN_MESSAGE) return json(403, { error: msg });
        return json(503, { error: msg });
      }

      if (!bolt11 || typeof bolt11 !== "string") {
        return json(400, { error: "bolt11 required" });
      }
      if (!idempotency_key || typeof idempotency_key !== "string" || !idempotency_key.trim()) {
        return json(400, { error: "idempotency_key required" });
      }

      // Decode and validate the invoice BEFORE any money moves:
      // amount (integer math), whole sats only, per-payment limit,
      // payment hash present, not expired.
      const decoded = decodeSendInvoice(bolt11.trim());
      if ("refusal" in decoded) return decoded.refusal;
      const { details, sats } = decoded;

      // Reserve the amount and record the send atomically
      // (btc_reserve_lightning_send): the row is the audit +
      // idempotency anchor, the hold drops available_sats only.
      // A replay (same key, or the same invoice already live/paid)
      // returns the original row — this call then reports its state
      // and NEVER pays again.
      const { data: reserveRows, error: reserveErr } = await admin.rpc(
        "btc_reserve_lightning_send",
        {
          p_user_id: user.id,
          p_bolt11: bolt11.trim(),
          p_payment_hash: details.paymentHash,
          p_amount_sats: sats,
          p_idempotency_key: idempotency_key.trim(),
          p_max_daily_sats: MAX_DAILY_SATS,
        },
      );
      if (reserveErr) {
        const msg = thrownMessage(reserveErr, "");
        if (msg.includes("Insufficient BTC balance")) {
          return json(400, { error: "Insufficient BTC balance" });
        }
        if (msg.includes("Daily Lightning payment limit exceeded")) {
          return json(400, { error: "You've reached today's Lightning payment limit. Try again tomorrow." });
        }
        if (msg.includes("Idempotency key already used")) {
          return json(409, { error: "This payment request was already used. Start a new payment." });
        }
        throw reserveErr;
      }
      const reserve = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
      if (!reserve?.payment_id) throw new Error("btc_reserve_lightning_send returned no row");
      const paymentId = reserve.payment_id as string;

      if (reserve.replayed) {
        // Report the original attempt's state; never pay twice.
        if (reserve.status === "paid") {
          return json(200, { status: "paid", paid_sats: sats, payment_id: paymentId });
        }
        if (reserve.status === "failed") {
          return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
        }
        return json(200, {
          status: "processing",
          payment_id: paymentId,
          message: PAYMENT_PROCESSING_MESSAGE,
        });
      }

      // Fresh reservation — ask the provider to pay. The classified
      // outcome decides: a definitive refusal releases the hold in
      // full; acceptance triggers an independent read-back (the POST
      // response alone never settles); an unknown outcome holds.
      const payOutcome = await providerPayInvoice(bolt11.trim());
      if (payOutcome.kind === "rejected") {
        console.error("lightning-service: provider refused payment", paymentId, payOutcome.detail);
        const { error: relErr } = await admin.rpc("btc_release_lightning_send", {
          p_payment_id: paymentId,
          p_reason: "Provider refused the payment",
        });
        if (relErr) {
          console.error("CRITICAL: Lightning release after refusal failed", paymentId, relErr);
          return json(200, {
            status: "processing",
            payment_id: paymentId,
            message: PAYMENT_PROCESSING_MESSAGE,
          });
        }
        return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
      }
      if (payOutcome.kind === "unknown") {
        console.error("lightning-service: payment outcome unknown", paymentId, payOutcome.detail);
        return json(200, {
          status: "processing",
          payment_id: paymentId,
          message: PAYMENT_PROCESSING_MESSAGE,
        });
      }

      // Accepted: confirm via read-back before settling anything.
      const resolution = await resolveOutboundSend(admin, {
        id: paymentId,
        bolt11: bolt11.trim(),
        payment_hash: details.paymentHash,
      });
      if (resolution === "paid") {
        return json(200, { status: "paid", paid_sats: sats, payment_id: paymentId });
      }
      if (resolution === "failed") {
        return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
      }
      return json(200, {
        status: "processing",
        payment_id: paymentId,
        message: PAYMENT_PROCESSING_MESSAGE,
      });
    }

    // ── Check a payment's status; settle on confirmation ──
    if (action === "check_status") {
      if (!breez_invoice_id) {
        return json(400, { error: "breez_invoice_id required" });
      }

      const { data: payment } = await admin.from("lightning_payments")
        .select("*").eq("id", breez_invoice_id).eq("user_id", user.id).single();

      if (!payment) return json(404, { error: "Payment not found" });

      // Outbound sends resolve against the provider read-back:
      // paid/failed are terminal; 'processing' re-checks the
      // provider and settles or releases atomically via the RPCs.
      if (payment.direction === "outbound") {
        if (payment.status === "paid") return json(200, { status: "paid" });
        if (payment.status === "failed") return json(200, { status: "failed" });
        if (payment.status !== "processing") {
          return json(200, { status: payment.status });
        }
        const resolution = await resolveOutboundSend(admin, payment);
        return json(200, { status: resolution });
      }

      if (payment.status === "paid") {
        // Retry hook: if a sell-intent conversion was missed when
        // this invoice settled, a later poll still completes it.
        await trySettleSellIntent(admin, payment.id);
        return json(200, { status: "paid" });
      }
      if (payment.status === "expired" || payment.status === "failed") {
        return json(200, { status: payment.status });
      }

      const { state } = await providerGetInvoice(payment.breez_invoice_id);
      const isPaid = state === "paid";

      if (!isPaid) {
        if (state === "expired") {
          await admin.from("lightning_payments")
            .update({ status: "expired" }).eq("id", payment.id);
          return json(200, { status: "expired" });
        }
        return json(200, { status: "pending" });
      }

      // Settle EXACTLY ONCE through the single-transaction RPC
      // (btc_settle_lightning_deposit, migration 20261022): the claim
      // (pending → paid), the wallet credit and the ledger row commit
      // or roll back TOGETHER, so no hard stop can strand a paid-but-
      // uncredited invoice and no retry or concurrent poll can
      // double-credit. The RPC credits the amount recorded on the
      // payment row — never a caller-supplied figure — and is
      // idempotent on the payment id.
      const { data: settleRows, error: settleErr } = await admin.rpc(
        "btc_settle_lightning_deposit",
        { p_payment_id: payment.id },
      );
      if (settleErr) throw settleErr;
      const outcome = Array.isArray(settleRows) ? settleRows[0] : settleRows;
      if (!outcome) throw new Error("btc_settle_lightning_deposit returned no row");
      if (outcome.outcome === "credited" || outcome.outcome === "already_settled") {
        // Self-custody sell-to-ZMW: convert the credit if this
        // invoice was created for a sell intent (isolated; a failure
        // leaves the BTC credit untouched for a later retry).
        await trySettleSellIntent(admin, payment.id);
        return json(200, { status: "paid" });
      }
      // The row changed state under us (e.g. expired concurrently) —
      // report its recorded status rather than inventing one.
      console.error(
        "lightning-service check_status: settle outcome",
        outcome.outcome, "for payment", payment.id,
      );
      return json(200, { status: outcome.payment_status ?? "pending" });
    }

    // ── LNURL resolve (no money moves) ──
    // One resolve serves both flows: the endpoint's tag decides
    // whether the input is a pay destination or a withdraw offer,
    // and the UI drives the matching review from `kind`.
    if (action === "lnurl_pay_resolve") {
      const gate = lightningProviderGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;
      if (!input || typeof input !== "string" || !input.trim()) {
        return json(400, { error: LNURL_INPUT_REQUIRED });
      }
      const params = await resolveLnurlParams(input.trim());
      if (params.kind === "pay") {
        return json(200, {
          kind: "pay",
          domain: params.domain,
          callback_domain: params.callbackDomain,
          min_sats: params.minSats,
          max_sats: params.maxSats,
          fixed_amount_sats: params.fixedAmountSats,
          description: params.description,
          identifier: params.identifier,
          comment_allowed: params.commentAllowed,
        });
      }
      return json(200, {
        kind: "withdraw",
        domain: params.domain,
        callback_domain: params.callbackDomain,
        min_sats: params.minSats,
        max_sats: params.maxSats,
        fixed_amount_sats: params.fixedAmountSats,
        description: params.defaultDescription,
      });
    }

    // ── LNURL pay (LUD-06/16): resolve → callback bolt11 → pay ──
    // The callback URL is NEVER taken from the client: the endpoint
    // is re-resolved server-side from `input` on every call, the
    // amount is re-validated against its freshly fetched bounds,
    // and the issued invoice's decoded amount must equal the amount
    // the user reviewed — a mismatched invoice is never reserved.
    if (action === "lnurl_pay") {
      const gate = lightningProviderGate(LIGHTNING_PAYMENTS_NOT_CONFIGURED);
      if (gate) return gate;
      try {
        await assertAccountNotFrozen(admin, user.id);
      } catch (e) {
        const msg = thrownMessage(e, ACCOUNT_STATUS_UNVERIFIED_MESSAGE);
        if (msg === ACCOUNT_FROZEN_MESSAGE) return json(403, { error: msg });
        return json(503, { error: msg });
      }
      if (!input || typeof input !== "string" || !input.trim()) {
        return json(400, { error: LNURL_INPUT_REQUIRED });
      }
      if (!idempotency_key || typeof idempotency_key !== "string" || !idempotency_key.trim()) {
        return json(400, { error: "idempotency_key required" });
      }
      const params = await resolveLnurlParams(input.trim());
      if (params.kind !== "pay") {
        return json(400, { error: LNURL_NOT_A_PAY });
      }
      const requestedSats = amount_sats === undefined || amount_sats === null
        ? null
        : Number(amount_sats);
      const { amountSats, amountMsat } = validateLnurlPayAmount(
        params,
        requestedSats !== null && Number.isInteger(requestedSats) ? requestedSats : null,
      );
      const cleanComment = validateLnurlComment(
        params,
        typeof comment === "string" ? comment : null,
      );
      const { bolt11: lnurlBolt11 } = await fetchLnurlPayInvoice(params, amountMsat, cleanComment);

      // The issued invoice passes the SAME pre-reserve validation
      // as a pasted one (decode, hash, expiry, whole sats, limit)…
      const decoded = decodeSendInvoice(lnurlBolt11.trim());
      if ("refusal" in decoded) return decoded.refusal;
      const { details, sats } = decoded;
      // …plus the LNURL-specific one: it must be for the amount the
      // user reviewed and the endpoint was asked for.
      if (sats !== amountSats) {
        console.error("lightning-service: LNURL callback issued a mismatched amount", sats, amountSats);
        return json(400, { error: LNURL_AMOUNT_MISMATCH });
      }

      // Reserve-first, exactly as pay_invoice: the hold, the
      // provider pay, and settlement ONLY on the read-back.
      const { data: reserveRows, error: reserveErr } = await admin.rpc(
        "btc_reserve_lightning_send",
        {
          p_user_id: user.id,
          p_bolt11: lnurlBolt11.trim(),
          p_payment_hash: details.paymentHash,
          p_amount_sats: sats,
          p_idempotency_key: idempotency_key.trim(),
          p_max_daily_sats: MAX_DAILY_SATS,
        },
      );
      if (reserveErr) {
        const msg = thrownMessage(reserveErr, "");
        if (msg.includes("Insufficient BTC balance")) {
          return json(400, { error: "Insufficient BTC balance" });
        }
        if (msg.includes("Daily Lightning payment limit exceeded")) {
          return json(400, { error: "You've reached today's Lightning payment limit. Try again tomorrow." });
        }
        if (msg.includes("Idempotency key already used")) {
          return json(409, { error: "This payment request was already used. Start a new payment." });
        }
        throw reserveErr;
      }
      const reserve = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
      if (!reserve?.payment_id) throw new Error("btc_reserve_lightning_send returned no row");
      const paymentId = reserve.payment_id as string;

      if (reserve.replayed) {
        if (reserve.status === "paid") {
          return json(200, { status: "paid", paid_sats: sats, payment_id: paymentId });
        }
        if (reserve.status === "failed") {
          return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
        }
        return json(200, {
          status: "processing",
          payment_id: paymentId,
          message: PAYMENT_PROCESSING_MESSAGE,
        });
      }

      const payOutcome = await providerPayInvoice(lnurlBolt11.trim());
      if (payOutcome.kind === "rejected") {
        console.error("lightning-service: provider refused LNURL payment", paymentId, payOutcome.detail);
        const { error: relErr } = await admin.rpc("btc_release_lightning_send", {
          p_payment_id: paymentId,
          p_reason: "Provider refused the payment",
        });
        if (relErr) {
          console.error("CRITICAL: Lightning release after refusal failed", paymentId, relErr);
          return json(200, {
            status: "processing",
            payment_id: paymentId,
            message: PAYMENT_PROCESSING_MESSAGE,
          });
        }
        return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
      }
      if (payOutcome.kind === "unknown") {
        console.error("lightning-service: LNURL payment outcome unknown", paymentId, payOutcome.detail);
        return json(200, {
          status: "processing",
          payment_id: paymentId,
          message: PAYMENT_PROCESSING_MESSAGE,
        });
      }
      const resolution = await resolveOutboundSend(admin, {
        id: paymentId,
        bolt11: lnurlBolt11.trim(),
        payment_hash: details.paymentHash,
      });
      if (resolution === "paid") {
        return json(200, { status: "paid", paid_sats: sats, payment_id: paymentId });
      }
      if (resolution === "failed") {
        return json(200, { status: "failed", payment_id: paymentId, error: PAYMENT_REFUSED });
      }
      return json(200, {
        status: "processing",
        payment_id: paymentId,
        message: PAYMENT_PROCESSING_MESSAGE,
      });
    }

    // ── LNURL withdraw (LUD-03): resolve → create → submit ──
    // Receiving stays open on frozen accounts (same posture as
    // create_invoice): no freeze guard here. The invoice is created
    // through the provider create path and recorded as an inbound
    // lightning_payments row BEFORE the callback is called, so if
    // the service pays, check_status settles it exactly once —
    // including when the callback answer itself was lost.
    if (action === "lnurl_withdraw") {
      const gate = lightningProviderGate(LIGHTNING_DEPOSITS_NOT_CONFIGURED);
      if (gate) return gate;
      if (!input || typeof input !== "string" || !input.trim()) {
        return json(400, { error: LNURL_INPUT_REQUIRED });
      }
      const params = await resolveLnurlParams(input.trim());
      if (params.kind !== "withdraw") {
        return json(400, { error: LNURL_NOT_A_WITHDRAW });
      }
      const requestedSats = amount_sats === undefined || amount_sats === null
        ? null
        : Number(amount_sats);
      const { amountSats } = validateLnurlWithdrawAmount(
        params,
        requestedSats !== null && Number.isInteger(requestedSats) ? requestedSats : null,
      );
      if (amountSats > MAX_SATS) {
        return json(400, { error: `Amount exceeds the ${MAX_SATS} sat Lightning limit` });
      }

      const memo = (params.defaultDescription || `LNURL withdrawal from ${params.domain}`)
        .slice(0, 140);
      const invoice = await providerCreateInvoice(amountSats, memo);
      const msat = decodeBolt11Msat(invoice.bolt11);
      if (msat === null || msat !== BigInt(amountSats) * 1000n) {
        throw new LightningUpstreamError(
          "Lightning provider returned an invoice with a mismatched amount",
        );
      }
      const { data: payment, error } = await admin.from("lightning_payments").insert({
        user_id: user.id,
        direction: "inbound",
        amount_sats: amountSats,
        breez_invoice_id: invoice.providerId,
        bolt11: invoice.bolt11,
        payment_hash: invoice.paymentHash,
        status: "pending",
      }).select("id").single();
      if (error) throw error;

      try {
        await submitLnurlWithdraw(params, invoice.bolt11);
      } catch (e) {
        if (e instanceof LnurlUserError) {
          // The service definitively refused the invoice (its ERROR
          // answer). The inbound row stays pending — harmless, it
          // can only ever settle if the service pays it anyway.
          return json(400, { error: LNURL_WITHDRAW_REFUSED, payment_id: payment.id });
        }
        // Unknown submission outcome: the service may still pay the
        // invoice it was (perhaps) handed. Report it as submitted
        // and let check_status settle any arrival exactly once.
        console.error("lightning-service: LNURL withdraw submission outcome unknown", payment.id, thrownMessage(e, "unknown"));
        return json(200, {
          status: "submitted",
          payment_id: payment.id,
          amount_sats: amountSats,
          message: LNURL_WITHDRAW_SUBMITTED_MESSAGE,
        });
      }
      return json(200, {
        status: "submitted",
        payment_id: payment.id,
        amount_sats: amountSats,
        message: LNURL_WITHDRAW_SUBMITTED_MESSAGE,
      });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    if (e instanceof LnurlUserError) {
      // Crafted plain-language refusals from the LNURL layer (bad
      // input, out-of-bounds amount, the endpoint's own ERROR
      // answer): the message IS the user-facing copy.
      return json(400, { error: e.message });
    }
    if (e instanceof LnurlUpstreamError) {
      // The LNURL endpoint could not be reached or answered with
      // something unusable. Detail stays in the server log; the
      // caller gets the plain truth, never the raw endpoint text.
      console.error("lightning-service: LNURL endpoint unavailable:", e.message);
      return json(503, { error: LNURL_UNREACHABLE });
    }
    if (e instanceof LightningNotConfiguredError) {
      console.error("lightning-service: Lightning provider not configured");
      return json(503, { error: "Lightning is not available yet — it is not configured on this deployment." });
    }
    if (e instanceof LightningUpstreamError) {
      // The provider could not be reached or answered with an error.
      // Log the real cause server-side; the user gets the plain truth:
      // Lightning is not available on the custodial wallet yet. Never
      // leak the raw network/provider error (live-proven leak,
      // 2026-10-22: verbatim DNS failure text reached the API caller).
      console.error("lightning-service: Lightning provider unavailable:", e.message);
      return json(503, {
        error: currentAction === "pay_invoice"
          ? LIGHTNING_PAYMENTS_UNAVAILABLE
          : LIGHTNING_DEPOSITS_UNAVAILABLE,
      });
    }
    console.error("lightning-service error:", e);
    return json(500, { error: thrownMessage(e, "Lightning operation failed") });
  }
});
