// Unit tests for the Payoneer payouts rail:
//   - supabase/functions/_shared/payoneer.ts — the pure decision
//     logic (config gate, input validation, request shapes, the
//     status machine, error classification, webhook signature).
//   - supabase/functions/_shared/payoneer-server.ts — the IO layer,
//     exercised with an injected fetch + clock (token cache) and an
//     in-memory service-client fake (ledger + wallet movements).
//
// The properties under test:
//   - The rail fails CLOSED: missing credentials are "not
//     configured", a bad webhook signature never verifies, and an
//     unlisted provider status never moves a payout.
//   - The ledger row leads: client_reference_id is ALWAYS the row's
//     uuid_id, from row creation through the provider create body.
//   - Money moves exactly once: a wallet is debited once per payout
//     and credited back exactly once on a confirmed provider
//     failure/reversal — replays change nothing.

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import {
  buildCreatePaymentBody,
  buildTokenRequest,
  canUsePayoneer,
  classifyPayoneerError,
  decideStatusTransition,
  extractProviderPayoutId,
  extractProviderStatus,
  extractWebhookIdentifiers,
  mapProviderStatus,
  payoneerConfig,
  payoneerProgramPayoutPath,
  validatePayoutInput,
  verifyPayoneerWebhookSignature,
  type PayoutState,
} from "../../supabase/functions/_shared/payoneer";
import {
  applyProviderStatus,
  createPayoneerPayment,
  createPayoutRow,
  debitWalletForPayout,
  findPayoutById,
  getPayoneerAccessToken,
  getPayoneerPayee,
  getPayoneerPayment,
  resetPayoneerTokenCache,
  type FetchLike,
  type PayoneerPayoutRow,
} from "../../supabase/functions/_shared/payoneer-server";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

// Fake credential VALUES for tests only (not real secrets).
const VALUES = {
  clientId: "cid_test_fake",
  clientSecret: "csecret_test_fake",
  programId: "prog_test_fake",
  env: "sandbox",
};

// ── Config ───────────────────────────────────────────────────────────

describe("payoneerConfig (the not_configured gate)", () => {
  it("is configured only with the full issued trio", () => {
    expect(payoneerConfig(VALUES).configured).toBe(true);
    expect(payoneerConfig({ ...VALUES, clientId: null }).configured).toBe(false);
    expect(payoneerConfig({ ...VALUES, clientSecret: "" }).configured).toBe(false);
    expect(payoneerConfig({ ...VALUES, programId: undefined }).configured).toBe(false);
    expect(payoneerConfig({}).configured).toBe(false);
  });

  it("switches base URL by PAYONEER_ENV, defaulting to sandbox", () => {
    expect(payoneerConfig(VALUES).env).toBe("sandbox");
    expect(payoneerConfig(VALUES).baseUrl).toBe("https://api.sandbox.payoneer.com");
    const prod = payoneerConfig({ ...VALUES, env: "production" });
    expect(prod.env).toBe("production");
    expect(prod.baseUrl).toBe("https://api.payoneer.com");
    // A typo never selects production.
    expect(payoneerConfig({ ...VALUES, env: "prod" }).env).toBe("sandbox");
  });

  it("reports the registration link separately from API credentials", () => {
    expect(payoneerConfig(VALUES).registrationLinkConfigured).toBe(false);
    const withLink = payoneerConfig({
      ...VALUES,
      registrationLink: "https://www.payoneer.com/register/fake",
    });
    expect(withLink.registrationLinkConfigured).toBe(true);
    expect(withLink.registrationLink).toContain("payoneer.com/register");
  });
});

describe("canUsePayoneer (admin-only rail)", () => {
  it("admits admin and super_admin, refuses everyone else", () => {
    expect(canUsePayoneer(["admin"])).toBe(true);
    expect(canUsePayoneer(["super_admin"])).toBe(true);
    expect(canUsePayoneer(["user", "super_admin"])).toBe(true);
    expect(canUsePayoneer(["user"])).toBe(false);
    expect(canUsePayoneer([])).toBe(false);
  });
});

// ── Validation ───────────────────────────────────────────────────────

