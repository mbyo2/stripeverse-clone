// Server-side confirmation of PayPal wallet deposits (Deno).
//
// Used by:
//   - `paypal-deposit-capture` — the user return flow: the app sends
//     the buyer back to /wallet with the order id, the page invokes the
//     function, and this module settles the deposit.
//   - `paypal-webhook` — the backstop: CHECKOUT.ORDER.APPROVED /
//     PAYMENT.CAPTURE.COMPLETED events for a deposit order run the same
//     confirmation, so a buyer who never returns to the app still gets
//     credited.
//
// The webhook payload is only ever a TRIGGER here: the credit decision
// is made from PayPal's own API state (fetched with our credentials)
// verified against the pending row, and the credit itself happens
// inside the complete_wallet_deposit RPC (SECURITY DEFINER,
// service_role only) — row-locked and idempotent, so the return flow
// and the webhook can race and replay freely and the wallet is still
// credited exactly once.
//
// The client passed in MUST be a dedicated service-role client that
// does not forward any caller Authorization header: the
// protect_wallet_balance trigger silently neutralizes wallet balance
// UPDATEs made while a user JWT is in scope (the internal-transfer
// lesson). Pure decision logic lives in ./deposit-capture.ts.

import {
  extractCompletedCapture,
  paypalErrorTrace,
  paypalOrderStatus,
  planCancellation,
  planCompletion,
  verifyCapture,
  type CapturedPayment,
  type PendingDeposit,
} from "./deposit-capture.ts";

