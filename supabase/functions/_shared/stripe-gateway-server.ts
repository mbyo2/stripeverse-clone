// Server-side Stripe gateway operations (Deno) for the wallet top-up
// rail — the Stripe mirror of _shared/paypal-deposit.ts.
//
// Used by:
//   - `stripe-gateway-checkout` — creates the Checkout Session
//     (createStripeCheckoutSession below).
//   - `stripe-gateway-webhook` — settles deposits from webhook hints
//     (settleStripeDeposit), closes unsettled rows on expiry/failure
//     (closeStripeDeposit) and flags refunds (flagStripeRefund).
//
// The webhook payload is only ever a TRIGGER here: the credit
// decision is made from Stripe's own API state (the session,
// re-queried with our secret key) verified against the pending
// ledger row, and the credit itself happens inside the
// complete_stripe_wallet_deposit RPC (SECURITY DEFINER, service_role
// only) — row-locked and idempotent, so duplicate, reordered or
// replayed webhooks still credit the wallet exactly once.
//
// The client passed in MUST be a dedicated service-role client that
// does not forward any caller Authorization header (the
// protect_wallet_balance lesson). Pure decision logic lives in
// ./stripe-gateway.ts.

import {
  fromMinorUnits,
  shouldRetryStripeRequest,
  STRIPE_API_VERSION,
  stripeErrorTrace,
  stripeRetryDelayMs,
  verifyStripeSession,
  planStripeSettlement,
  type StripeApiErrorLike,
  type StripeSessionLike,
  type PendingStripeDeposit,
} from "./stripe-gateway.ts";

// The API version pin lives in ./stripe-gateway.ts (STRIPE_API_VERSION
// = "2023-10-16") — the same version the subscription functions
// (create-checkout, customer-portal) pin through stripe@14.21.0, so
// every Stripe call in this repo speaks one API dialect (audit fix
// D3, 2026-10-26 — an earlier comment here claimed a 2024-06-20 pin
// was "the same pin"; it was not).
const STRIPE_API_BASE = "https://api.stripe.com/v1";

/** Per-attempt HTTP timeout for Stripe API calls (audit fix D7). */
const STRIPE_REQUEST_TIMEOUT_MS = 15_000;

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface StripeApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: StripeApiErrorLike | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One logical Stripe API call, with an HTTP-layer timeout and safe
 * retries (audit fix D7, 2026-10-26). Previously a hung connection
 * could stall an invocation indefinitely and a transient 429/5xx
 * failed the call outright. The retry decision itself is the pure
 * shouldRetryStripeRequest: transient statuses only, bounded
 * attempts, and POSTs only with an Idempotency-Key (every POST this
 * rail makes carries one, so a retry replays rather than duplicates).
 */