describe("validatePayoutInput (server-side guard)", () => {
  it("accepts and normalises a well-formed payout (ZMW included)", () => {
    expect(
      validatePayoutInput({ payee_id: "  payee-9 ", amount: "40.50", currency: "zmw" }),
    ).toEqual({
      ok: true, payeeId: "payee-9", amount: 40.5, currency: "ZMW", description: null,
    });
    for (const c of ["USD", "EUR", "GBP", "ZAR", "KES", "JPY"]) {
      expect(validatePayoutInput({ payee_id: "p", amount: 1, currency: c }).ok).toBe(true);
    }
  });

  it("refuses a missing payee, bad amounts and unlisted currencies", () => {
    expect(validatePayoutInput({ payee_id: " ", amount: 10, currency: "USD" })).toMatchObject({
      ok: false, reason: "missing_payee",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: 0, currency: "USD" })).toMatchObject({
      ok: false, reason: "invalid_amount",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: -5, currency: "USD" })).toMatchObject({
      ok: false, reason: "invalid_amount",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: "abc", currency: "USD" })).toMatchObject({
      ok: false, reason: "invalid_amount",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: 10, currency: "US" })).toMatchObject({
      ok: false, reason: "invalid_currency",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: 10, currency: "BTC" })).toMatchObject({
      ok: false, reason: "unsupported_currency",
    });
    expect(validatePayoutInput({ payee_id: "p", amount: 10, currency: "XXX" })).toMatchObject({
      ok: false, reason: "unsupported_currency",
    });
  });
});

// ── Request shapes ───────────────────────────────────────────────────

