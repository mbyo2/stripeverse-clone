// pos: the Bitcoin POS data bridge — the single client path into the
// merchant POS data layer (migration 20261030_bitcoin_pos_data.sql).
//
// This is a DATA layer, not a checkout: merchants create BTC payment
// requests at their till, customers pay on-chain to the merchant's
// BMaGlass deposit address, and the merchant's existing POS /
// accounting system pulls the settled records back out.
//
// Actions (POST JSON { action, ... }):
//   Merchant UI actions (user JWT):
//     create_request          { reference, fiat_amount_zmw,
//                               expires_in_minutes? } → request + BIP21
//     list_requests           { status?, from?, to?, limit?, offset? }
//     get_request             { id }
//     cancel_request          { id }
//     create_api_key          { label? } → plain key, shown ONCE
//     list_api_keys           → metadata only, never hashes or keys
//     revoke_api_key          { id }
//     export_csv              { from?, to? } → { csv, filename, count }
//   Machine actions (Authorization: Bearer bmp_pos_... API key):
//     list_requests           same shape as above
//     get_request_by_reference { reference }
//
// Identity: the actor is ALWAYS resolved here — from the verified JWT
// for UI actions, from the hashed API key for machine actions — and
// every query/RPC is scoped to that merchant. Key material is hashed
// (SHA-256, _shared/pos-core) before it touches the database; the
// plain key exists only in the create_api_key response.
//
// Address issuance is REUSED, not reimplemented: create_request calls
// btc-onchain's `receive` with the merchant's own JWT, so the address
// is the merchant's one BIP84 deposit address from the existing
// custody setup, including its honest "not configured" refusal.
//
// Pricing: the latest non-stale p2p_price_snapshots BTC index
// (Coinbase/Kraken cross-checked x exchange_rates — the index P2P
// uses), raw index with NO trade spread, floored (pos-core). A stale
// or missing index refuses in plain language rather than guessing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";
import {
  bip21Uri,
  fiatZmwToSats,
  generatePosApiKey,
  isPosApiKey,
  isPosRequestStatus,
  normaliseFiatZmw,
  normaliseMerchantReference,
  requestsToCsv,
  sha256Hex,
  timingSafeEqual,
  type PosRequestCsvRow,
} from "../_shared/pos-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_SOURCE = "p2p_price_snapshots";
const DEFAULT_STALE_MINUTES = 5;
const DEFAULT_EXPIRY_MINUTES = 120;
const MIN_EXPIRY_MINUTES = 5;
const MAX_EXPIRY_MINUTES = 10_080; // 7 days
const MACHINE_RATE_LIMIT = 120; // requests per key per minute (best-effort, per isolate)

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Delta-audit E3: every database failure leaves this function as a
// crafted response, mirroring the p2p function's rpcErrorResponse.
// P0001 is a deliberate RAISE from our RPCs — its message is crafted
// plain language written for the user, so it passes through. Known
// constraint codes get crafted messages; everything else is a
// generic 500. Raw Postgres text appears ONLY in the server log —
// never in a response body (standing CEO rule: no raw system text).
function posErrorResponse(error: any) {
  console.error("pos rpc/query failed:", error);
  if (error?.code === "P0001") return json(400, { error: error.message });
  if (error?.code === "23505") {
    return json(409, {
      error: "That already exists — it may have been saved already. Check first, and try again if needed.",
    });
  }
  if (error?.code === "42501") {
    return json(403, { error: "You don't have permission to do that." });
  }
  return json(500, {
    error: "Something went wrong on our side. Please try again.",
  });
}

