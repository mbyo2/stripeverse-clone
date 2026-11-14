// Merchant webhook tests (gate14, 2026-11-14).
//
// Exercises the EXACT notifier the edge functions run
// (supabase/functions/_shared/merchant-webhooks.ts) against an
// in-memory stand-in for the tables it touches, with fetch stubbed.
// Pins the three gate14 findings:
//   1. the event vocabulary is the merchant-facing one — a
//      dashboard-configured webhook (payment_success /
//      payment_failed) DOES match a settlement; the old
//      `transaction.completed` name could never match one;
//   2. a row that literally subscribed to `transaction.completed`
//      still matches (backward compatible);
//   3. a settlement observed twice (API poll + provider callback +
//      requery poller) notifies exactly once — claimed on the
//      settlement before sending.
// Plus: signatures verify, unsafe URLs are skipped, non-merchants
// and unsubscribed rows stay silent, and a dead endpoint is a
// logged failure, not an exception.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  MERCHANT_EVENT_FOR_STATUS,
  matchedMerchantEvent,
  notifyMerchantWebhooks,
  notifyMerchantMomoOutcome,
} from "../../supabase/functions/_shared/merchant-webhooks";

// ── In-memory PostgREST stand-in ─────────────────────────────────────
// Implements just the builder surface the notifier uses:
//   from(t).select().eq(k, v) / .in(k, vs)            → { data }
//   from(t).select().eq(k, v).maybeSingle()           → { data }
//   from(t).insert(row)                               → { error } (23505 on PK clash)
class Builder {
  private op = "";
  private payload: any = null;
  private filters: [string, unknown][] = [];
  private inFilters: [string, unknown[]][] = [];
  private singleFlag = false;
  constructor(private state: any, private table: string) {}
  select() { if (!this.op) this.op = "select"; return this; }
  insert(row: any) { this.op = "insert"; this.payload = row; return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  in(k: string, vs: unknown[]) { this.inFilters.push([k, vs]); return this; }
  maybeSingle() { this.singleFlag = true; return this; }
  single() { this.singleFlag = true; return this; }
  then(resolve: (v: any) => void, reject: (e: unknown) => void) {
    try { resolve(this.execute()); } catch (e) { reject(e); }
  }
  private rows() {
    const s = this.state;
    if (this.table === "merchant_accounts") return s.merchants;
    if (this.table === "webhooks") return s.hooks;
    if (this.table === "transactions") return s.transactions;
    return [];
  }
  private execute() {
    if (this.op === "insert" && this.table === "developer_event_dispatches") {
      if (this.state.claims.has(this.payload.event_key)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      this.state.claims.add(this.payload.event_key);
      return { data: null, error: null };
    }
    if (this.op === "select") {
      let rows = [...this.rows()];
      for (const [k, v] of this.filters) rows = rows.filter((r: any) => r[k] === v);
      for (const [k, vs] of this.inFilters) rows = rows.filter((r: any) => vs.includes(r[k]));
      if (this.singleFlag) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    throw new Error(`FakeDb: unhandled ${this.op} on ${this.table}`);
  }
}

const OWNER = "11111111-1111-1111-1111-111111111111";
const MERCHANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TX_UUID = "33333333-3333-3333-3333-333333333333";

let state: any;
let fetchCalls: { url: string; headers: Record<string, string>; body: string }[];

beforeEach(() => {
  state = {
    merchants: [{ id: MERCHANT_ID, user_id: OWNER }],
    hooks: [
      { id: "hook_ui", user_id: OWNER, url: "https://shop.example/hook", secret: "hooksecret-ui", events: ["payment_success", "payment_failed"] },
      { id: "hook_literal", user_id: OWNER, url: "https://shop.example/literal", secret: "hooksecret-lit", events: ["transaction.completed"] },
      { id: "hook_other", user_id: OWNER, url: "https://shop.example/other", secret: "hooksecret-other", events: ["settlement"] },
    ],
    transactions: [
      { uuid_id: TX_UUID, transaction_id: null, amount: 10, currency: "ZMW", status: "completed", external_reference: "263180030", user_id: OWNER },
    ],
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
const input = (over: any = {}) => ({
  userId: OWNER, transactionId: TX_UUID, amount: 10, currency: "ZMW",
  status: "completed", externalReference: "263180030", ...over,
});

describe("merchant webhook vocabulary", () => {
  it("maps completed → payment_success and failed → payment_failed", () => {
    expect(MERCHANT_EVENT_FOR_STATUS.completed).toBe("payment_success");
    expect(MERCHANT_EVENT_FOR_STATUS.failed).toBe("payment_failed");
  });

  it("a dashboard-configured webhook (payment_success) matches a settlement", async () => {
    const out = await notifyMerchantWebhooks(db(), input());
    expect(out.filter((r) => r.status === "delivered").map((r) => r.webhook_id)).toContain("hook_ui");
    const call = fetchCalls.find((c) => c.url === "https://shop.example/hook");
    expect(call).toBeDefined();
    expect(JSON.parse(call!.body).event).toBe("payment_success");
  });

  it("a row literally subscribed to transaction.completed still matches (backward compat)", async () => {
    const out = await notifyMerchantWebhooks(db(), input());
    expect(out.filter((r) => r.status === "delivered").map((r) => r.webhook_id)).toContain("hook_literal");
    const call = fetchCalls.find((c) => c.url === "https://shop.example/literal");
    expect(JSON.parse(call!.body).event).toBe("transaction.completed");
  });

  it("an unsubscribed row (settlement only) stays silent", async () => {
    await notifyMerchantWebhooks(db(), input());
    expect(fetchCalls.map((c) => c.url)).not.toContain("https://shop.example/other");
  });

  it("a failed settlement delivers payment_failed to the UI-subscribed row only", async () => {
    await notifyMerchantWebhooks(db(), input({ status: "failed" }));
    const call = fetchCalls.find((c) => c.url === "https://shop.example/hook");
    expect(JSON.parse(call!.body).event).toBe("payment_failed");
    expect(JSON.parse(call!.body).data.status).toBe("failed");
    expect(fetchCalls.map((c) => c.url)).not.toContain("https://shop.example/literal");
  });

  it("a non-terminal status notifies nobody", async () => {
    const out = await notifyMerchantWebhooks(db(), input({ status: "pending" }));
    expect(out).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });

  it("a user with no merchant account notifies nobody", async () => {
    state.merchants = [];
    const out = await notifyMerchantWebhooks(db(), input());
    expect(out).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("merchant webhook signing + delivery", () => {
  it("payload carries the settlement facts; signature is HMAC-SHA256 over the exact body", async () => {
    await notifyMerchantWebhooks(db(), input());
    const call = fetchCalls.find((c) => c.url === "https://shop.example/hook")!;
    const evt = JSON.parse(call.body);
    expect(evt.data.transaction_id).toBe(TX_UUID);
    expect(evt.data.amount).toBe(10);
    expect(evt.data.currency).toBe("ZMW");
    expect(evt.data.status).toBe("completed");
    expect(evt.data.external_reference).toBe("263180030");
    expect(typeof evt.data.timestamp).toBe("string");
    const expected = "sha256=" + createHmac("sha256", "hooksecret-ui").update(call.body).digest("hex");
    expect(call.headers["X-Webhook-Signature"]).toBe(expected);
  });

  it("EXACTLY ONCE: a second observer of the same settlement sends nothing more", async () => {
    const first = await notifyMerchantWebhooks(db(), input());
    expect(first.filter((r) => r.status === "delivered")) .toHaveLength(2);
    const callsAfterFirst = fetchCalls.length;
    const replay = await notifyMerchantWebhooks(db(), input());
    expect(replay.every((r) => r.status === "already_notified")).toBe(true);
    expect(fetchCalls).toHaveLength(callsAfterFirst);
  });

  it("a distinct settlement notifies again", async () => {
    await notifyMerchantWebhooks(db(), input());
    const out = await notifyMerchantWebhooks(db(), input({ transactionId: "44444444-4444-4444-4444-444444444444" }));
    expect(out.filter((r) => r.status === "delivered")) .toHaveLength(2);
  });

  it("an unsafe URL is skipped, never fetched", async () => {
    state.hooks.push({ id: "hook_bad", user_id: OWNER, url: "http://127.0.0.1:9/hook", secret: "x", events: ["payment_success"] });
    const out = await notifyMerchantWebhooks(db(), input());
    expect(out.find((r) => r.webhook_id === "hook_bad")?.status).toBe("skipped");
    expect(fetchCalls.map((c) => c.url)).not.toContain("http://127.0.0.1:9/hook");
  });

  it("a dead endpoint is a logged failure, not an exception", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, text: async () => "err" }));
    const out = await notifyMerchantWebhooks(db(), input());
    expect(out.every((r) => r.status === "failed" && r.response_status === 500)).toBe(true);
  });

  it("matchedMerchantEvent prefers the merchant-facing name", () => {
    expect(matchedMerchantEvent(["payment_success", "transaction.completed"], "completed")).toBe("payment_success");
    expect(matchedMerchantEvent(["transaction.completed"], "completed")).toBe("transaction.completed");
    expect(matchedMerchantEvent(["settlement"], "completed")).toBeNull();
    expect(matchedMerchantEvent({ payment_failed: true }, "failed")).toBe("payment_failed");
  });
});

describe("notifyMerchantMomoOutcome", () => {
  it("loads the ledger row by uuid and notifies with the uuid when no platform ref exists", async () => {
    const out = await notifyMerchantMomoOutcome(db(), { merchantUserId: OWNER, transactionUuid: TX_UUID, status: "completed" });
    expect(out.filter((r) => r.status === "delivered")).toHaveLength(2);
    const call = fetchCalls.find((c) => c.url === "https://shop.example/hook")!;
    expect(JSON.parse(call.body).data.transaction_id).toBe(TX_UUID);
    expect(JSON.parse(call.body).data.amount).toBe(10);
  });

  it("a missing ledger row is a silent no-op", async () => {
    const out = await notifyMerchantMomoOutcome(db(), { merchantUserId: OWNER, transactionUuid: "99999999-9999-9999-9999-999999999999", status: "completed" });
    expect(out).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });
});