describe("buildTokenRequest (OAuth client credentials)", () => {
  const req = buildTokenRequest({
    baseUrl: "https://api.sandbox.payoneer.com",
    clientId: "cid_test_fake",
    clientSecret: "csecret_test_fake",
  });

  it("posts form-encoded client credentials to /v4/oauth2/token", () => {
    expect(req.url).toBe("https://api.sandbox.payoneer.com/v4/oauth2/token");
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(req.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("cid_test_fake");
    expect(form.get("client_secret")).toBe("csecret_test_fake");
  });
});

describe("buildCreatePaymentBody (the create contract)", () => {
  it("always sends client_reference_id = our uuid_id", () => {
    const body = buildCreatePaymentBody({
      payeeId: "payee-9",
      amount: 40.5,
      currency: "zmw",
      description: "October payout",
      clientReferenceId: "uuid-123",
    });
    expect(body).toEqual({
      payee_id: "payee-9",
      amount: 40.5,
      currency: "ZMW",
      description: "October payout",
      client_reference_id: "uuid-123",
    });
  });

  it("omits description when none is given", () => {
    const body = buildCreatePaymentBody({
      payeeId: "payee-9", amount: 1, currency: "USD", clientReferenceId: "uuid-1",
    });
    expect("description" in body).toBe(false);
  });

  it("pins the program-scoped variant path for onboarding confirmation", () => {
    expect(payoneerProgramPayoutPath("prog 1")).toBe(
      "/v4/programs/prog%201/payments/payout",
    );
  });
});

// ── Status machine ───────────────────────────────────────────────────

describe("mapProviderStatus", () => {
  it("maps the documented provider vocabulary", () => {
    expect(mapProviderStatus("PENDING")).toBe("submitted");
    expect(mapProviderStatus("COMPLETED")).toBe("completed");
    expect(mapProviderStatus("PAID")).toBe("completed");
    expect(mapProviderStatus("FAILED")).toBe("failed");
    expect(mapProviderStatus("CANCELLED")).toBe("failed");
    expect(mapProviderStatus("CANCELED")).toBe("failed");
    expect(mapProviderStatus("REVERSED")).toBe("reversed");
    expect(mapProviderStatus("RETURNED")).toBe("reversed");
  });

  it("is case-insensitive and maps anything unlisted to null", () => {
    expect(mapProviderStatus("completed")).toBe("completed");
    expect(mapProviderStatus(" Pending ")).toBe("submitted");
    expect(mapProviderStatus("PROCESSING")).toBeNull();
    expect(mapProviderStatus("SOMETHING_NEW")).toBeNull();
    expect(mapProviderStatus("")).toBeNull();
    expect(mapProviderStatus(null)).toBeNull();
    expect(mapProviderStatus(undefined)).toBeNull();
  });
});

describe("decideStatusTransition", () => {
  const state = (status: string, debit_state: string): PayoutState =>
    ({ status, debit_state } as PayoutState);

  it("moves forward only: pending → submitted → completed", () => {
    expect(decideStatusTransition(state("pending", "none"), "submitted"))
      .toEqual({ next: "submitted", shouldReverseDebit: false });
    expect(decideStatusTransition(state("submitted", "debited"), "completed"))
      .toEqual({ next: "completed", shouldReverseDebit: false });
    // A late 'submitted' never drags a completed row backwards.
    expect(decideStatusTransition(state("completed", "debited"), "submitted"))
      .toEqual({ next: "completed", shouldReverseDebit: false });
    // No mapped status changes nothing.
    expect(decideStatusTransition(state("pending", "none"), null))
      .toEqual({ next: "pending", shouldReverseDebit: false });
  });

  it("reverses the debit ONLY from a debited state on confirmed states", () => {
    expect(decideStatusTransition(state("submitted", "debited"), "failed"))
      .toEqual({ next: "failed", shouldReverseDebit: true });
    expect(decideStatusTransition(state("submitted", "debited"), "reversed"))
      .toEqual({ next: "reversed", shouldReverseDebit: true });
    // Never debited → nothing to give back.
    expect(decideStatusTransition(state("submitted", "none"), "failed"))
      .toEqual({ next: "failed", shouldReverseDebit: false });
    // Already reversed → never twice.
    expect(decideStatusTransition(state("submitted", "reversed"), "failed"))
      .toEqual({ next: "failed", shouldReverseDebit: false });
  });

  it("lets a provider reversal end a completed payout (with credit-back)", () => {
    expect(decideStatusTransition(state("completed", "debited"), "reversed"))
      .toEqual({ next: "reversed", shouldReverseDebit: true });
  });

  it("refuses the contradictory completed → failed move", () => {
    expect(decideStatusTransition(state("completed", "debited"), "failed"))
      .toEqual({ next: "completed", shouldReverseDebit: false });
  });

  it("still owes the reversal when the row is terminal but still debited", () => {
    // Missed-reversal recovery: status already failed, debit not yet
    // returned — the guarded flip makes acting on this exactly-once.
    expect(decideStatusTransition(state("failed", "debited"), "failed"))
      .toEqual({ next: "failed", shouldReverseDebit: true });
    expect(decideStatusTransition(state("reversed", "debited"), "reversed"))
      .toEqual({ next: "reversed", shouldReverseDebit: true });
  });

  it("terminal states never move on late success claims", () => {
    expect(decideStatusTransition(state("failed", "reversed"), "completed"))
      .toEqual({ next: "failed", shouldReverseDebit: false });
    expect(decideStatusTransition(state("reversed", "reversed"), "completed"))
      .toEqual({ next: "reversed", shouldReverseDebit: false });
  });
});

// ── Error classification ─────────────────────────────────────────────

describe("classifyPayoneerError (plain language, never raw bodies)", () => {
  it("classifies the statuses that matter", () => {
    expect(classifyPayoneerError(401)).toContain("credentials");
    expect(classifyPayoneerError(403)).toContain("credentials");
    expect(classifyPayoneerError(400)).toContain("could not accept");
    expect(classifyPayoneerError(422)).toContain("could not accept");
    expect(classifyPayoneerError(404)).toContain("could not find");
    expect(classifyPayoneerError(409)).toContain("already exists");
    expect(classifyPayoneerError(429)).toContain("busy");
    expect(classifyPayoneerError(500)).toContain("having trouble");
    expect(classifyPayoneerError(0)).toContain("could not be reached");
  });

  it("names a platform-float refusal plainly", () => {
    const message = classifyPayoneerError(400, { name: "INSUFFICIENT_FUNDS" });
    expect(message).toContain("does not have enough funds");
  });

  it("never echoes the raw provider body", () => {
    const message = classifyPayoneerError(400, {
      message: "raw detail mentioning csecret_test_fake",
      name: "VALIDATION_ERROR",
    });
    expect(message).not.toContain("csecret_test_fake");
    expect(message).not.toContain("raw detail");
  });
});

// ── Response / webhook hint extraction ──────────────────────────────

describe("provider response + webhook hint extraction", () => {
  it("reads id and status from flat and nested shapes", () => {
    expect(extractProviderPayoutId({ payment_id: "pay_1", status: "PENDING" })).toBe("pay_1");
    expect(extractProviderStatus({ payment_id: "pay_1", status: "PENDING" })).toBe("PENDING");
    expect(extractProviderPayoutId({ payment: { id: "pay_2", status: "PAID" } })).toBe("pay_2");
    expect(extractProviderStatus({ data: { payout_id: "pay_3", payment_status: "FAILED" } }))
      .toBe("FAILED");
    expect(extractProviderPayoutId(null)).toBeNull();
    expect(extractProviderStatus({})).toBeNull();
  });

  it("extracts webhook hint identifiers at top level and nested", () => {
    expect(extractWebhookIdentifiers({
      payment_id: "pay_1", client_reference_id: "uuid-1",
    })).toEqual({ providerPayoutId: "pay_1", clientReferenceId: "uuid-1" });
    expect(extractWebhookIdentifiers({
      data: { payout_id: "pay_2", client_reference_id: "uuid-2" },
    })).toEqual({ providerPayoutId: "pay_2", clientReferenceId: "uuid-2" });
    expect(extractWebhookIdentifiers({ unrelated: true }))
      .toEqual({ providerPayoutId: null, clientReferenceId: null });
    expect(extractWebhookIdentifiers(null))
      .toEqual({ providerPayoutId: null, clientReferenceId: null });
  });
});

// ── Webhook signature ────────────────────────────────────────────────

describe("verifyPayoneerWebhookSignature (fails closed)", () => {
  const secret = "whsec_test_fake_secret";
  const rawBody = '{"payment_id":"pay_1","client_reference_id":"uuid-1"}';
  const good = createHmac("sha256", secret).update(rawBody).digest("hex");

  it("accepts the correct HMAC-SHA256 hex of the raw body", async () => {
    await expect(verifyPayoneerWebhookSignature(rawBody, good, secret)).resolves.toBe(true);
    await expect(verifyPayoneerWebhookSignature(rawBody, good.toUpperCase(), secret))
      .resolves.toBe(true);
  });

  it("rejects tampering, wrong secrets and missing pieces", async () => {
    await expect(verifyPayoneerWebhookSignature(rawBody + " ", good, secret)).resolves.toBe(false);
    await expect(verifyPayoneerWebhookSignature(rawBody, good, "other_secret")).resolves.toBe(false);
    await expect(verifyPayoneerWebhookSignature(rawBody, null, secret)).resolves.toBe(false);
    await expect(verifyPayoneerWebhookSignature(rawBody, "", secret)).resolves.toBe(false);
    await expect(verifyPayoneerWebhookSignature(rawBody, good, null)).resolves.toBe(false);
    await expect(verifyPayoneerWebhookSignature(rawBody, good, "")).resolves.toBe(false);
  });
});

// ── Fake fetch + token cache / provider calls ────────────────────────

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("getPayoneerAccessToken (cached, expiry-aware)", () => {
  beforeEach(() => resetPayoneerTokenCache());

  it("caches until under 60s of life remains, keyed by env + client", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return fakeResponse(200, { access_token: `tok-${calls}`, expires_in: 3600 });
    };
    const t0 = 1_000_000;
    await expect(getPayoneerAccessToken(fetchImpl, VALUES, t0)).resolves.toBe("tok-1");
    // Well inside the lifetime: cache hit, no new fetch.
    await expect(getPayoneerAccessToken(fetchImpl, VALUES, t0 + 1_000)).resolves.toBe("tok-1");
    expect(calls).toBe(1);
    // 50s before expiry (< 60s skew): refresh.
    await expect(getPayoneerAccessToken(fetchImpl, VALUES, t0 + 3_550_000))
      .resolves.toBe("tok-2");
    expect(calls).toBe(2);
    // A different environment is a different cache entry.
    await expect(
      getPayoneerAccessToken(fetchImpl, { ...VALUES, env: "production" }, t0),
    ).resolves.toBe("tok-3");
    expect(calls).toBe(3);
  });

  it("throws a classified error on refusal and never caches failures", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1
        ? fakeResponse(401, { name: "invalid_client" })
        : fakeResponse(200, { access_token: "tok-ok", expires_in: 3600 });
    };
    await expect(getPayoneerAccessToken(fetchImpl, VALUES, 0))
      .rejects.toThrow(/credentials/);
    // The failure was not cached: the next call retries and succeeds.
    await expect(getPayoneerAccessToken(fetchImpl, VALUES, 0)).resolves.toBe("tok-ok");
    expect(calls).toBe(2);
  });

  it("refuses before any fetch when the OAuth pair is absent", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return fakeResponse(200, { access_token: "tok", expires_in: 3600 });
    };
    await expect(getPayoneerAccessToken(fetchImpl, { env: "sandbox" }, 0))
      .rejects.toThrow(/still being connected/);
    expect(calls).toBe(0);
  });
});

