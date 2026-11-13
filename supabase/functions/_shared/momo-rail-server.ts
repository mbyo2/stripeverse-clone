// Merchant mobile-money rail — server companion (Deno-only: fetch,
// env, Supabase service-role client). The pure rules live in
// _shared/momo-rail.ts; this module performs them:
//
//   * loads a merchant's connected gateway credential (decrypting it
//     in-function only, at the moment of use),
//   * calls the gateway's collections API with the MERCHANT's token —
//     collections are created on the merchant's own gateway account;
//     the platform token is never involved because there isn't one,
//   * drives settlement: a collection settles ONLY from a re-queried
//     gateway status, applied through the settle_momo_collection RPC
//     (row-locked, terminal-guarded, amount-checked, exactly-once).
//     Webhook payloads are hints that trigger a requery — the same
//     discipline as the platform's telco ledger.

import {
  detectOperator,
  friendlyFailureReason,
  mapProviderStatus,
  momoBuyerTotalFor,
  normalizeZmPhone,
  railBaseUrl,
  type MomoEnvironment,
  type MomoFeeBearer,
  type MomoInternalStatus,
  type MomoOperator,
} from "./momo-rail.ts";
import { decryptSecret, secretVaultKeyFromEnv } from "./secret-vault.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface MomoConnection {
  id: string;
  user_id: string;
  environment: MomoEnvironment;
  api_base_url: string | null;
  account_id: string | null;
  key_hint: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  /** Decrypted in-function only. Never serialise a connection that
   *  carries this field into a response. */
  secretKey?: string;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  environment: MomoEnvironment;
  api_base_url: string | null;
  account_id: string | null;
  key_hint: string | null;
  status: string;
  secret_key_ciphertext: string;
  secret_key_iv: string;
  vault_key_version: number;
  created_at: string;
  updated_at: string;
}

const CONNECTION_COLUMNS =
  "id, user_id, environment, api_base_url, account_id, key_hint, status, secret_key_ciphertext, secret_key_iv, vault_key_version, created_at, updated_at";

async function decryptRow(row: ConnectionRow): Promise<MomoConnection> {
  const vaultKey = secretVaultKeyFromEnv();
  if (!vaultKey) throw new Error("vault_not_configured");
  const secretKey = await decryptSecret(
    { ciphertext: row.secret_key_ciphertext, iv: row.secret_key_iv, keyVersion: row.vault_key_version },
    vaultKey,
  );
  const { secret_key_ciphertext: _c, secret_key_iv: _i, vault_key_version: _v, ...rest } = row;
  return { ...rest, secretKey };
}

