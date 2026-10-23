// p2p-request: the p2p edge function's action table and request
// validation (scope §4.2). Pure module — no imports, no Deno globals —
// so the mapping from HTTP body to RPC arguments is unit-testable.
//
// The security invariant lives here: every RPC's actor argument is
// declared as `actorArg` and is filled by the dispatcher from the
// verified JWT — builders NEVER read a user id out of the body, so a
// body that smuggles `p_user_id` / `user_id` / `actor` fields cannot
// move the actor. The single exception is `apply_sanction`, an
// admin-gated action whose *target* is legitimately a body field
// (the admin is the actor: the dispatcher verifies the admin role
// before dispatch and stamps BOTH p_admin_id via `actorArg` and
// p_applied_by with the verified admin's own id — never a literal —
// and the RPC re-verifies has_role in the database; delta-audit
// D10/E7).

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
const fail = (error: string): Validation<never> => ({ ok: false, error });

export type Body = Record<string, unknown>;

// ---------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

function reqUuid(body: Body, field: string): Validation<string> {
  const v = body[field];
  if (!isUuid(v)) return fail(`${field} must be a valid id`);
  return ok(v);
}

function optUuid(body: Body, field: string): Validation<string | null> {
  const v = body[field];
  if (v === undefined || v === null) return ok(null);
  if (!isUuid(v)) return fail(`${field} must be a valid id`);
  return ok(v);
}

function reqString(
  body: Body,
  field: string,
  maxLen = 500,
): Validation<string> {
  const v = body[field];
  if (typeof v !== "string" || v.trim().length === 0) {
    return fail(`${field} is required`);
  }
  if (v.length > maxLen) return fail(`${field} is too long`);
  return ok(v);
}

function optString(
  body: Body,
  field: string,
  maxLen = 500,
): Validation<string | null> {
  const v = body[field];
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== "string") return fail(`${field} must be text`);
  if (v.length > maxLen) return fail(`${field} is too long`);
  return ok(v);
}

function reqNumber(
  body: Body,
  field: string,
  opts: { min?: number; max?: number } = {},
): Validation<number> {
  const v = body[field];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return fail(`${field} must be a number`);
  }
  if (opts.min !== undefined && v < opts.min) {
    return fail(`${field} is too small`);
  }
  if (opts.max !== undefined && v > opts.max) {
    return fail(`${field} is too large`);
  }
  return ok(v);
}

function optNumber(
  body: Body,
  field: string,
  opts: { min?: number; max?: number } = {},
): Validation<number | null> {
  const v = body[field];
  if (v === undefined || v === null) return ok(null);
  return reqNumber(body, field, opts);
}

function optInt(
  body: Body,
  field: string,
  opts: { min?: number; max?: number } = {},
): Validation<number | null> {
  const v = body[field];
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return fail(`${field} must be a whole number`);
  }
  if (opts.min !== undefined && v < opts.min) {
    return fail(`${field} is too small`);
  }
  if (opts.max !== undefined && v > opts.max) {
    return fail(`${field} is too large`);
  }
  return ok(v);
}

function optBool(body: Body, field: string): Validation<boolean> {
  const v = body[field];
  if (v === undefined || v === null) return ok(false);
  if (typeof v !== "boolean") return fail(`${field} must be true or false`);
  return ok(v);
}

function optStringArray(
  body: Body,
  field: string,
): Validation<string[] | null> {
  const v = body[field];
  if (v === undefined || v === null) return ok(null);
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    return fail(`${field} must be a list of text values`);
  }
  return ok(v as string[]);
}

/** Idempotency keys are required on every state transition (§2.3
 *  invariant 4) — same 8–80 char discipline as btc-trade. */
function reqIdempotencyKey(body: Body): Validation<string> {
  const v = body["idempotency_key"];
  if (typeof v !== "string" || v.length < 8 || v.length > 80) {
    return fail("idempotency_key is required (8–80 chars)");
  }
  return ok(v);
}

/** Collect a built args object from per-field validations, returning
 *  the first failure. Fields validated to null are OMITTED so the
 *  RPC's own DEFAULT applies (passing explicit null would override
 *  defaults like p_min_counterparty_tier = 'T1'). */
function collect(
  fields: Record<string, Validation<unknown>>,
): Validation<Record<string, unknown>> {
  const args: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(fields)) {
    if (!r.ok) return r;
    if (r.value !== null && r.value !== undefined) args[key] = r.value;
  }
  return ok(args);
}

