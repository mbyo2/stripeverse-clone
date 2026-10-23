// Unit tests for supabase/functions/_shared/p2p-request.ts — the p2p
// edge function's action table: HTTP body → RPC arguments (scope
// §4.2). The load-bearing assertions are about the actor invariant:
// the JWT user's id is injected by the dispatcher under `actorArg`,
// so no builder may ever surface a user id from the request body.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadShared(name: string) {
  const source = fs.readFileSync(
    path.resolve(here, "../../supabase/functions/_shared", name),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: name,
  });
  const tmp = path.join(here, `.tmp-${name.replace(/\.ts$/, ".mjs")}`);
  fs.writeFileSync(tmp, outputText);
  return import(tmp);
}

type Req = typeof import("../../supabase/functions/_shared/p2p-request");
let req: Req;

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const KEY = "idem-key-0001";

beforeAll(async () => {
  req = await loadShared("p2p-request.ts");
});

describe("actor invariant", () => {
  it("mark_paid maps fields and never reads a user id from the body", () => {
    const r = req.buildRpcArgs("mark_paid", {
      order_id: UUID_A,
      payment_method_id: UUID_B,
      rail_reference: "TXN123",
      amount_sent_zmw: 500,
      idempotency_key: KEY,
      // smuggled actor fields — must be ignored entirely:
      p_buyer_id: "attacker",
      user_id: "attacker",
      buyer_id: "attacker",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spec.rpc).toBe("p2p_mark_paid");
    expect(r.value.spec.actorArg).toBe("p_buyer_id");
    expect(r.value.args.p_order_id).toBe(UUID_A);
    expect(r.value.args.p_rail_reference).toBe("TXN123");
    expect(r.value.args.p_amount_sent_zmw).toBe(500);
    expect(r.value.args).not.toHaveProperty("p_buyer_id");
    expect(r.value.args).not.toHaveProperty("user_id");
    expect(JSON.stringify(r.value.args)).not.toContain("attacker");
  });

  it("every RPC action declares the right RPC and actor argument", () => {
    const expected: Record<string, [string, string | undefined]> = {
      create_payment_method: ["p2p_create_payment_method", "p_user_id"],
      create_ad: ["p2p_create_ad", "p_owner_id"],
      create_order: ["p2p_create_order", "p_taker_id"],
      cancel_order: ["p2p_cancel_order", "p_caller_id"],
      confirm_release: ["p2p_confirm_release", "p_seller_id"],
      open_dispute: ["p2p_open_dispute", "p_caller_id"],
      resolve_dispute: ["p2p_resolve_dispute", "p_admin_id"],
      block_user: ["p2p_block_user", "p_blocker_id"],
      report_user: ["p2p_report_user", "p_reporter_id"],
      get_limits: ["p2p_effective_limits", "p_user_id"],
    };
    for (const [action, [rpc, actorArg]] of Object.entries(expected)) {
      const spec: any = (req.P2P_ACTIONS as any)[action];
      expect(spec.kind, action).toBe("rpc");
      expect(spec.rpc, action).toBe(rpc);
      expect(spec.actorArg, action).toBe(actorArg);
    }
  });

  it("only create_ad and create_order are kill-switch entry actions", () => {
    const entries = Object.entries(req.P2P_ACTIONS as any)
      .filter(([, s]: any) => s.kind === "rpc" && s.entry)
      .map(([a]) => a)
      .sort();
    expect(entries).toEqual(["create_ad", "create_order"]);
  });

  it("admin actions are flagged for the dispatcher's role check", () => {
    for (const a of ["resolve_dispute", "apply_sanction", "revoke_sanction"]) {
      expect((req.P2P_ACTIONS as any)[a].admin, a).toBe(true);
    }
    expect((req.P2P_ACTIONS as any).open_dispute.admin).toBeFalsy();
  });
});

describe("validation", () => {
  it("rejects unknown actions", () => {
    expect(req.buildRpcArgs("nonsense", {}).ok).toBe(false);
    expect(req.buildRpcArgs("send_message", {}).ok).toBe(false);
  });

  it("requires a valid idempotency key on transitions", () => {
    const base = { order_id: UUID_A };
    expect(req.buildRpcArgs("cancel_order", base).ok).toBe(false);
    expect(
      req.buildRpcArgs("cancel_order", { ...base, idempotency_key: "short" })
        .ok,
    ).toBe(false);
    expect(
      req.buildRpcArgs("cancel_order", { ...base, idempotency_key: KEY }).ok,
    ).toBe(true);
  });

  it("rejects malformed uuids", () => {
    const r = req.buildRpcArgs("mark_paid", {
      order_id: "not-a-uuid",
      payment_method_id: UUID_B,
      rail_reference: "X",
      amount_sent_zmw: 1,
      idempotency_key: KEY,
    });
    expect(r.ok).toBe(false);
  });

  it("mark_paid requires the rail reference and amount", () => {
    expect(
      req.buildRpcArgs("mark_paid", {
        order_id: UUID_A,
        payment_method_id: UUID_B,
        idempotency_key: KEY,
      }).ok,
    ).toBe(false);
  });

  it("confirm_release defaults the §3.5 checklist to false, never true", () => {
    const r = req.buildRpcArgs("confirm_release", {
      order_id: UUID_A,
      received_amount_zmw: 500,
      received_reference: "TXN123",
      idempotency_key: KEY,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.args.p_checked_own_account).toBe(false);
    expect(r.value.args.p_checked_full_amount).toBe(false);
    expect(r.value.args.p_checked_sender_name).toBe(false);
  });

  it("omits absent optionals so RPC defaults apply", () => {
    const r = req.buildRpcArgs("create_ad", {
      side: "sell",
      price_type: "floating",
      total_amount_minor: 100_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.args).not.toHaveProperty("p_terms");
    expect(r.value.args).not.toHaveProperty("p_min_counterparty_tier");
    expect(r.value.args.p_asset).toBe("BTC");
  });

  it("rejects non-BTC ads with the designed refusal", () => {
    const r = req.buildRpcArgs("create_ad", {
      side: "sell",
      price_type: "fixed",
      asset: "USDT",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not available");
    expect(r.error).toContain("Bitcoin (BTC) only");
  });

  it("apply_sanction validates level and duration", () => {
    const base = {
      user_id: UUID_A,
      scope: "p2p",
      reason_code: "fake_paid_claim",
      detail: "ruled in dispute",
    };
    expect(req.buildRpcArgs("apply_sanction", { ...base, level: 5 }).ok).toBe(
      false,
    );
    expect(
      req.buildRpcArgs("apply_sanction", { ...base, level: 2, duration: "forever" })
        .ok,
    ).toBe(false);
    const good = req.buildRpcArgs("apply_sanction", {
      ...base,
      level: 2,
      duration: "7 days",
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // the sanction TARGET legitimately comes from the body here
    expect(good.value.args.p_user_id).toBe(UUID_A);
    expect(good.value.args.p_duration).toBe("7 days");
    expect(good.value.spec.admin).toBe(true);
  });

  it("self reads take no body fields at all", () => {
    const r = req.buildRpcArgs("get_tier", { p_user_id: "attacker" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.args).toEqual({});
    expect(r.value.spec.wrap).toBe("tier");
  });

  it("isUuid accepts only canonical uuids", () => {
    expect(req.isUuid(UUID_A)).toBe(true);
    expect(req.isUuid("123")).toBe(false);
    expect(req.isUuid(42)).toBe(false);
    expect(req.isUuid(null)).toBe(false);
  });
});
