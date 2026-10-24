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
  stripeErrorTrace,
  verifyStripeSession,
  planStripeSettlement,
  type StripeApiErrorLike,
  type StripeSessionLike,
  type PendingStripeDeposit,
} from "./stripe-gateway.ts";

// Pinned API version — the same pin the subscription checkout uses
// (create-checkout, stripe@14.21.0 defaults), so both Stripe
// integrations in this repo speak one API dialect.
const STRIPE_API_VERSION = "2024-06-20";
const STRIPE_API_BASE = "https://api.stripe.com/v1";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface StripeApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: StripeApiErrorLike | null;
}

async function stripeRequest<T>(
  secretKey: string,
  method: string,
  path: string,
  opts?: { form?: Record<string, string>; idempotencyKey?: string },
): Promise<StripeApiResult<T>> {
  try {
    const response = await fetch(`${STRIPE_API_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(opts?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: opts?.form ? new URLSearchParams(opts.form).toString() : undefined,
    });
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
      return { ok: false, status: response.status, data: null, error };
    }
    return { ok: true, status: response.status, data: JSON.parse(text) as T, error: null };
  } catch (e) {
    console.error("Stripe API request failed:", e instanceof Error ? e.message : String(e));
    return { ok: false, status: 0, data: null, error: null };
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
  const session = queried.data;

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

  const verification = verifyStripeSession(session, pending);
  if (!verification.ok) {
    // A genuinely unpaid session (async method still clearing) is
    // patience, not an error: async_payment_succeeded will re-drive
    // settlement when the money lands.
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
 */
export async function closeStripeDeposit(
  admin: AdminClient,
  sessionId: string,
  reason: string,
): Promise<"closed" | "not_found" | "not_pending"> {
  const { data, error } = await admin
    .from("transactions")
    .select(ROW_COLUMNS)
    .eq("reference", sessionId)
    .eq("payment_method", "stripe")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Stripe deposit lookup failed: ${error.message}`);
  const row = ((data ?? []) as StripeDepositRow[]).find(
    (r) => r.metadata?.kind === "wallet_deposit",
  );
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