// ---------------------------------------------------------------------
// Action table
// ---------------------------------------------------------------------

export interface RpcActionSpec {
  kind: "rpc";
  rpc: string;
  /** RPC argument the dispatcher fills with the JWT user's id. */
  actorArg?: string;
  /** Requires the admin role (checked by the dispatcher, and — for
   *  resolve_dispute — again inside the RPC itself). */
  admin?: boolean;
  /** Marketplace-entry action: refused while p2p_enabled is off.
   *  Lifecycle actions on existing orders are never entry actions —
   *  escrow must always be able to settle, even during a pause. */
  entry?: boolean;
  /** How the dispatcher wraps a non-jsonb RPC return. */
  wrap?: "tier" | "unmatured_sats" | "sanction_id" | "void";
  build: (body: Body) => Validation<Record<string, unknown>>;
}

export type ActionSpec =
  | RpcActionSpec
  | { kind: "message" }
  | { kind: "cron" };

const rpc = (
  spec: Omit<RpcActionSpec, "kind">,
): RpcActionSpec => ({ kind: "rpc", ...spec });

export const P2P_ACTIONS: Record<string, ActionSpec> = {
  // ── Payment methods (Phase 0 registry) ──────────────────────────
  create_payment_method: rpc({
    rpc: "p2p_create_payment_method",
    actorArg: "p_user_id",
    build: (b) =>
      collect({
        p_type: reqString(b, "type", 40),
        p_account_number: reqString(b, "account_number", 64),
        p_account_name: reqString(b, "account_name", 120),
        p_bank_name: optString(b, "bank_name", 120),
      }),
  }),
  set_payment_method_status: rpc({
    rpc: "p2p_set_payment_method_status",
    actorArg: "p_user_id",
    build: (b) =>
      collect({
        p_method_id: reqUuid(b, "method_id"),
        p_status: reqString(b, "status", 20),
      }),
  }),

  // ── Ads ─────────────────────────────────────────────────────────
  create_ad: rpc({
    rpc: "p2p_create_ad",
    actorArg: "p_owner_id",
    entry: true,
    build: (b) => {
      // BTC-only (CEO, 2026-10-23): USDT ads get the designed
      // not-available refusal (§4.2), never a silent BTC substitution.
      const asset = b["asset"];
      if (asset !== undefined && asset !== null && asset !== "BTC") {
        return fail(
          "USDT P2P trading is not available yet — P2P is Bitcoin (BTC) only for now.",
        );
      }
      return collect({
        p_side: reqString(b, "side", 20),
        p_asset: ok("BTC"),
        p_price_type: reqString(b, "price_type", 20),
        p_fixed_price_zmw: optNumber(b, "fixed_price_zmw", { min: 0 }),
        p_margin_percent: optNumber(b, "margin_percent", {
          min: -100,
          max: 100,
        }),
        p_total_amount_minor: optInt(b, "total_amount_minor", { min: 0 }),
        p_min_order_zmw: optNumber(b, "min_order_zmw", { min: 0 }),
        p_max_order_zmw: optNumber(b, "max_order_zmw", { min: 0 }),
        p_payment_method_types: optStringArray(b, "payment_method_types"),
        p_payment_window_minutes: optInt(b, "payment_window_minutes", {
          min: 1,
          max: 1440,
        }),
        p_settle_delay_minutes: optInt(b, "settle_delay_minutes", {
          min: 0,
          max: 10080,
        }),
        p_terms: optString(b, "terms", 2000),
        p_min_counterparty_tier: optString(b, "min_counterparty_tier", 4),
        p_min_counterparty_trades: optInt(b, "min_counterparty_trades", {
          min: 0,
        }),
      });
    },
  }),
  set_ad_status: rpc({
    rpc: "p2p_set_ad_status",
    actorArg: "p_owner_id",
    build: (b) =>
      collect({
        p_ad_id: reqUuid(b, "ad_id"),
        p_status: reqString(b, "status", 20),
      }),
  }),

  // ── Orders ──────────────────────────────────────────────────────
  create_order: rpc({
    rpc: "p2p_create_order",
    actorArg: "p_taker_id",
    entry: true,
    build: (b) =>
      collect({
        p_ad_id: reqUuid(b, "ad_id"),
        p_fiat_amount_zmw: optNumber(b, "fiat_amount_zmw", { min: 0 }),
        p_crypto_amount_minor: optInt(b, "crypto_amount_minor", { min: 0 }),
        p_seller_payment_method_id: optUuid(b, "seller_payment_method_id"),
        p_idempotency_key: reqIdempotencyKey(b),
        p_taker_ack_offmarket: optBool(b, "taker_ack_offmarket"),
      }),
  }),
  cancel_order: rpc({
    rpc: "p2p_cancel_order",
    actorArg: "p_caller_id",
    build: (b) =>
      collect({
        p_order_id: reqUuid(b, "order_id"),
        p_reason: optString(b, "reason", 500),
        p_idempotency_key: reqIdempotencyKey(b),
      }),
  }),
  mark_paid: rpc({
    rpc: "p2p_mark_paid",
    actorArg: "p_buyer_id",
    build: (b) =>
      collect({
        p_order_id: reqUuid(b, "order_id"),
        p_payment_method_id: reqUuid(b, "payment_method_id"),
        p_rail_reference: reqString(b, "rail_reference", 120),
        p_amount_sent_zmw: reqNumber(b, "amount_sent_zmw", { min: 0 }),
        p_payer_name_attested: optString(b, "payer_name_attested", 120),
        p_proof_file_hash: optString(b, "proof_file_hash", 128),
        p_proof_storage_path: optString(b, "proof_storage_path", 500),
        p_idempotency_key: reqIdempotencyKey(b),
      }),
  }),
  confirm_release: rpc({
    rpc: "p2p_confirm_release",
    actorArg: "p_seller_id",
    build: (b) =>
      collect({
        p_order_id: reqUuid(b, "order_id"),
        p_received_amount_zmw: reqNumber(b, "received_amount_zmw", {
          min: 0,
        }),
        p_received_reference: reqString(b, "received_reference", 120),
        // The §3.5 checklist booleans pass through verbatim — the RPC
        // refuses unless all three are true; the edge layer does not
        // soften that by defaulting them.
        p_checked_own_account: optBool(b, "checked_own_account"),
        p_checked_full_amount: optBool(b, "checked_full_amount"),
        p_checked_sender_name: optBool(b, "checked_sender_name"),
        p_idempotency_key: reqIdempotencyKey(b),
      }),
  }),

  // ── Disputes ────────────────────────────────────────────────────
  open_dispute: rpc({
    rpc: "p2p_open_dispute",
    actorArg: "p_caller_id",
    build: (b) =>
      collect({
        p_order_id: reqUuid(b, "order_id"),
        p_reason: reqString(b, "reason", 40),
        p_detail: optString(b, "detail", 2000),
        p_idempotency_key: reqIdempotencyKey(b),
      }),
  }),
  add_dispute_evidence: rpc({
    rpc: "p2p_add_dispute_evidence",
    actorArg: "p_caller_id",
    build: (b) =>
      collect({
        p_dispute_id: reqUuid(b, "dispute_id"),
        p_kind: reqString(b, "kind", 20),
        p_body: optString(b, "body", 4000),
        p_storage_path: optString(b, "storage_path", 500),
        p_file_hash: optString(b, "file_hash", 128),
      }),
  }),
  propose_dispute_closure: rpc({
    rpc: "p2p_propose_dispute_closure",
    actorArg: "p_caller_id",
    build: (b) =>
      collect({
        p_dispute_id: reqUuid(b, "dispute_id"),
        p_outcome: reqString(b, "outcome", 30),
      }),
  }),
  confirm_dispute_closure: rpc({
    rpc: "p2p_confirm_dispute_closure",
    actorArg: "p_caller_id",
    build: (b) =>
      collect({
        p_dispute_id: reqUuid(b, "dispute_id"),
      }),
  }),
  resolve_dispute: rpc({
    rpc: "p2p_resolve_dispute",
    actorArg: "p_admin_id",
    admin: true,
    build: (b) =>
      collect({
        p_dispute_id: reqUuid(b, "dispute_id"),
        p_outcome: reqString(b, "outcome", 30),
        p_notes: reqString(b, "notes", 4000),
        p_sanction_level: optInt(b, "sanction_level", { min: 0, max: 4 }),
        p_sanction_reason_code: optString(b, "sanction_reason_code", 60),
        p_idempotency_key: reqIdempotencyKey(b),
      }),
  }),

  // ── Sanctions (admin console actions, §4.3) ─────────────────────
  apply_sanction: rpc({
    rpc: "p2p_apply_sanction",
    actorArg: "p_admin_id",
    admin: true,
    wrap: "sanction_id",
    build: (b) => {
      const duration = b["duration"];
      if (
        duration !== undefined &&
        duration !== null &&
        (typeof duration !== "string" ||
          !/^\d+\s+(days?|weeks?|months?|hours?)$/i.test(duration))
      ) {
        return fail("duration must look like '7 days'");
      }
      return collect({
        // The TARGET user — the one legitimate body-supplied user id
        // in this table (see the module header). The acting admin is
        // verified by the dispatcher, stamped as p_admin_id
        // (actorArg) + p_applied_by, and re-verified inside the RPC.
        p_user_id: reqUuid(b, "user_id"),
        p_scope: reqString(b, "scope", 20),
        p_level: (() => {
          const v = b["level"];
          if (
            typeof v !== "number" ||
            !Number.isInteger(v) ||
            v < 0 ||
            v > 4
          ) {
            return fail("level must be a whole number from 0 to 4");
          }
          return ok(v);
        })(),
        p_reason_code: reqString(b, "reason_code", 60),
        p_detail: reqString(b, "detail", 2000),
        p_duration: ok(
          typeof duration === "string" ? duration : null,
        ),
      });
    },
  }),
  revoke_sanction: rpc({
    rpc: "p2p_revoke_sanction",
    actorArg: "p_admin_id",
    admin: true,
    wrap: "void",
    build: (b) =>
      collect({
        p_sanction_id: reqUuid(b, "sanction_id"),
      }),
  }),
  // The audited clear path for the re-review queue (delta-audit D4):
  // direct admin UPDATEs on p2p_reviews no longer exist.
  resolve_review: rpc({
    rpc: "p2p_resolve_review",
    actorArg: "p_admin_id",
    admin: true,
    wrap: "void",
    build: (b) =>
      collect({
        p_review_id: reqUuid(b, "review_id"),
      }),
  }),

  // ── Blocks & reports ────────────────────────────────────────────
  block_user: rpc({
    rpc: "p2p_block_user",
    actorArg: "p_blocker_id",
    build: (b) =>
      collect({
        p_blocked_id: reqUuid(b, "blocked_id"),
        p_reason: optString(b, "reason", 500),
      }),
  }),
  unblock_user: rpc({
    rpc: "p2p_unblock_user",
    actorArg: "p_blocker_id",
    build: (b) =>
      collect({
        p_blocked_id: reqUuid(b, "blocked_id"),
      }),
  }),
  report_user: rpc({
    rpc: "p2p_report_user",
    actorArg: "p_reporter_id",
    build: (b) =>
      collect({
        p_subject_id: reqUuid(b, "subject_id"),
        p_category: reqString(b, "category", 40),
        p_order_id: optUuid(b, "order_id"),
        p_detail: optString(b, "detail", 2000),
      }),
  }),

  // ── Self reads (actor is always the caller) ─────────────────────
  get_limits: rpc({
    rpc: "p2p_effective_limits",
    actorArg: "p_user_id",
    build: () => ok({}),
  }),
  get_tier: rpc({
    rpc: "p2p_kyc_tier",
    actorArg: "p_user_id",
    wrap: "tier",
    build: () => ok({}),
  }),
  get_unmatured_holds: rpc({
    rpc: "p2p_unmatured_withdrawal_hold_sats",
    actorArg: "p_user_id",
    wrap: "unmatured_sats",
    build: () => ok({}),
  }),

  // ── Non-RPC actions (handled by the dispatcher itself) ──────────
  send_message: { kind: "message" },
  refresh_price_index: { kind: "cron" },
};

/** Validate a body for an RPC action and build its argument object
 *  (without the actor argument — the dispatcher injects it). */
export function buildRpcArgs(
  action: string,
  body: Body,
): Validation<{ spec: RpcActionSpec; args: Record<string, unknown> }> {
  const spec = P2P_ACTIONS[action];
  if (!spec || spec.kind !== "rpc") {
    return fail(`Unknown action: ${action}`);
  }
  const built = spec.build(body);
  if (!built.ok) return built;
  return ok({ spec, args: built.value });
}