/** The merchant's connection for one environment, decrypted. */
export async function loadConnection(
  db: Db,
  userId: string,
  environment: MomoEnvironment,
): Promise<MomoConnection | null> {
  const { data, error } = await db
    .from("merchant_momo_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .eq("environment", environment)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return decryptRow(data as ConnectionRow);
}

/** Any active connection for the merchant (either environment). */
export async function loadAnyConnection(db: Db, userId: string): Promise<MomoConnection | null> {
  const { data, error } = await db
    .from("merchant_momo_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return decryptRow(data as ConnectionRow);
}

/** Secret-free connection summary straight from the row — used by
 *  status surfaces that must not decrypt anything. */
export async function loadConnectionSummary(
  db: Db,
  userId: string,
  environment: MomoEnvironment,
): Promise<MomoConnection | null> {
  const { data, error } = await db
    .from("merchant_momo_connections")
    .select("id, user_id, environment, api_base_url, account_id, key_hint, status, created_at, updated_at")
    .eq("user_id", userId)
    .eq("environment", environment)
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MomoConnection | null) ?? null;
}

/** Public (secret-free) connection summary for API responses. */
export function connectionSummary(c: MomoConnection | null) {
  if (!c) return null;
  return {
    connected: true,
    environment: c.environment,
    key_hint: c.key_hint,
    account_id: c.account_id,
    connected_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// ── Gateway client (merchant's own token) ───────────────────────────

export interface RailCollectionData {
  reference?: string;
  lencoReference?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
  fee?: string | number | null;
  reasonForFailure?: string | null;
  [k: string]: unknown;
}

export class RailApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function railFetch(
  conn: MomoConnection,
  path: string,
  init?: RequestInit,
): Promise<{ status: boolean; message?: string; data?: RailCollectionData }> {
  if (!conn.secretKey) throw new Error("connection_not_loaded");
  const base = railBaseUrl(conn.environment, conn.api_base_url);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${conn.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "BMaGlassPay/1.0",
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new RailApiError(0, `gateway_unreachable: ${e instanceof Error ? e.message : "network error"}`);
  }
  const text = await res.text();
  let json: { status?: boolean; message?: string; data?: RailCollectionData } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new RailApiError(res.status, `gateway_non_json: HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new RailApiError(res.status, `gateway_error: HTTP ${res.status}: ${json.message || text.slice(0, 160)}`);
  }
  return json;
}

/** Lightweight credential check used when a merchant connects:
 *  the accounts list answers only for a valid token. */
export async function validateRailCredential(
  secretKey: string,
  environment: MomoEnvironment,
): Promise<{ ok: boolean; accountId: string | null }> {
  const probe: MomoConnection = {
    id: "probe", user_id: "probe", environment, api_base_url: null,
    account_id: null, key_hint: null, status: "connected",
    created_at: "", updated_at: "", secretKey,
  };
  const env = await railFetch(probe, "/accounts");
  const data = env.data as unknown;
  let accountId: string | null = null;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as { id?: string };
    accountId = typeof first?.id === "string" ? first.id : null;
  } else if (data && typeof data === "object" && typeof (data as { id?: string }).id === "string") {
    accountId = (data as { id: string }).id;
  }
  return { ok: env.status !== false, accountId };
}

/** The merchant's fee-bearer choice (merchant_accounts, default
 *  'seller'). Read server-side on every collection start — never
 *  from the client, never cached. An unknown value or a missing
 *  merchant row falls back to 'seller' (today's behaviour); a
 *  database error fails the start instead of guessing. */
export async function loadFeeBearer(db: Db, userId: string): Promise<MomoFeeBearer> {
  const { data, error } = await db
    .from("merchant_accounts")
    .select("momo_fee_bearer")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.momo_fee_bearer === "buyer" ? "buyer" : "seller";
}

/** Create a collection on the merchant's gateway account. The
 *  customer authorises on their handset; the returned status is
 *  normally 'pay-offline' (pending) at this point. The rail bearer
 *  follows the merchant's fee-bearer choice: 'customer' when the
 *  buyer pays the charges on top, 'merchant' when the seller
 *  absorbs them. */
export async function createRailCollection(
  conn: MomoConnection,
  input: { amount: number; reference: string; phone: string; operator: MomoOperator; bearer: "merchant" | "customer" },
): Promise<RailCollectionData> {
  const env = await railFetch(conn, "/collections/mobile-money", {
    method: "POST",
    body: JSON.stringify({
      amount: Number(input.amount),
      currency: "ZMW",
      reference: input.reference,
      phone: normalizeZmPhone(input.phone),
      operator: input.operator,
      country: "zm",
      bearer: input.bearer,
    }),
  });
  if (!env.data) throw new RailApiError(502, "gateway_empty_response");
  return env.data;
}

/** Requery a collection's authoritative status by our reference. */
export async function getRailCollectionStatus(
  conn: MomoConnection,
  reference: string,
): Promise<RailCollectionData> {
  const env = await railFetch(conn, `/collections/status/${encodeURIComponent(reference)}`);
  if (!env.data) throw new RailApiError(502, "gateway_empty_response");
  return env.data;
}

// ── Settlement driver ───────────────────────────────────────────────

export interface SettleOutcome {
  outcome: string;
  collection_status: string | null;
  transaction_status: string | null;
  wallet_balance: number | null;
  just_settled: boolean;
  just_failed: boolean;
  collection_id: string | null;
  transaction_id: string | null;
  payment_link_id: string | null;
  merchant_user_id: string | null;
  amount: number | null;
  /** The product amount the 1% charge is computed on (== amount in
   *  seller mode; smaller than amount in buyer mode). */
  base_amount: number | null;
}

/** Requery the gateway for one collection and apply the result
 *  through the exactly-once settle RPC. Safe to call from the status
 *  endpoint, the webhook (as a hint) and the poller, any number of
 *  times, concurrently — the RPC's row lock + terminal guard make
 *  repeats no-ops. */
export async function refreshCollectionFromRail(
  db: Db,
  reference: string,
): Promise<SettleOutcome> {
  const { data: row, error } = await db
    .from("momo_collections")
    .select("id, user_id, environment, status, base_amount, created_at")
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) {
    return {
      outcome: "not_found", collection_status: null, transaction_status: null,
      wallet_balance: null, just_settled: false, just_failed: false,
      collection_id: null, transaction_id: null, payment_link_id: null,
      merchant_user_id: null, amount: null, base_amount: null,
    };
  }
  if (row.status !== "pending") {
    return {
      outcome: "already_terminal", collection_status: row.status,
      transaction_status: row.status === "successful" ? "completed" : "failed",
      wallet_balance: null, just_settled: false, just_failed: false,
      collection_id: row.id, transaction_id: null, payment_link_id: null,
      merchant_user_id: row.user_id, amount: null,
      base_amount: row.base_amount != null ? Number(row.base_amount) : null,
    };
  }
  const conn = await loadConnection(db, row.user_id, row.environment as MomoEnvironment);
  if (!conn) {
    return {
      outcome: "connection_missing", collection_status: "pending", transaction_status: "pending",
      wallet_balance: null, just_settled: false, just_failed: false,
      collection_id: row.id, transaction_id: null, payment_link_id: null,
      merchant_user_id: row.user_id, amount: null,
      base_amount: row.base_amount != null ? Number(row.base_amount) : null,
    };
  }
  let data: RailCollectionData;
  try {
    data = await getRailCollectionStatus(conn, reference);
  } catch (e) {
    // A collection the gateway has never heard of, minutes after it
    // was created, never started: close it as failed rather than
    // leaving it pending forever. Young rows are exempt — a status
    // read can race a just-created collection.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (e instanceof RailApiError && e.status === 404 && ageMs > 120_000) {
      const { data: rpcRows, error: rpcError } = await db.rpc("settle_momo_collection", {
        p_reference: reference,
        p_provider_status: "failed",
        p_provider_reference: null,
        p_provider_amount: null,
        p_provider_currency: null,
        p_provider_fee: null,
        p_provider_status_raw: "not_found",
        p_failure_reason: friendlyFailureReason("not_found"),
      });
      if (rpcError) throw new Error(rpcError.message);
      const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      return {
        outcome: rpc?.outcome ?? "failed_terminal",
        collection_status: rpc?.collection_status ?? "failed",
        transaction_status: rpc?.transaction_status ?? "failed",
        wallet_balance: rpc?.wallet_balance != null ? Number(rpc.wallet_balance) : null,
        just_settled: false,
        just_failed: rpc?.outcome === "failed_terminal",
        collection_id: rpc?.collection_id ?? row.id,
        transaction_id: rpc?.transaction_id ?? null,
        payment_link_id: rpc?.payment_link_id ?? null,
        merchant_user_id: rpc?.merchant_user_id ?? row.user_id,
        amount: rpc?.amount != null ? Number(rpc.amount) : null,
        base_amount: rpc?.base_amount != null ? Number(rpc.base_amount) : null,
      };
    }
    throw e;
  }
  const internal: MomoInternalStatus = mapProviderStatus(data.status);
  const { data: rpcRows, error: rpcError } = await db.rpc("settle_momo_collection", {
    p_reference: reference,
    p_provider_status: internal,
    p_provider_reference: typeof data.lencoReference === "string" ? data.lencoReference : null,
    p_provider_amount: data.amount != null ? Number(data.amount) : null,
    p_provider_currency: typeof data.currency === "string" ? data.currency : null,
    p_provider_fee: data.fee != null ? Number(data.fee) : null,
    p_provider_status_raw: typeof data.status === "string" ? data.status : null,
    p_failure_reason: internal === "failed"
      ? friendlyFailureReason(data.status, data.reasonForFailure ?? null)
      : null,
  });
  if (rpcError) throw new Error(rpcError.message);
  const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  return {
    outcome: rpc?.outcome ?? "unknown",
    collection_status: rpc?.collection_status ?? null,
    transaction_status: rpc?.transaction_status ?? null,
    wallet_balance: rpc?.wallet_balance != null ? Number(rpc.wallet_balance) : null,
    just_settled: rpc?.outcome === "settled",
    just_failed: rpc?.outcome === "failed_terminal",
    collection_id: rpc?.collection_id ?? row.id,
    transaction_id: rpc?.transaction_id ?? null,
    payment_link_id: rpc?.payment_link_id ?? null,
    merchant_user_id: rpc?.merchant_user_id ?? row.user_id,
    amount: rpc?.amount != null ? Number(rpc.amount) : null,
    base_amount: rpc?.base_amount != null ? Number(rpc.base_amount) : null,
  };
}

// ── Create driver (shared by the merchant endpoint and checkout) ────

export interface StartCollectionInput {
  merchantUserId: string;
  accountId: string | null;
  amount: number;
  phone: string;
  operator: MomoOperator;
  environment: MomoEnvironment;
  source: "direct" | "payment_link";
  paymentLinkId: string | null;
  idempotencyKey: string;
  reference: string;
}

export interface StartCollectionResult {
  kind: "pending" | "existing" | "start_failed" | "conflict" | "unknown";
  reference: string;
  collectionId: string | null;
  transactionId: string | null;
  status: string;
  message: string;
  /** The total the buyer is charged (product + service charge in
   *  buyer mode; the product amount in seller mode). */
  amount: number;
  /** The product amount the 1% charge is computed on. */
  baseAmount: number;
  /** The 1% service charge (0 in seller mode — the seller absorbs
   *  it from their wallet after settlement instead). */
  serviceCharge: number;
  feeBearer: MomoFeeBearer;
}

/** Ledger-first collection start: the begin RPC writes the
 *  collection + transaction rows BEFORE the gateway is called, then
 *  the gateway call runs on the merchant's own account. A gateway
 *  validation refusal closes the ledger row as failed (never a
 *  credit); a network ambiguity leaves it pending for the requery
 *  paths to resolve — money is only ever credited by the settle RPC
 *  from a re-queried successful status.
 *
 *  The merchant's fee-bearer choice is applied HERE, once, for
 *  every caller (website checkout, payment links, developer API):
 *  in buyer mode the collection amount is the product amount
 *  grossed up by the 1% service charge, the ledger records the
 *  product amount as base_amount, and the rail is told the buyer
 *  bears its own fee (bearer 'customer'); in seller mode the
 *  amounts are unchanged and the rail bearer stays 'merchant'.
 *  `input.amount` is always the PRODUCT amount. */
export async function startCollection(
  db: Db,
  conn: MomoConnection,
  input: StartCollectionInput,
): Promise<StartCollectionResult> {
  const feeBearer = await loadFeeBearer(db, input.merchantUserId);
  const breakdown = momoBuyerTotalFor(input.amount, feeBearer);
  const { data: rpcRows, error } = await db.rpc("begin_momo_collection", {
    p_user_id: input.merchantUserId,
    p_account_id: input.accountId,
    p_reference: input.reference,
    p_amount: breakdown.total,
    p_base_amount: breakdown.baseAmount,
    p_operator: input.operator,
    p_phone: normalizeZmPhone(input.phone),
    p_environment: input.environment,
    p_source: input.source,
    p_payment_link_id: input.paymentLinkId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error(error.message);
  const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!rpc) throw new Error("begin_momo_collection returned no row");
  if (rpc.outcome === "idempotency_conflict") {
    return {
      kind: "conflict", reference: input.reference, collectionId: null,
      transactionId: null, status: "failed",
      message: "That request was already used for a different payment. Start a new payment instead.",
      amount: breakdown.total, baseAmount: breakdown.baseAmount,
      serviceCharge: breakdown.serviceCharge, feeBearer,
    };
  }
  if (rpc.outcome === "existing") {
    return {
      kind: "existing", reference: rpc.reference, collectionId: rpc.collection_id,
      transactionId: rpc.transaction_id, status: rpc.collection_status,
      message: "This payment was already started.",
      amount: breakdown.total, baseAmount: breakdown.baseAmount,
      serviceCharge: breakdown.serviceCharge, feeBearer,
    };
  }
  try {
    const data = await createRailCollection(conn, {
      amount: breakdown.total,
      reference: input.reference,
      phone: input.phone,
      operator: input.operator,
      bearer: feeBearer === "buyer" ? "customer" : "merchant",
    });
    // Record whatever the gateway already knows (its reference and
    // any instantly-terminal status) through the settle path.
    const internal = mapProviderStatus(data.status);
    if (internal !== "pending" || data.lencoReference) {
      await db.rpc("settle_momo_collection", {
        p_reference: input.reference,
        p_provider_status: internal,
        p_provider_reference: typeof data.lencoReference === "string" ? data.lencoReference : null,
        p_provider_amount: internal === "pending" ? null : (data.amount != null ? Number(data.amount) : null),
        p_provider_currency: internal === "pending" ? null : (typeof data.currency === "string" ? data.currency : null),
        p_provider_fee: data.fee != null ? Number(data.fee) : null,
        p_provider_status_raw: typeof data.status === "string" ? data.status : null,
        p_failure_reason: internal === "failed" ? friendlyFailureReason(data.status, data.reasonForFailure ?? null) : null,
      });
    }
    return {
      kind: "pending", reference: input.reference, collectionId: rpc.collection_id,
      transactionId: rpc.transaction_id, status: "pending",
      message: "Approve the payment prompt on your phone to complete this payment.",
      amount: breakdown.total, baseAmount: breakdown.baseAmount,
      serviceCharge: breakdown.serviceCharge, feeBearer,
    };
  } catch (e) {
    if (e instanceof RailApiError && e.status >= 400 && e.status < 500) {
      // The gateway refused the request itself (bad number, bad
      // reference, auth): the payment never started — close the
      // ledger row as failed so it can't be settled later.
      await db.rpc("settle_momo_collection", {
        p_reference: input.reference,
        p_provider_status: "failed",
        p_provider_reference: null,
        p_provider_amount: null,
        p_provider_currency: null,
        p_provider_fee: null,
        p_provider_status_raw: "start_refused",
        p_failure_reason: friendlyFailureReason("start_refused"),
      }).catch(() => null);
      return {
        kind: "start_failed", reference: input.reference, collectionId: rpc.collection_id,
        transactionId: rpc.transaction_id, status: "failed",
        message: "The payment couldn't be started. Check the phone number and try again — no money was taken.",
        amount: breakdown.total, baseAmount: breakdown.baseAmount,
        serviceCharge: breakdown.serviceCharge, feeBearer,
      };
    }
    // Network/5xx ambiguity: the gateway may or may not have created
    // the collection. Leave the row pending; status polling and the
    // requery poller resolve it from the gateway's own record.
    return {
      kind: "unknown", reference: input.reference, collectionId: rpc.collection_id,
      transactionId: rpc.transaction_id, status: "pending",
      message: "Approve the payment prompt on your phone if one arrives — we're confirming the payment's status.",
      amount: breakdown.total, baseAmount: breakdown.baseAmount,
      serviceCharge: breakdown.serviceCharge, feeBearer,
    };
  }
}

export { detectOperator };
