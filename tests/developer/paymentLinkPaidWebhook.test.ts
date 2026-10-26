// payment_link.paid webhook tests (2026-10-26).
//
// Exercises the EXACT dispatcher the edge functions run
// (supabase/functions/_shared/developer-webhooks.ts) against an
// in-memory stand-in for the three tables it touches, with fetch
// stubbed. Pins: the event fires on settlement, the payload carries
// the order identity a connector needs, the HMAC signature verifies,
// subscription filtering matches the developer-api contract, and —
// the point of the feature — a replayed settlement NEVER produces a
// second event (exactly-once, anchored on the owner transaction id).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  dispatchPaymentLinkPaid,
  KNOWN_DEVELOPER_EVENTS,
} from "../../supabase/functions/_shared/developer-webhooks";

// ── In-memory PostgREST stand-in ─────────────────────────────────────
// Implements just the builder surface the dispatcher uses:
//   from(t).select().eq().eq()          → { data }
//   from(t).insert(row)                 → { error }   (23505 on PK clash)
//   from(t).insert(row).select().single() → { data: { id } }
//   from(t).delete().eq()               → { error: null }
class Builder {
  private op = "";
  private payload: any = null;
  private filters: [string, unknown][] = [];
  private singleFlag = false;
  constructor(private state: any, private table: string) {}
  select() { if (!this.op) this.op = "select"; return this; }
  insert(row: any) { this.op = "insert"; this.payload = row; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  single() { this.singleFlag = true; return this; }
  then(resolve: (v: any) => void, reject: (e: unknown) => void) {
    try { resolve(this.execute()); } catch (e) { reject(e); }
  }
  private execute() {
    const s = this.state;
    if (this.table === "developer_webhooks" && this.op === "select") {
      let rows = [...s.hooks];
      for (const [k, v] of this.filters) rows = rows.filter((r: any) => r[k] === v);
      return { data: rows, error: null };
    }
    if (this.table === "developer_webhook_deliveries" && this.op === "insert") {
      const row = { id: `del_${s.deliveries.length + 1}`, ...this.payload };
      s.deliveries.push(row);
      return this.singleFlag ? { data: { id: row.id }, error: null } : { data: null, error: null };
    }
    if (this.table === "payment_link_paid_dispatches" && this.op === "insert") {
      if (s.claims.has(this.payload.owner_transaction_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      s.claims.add(this.payload.owner_transaction_id);
      return { data: null, error: null };
    }
    if (this.table === "payment_link_paid_dispatches" && this.op === "delete") {
      for (const [k, v] of this.filters) if (k === "owner_transaction_id") s.claims.delete(v);
      return { data: null, error: null };
    }
    throw new Error(`FakeDb: unhandled ${this.op} on ${this.table}`);
  }
}

const OWNER = "11111111-1111-1111-1111-111111111111";
const LINK = {
  id: "22222222-2222-2222-2222-222222222222",
  link_code: "9f8e7d6c5b4a3210",
  title: "Order #1042",
  user_id: OWNER,
  payment_count: 1,
  total_collected: 5,
  metadata: { reference: "WC-1042", source: "woocommerce" },
};
const SETTLEMENT = {
  ownerTransactionId: "33333333-3333-3333-3333-333333333333",
  payerTransactionId: "44444444-4444-4444-4444-444444444444",
  amount: 5,
  currency: "ZMW",
  paymentMethod: "wallet",
  // Fee-bearer truth: this settlement was buyer-pays — the K5 price
  // carried a K0.13 fee (2.5%, half-up) and the buyer paid K5.13.
  feePayer: "buyer",
  feeAmount: 0.13,
  totalCharged: 5.13,
  settledAt: "2026-10-26T07:00:00.000Z",
};

let state: any;
let fetchCalls: { url: string; headers: Record<string, string>; body: string }[];

beforeEach(() => {
  state = {
    hooks: [
      { id: "hook_paid", user_id: OWNER, url: "https://shop.example/hook", secret: "whsec_paid", events: ["payment_link.paid"], is_active: true },
      { id: "hook_all", user_id: OWNER, url: "https://shop.example/all", secret: "whsec_all", events: [], is_active: true },
      { id: "hook_other", user_id: OWNER, url: "https://shop.example/other", secret: "whsec_other", events: ["transaction.completed"], is_active: true },
      { id: "hook_off", user_id: OWNER, url: "https://shop.example/off", secret: "whsec_off", events: ["payment_link.paid"], is_active: false },
    ],
    deliveries: [],
    claims: new Set<string>(),
  };
  fetchCalls = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    fetchCalls.push({ url, headers: init.headers, body: init.body });
    return { ok: true, status: 200, text: async () => "" };
  });
});
afterEach(() => vi.unstubAllGlobals());

const db = () => ({ from: (t: string) => new Builder(state, t) });

describe("payment_link.paid dispatcher", () => {
  it("is a known, subscribable developer event", () => {
    expect(KNOWN_DEVELOPER_EVENTS).toContain("payment_link.paid");
  });

  it("dispatches to subscribed + legacy all-events endpoints only, signed and logged", async () => {
    const out = await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    expect(out.dispatched).toBe(true);
    expect(out.alreadyDispatched).toBe(false);
    // hook_paid (subscribed) + hook_all (empty events = all); NOT
    // hook_other (different event), NOT hook_off (inactive, filtered
    // by the dispatcher's own is_active query in production — the
    // fake applies the eq filter the dispatcher sends).
    expect(fetchCalls.map((c) => c.url).sort()).toEqual([
      "https://shop.example/all",
      "https://shop.example/hook",
    ]);
    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries.every((d: any) => d.event_type === "payment_link.paid" && d.status === "delivered" && d.response_status === 200)).toBe(true);
    expect(out.deliveries).toHaveLength(2);
  });

  it("payload carries link identity, settlement facts and merchant reference", async () => {
    await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    const evt = JSON.parse(fetchCalls[0].body);
    expect(evt.type).toBe("payment_link.paid");
    expect(evt.id).toMatch(/^evt_/);
    expect(evt.data.link_code).toBe(LINK.link_code);
    expect(evt.data.payment_link_id).toBe(LINK.id);
    expect(evt.data.amount).toBe(5);
    expect(evt.data.currency).toBe("ZMW");
    expect(evt.data.transaction_id).toBe(SETTLEMENT.ownerTransactionId);
    expect(evt.data.payer_transaction_id).toBe(SETTLEMENT.payerTransactionId);
    // The fee truth rides along so a shop can reconcile the buyer's
    // paid total (price + fee) against its order.
    expect(evt.data.fee_payer).toBe("buyer");
    expect(evt.data.fee_amount).toBe(0.13);
    expect(evt.data.total_charged).toBe(5.13);
    expect(evt.data.reference).toBe("WC-1042");
    expect(evt.data.metadata).toEqual(LINK.metadata);
    expect(evt.data.settled_at).toBe(SETTLEMENT.settledAt);
  });

  it("signature is HMAC-SHA256 over the exact body, per-endpoint secret", async () => {
    await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    for (const call of fetchCalls) {
      const secret = call.url.endsWith("/all") ? "whsec_all" : "whsec_paid";
      const expected = "sha256=" + createHmac("sha256", secret).update(call.body).digest("hex");
      expect(call.headers["X-BMaGlass-Signature"]).toBe(expected);
      expect(call.headers["X-BMaGlass-Event"]).toBe("payment_link.paid");
    }
  });

  it("EXACTLY ONCE: replaying the same settlement dispatches nothing more", async () => {
    const first = await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    expect(first.dispatched).toBe(true);
    const callsAfterFirst = fetchCalls.length;
    const replay = await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    expect(replay.dispatched).toBe(false);
    expect(replay.alreadyDispatched).toBe(true);
    expect(fetchCalls).toHaveLength(callsAfterFirst);
    expect(state.deliveries).toHaveLength(2);
  });

  it("a second, distinct settlement on the same link dispatches again", async () => {
    await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    const second = await dispatchPaymentLinkPaid(db(), LINK, {
      ...SETTLEMENT,
      ownerTransactionId: "55555555-5555-5555-5555-555555555555",
    });
    expect(second.dispatched).toBe(true);
    expect(state.deliveries).toHaveLength(4);
  });

  it("a dead endpoint is a logged failure, not an exception", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, text: async () => "err" }));
    const out = await dispatchPaymentLinkPaid(db(), LINK, SETTLEMENT);
    expect(out.dispatched).toBe(true);
    expect(state.deliveries.every((d: any) => d.status === "failed" && d.response_status === 500)).toBe(true);
  });
});