// ── Machine rate limiting (in-memory; isolates are ephemeral, so this
// is a burst guard, not a billing-grade quota — say so in the docs).
const rateBuckets = new Map<string, { start: number; count: number }>();
function machineRateOk(keyId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(keyId);
  if (!bucket || now - bucket.start >= 60_000) {
    rateBuckets.set(keyId, { start: now, count: 1 });
    pruneMap(rateBuckets, 5_000);
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MACHINE_RATE_LIMIT;
}

// ── Delta-audit E4: pre-lookup throttling for machine tokens. The
// key lookup is the cost centre (a database round-trip per attempt)
// and it used to run BEFORE any limiter, so key enumeration was
// unthrottled. Two in-memory brakes now sit in front of it:
//   - a negative cache: a token hash that just failed is refused
//     from memory for 60s, with no query at all;
//   - a per-source-IP failure budget (30 failed attempts/minute)
//     that slows enumeration floods across many distinct tokens.
// Legitimate keys never accumulate failures, so real tills are
// unaffected. Same isolate caveat as above: burst brakes, not quotas.
const failedKeyHashes = new Map<string, number>();
const machineFailures = new Map<string, { start: number; count: number }>();
const MACHINE_FAILURE_LIMIT = 30;
const FAILED_KEY_TTL_MS = 60_000;

function pruneMap<K, V>(map: Map<K, V>, max: number) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest as K);
  }
}

function machineFailureBudgetOk(ip: string): boolean {
  const bucket = machineFailures.get(ip);
  if (!bucket || Date.now() - bucket.start >= 60_000) return true;
  return bucket.count < MACHINE_FAILURE_LIMIT;
}

function recordMachineFailure(ip: string) {
  const now = Date.now();
  const bucket = machineFailures.get(ip);
  if (!bucket || now - bucket.start >= 60_000) {
    machineFailures.set(ip, { start: now, count: 1 });
    pruneMap(machineFailures, 5_000);
  } else {
    bucket.count += 1;
  }
}

const REQUEST_COLUMNS =
  "id, user_id, merchant_reference, fiat_amount_zmw, sats_expected, " +
  "btc_zmw_rate, rate_source, deposit_address, status, txid, " +
  "sats_received, confirmations_at_detection, btc_zmw_rate_at_payment, " +
  "paid_at, expires_at, cancelled_at, created_at, updated_at";

function shapeRequest(row: Record<string, unknown>) {
  return {
    ...row,
    bip21_uri: bip21Uri(
      String(row.deposit_address),
      Number(row.sats_expected),
      String(row.merchant_reference),
    ),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = getServiceRoleClient();
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    if (!action) return json(400, { error: "An action is required." });

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");

    // ── Machine path: POS API key ──────────────────────────────────
    if (isPosApiKey(token)) {
      return await handleMachine(admin, req, token, action, body);
    }

    // ── Merchant UI path: user JWT ─────────────────────────────────
    const requestClient = getSupabaseClient(req);
    const {
      data: { user },
      error: authError,
    } = await requestClient.auth.getUser(token);
    if (authError || !user) return json(401, { error: "Please sign in again." });

    switch (action) {
      case "create_request":
        return await createRequest(admin, req, user.id, body);
      case "list_requests":
        return await listRequests(admin, user.id, body);
      case "get_request":
        return await getRequest(admin, user.id, body);
      case "get_request_by_reference":
        return await getRequestByReference(admin, user.id, body);
      case "cancel_request":
        return await cancelRequest(admin, user.id, body);
      case "create_api_key":
        return await createApiKey(admin, user.id, body);
      case "list_api_keys":
        return await listApiKeys(admin, user.id);
      case "revoke_api_key":
        return await revokeApiKey(admin, user.id, body);
      case "export_csv":
        return await exportCsv(admin, user.id, body);
      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (e) {
    // Delta-audit E3: nothing raw ever reaches the client — the
    // detail goes to the server log only.
    console.error("pos error:", e);
    return json(500, {
      error: "Something went wrong on our side. Please try again.",
    });
  }
});

// ── Machine (API key) dispatch ───────────────────────────────────────

async function handleMachine(
  admin: ReturnType<typeof getServiceRoleClient>,
  req: Request,
  plainKey: string,
  action: string,
  body: Record<string, unknown>,
) {
  if (action !== "list_requests" && action !== "get_request_by_reference") {
    return json(403, {
      error: "This API key can only read payment requests. Sign in to the app to make changes.",
    });
  }

  const keyHash = await sha256Hex(plainKey);

  // Delta-audit E4: both brakes run BEFORE the key lookup (see the
  // limiter block above). A cached failure gets the same crafted
  // 401 as a fresh one — the responses are indistinguishable.
  const sourceIp =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  const negUntil = failedKeyHashes.get(keyHash);
  if (negUntil && negUntil > Date.now()) {
    return json(401, { error: "That API key is not valid. Check the key, or create a new one in the app." });
  }
  if (!machineFailureBudgetOk(sourceIp)) {
    return json(429, {
      error: "Too many failed API key attempts from this connection. Wait a minute and try again.",
    });
  }

  const { data: keyRow, error } = await admin
    .from("pos_api_keys")
    .select("id, user_id, key_hash, revoked")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) return posErrorResponse(error);
  if (!keyRow || keyRow.revoked || !timingSafeEqual(String(keyRow.key_hash), keyHash)) {
    failedKeyHashes.set(keyHash, Date.now() + FAILED_KEY_TTL_MS);
    pruneMap(failedKeyHashes, 10_000);
    recordMachineFailure(sourceIp);
    return json(401, { error: "That API key is not valid. Check the key, or create a new one in the app." });
  }

  if (!machineRateOk(String(keyRow.id))) {
    return json(429, { error: "Too many requests for this API key. Please slow down and try again shortly." });
  }

  // Best-effort usage stamp (the RPC throttles itself to 1/minute).
  admin.rpc("pos_touch_api_key", { p_key_id: keyRow.id }).then(
    () => {},
    () => {},
  );

  const merchantId = String(keyRow.user_id);
  if (action === "list_requests") return await listRequests(admin, merchantId, body);
  return await getRequestByReference(admin, merchantId, body);
}