export interface DepositTransactionRow {
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

export type ConfirmDepositResult =
  | { kind: "not_found" }
  | { kind: "forbidden"; transactionId: string }
  | { kind: "not_configured" }
  | { kind: "not_pending"; transactionId: string; status: string }
  | { kind: "pending"; transactionId: string; paypalStatus: string }
  | { kind: "failed"; transactionId: string; paypalStatus: string; error: string }
  | { kind: "mismatch"; transactionId: string; reason: string }
  | {
      kind: "completed";
      transactionId: string;
      captureId: string;
      amount: number;
      currency: string;
      newBalance: number | null;
      alreadyCredited: boolean;
    };

// deno-lint-ignore no-explicit-any
type AdminClient = any;

function rowToPending(row: DepositTransactionRow): PendingDeposit {
  const captureId =
    (typeof row.metadata?.capture_id === "string" ? row.metadata.capture_id : null) ??
    row.external_reference;
  return { amount: Number(row.amount), currency: row.currency, status: row.status, captureId };
}

/** Find the wallet-deposit row recorded for a PayPal order id, if any. */
export async function findDepositTransaction(
  admin: AdminClient,
  orderId: string,
): Promise<DepositTransactionRow | null> {
  const { data, error } = await admin
    .from("transactions")
    .select(
      "uuid_id, user_id, wallet_id, amount, currency, status, reference, external_reference, metadata",
    )
    .eq("reference", orderId)
    .eq("payment_method", "paypal")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Deposit lookup failed: ${error.message}`);
  const rows = (data ?? []) as DepositTransactionRow[];
  return rows.find((r) => r.metadata?.kind === "wallet_deposit") ?? null;
}

async function walletBalance(admin: AdminClient, walletId: string | null): Promise<number | null> {
  if (!walletId) return null;
  const { data } = await admin.from("wallets").select("balance").eq("id", walletId).maybeSingle();
  return data ? Number(data.balance) : null;
}

/**
 * Confirm (and, when PayPal reports the order APPROVED, capture) the
 * deposit behind a PayPal order id, crediting its wallet exactly once.
 * `expectUserId` pins the deposit to a caller (return flow); the
 * webhook omits it.
 */
export async function confirmPayPalDeposit(
  admin: AdminClient,
  orderId: string,
  opts?: { expectUserId?: string },
): Promise<ConfirmDepositResult> {
  const row = await findDepositTransaction(admin, orderId);
  if (!row) return { kind: "not_found" };
  if (opts?.expectUserId && row.user_id !== opts.expectUserId) {
    return { kind: "forbidden", transactionId: row.uuid_id };
  }

  const pending = rowToPending(row);

  // Already settled: report the truth without touching PayPal or money.
  if (row.status === "completed") {
    return {
      kind: "completed",
      transactionId: row.uuid_id,
      captureId: pending.captureId ?? "",
      amount: Number(row.amount),
      currency: row.currency,
      newBalance: await walletBalance(admin, row.wallet_id),
      alreadyCredited: true,
    };
  }
  if (row.status !== "pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) return { kind: "not_configured" };

  let order = await fetchPayPalOrder(accessToken, orderId);
  if (!order) {
    return {
      kind: "failed",
      transactionId: row.uuid_id,
      paypalStatus: "unknown",
      error: "PayPal could not be reached to confirm this deposit. No money has moved.",
    };
  }

  let capture: CapturedPayment | null = extractCompletedCapture(order);
  let status = paypalOrderStatus(order) ?? "unknown";

  // Approved but not yet captured: capture it now. This is the step
  // that was missing platform-wide — orders were created and approved
  // and then simply never captured, so no deposit could ever settle.
  if (!capture && status === "APPROVED") {
    const captured = await capturePayPalOrder(accessToken, orderId);
    if (captured) {
      order = captured;
      capture = extractCompletedCapture(order);
      status = paypalOrderStatus(order) ?? status;
    } else {
      // Capture failed (or lost a race with the webhook): re-read the
      // order once — if it now shows a completed capture we can still
      // settle from PayPal's authoritative state.
      const reread = await fetchPayPalOrder(accessToken, orderId);
      if (reread) {
        order = reread;
        capture = extractCompletedCapture(order);
        status = paypalOrderStatus(order) ?? status;
      }
    }
  }

  if (!capture) {
    if (status === "VOIDED") {
      return {
        kind: "failed",
        transactionId: row.uuid_id,
        paypalStatus: status,
        error: "This PayPal order was voided before completion. No money was charged.",
      };
    }
    // CREATED / PAYER_ACTION_REQUIRED / APPROVED-without-capture /
    // COMPLETED-with-a-still-pending-capture: nothing creditable yet.
    return { kind: "pending", transactionId: row.uuid_id, paypalStatus: status };
  }

  const verification = verifyCapture(capture, pending);
  if (!verification.ok) {
    return { kind: "mismatch", transactionId: row.uuid_id, reason: verification.reason };
  }
  const plan = planCompletion(pending, capture.id);
  if (plan === "not_pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }
  if (plan === "conflict") {
    return { kind: "mismatch", transactionId: row.uuid_id, reason: "capture_conflict" };
  }

  // The RPC re-verifies amount + currency and performs the credit
  // atomically under the row lock — replay-safe by construction.
  const { data, error } = await admin.rpc("complete_wallet_deposit", {
    p_order_id: orderId,
    p_capture_id: capture.id,
    p_captured_amount: capture.amount,
    p_captured_currency: capture.currency,
  });
  if (error) throw new Error(`Deposit completion failed: ${error.message}`);

  const result = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; new_balance: number | null }
    | undefined;
  if (!result) throw new Error("Deposit completion returned no result");

  switch (result.outcome) {
    case "credited":
    case "already_completed":
      return {
        kind: "completed",
        transactionId: row.uuid_id,
        captureId: capture.id,
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
        paypalStatus: status,
        error: `Deposit could not be completed (${result.outcome}). No money has moved.`,
      };
  }
}

export type CancelDepositResult =
  | ConfirmDepositResult
  | {
      kind: "cancelled";
      transactionId: string;
      paypalStatus: string | null;
      alreadyCancelled: boolean;
    }
  | { kind: "unverified"; transactionId: string };

/**
 * Record a payer's cancellation of a PayPal wallet deposit (the
 * cancel-URL return). Before this, a cancelled deposit stayed
 * 'pending' forever and Recent Activity showed it "awaiting
 * confirmation" indefinitely.
 *
 * The flip is decided by planCancellation from PayPal's AUTHORITATIVE
 * order state — never from the return URL's say-so:
 *   - order never approved and no completed capture → the pending row
 *     flips to 'cancelled' (guarded UPDATE … WHERE status='pending',
 *     so a completion that lands first wins the race and is reported
 *     instead). Description and metadata record the cancellation so
 *     activity lists read truthfully.
 *   - order approved or captured → the result of the ordinary
 *     confirmation path, untouched: money the payer approved is
 *     captured and credited exactly once, never buried as
 *     "cancelled".
 *   - row already completed → reported, never modified.
 *   - PayPal unreachable / unconfigured → 'unverified': NO flip
 *     happens on an unverified claim; the row stays pending and the
 *     confirmation path remains the only thing that can settle it.
 */
export async function cancelPayPalDeposit(
  admin: AdminClient,
  orderId: string,
  opts?: { expectUserId?: string },
): Promise<CancelDepositResult> {
  const row = await findDepositTransaction(admin, orderId);
  if (!row) return { kind: "not_found" };
  if (opts?.expectUserId && row.user_id !== opts.expectUserId) {
    return { kind: "forbidden", transactionId: row.uuid_id };
  }

  if (row.status === "completed") {
    const pending = rowToPending(row);
    return {
      kind: "completed",
      transactionId: row.uuid_id,
      captureId: pending.captureId ?? "",
      amount: Number(row.amount),
      currency: row.currency,
      newBalance: await walletBalance(admin, row.wallet_id),
      alreadyCredited: true,
    };
  }
  if (row.status === "cancelled") {
    return {
      kind: "cancelled",
      transactionId: row.uuid_id,
      paypalStatus:
        typeof row.metadata?.paypal_status === "string" ? row.metadata.paypal_status : null,
      alreadyCancelled: true,
    };
  }
  if (row.status !== "pending") {
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) return { kind: "not_configured" };

  const order = await fetchPayPalOrder(accessToken, orderId);
  if (!order) return { kind: "unverified", transactionId: row.uuid_id };

  const orderStatus = paypalOrderStatus(order);
  const plan = planCancellation(row.status, {
    orderStatus,
    hasCompletedCapture: extractCompletedCapture(order) !== null,
  });

  if (plan === "confirm_instead") {
    // Money is in flight at PayPal: the confirmation path governs.
    return confirmPayPalDeposit(admin, orderId, opts);
  }
  if (plan !== "mark_cancelled") {
    // Unreachable given the status checks above (the plan for a
    // pending row with a fetched order is mark_cancelled or
    // confirm_instead) — fail closed to the row's current truth.
    return { kind: "not_pending", transactionId: row.uuid_id, status: row.status };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("transactions")
    .update({
      status: "cancelled",
      description: "Wallet deposit via PayPal (cancelled)",
      metadata: {
        ...(row.metadata ?? {}),
        payer_cancelled: true,
        cancelled_at: nowIso,
        cancel_reason: "payer_cancelled_at_paypal",
        paypal_status: orderStatus,
      },
      updated_at: nowIso,
    })
    .eq("uuid_id", row.uuid_id)
    .eq("status", "pending")
    .select("uuid_id");
  if (error) throw new Error(`Deposit cancellation failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    // Lost the race: the row settled (or was cancelled) between the
    // read and the guarded update. Report its fresh truth.
    const fresh = await findDepositTransaction(admin, orderId);
    if (fresh?.status === "completed") {
      const pending = rowToPending(fresh);
      return {
        kind: "completed",
        transactionId: fresh.uuid_id,
        captureId: pending.captureId ?? "",
        amount: Number(fresh.amount),
        currency: fresh.currency,
        newBalance: await walletBalance(admin, fresh.wallet_id),
        alreadyCredited: true,
      };
    }
    if (fresh?.status === "cancelled") {
      return {
        kind: "cancelled",
        transactionId: fresh.uuid_id,
        paypalStatus: orderStatus,
        alreadyCancelled: true,
      };
    }
    return {
      kind: "not_pending",
      transactionId: row.uuid_id,
      status: fresh?.status ?? "unknown",
    };
  }