describe("provider calls (token + paths + classified errors)", () => {
  beforeEach(() => resetPayoneerTokenCache());

  function routedFetch(routes: Record<string, { status: number; body: unknown }>) {
    const seen: Array<{ url: string; method: string; auth: string | undefined }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes("/v4/oauth2/token")) {
        return fakeResponse(200, { access_token: "tok-1", expires_in: 3600 });
      }
      seen.push({ url, method: init?.method ?? "GET", auth: init?.headers?.Authorization });
      for (const [needle, route] of Object.entries(routes)) {
        if (url.includes(needle)) return fakeResponse(route.status, route.body);
      }
      return fakeResponse(404, { name: "not_found" });
    };
    return { fetchImpl, seen };
  }

  it("creates a payment at POST /v4/payments with the bearer token", async () => {
    const { fetchImpl, seen } = routedFetch({
      "/v4/payments": { status: 201, body: { payment_id: "pay_1", status: "PENDING" } },
    });
    const payload = await createPayoneerPayment(fetchImpl, VALUES, {
      payee_id: "payee-9", amount: 10, currency: "USD", client_reference_id: "uuid-1",
    });
    expect(payload).toEqual({ payment_id: "pay_1", status: "PENDING" });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.sandbox.payoneer.com/v4/payments");
    expect(seen[0].method).toBe("POST");
    expect(seen[0].auth).toBe("Bearer tok-1");
  });

  it("reads payment and payee state from their GET paths", async () => {
    const { fetchImpl, seen } = routedFetch({
      "/v4/payments/pay_1": { status: 200, body: { payment_id: "pay_1", status: "COMPLETED" } },
      "/v4/payees/payee-9": { status: 200, body: { payee_id: "payee-9", status: "ACTIVE" } },
    });
    await expect(getPayoneerPayment(fetchImpl, VALUES, "pay_1"))
      .resolves.toEqual({ payment_id: "pay_1", status: "COMPLETED" });
    await expect(getPayoneerPayee(fetchImpl, VALUES, "payee-9"))
      .resolves.toEqual({ payee_id: "payee-9", status: "ACTIVE" });
    expect(seen.map((s) => s.url)).toEqual([
      "https://api.sandbox.payoneer.com/v4/payments/pay_1",
      "https://api.sandbox.payoneer.com/v4/payees/payee-9",
    ]);
  });

  it("throws classified plain-language errors, never raw bodies", async () => {
    const { fetchImpl } = routedFetch({
      "/v4/payments": { status: 422, body: { message: "raw: bad payee csecret_test_fake" } },
    });
    await expect(
      createPayoneerPayment(fetchImpl, VALUES, { payee_id: "x" }),
    ).rejects.toThrow(/could not accept those payout details/);
  });
});

