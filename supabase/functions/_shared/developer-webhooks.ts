// Developer webhook machinery — shared by the developer-api edge
// function (transfers / link creation / test pings) and the
// payment-link-checkout function (payment_link.paid on settlement).
//
// One implementation, deliberately free of Deno-specific APIs (only
// WebCrypto / fetch / AbortSignal, all present in Node ≥ 19 too) so
// the vitest suite can exercise the exact code the edge functions run.
//
// Delivery contract (unchanged since the developer API shipped):
//   - Subscriptions live in public.developer_webhooks; an endpoint
//     receives an event when its `events` list is empty (legacy: all
//     events) or names the event type.
//   - Every delivery is HMAC-SHA256 signed over the exact request body
//     (header X-BMaGlass-Signature: sha256=<hex>), with companion
//     headers X-BMaGlass-Event and X-BMaGlass-Delivery.
//   - Every attempt is logged in public.developer_webhook_deliveries.
//   - A single attempt per event today (no retry schedule) — callers
//     must treat dispatch as best-effort and NEVER let it fail the
//     money path that triggered it.
//
// payment_link.paid exactly-once: settlement of a payment link is
// anchored to the owner-side ledger row the settlement RPC creates
// (transactions.uuid_id, stable across idempotent replays of the same
// settlement). dispatchPaymentLinkPaid claims that anchor in
// public.payment_link_paid_dispatches (PRIMARY KEY) before sending —
// only the first caller across any number of retries, replays or
// duplicate checkout invocations dispatches; everyone else is a no-op.

export const KNOWN_DEVELOPER_EVENTS = [
  "transaction.completed",
  "payment_link.created",
  "payment_link.paid",
  "webhook.test",
];

export async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
type Db = any;

export interface WebhookDispatchResult {
  webhook_id: string;
  delivery_id: string | null;
  status: string;
  response_status: number | null;
}

/** Sign + deliver one event to every subscribed active endpoint of the
 *  account, logging each attempt. Mirrors the behaviour the
 *  developer-api shipped with; never throws for a failed delivery
 *  (a dead endpoint is a logged "failed" row, not an exception). */
export async function dispatchEvent(
  db: Db,
  userId: string,
  eventType: string,
  // deno-lint-ignore no-explicit-any
  data: any,
): Promise<WebhookDispatchResult[]> {
  const { data: hooks } = await db.from("developer_webhooks")
    .select("*").eq("user_id", userId).eq("is_active", true);
  const results: WebhookDispatchResult[] = [];
  for (const hook of hooks ?? []) {
    if (Array.isArray(hook.events) && hook.events.length > 0 && !hook.events.includes(eventType)) continue;
    const event = {
      id: `evt_${crypto.randomUUID()}`,
      type: eventType,
      created: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(event);
    const signature = "sha256=" + (await hmacHex(hook.secret, body));
    let status = "failed";
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BMaGlass-Signature": signature,
          "X-BMaGlass-Event": eventType,
          "X-BMaGlass-Delivery": event.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      responseStatus = res.status;
      await res.text().catch(() => "");
      status = res.ok ? "delivered" : "failed";
      if (!res.ok) errorMessage = `HTTP ${res.status}`;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "network error";
    }
    const { data: logRow } = await db.from("developer_webhook_deliveries").insert({
      webhook_id: hook.id, user_id: userId, event_id: event.id, event_type: eventType,
      webhook_url: hook.url, payload: event, status, attempts: 1,
      response_status: responseStatus, error_message: errorMessage,
    }).select("id").single();
    results.push({ webhook_id: hook.id, delivery_id: logRow?.id ?? null, status, response_status: responseStatus });
  }
  return results;
}