async function stripeRequest<T>(
  secretKey: string,
  method: string,
  path: string,
  opts?: { form?: Record<string, string>; idempotencyKey?: string },
): Promise<StripeApiResult<T>> {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT_MS);
    let status = 0;
    let retryAfterSeconds: number | null = null;
    try {
      const response = await fetch(`${STRIPE_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
          ...(opts?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
        },
        body: opts?.form ? new URLSearchParams(opts.form).toString() : undefined,
      });
      status = response.status;
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const parsed = Number(retryAfter);
        if (Number.isFinite(parsed)) retryAfterSeconds = parsed;
      }
      const text = await response.text();
      if (!response.ok) {
        // Trace fields only (audit L1) — never the raw error body.
        console.error("Stripe API error:", stripeErrorTrace(response.status, text));
        let error: StripeApiErrorLike | null = null;
        try {
          error = (JSON.parse(text) as { error?: StripeApiErrorLike }).error ?? null;
        } catch {
          error = null;
        }
        const failure: StripeApiResult<T> = { ok: false, status: response.status, data: null, error };
        if (
          !shouldRetryStripeRequest({
            attempt,
            status: response.status,
            method,
            hasIdempotencyKey: !!opts?.idempotencyKey,
          })
        ) {
          return failure;
        }
        // else fall through to the retry wait below
      } else {
        return { ok: true, status: response.status, data: JSON.parse(text) as T, error: null };
      }
    } catch (e) {
      // Network failure or our own timeout abort — status 0.
      status = 0;
      console.error("Stripe API request failed:", e instanceof Error ? e.message : String(e));
      if (
        !shouldRetryStripeRequest({
          attempt,
          status,
          method,
          hasIdempotencyKey: !!opts?.idempotencyKey,
        })
      ) {
        return { ok: false, status: 0, data: null, error: null };
      }
    } finally {
      clearTimeout(timer);
    }
    const delayMs = stripeRetryDelayMs(attempt, retryAfterSeconds);
    console.error(`Stripe API retry: attempt ${attempt} failed (status ${status}); retrying in ${delayMs}ms`);
    await sleep(delayMs);
  }
}

/** Create a Checkout Session. `idempotencyKey` MUST be the ledger id. */
export function createStripeCheckoutSession(
  secretKey: string,
  form: Record<string, string>,
  idempotencyKey: string,
): Promise<StripeApiResult<StripeSessionLike & { url?: string | null }>> {
  return stripeRequest(secretKey, "POST", "/checkout/sessions", { form, idempotencyKey });
}

/** Re-query a Checkout Session — the only state settlement trusts. */
export function retrieveStripeSession(
  secretKey: string,
  sessionId: string,
): Promise<StripeApiResult<StripeSessionLike>> {
  return stripeRequest(secretKey, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export interface StripeRefundLike {
  id: string;
  status?: string | null;
  payment_intent?: string | null;
  charge?: string | null;
  amount?: number | null;
  currency?: string | null;
}

/**
 * Create a refund via POST /v1/refunds. `idempotencyKey` MUST be
 * `refund:<ledger uuid>` (stripeRefundIdempotencyKey) so a retried
 * admin action can never create a second refund for one deposit.
 * The form is built by the pure buildStripeRefundParams.
 */
export function createStripeRefund(
  secretKey: string,
  form: Record<string, string>,
  idempotencyKey: string,
): Promise<StripeApiResult<StripeRefundLike>> {
  return stripeRequest(secretKey, "POST", "/refunds", { form, idempotencyKey });
}

// ── Ledger rows ──────────────────────────────────────────────────────

export interface StripeDepositRow {
  uuid_id: string;
  user_id: string | null;
  wallet_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
}

function rowToPending(row: StripeDepositRow): PendingStripeDeposit {
  return {
    id: row.uuid_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    sessionId: row.reference ?? row.external_reference,
  };
}

const ROW_COLUMNS =
  "uuid_id, user_id, wallet_id, amount, currency, status, reference, external_reference, metadata";

/**
 * Find the wallet-deposit ledger row behind a Checkout Session:
 * primarily by the recorded session reference; defensively by the
 * session's client_reference_id (= our ledger uuid) for the narrow
 * window where the session exists but the checkout function has not
 * yet written the reference back — in which case the reference is
 * back-filled here so the RPC's strict lookup succeeds.
 */
export async function findStripeDepositTransaction(
  admin: AdminClient,
  session: StripeSessionLike,
): Promise<StripeDepositRow | null> {
  const { data, error } = await admin
    .from("transactions")
    .select(ROW_COLUMNS)
    .eq("reference", session.id)
    .eq("payment_method", "stripe")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Stripe deposit lookup failed: ${error.message}`);
  const rows = ((data ?? []) as StripeDepositRow[]).filter(
    (r) => r.metadata?.kind === "wallet_deposit",
  );
  if (rows.length > 0) return rows[0];

  const ledgerId = session.client_reference_id ?? session.metadata?.ledger_id;
  if (!ledgerId) return null;
  const { data: byId, error: byIdError } = await admin
    .from("transactions")
    .select(ROW_COLUMNS)
    .eq("uuid_id", ledgerId)
    .eq("payment_method", "stripe")
    .maybeSingle();
  if (byIdError) throw new Error(`Stripe deposit lookup failed: ${byIdError.message}`);
  const row = byId as StripeDepositRow | null;
  if (!row || row.metadata?.kind !== "wallet_deposit") return null;
  if (!row.reference) {
    await admin
      .from("transactions")
      .update({ reference: session.id })
      .eq("uuid_id", row.uuid_id)
      .is("reference", null);
    row.reference = session.id;
  }
  return row;
}

// ── Settlement ───────────────────────────────────────────────────────

export type SettleStripeResult =
  | { kind: "not_found" }
  | { kind: "not_configured" }
  | { kind: "not_pending"; transactionId: string; status: string }
  | { kind: "pending"; transactionId: string; reason: string }
  | { kind: "mismatch"; transactionId: string; reason: string }
  | { kind: "failed"; transactionId: string; error: string }
  | {
      kind: "completed";
      transactionId: string;
      sessionId: string;
      amount: number;
      currency: string;
      newBalance: number | null;
      alreadyCredited: boolean;
    };