// ── In-memory service-client fake ────────────────────────────────────
// Implements exactly the PostgREST builder surface the server module
// uses (select/insert/update + eq/in + maybeSingle/single + await),
// so the ledger and wallet movements run against real row state.

type Row = Record<string, unknown>;

class FakeBuilder {
  private mode: "select" | "insert" | "update" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private payload: Row = {};
  private returning = false;

  constructor(
    private db: Map<string, Row[]>,
    private table: string,
  ) {}

  select(): this {
    if (this.mode === "select") return this;
    this.returning = true;
    return this;
  }
  insert(payload: Row): this {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row): this {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((row) => row[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((row) => vals.includes(row[col]));
    return this;
  }

  private rows(): Row[] {
    return this.db.get(this.table) ?? [];
  }
  private matched(): Row[] {
    return this.rows().filter((row) => this.filters.every((f) => f(row)));
  }
  private execute(): { data: unknown; error: unknown } {
    if (this.mode === "insert") {
      const row: Row = {
        id: `row-${Math.random().toString(36).slice(2, 10)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      };
      this.rows().push(row);
      return { data: this.returning ? [{ ...row }] : null, error: null };
    }
    if (this.mode === "update") {
      const matched = this.matched();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: this.returning ? matched.map((r) => ({ ...r })) : null, error: null };
    }
    return { data: this.matched().map((r) => ({ ...r })), error: null };
  }
  async maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    const { data } = this.execute() as { data: Row[] | null };
    return { data: data?.[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row | null; error: unknown }> {
    const { data } = this.execute() as { data: Row[] | null };
    if (!data || data.length === 0) {
      return { data: null, error: { message: "Results contain 0 rows" } };
    }
    return { data: data[0], error: null };
  }
  // Thenable: awaiting the builder runs it (PostgREST semantics).
  then(
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }
}

function makeFakeAdmin(wallets: Row[]) {
  const db = new Map<string, Row[]>([
    ["payoneer_payouts", []],
    ["wallets", wallets],
  ]);
  const admin = {
    from: (table: string) => new FakeBuilder(db, table),
  };
  const walletBalance = (id: string) =>
    Number((db.get("wallets") ?? []).find((w) => w.id === id)?.balance);
  return { admin, db, walletBalance };
}

describe("ledger + wallet movements (server module, fake client)", () => {
  const seedWallet = (): Row[] => [
    { id: "wallet-1", user_id: "user-1", currency: "USD", balance: 100, status: "active" },
  ];

  async function recordedPayout(
    admin: unknown,
    amount: number,
  ): Promise<PayoneerPayoutRow> {
    return createPayoutRow(admin as never, {
      payeeId: "payee-9",
      amount,
      currency: "USD",
      userId: "user-1",
      walletId: "wallet-1",
      createdBy: "admin-1",
    });
  }

  it("records the row FIRST with client_reference_id = its uuid_id", async () => {
    const { admin } = makeFakeAdmin(seedWallet());
    const row = await recordedPayout(admin, 40);
    expect(row.status).toBe("pending");
    expect(row.debit_state).toBe("none");
    expect(row.client_reference_id).toBe(row.uuid_id);
    expect(row.provider_payout_id).toBeNull();
  });

  it("debits exactly once — a replayed debit is a no-op", async () => {
    const { admin, walletBalance } = makeFakeAdmin(seedWallet());
    const row = await recordedPayout(admin, 40);
    const first = await debitWalletForPayout(admin as never, row);
    expect(first).toEqual({ ok: true, newBalance: 60, alreadyDebited: false });
    expect(walletBalance("wallet-1")).toBe(60);

    const fresh = await findPayoutById(admin as never, row.id);
    const replay = await debitWalletForPayout(admin as never, fresh as PayoneerPayoutRow);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.alreadyDebited).toBe(true);
    expect(walletBalance("wallet-1")).toBe(60);
  });

  it("refuses an insufficient debit and moves nothing", async () => {
    const { admin, walletBalance } = makeFakeAdmin([
      { id: "wallet-1", user_id: "user-1", currency: "USD", balance: 10, status: "active" },
    ]);
    const row = await recordedPayout(admin, 40);
    const result = await debitWalletForPayout(admin as never, row);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Insufficient balance");
    expect(walletBalance("wallet-1")).toBe(10);
    const fresh = await findPayoutById(admin as never, row.id);
    expect(fresh?.debit_state).toBe("none");
  });

  it("credits back exactly once on a confirmed provider failure", async () => {
    const { admin, walletBalance } = makeFakeAdmin(seedWallet());
    const row = await recordedPayout(admin, 40);
    await debitWalletForPayout(admin as never, row);
    expect(walletBalance("wallet-1")).toBe(60);

    const submitted = await findPayoutById(admin as never, row.id);
    const applied = await applyProviderStatus(admin as never, submitted as PayoneerPayoutRow, "FAILED");
    expect(applied.reversedDebit).toBe(true);
    expect(applied.row.status).toBe("failed");
    expect(applied.row.debit_state).toBe("reversed");
    expect(walletBalance("wallet-1")).toBe(100);

    // Webhook + poll replays of the same truth change nothing.
    const again = await applyProviderStatus(admin as never, applied.row, "FAILED");
    expect(again.reversedDebit).toBe(false);
    expect(walletBalance("wallet-1")).toBe(100);
  });

  it("a completed payout keeps its debit; a later reversal returns it once", async () => {
    const { admin, walletBalance } = makeFakeAdmin(seedWallet());
    const row = await recordedPayout(admin, 25);
    await debitWalletForPayout(admin as never, row);

    const submitted = await findPayoutById(admin as never, row.id);
    const completed = await applyProviderStatus(
      admin as never, submitted as PayoneerPayoutRow, "COMPLETED",
    );
    expect(completed.row.status).toBe("completed");
    expect(completed.reversedDebit).toBe(false);
    expect(walletBalance("wallet-1")).toBe(75);

    const reversed = await applyProviderStatus(admin as never, completed.row, "REVERSED");
    expect(reversed.row.status).toBe("reversed");
    expect(reversed.reversedDebit).toBe(true);
    expect(walletBalance("wallet-1")).toBe(100);

    const replay = await applyProviderStatus(admin as never, reversed.row, "REVERSED");
    expect(replay.reversedDebit).toBe(false);
    expect(walletBalance("wallet-1")).toBe(100);
  });

  it("an unlisted provider status changes nothing at all", async () => {
    const { admin, walletBalance } = makeFakeAdmin(seedWallet());
    const row = await recordedPayout(admin, 40);
    await debitWalletForPayout(admin as never, row);
    const submitted = await findPayoutById(admin as never, row.id);
    const applied = await applyProviderStatus(
      admin as never, submitted as PayoneerPayoutRow, "PROCESSING",
    );
    expect(applied.changed).toBe(false);
    expect(applied.row.status).toBe("pending");
    expect(walletBalance("wallet-1")).toBe(60);
  });
});

// ── Source pins (migration, gates, config) ───────────────────────────

describe("source pins", () => {
  const migration = read("../../supabase/migrations/20261202_payoneer_payouts.sql");
  const payoutsFn = read("../../supabase/functions/payoneer-payouts/index.ts");
  const webhookFn = read("../../supabase/functions/payoneer-webhook/index.ts");
  const configToml = read("../../supabase/config.toml");

  it("migration: kill switch defaults false, ledger + admin-read RLS, no client writes", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS payoneer_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.payoneer_payouts");
    expect(migration).toContain("client_reference_id TEXT UNIQUE NOT NULL");
    expect(migration).toContain("debit_state IN ('none', 'debited', 'reversed')");
    expect(migration).toContain('"Admins can view Payoneer payouts"');
    expect(migration).not.toMatch(/ON public\.payoneer_payouts FOR (INSERT|UPDATE|DELETE)/);
  });

  it("payouts function: 'status' answers before the kill switch and config gates", () => {
    const statusAt = payoutsFn.indexOf('action === "status"');
    const killAt = payoutsFn.indexOf('status: "disabled"');
    const configAt = payoutsFn.indexOf('status: "not_configured"');
    expect(statusAt).toBeGreaterThan(-1);
    expect(killAt).toBeGreaterThan(statusAt);
    expect(configAt).toBeGreaterThan(killAt);
    expect(payoutsFn).toContain("createPayoutRow");
    expect(payoutsFn).toContain("debitWalletForPayout");
  });

  it("webhook: HMAC first, re-query before any state change, 503 when unconfigured", () => {
    expect(webhookFn).toContain("Webhook is not configured.");
    expect(webhookFn).toContain("x-payoneer-signature");
    expect(webhookFn).toContain("verifyPayoneerWebhookSignature");
    const verifyAt = webhookFn.indexOf("await verifyPayoneerWebhookSignature");
    const requeryAt = webhookFn.indexOf("await getPayoneerPayment");
    const applyAt = webhookFn.indexOf("await applyProviderStatus");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(requeryAt).toBeGreaterThan(verifyAt);
    expect(applyAt).toBeGreaterThan(requeryAt);
  });

  it("config.toml: webhook is JWT-off, payouts is JWT-on", () => {
    expect(configToml).toMatch(
      /\[functions\.payoneer-payouts\]\s*\nverify_jwt = true/,
    );
    expect(configToml).toMatch(
      /\[functions\.payoneer-webhook\]\s*\nverify_jwt = false/,
    );
  });
});