// ── Settings + price helpers ─────────────────────────────────────────

async function posSettings(admin: ReturnType<typeof getServiceRoleClient>) {
  const { data } = await admin
    .from("platform_settings")
    .select("pos_enabled, pos_default_expiry_minutes, p2p_price_stale_minutes")
    .limit(1)
    .maybeSingle();
  return {
    enabled: data?.pos_enabled !== false,
    defaultExpiryMinutes:
      Number(data?.pos_default_expiry_minutes) > 0
        ? Number(data.pos_default_expiry_minutes)
        : DEFAULT_EXPIRY_MINUTES,
    staleMinutes:
      Number(data?.p2p_price_stale_minutes) > 0
        ? Number(data.p2p_price_stale_minutes)
        : DEFAULT_STALE_MINUTES,
  };
}

async function latestBtcIndexZmw(
  admin: ReturnType<typeof getServiceRoleClient>,
  staleMinutes: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data } = await admin
    .from("p2p_price_snapshots")
    .select("index_zmw, is_stale, created_at")
    .eq("asset", "BTC")
    .eq("is_stale", false)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rate = Number(data?.index_zmw);
  return data && Number.isFinite(rate) && rate > 0 ? rate : null;
}

// The merchant's deposit address, from the EXISTING issuance path:
// btc-onchain `receive`, called with the merchant's own JWT. Its
// designed refusals (custody not configured etc.) are already plain
// language and are passed through untouched.
async function merchantDepositAddress(
  req: Request,
): Promise<{ address: string } | { error: string; status: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const res = await fetch(`${supabaseUrl}/functions/v1/btc-onchain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") || "",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({ action: "receive" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) {
    return { error: "We could not get your Bitcoin deposit address. Please try again.", status: 502 };
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.address) {
    return {
      error: typeof payload?.error === "string"
        ? payload.error
        : "We could not get your Bitcoin deposit address. Please try again.",
      status: res.status >= 400 && res.status < 600 ? res.status : 502,
    };
  }
  return { address: String(payload.address) };
}

// ── Actions ──────────────────────────────────────────────────────────

async function createRequest(
  admin: ReturnType<typeof getServiceRoleClient>,
  req: Request,
  userId: string,
  body: Record<string, unknown>,
) {
  const settings = await posSettings(admin);
  if (!settings.enabled) {
    return json(503, {
      error: "Bitcoin POS is paused right now. Existing requests can still be viewed and exported.",
    });
  }

  const reference = normaliseMerchantReference(body?.reference);
  if (!reference) {
    return json(400, { error: "Give the request a reference — your till or order number, up to 64 characters." });
  }
  const fiat = normaliseFiatZmw(body?.fiat_amount_zmw);
  if (fiat === null) {
    return json(400, { error: "Enter an amount in kwacha, more than zero and no more than K1,000,000." });
  }
  let expiryMinutes = settings.defaultExpiryMinutes;
  if (body?.expires_in_minutes !== undefined && body?.expires_in_minutes !== null) {
    const n = Number(body.expires_in_minutes);
    if (!Number.isInteger(n) || n < MIN_EXPIRY_MINUTES || n > MAX_EXPIRY_MINUTES) {
      return json(400, {
        error: `The time to pay must be between ${MIN_EXPIRY_MINUTES} minutes and 7 days.`,
      });
    }
    expiryMinutes = n;
  }

  // Idempotent create: a till retrying the same reference + amount
  // gets the original request back, not a duplicate or an error.
  const { data: existing } = await admin
    .from("pos_payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .eq("merchant_reference", reference)
    .maybeSingle();
  if (existing) {
    if (Number(existing.fiat_amount_zmw) === fiat) {
      return json(200, { success: true, request: shapeRequest(existing), reused: true });
    }
    return json(409, {
      error: `Reference ${reference} was already used for a different amount. Use a new reference for this sale.`,
    });
  }

  const rate = await latestBtcIndexZmw(admin, settings.staleMinutes);
  if (rate === null) {
    return json(503, {
      error: "We can't price this in Bitcoin right now — the latest price check is out of date. Please try again in a minute.",
    });
  }

  const addr = await merchantDepositAddress(req);
  if ("error" in addr) return json(addr.status, { error: addr.error });

  const sats = fiatZmwToSats(fiat, rate);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();

  const { data: row, error } = await admin.rpc("pos_create_request", {
    p_user_id: userId,
    p_merchant_reference: reference,
    p_fiat_amount_zmw: fiat,
    p_sats_expected: sats,
    p_btc_zmw_rate: Math.round(rate * 100) / 100,
    p_rate_source: RATE_SOURCE,
    p_deposit_address: addr.address,
    p_expires_at: expiresAt,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return json(409, {
        error: `Reference ${reference} was just used by another request. Refresh and check your list before trying again.`,
      });
    }
    if ((error as { code?: string }).code === "P0001") {
      return json(400, { error: error.message });
    }
    return posErrorResponse(error);
  }
  return json(200, { success: true, request: shapeRequest(row) });
}

async function listRequests(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  let limit = Number(body?.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  let offset = Number(body?.offset ?? 0);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  let query = admin
    .from("pos_payment_requests")
    .select(REQUEST_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (body?.status !== undefined && body?.status !== null) {
    if (!isPosRequestStatus(body.status)) {
      return json(400, { error: "That status filter is not one we recognise." });
    }
    query = query.eq("status", body.status);
  }
  if (typeof body?.from === "string" && body.from) {
    const from = new Date(body.from);
    if (Number.isNaN(from.getTime())) return json(400, { error: "The start date is not a valid date." });
    query = query.gte("created_at", from.toISOString());
  }
  if (typeof body?.to === "string" && body.to) {
    const to = new Date(body.to);
    if (Number.isNaN(to.getTime())) return json(400, { error: "The end date is not a valid date." });
    query = query.lte("created_at", to.toISOString());
  }

  const { data, error, count } = await query;
  if (error) return posErrorResponse(error);
  return json(200, {
    success: true,
    requests: (data ?? []).map(shapeRequest),
    total: count ?? (data ?? []).length,
    limit,
    offset,
  });
}

async function getRequest(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return json(400, { error: "A request id is required." });
  const { data, error } = await admin
    .from("pos_payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) return posErrorResponse(error);
  if (!data) return json(404, { error: "That payment request could not be found." });
  return json(200, { success: true, request: shapeRequest(data) });
}

async function getRequestByReference(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const reference = normaliseMerchantReference(body?.reference);
  if (!reference) return json(400, { error: "A reference is required." });
  const { data, error } = await admin
    .from("pos_payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .eq("merchant_reference", reference)
    .maybeSingle();
  if (error) return posErrorResponse(error);
  if (!data) {
    return json(404, { error: `No payment request with reference ${reference} was found.` });
  }
  return json(200, { success: true, request: shapeRequest(data) });
}

async function cancelRequest(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return json(400, { error: "A request id is required." });
  const { data, error } = await admin.rpc("pos_cancel_request", {
    p_user_id: userId,
    p_request_id: id,
  });
  if (error) {
    if ((error as { code?: string }).code === "P0001") {
      return json(400, { error: error.message });
    }
    return posErrorResponse(error);
  }
  return json(200, { success: true, request: shapeRequest(data) });
}

async function createApiKey(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "POS key";
  const { count } = await admin
    .from("pos_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("revoked", false);
  if ((count ?? 0) >= 10) {
    return json(400, {
      error: "You already have 10 active POS API keys. Revoke one you no longer use before creating another.",
    });
  }

  const { plain, displayPrefix } = generatePosApiKey();
  const keyHash = await sha256Hex(plain);
  const { data, error } = await admin.rpc("pos_create_api_key", {
    p_user_id: userId,
    p_label: label || "POS key",
    p_key_hash: keyHash,
    p_key_prefix: displayPrefix,
  });
  if (error) return posErrorResponse(error);

  return json(200, {
    success: true,
    id: data.id,
    label: data.label,
    key_prefix: displayPrefix,
    // The plain key is returned EXACTLY ONCE, here. Only its hash is stored.
    key: plain,
    warning: "Copy this key now — it will never be shown again.",
  });
}

async function listApiKeys(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
) {
  const { data, error } = await admin
    .from("pos_api_keys")
    .select("id, label, key_prefix, last_used_at, revoked, revoked_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return posErrorResponse(error);
  return json(200, { success: true, keys: data ?? [] });
}

async function revokeApiKey(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return json(400, { error: "A key id is required." });
  const { error } = await admin.rpc("pos_revoke_api_key", {
    p_user_id: userId,
    p_key_id: id,
  });
  if (error) {
    if ((error as { code?: string }).code === "P0001") {
      return json(400, { error: error.message });
    }
    return posErrorResponse(error);
  }
  return json(200, { success: true });
}

async function exportCsv(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const now = new Date();
  let from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  let to = now;
  if (typeof body?.from === "string" && body.from) {
    from = new Date(body.from);
    if (Number.isNaN(from.getTime())) return json(400, { error: "The start date is not a valid date." });
  }
  if (typeof body?.to === "string" && body.to) {
    to = new Date(body.to);
    if (Number.isNaN(to.getTime())) return json(400, { error: "The end date is not a valid date." });
  }
  if (to < from) return json(400, { error: "The end date is before the start date." });
  if (to.getTime() - from.getTime() > 366 * 24 * 3600 * 1000) {
    return json(400, { error: "Exports are limited to one year at a time." });
  }

  const { data, error } = await admin
    .from("pos_payment_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: true })
    .limit(10_000);
  if (error) return posErrorResponse(error);

  const rows = data ?? [];
  return json(200, {
    success: true,
    filename: "bmaglass-pos-export.csv",
    count: rows.length,
    csv: requestsToCsv(rows as unknown as PosRequestCsvRow[]),
  });
}