  return {
    kind: "cancelled",
    transactionId: row.uuid_id,
    paypalStatus: orderStatus,
    alreadyCancelled: false,
  };
}

// ── PayPal REST (mirrors wallet-deposit / paypal-checkout patterns) ────

export function paypalBaseUrl(): string {
  return Deno.env.get("PAYPAL_ENV") === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// OAuth token caching (audit D7, 2026-10-26): every PayPal caller
// used to fetch a fresh client-credentials token per operation —
// five separate implementations across the functions, each an extra
// round-trip and a needless load on PayPal's token endpoint. This
// shared getter caches the token in the function isolate until
// shortly before PayPal's stated expiry; all PayPal functions now
// route through it (the legacy per-function copies are deleted).
let cachedToken: { value: string; expiresAtMs: number } | null = null;

export async function getPayPalAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now()) {
    return cachedToken.value;
  }
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
    const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) return null;
    const data = await response.json();
    const token = data.access_token ?? null;
    if (token) {
      const expiresInSec = Number(data.expires_in);
      const ttlMs = Number.isFinite(expiresInSec) && expiresInSec > 120
        ? (expiresInSec - 60) * 1000
        : 300_000;
      cachedToken = { value: token, expiresAtMs: Date.now() + ttlMs };
    }
    return token;
  } catch (e) {
    console.error("PayPal token error:", e);
    return null;
  }
}

export async function fetchPayPalOrder(
  accessToken: string,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("PayPal order fetch error:", e);
    return null;
  }
}

/**
 * Capture an approved order. Returns the capture response (an order
 * payload) or null. The PayPal-Request-Id makes the capture itself
 * idempotent at PayPal: a retried capture for the same order replays
 * instead of double-charging.
 */
export async function capturePayPalOrder(
  accessToken: string,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": `wallet-deposit-capture-${orderId}`,
      },
    });
    if (!response.ok) {
      // Trace fields only (audit L1) — never the raw error body.
      console.error("PayPal capture failed:", paypalErrorTrace(response.status, await response.text()));
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error("PayPal capture error:", e);
    return null;
  }
}

// ── Capture / refund re-queries (audit D2) ───────────────────────
// The reversal webhook cases decide from PayPal's authoritative
// state, never from the event payload: these two reads are that
// state (GET /v2/payments/captures/{id} and /refunds/{id}).

export async function fetchPayPalCapture(
  accessToken: string,
  captureId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v2/payments/captures/${captureId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("PayPal capture fetch error:", e);
    return null;
  }
}

export async function fetchPayPalRefund(
  accessToken: string,
  refundId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${paypalBaseUrl()}/v2/payments/refunds/${refundId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("PayPal refund fetch error:", e);
    return null;
  }
}