/**
 * Settle the deposit behind a Checkout Session id: re-query the
 * session from Stripe, verify it against the ledger row, and credit
 * via complete_stripe_wallet_deposit. Safe under webhook replays and
 * reordering — every path that does not end in a verified 'paid'
 * session credits nothing.
 */
export async function settleStripeDeposit(
  admin: AdminClient,
  secretKey: string | null,
  sessionId: string,
): Promise<SettleStripeResult> {
  if (!secretKey) return { kind: "not_configured" };

  const queried = await retrieveStripeSession(secretKey, sessionId);
  if (!queried.ok || !queried.data) {
    return {
      kind: "failed",
      transactionId: "",
      error: "Stripe could not be reached to confirm this deposit. No money has moved.",
    };
  }
  let session = queried.data;

  const row = await findStripeDepositTransaction(admin, session);
  if (!row) return { kind: "not_found" };

  const pending = rowToPending(row);

  // Already settled: report the truth without touching money.
  if (row.status === "completed") {
    const plan = planStripeSettlement(pending, sessionId);
    if (plan === "already_completed") {
      const { data: wallet } = await admin
        .from("wallets")
        .select("balance")
        .eq("id", row.wallet_id)
        .maybeSingle();
      return {
        kind: "completed",
        transactionId: row.uuid_id,
        sessionId,
        amount: Number(row.amount),
        currency: row.currency,
        newBalance: wallet ? Number(wallet.balance) : null,
        alreadyCredited: true,
      };
    }
    return { kind: "mismatch", transactionId: row.uuid_id, reason: "session_conflict" };
  }
  if (row.status !== "pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }

  let verification = verifyStripeSession(session, pending);
  // A card payment can still be in `processing` when
  // checkout.session.completed fires, and Stripe does not promise an
  // async_payment_succeeded follow-up for every such case — so
  // settlement must not rest on that single event (audit fix D8,
  // 2026-10-26). Re-poll the session briefly here; if it is STILL
  // unpaid, the webhook answers non-2xx so Stripe's own retry
  // schedule re-drives settlement, with async_payment_succeeded kept
  // as a third driver rather than the only one.
  for (
    let poll = 0;
    !verification.ok && verification.reason === "not_paid" && poll < 2;
    poll++
  ) {
    await sleep(1500);
    const reQueried = await retrieveStripeSession(secretKey, sessionId);
    if (!reQueried.ok || !reQueried.data) break;
    session = reQueried.data;
    verification = verifyStripeSession(session, pending);
  }
  if (!verification.ok) {
    // A genuinely unpaid session is patience, not an error — but it
    // is not acked either (see the webhook's handling of "pending").
    if (verification.reason === "not_paid") {
      return { kind: "pending", transactionId: row.uuid_id, reason: verification.reason };
    }
    return { kind: "mismatch", transactionId: row.uuid_id, reason: verification.reason };
  }

  // The RPC re-verifies amount + currency and performs the credit
  // atomically under the row lock — replay-safe by construction. It
  // receives the SESSION's re-queried values (never the row's own),
  // so its comparison is a genuine second check.
  const { data, error } = await admin.rpc("complete_stripe_wallet_deposit", {
    p_session_id: sessionId,
    p_payment_intent_id: verification.paymentIntentId,
    p_paid_amount: fromMinorUnits(session.amount_total as number),
    p_paid_currency: (session.currency as string).toUpperCase(),
  });
  if (error) throw new Error(`Stripe deposit completion failed: ${error.message}`);

  const result = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; new_balance: number | null }
    | undefined;
  if (!result) throw new Error("Stripe deposit completion returned no result");

  switch (result.outcome) {
    case "credited":
    case "already_completed":
      return {
        kind: "completed",
        transactionId: row.uuid_id,
        sessionId,
        amount: Number(row.amount),
        currency: row.currency,
        newBalance: result.new_balance !== null ? Number(result.new_balance) : null,
        alreadyCredited: result.outcome === "already_completed",
      };
    case "amount_mismatch":
    case "currency_mismatch":
    case "conflict":
      return { kind: "mismatch", transactionId: row.uuid_id, reason: result.outcome };
    case "not_pending":
      return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
    case "not_found":
      return { kind: "not_found" };
    default:
      return {
        kind: "failed",
        transactionId: row.uuid_id,
        error: `Deposit could not be completed (${result.outcome}). No money has moved.`,
      };
  }
}