export interface PaymentLinkPaidSettlement {
  /** Owner-side ledger row (transactions.uuid_id) created by the
   *  settlement — the exactly-once anchor. */
  ownerTransactionId: string;
  /** Payer-side ledger row, when the payer has one (wallet payments). */
  payerTransactionId?: string | null;
  /** The link's price — what the payment was FOR. */
  amount: number;
  currency: string;
  paymentMethod: string;
  /** Who bore the platform fee: the link's stored choice, enforced
   *  server-side at settlement (seller | buyer). */
  feePayer: string;
  /** The platform fee the settlement actually took. */
  feeAmount: number;
  /** What the buyer actually paid in total: the price when the
   *  seller bore the fee, price + fee when the buyer did. Lets a
   *  shop connector reconcile the buyer's paid total against its
   *  order total (+ the fee it added at checkout, where it did). */
  totalCharged: number;
  /** ISO timestamp of the settlement. */
  settledAt: string;
}

export interface PaymentLinkPaidLink {
  id: string;
  link_code: string;
  title: string;
  user_id: string;
  payment_count?: number | null;
  total_collected?: number | string | null;
  // deno-lint-ignore no-explicit-any
  metadata?: Record<string, any> | null;
}

export interface PaymentLinkPaidOutcome {
  dispatched: boolean;
  /** True when this call lost the claim (a previous call already
   *  dispatched for this settlement) — the expected replay outcome. */
  alreadyDispatched: boolean;
  deliveries: WebhookDispatchResult[];
}

/**
 * Emit `payment_link.paid` for one settled payment link — exactly once
 * per settlement, however many times the settlement is replayed.
 *
 * The payload `data` mirrors payment_link.created's link fields and
 * adds the settlement facts a shop connector needs to complete an
 * order immediately: the link's public code (order identity is the
 * merchant's link ↔ order mapping), the amount and currency, the
 * fee truth (fee_payer, fee_amount, and total_charged — what the
 * buyer actually paid), the owner-side transaction id, and the
 * link's merchant-supplied `reference`/`metadata` when present.
 */
export async function dispatchPaymentLinkPaid(
  db: Db,
  link: PaymentLinkPaidLink,
  settlement: PaymentLinkPaidSettlement,
): Promise<PaymentLinkPaidOutcome> {
  // ── Exactly-once claim ──────────────────────────────────────────
  // INSERT against the PRIMARY KEY anchor; a conflict (Postgres
  // 23505, surfaced by PostgREST in error.code) means this settlement
  // was already dispatched — by an earlier invocation, a retry, or an
  // idempotent replay of the settlement itself.
  const { error: claimError } = await db
    .from("payment_link_paid_dispatches")
    .insert({
      owner_transaction_id: settlement.ownerTransactionId,
      link_id: link.id,
      user_id: link.user_id,
    });
  if (claimError) {
    if ((claimError as { code?: string }).code === "23505") {
      return { dispatched: false, alreadyDispatched: true, deliveries: [] };
    }
    throw new Error(`payment_link.paid claim failed: ${claimError.message ?? claimError}`);
  }

  const reference =
    link.metadata && typeof link.metadata.reference === "string"
      ? link.metadata.reference
      : null;
  const data = {
    payment_link_id: link.id,
    link_code: link.link_code,
    title: link.title,
    amount: settlement.amount,
    currency: settlement.currency,
    fee_payer: settlement.feePayer,
    fee_amount: settlement.feeAmount,
    total_charged: settlement.totalCharged,
    transaction_id: settlement.ownerTransactionId,
    payer_transaction_id: settlement.payerTransactionId ?? null,
    payment_method: settlement.paymentMethod,
    payment_count: link.payment_count != null ? Number(link.payment_count) : null,
    total_collected: link.total_collected != null ? Number(link.total_collected) : null,
    reference,
    metadata: link.metadata ?? null,
    settled_at: settlement.settledAt,
  };

  try {
    const deliveries = await dispatchEvent(db, link.user_id, "payment_link.paid", data);
    return { dispatched: true, alreadyDispatched: false, deliveries };
  } catch (e) {
    // Dispatch blew up before any delivery row was written (e.g. the
    // subscriptions read failed). Release the claim so a later
    // invocation of the same settlement can retry the event, then
    // propagate — the caller decides whether to swallow (the checkout
    // does: money already moved; the event is best-effort there).
    await db.from("payment_link_paid_dispatches")
      .delete().eq("owner_transaction_id", settlement.ownerTransactionId)
      .then(() => {}, () => {});
    throw e;
  }
}