/**
 * Close a still-pending deposit WITHOUT crediting (session expired
 * or an async payment failed). Only a 'pending' row transitions —
 * a completed row is never rewritten by a late failure event, which
 * is what makes out-of-order delivery safe.
 *
 * Row lookup has the same parity as the settlement path
 * (findStripeDepositTransaction, audit fix D5, 2026-10-26): first by
 * the recorded session reference, then — for the window where the
 * session exists but the checkout function has not yet written the
 * reference back — by the session's client_reference_id (our ledger
 * uuid), back-filling the reference. A row bound to a DIFFERENT
 * session is never closed.
 */
export async function closeStripeDeposit(
  admin: AdminClient,
  session: { id: string; clientReferenceId?: string | null },
  reason: string,
): Promise<"closed" | "not_found" | "not_pending"> {
  const { data, error } = await admin
    .from("transactions")
    .select(ROW_COLUMNS)
    .eq("reference", session.id)
    .eq("payment_method", "stripe")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Stripe deposit lookup failed: ${error.message}`);
  let row = ((data ?? []) as StripeDepositRow[]).find(
    (r) => r.metadata?.kind === "wallet_deposit",
  );
  if (!row && session.clientReferenceId) {
    const { data: byId, error: byIdError } = await admin
      .from("transactions")
      .select(ROW_COLUMNS)
      .eq("uuid_id", session.clientReferenceId)
      .eq("payment_method", "stripe")
      .maybeSingle();
    if (byIdError) throw new Error(`Stripe deposit lookup failed: ${byIdError.message}`);
    const candidate = byId as StripeDepositRow | null;
    if (
      candidate &&
      candidate.metadata?.kind === "wallet_deposit" &&
      (!candidate.reference || candidate.reference === session.id)
    ) {
      row = candidate;
      if (!row.reference) {
        await admin
          .from("transactions")
          .update({ reference: session.id })
          .eq("uuid_id", row.uuid_id)
          .is("reference", null);
        row.reference = session.id;
      }
    }
  }
  if (!row) return "not_found";
  if (row.status !== "pending") return "not_pending";
  const { error: updateError } = await admin
    .from("transactions")
    .update({
      status: "failed",
      metadata: {
        ...(row.metadata ?? {}),
        closed_reason: reason,
        closed_at: new Date().toISOString(),
      },
    })
    .eq("uuid_id", row.uuid_id)
    .eq("status", "pending");
  if (updateError) throw new Error(`Stripe deposit close failed: ${updateError.message}`);
  return "closed";
}

/**
 * Flag a refunded charge on its settled deposit row for ops
 * reconciliation (brief §3.1: refunds surface via charge.refunded;
 * they are NEVER auto-debited — a card top-up refund is an ops
 * decision, and the wallet may already have spent the money).
 * Returns true when a settled deposit row was flagged.
 */
export async function flagStripeRefund(
  admin: AdminClient,
  paymentIntentId: string,
  chargeId: string | null,
): Promise<boolean> {
  // Best-effort by design: the refund itself is Stripe's record and
  // the ops decision; this flag only saves the admin a lookup. Any
  // failure is logged and reported as "not flagged" — never thrown,
  // so the webhook still acks and Stripe does not retry an event
  // that can change nothing about money.
  try {
    const { data, error } = await admin
      .from("transactions")
      .select(ROW_COLUMNS)
      .eq("payment_method", "stripe")
      .eq("metadata->>payment_intent_id", paymentIntentId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Stripe refund lookup failed:", error.message);
      return false;
    }
    const row = ((data ?? []) as StripeDepositRow[]).find(
      (r) => r.metadata?.kind === "wallet_deposit" && r.status === "completed",
    );
    if (!row) return false;
    const { error: updateError } = await admin
      .from("transactions")
      .update({
        metadata: {
          ...(row.metadata ?? {}),
          refund_flagged_at: new Date().toISOString(),
          refund_charge_id: chargeId,
        },
      })
      .eq("uuid_id", row.uuid_id);
    if (updateError) {
      console.error("Stripe refund flag failed:", updateError.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Stripe refund flag failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}
