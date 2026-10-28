// developer-api: the unified public developer API for BMaGlass Pay.
//
// Auth: API key only — header `X-Api-Key: bmp_live_…` / `bmp_test_…`
// (or `Authorization: Bearer bmp_…`). Keys live in public.api_keys as
// SHA-256 hashes (created by generate-api-key, shown once, revoked by
// revoke-api-key). Scopes on the key gate each route; an empty scope
// list means the key was created before scopes were offered and is
// treated as read-only (wallets:read, transactions:read,
// payment_links:read, bitcoin:read).
//
// Routing: the resource is the path segment after the function name,
// e.g. POST /functions/v1/developer-api/transfers. A `?resource=`
// query parameter is also accepted (used by the docs playground).
//
// TEST MODE IS HONEST: this app has no test-mode ledger and no
// transaction is ever marked as test data, so test keys are READ-ONLY.
// Any write with a test key answers 403 { error: "test_mode_read_only" }
// — except webhook registration and webhook test delivery, which move
// no money. Live transfers route through the same fee-charging RPCs as
// the app (execute_transfer_with_fee, 1.5% on top, platform-credited).
//
// Webhooks: developers register endpoints (POST /webhooks); the signing
// secret is returned exactly once. Events that really occur today:
//   transaction.completed — a live API transfer settled
//   payment_link.created  — a live API payment link was created
//   payment_link.paid     — a payment link was paid (dispatched by the
//                           payment-link-checkout settlement path via
//                           the shared dispatcher in _shared)
//   webhook.test          — sent by POST /webhooks/{id}/test
// Deliveries are HMAC-SHA256 signed (header X-BMaGlass-Signature:
// sha256=<hex> over the exact request body) and every attempt is logged
// in public.developer_webhook_deliveries. The dispatcher itself lives
// in ../_shared/developer-webhooks.ts so every emitter signs, filters
// subscriptions and logs identically.
//
// Fee-bearer (2026-10-26): who funds the payment-link platform fee —
// the seller or the buyer — is the merchant's account setting in
// BMaGlass Pay (dashboard Settings → Payment), exposed read-only here
// as GET /settings so a connected plugin/SDK learns it from the
// merchant's key instead of asking again. Link create accepts an
// optional per-link fee_payer; when omitted it resolves from that
// account default. Plugins get NO fee-bearer setting of their own —
// they inherit. Link responses carry the resolved fee_payer plus the
// computed fee_amount / buyer_total / seller_receives (shared
// _shared/fee-math.ts — the same rule settlement charges), and
// settlement is enforced server-side from the link's stored value.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dispatchEvent,
  KNOWN_DEVELOPER_EVENTS,
} from "../_shared/developer-webhooks.ts";
import { linkFeeRateForMethod, paymentLinkAmounts, type FeePayer } from "../_shared/fee-math.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const READ_SCOPES = ["wallets:read", "transactions:read", "payment_links:read", "bitcoin:read"];
const KNOWN_EVENTS = KNOWN_DEVELOPER_EVENTS;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(status: number, code: string, message: string) {
  return json(status, { error: code, message });
}
async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface ApiKeyRow {
  id: string; user_id: string; key_prefix: string; scopes: string[];
  is_active: boolean; expires_at: string | null; mode: string | null;
}

async function authenticate(req: Request, db: any): Promise<ApiKeyRow | Response> {
  const raw = req.headers.get("x-api-key") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!raw || !raw.startsWith("bmp_")) {
    return err(401, "invalid_api_key", "Send your API key in the X-Api-Key header (bmp_live_… or bmp_test_…).");
  }
  const hash = await sha256Hex(raw);
  const { data, error } = await db.from("api_keys").select("*").eq("key_hash", hash).maybeSingle();
  if (error || !data) return err(401, "invalid_api_key", "That API key was not recognised.");
  if (!data.is_active) return err(401, "api_key_revoked", "That API key has been revoked.");
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return err(401, "api_key_expired", "That API key has expired.");
  }
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data as ApiKeyRow;
}

function modeOf(key: ApiKeyRow): "test" | "live" {
  if (key.mode === "live" || key.mode === "test") return key.mode;
  return key.key_prefix.includes("live") ? "live" : "test";
}
function scopesOf(key: ApiKeyRow): string[] {
  return Array.isArray(key.scopes) && key.scopes.length > 0 ? key.scopes : READ_SCOPES;
}
function requireScope(key: ApiKeyRow, scope: string): Response | null {
  if (!scopesOf(key).includes(scope)) {
    return err(403, "insufficient_scope", `This key does not have the ${scope} scope.`);
  }
  return null;
}
function requireLive(key: ApiKeyRow): Response | null {
  if (modeOf(key) === "test") {
    return err(403, "test_mode_read_only",
      "Test keys are read-only: this app has no test-mode ledger, so a test key can never move real money. Use a live key for writes.");
  }
  return null;
}

// ── Router ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = admin();
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const fnIdx = segments.indexOf("developer-api");
    let parts = fnIdx >= 0 ? segments.slice(fnIdx + 1) : [];
    if (parts.length === 0) {
      const r = url.searchParams.get("resource");
      if (r) parts = r.split("/").filter(Boolean);
    }
    const resource = parts[0] ?? "";
    const sub = parts[1] ?? "";
    const method = req.method.toUpperCase();

    // Public meta route (no key): what this API honestly is.
    if (resource === "" || resource === "meta") {
      return json(200, {
        name: "BMaGlass Pay Developer API",
        version: "1",
        mode_note: "Test keys (bmp_test_) are read-only. Live keys (bmp_live_) move real money.",
        resources: ["wallets", "transactions", "transfers", "payment-links", "settings", "bitcoin", "webhooks", "webhook-deliveries"],
        unavailable: ["moonpay", "card-issuing"],
      });
    }

    const keyOrRes = await authenticate(req, db);
    if (keyOrRes instanceof Response) return keyOrRes;
    const key = keyOrRes;
    const userId = key.user_id;
    const body = method === "POST" ? await req.json().catch(() => ({})) : {};

    // The merchant's fee-bearer truth: their account default (set in
    // the BMaGlass dashboard — the source of truth) and the platform's
    // current payment-link fee rate, resolved together.
    const feeContext = async () => {
      const [{ data: settings }, { data: profile }] = await Promise.all([
        db.from("platform_settings").select("split_platform_fee_percent, paypal_platform_fee_percent").eq("id", true).maybeSingle(),
        db.from("profiles").select("payment_link_fee_payer").eq("id", userId).maybeSingle(),
      ]);
      const feePayerDefault: FeePayer =
        profile?.payment_link_fee_payer === "buyer" ? "buyer" : "seller";
      return {
        feePayerDefault,
        rate: settings?.split_platform_fee_percent ?? null,
        paypalRate: linkFeeRateForMethod("paypal", settings),
      };
    };
    // Merge the computed money picture into a link row. Amount fields
    // are null when the link has no fixed price (or the rate is
    // somehow unavailable): the client can then compute from
    // fee_payer + the rate exposed by GET /settings.
    const withAmounts = (
      row: Record<string, unknown>,
      rate: number | string | null,
    ): Record<string, unknown> => {
      const feePayer: FeePayer = row.fee_payer === "buyer" ? "buyer" : "seller";
      if (row.amount == null || rate === null) {
        return { ...row, fee_payer: feePayer, fee_amount: null, buyer_total: null, seller_receives: null };
      }
      const a = paymentLinkAmounts(Number(row.amount), String(rate), feePayer);
      return {
        ...row,
        fee_payer: feePayer,
        fee_amount: a.fee_amount,
        buyer_total: a.buyer_total,
        seller_receives: a.seller_receives,
      };
    };

    // ── Settings (read-only): the merchant's fee-bearer default ──
    // The setting itself is changed in the BMaGlass dashboard
    // (Settings → Payment); this read exists so a connected plugin,
    // extension or SDK learns it from the merchant's key the moment
    // it connects. Plugins have no fee-bearer setting of their own.
    if (resource === "settings" && method === "GET") {
      const { feePayerDefault, rate, paypalRate } = await feeContext();
      return json(200, {
        data: {
          fee_payer_default: feePayerDefault,
          platform_fee_percent: rate === null ? null : Number(rate),
          paypal_platform_fee_percent: paypalRate,
          note: "fee_payer_default decides who funds the payment-link platform fee: 'seller' — the fee comes out of what the seller receives; 'buyer' — the fee is added on top of the price and the seller receives the full price. It is set in the BMaGlass Pay dashboard (Settings → Payment) and can be overridden per payment link at creation. Settlement always follows the link's stored fee_payer. Payments collected through PayPal carry the PayPal platform fee (paypal_platform_fee_percent) instead of the payment-link rate, on payment links and checkout payments alike.",
        },
        mode: modeOf(key),
      });
    }

    // ── Wallets ──
    if (resource === "wallets" && method === "GET") {
      const denied = requireScope(key, "wallets:read"); if (denied) return denied;
      const { data, error } = await db.from("wallets").select("id, currency, balance, status, created_at, updated_at").eq("user_id", userId);
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }

    // ── Transactions ──
    if (resource === "transactions" && method === "GET") {
      const denied = requireScope(key, "transactions:read"); if (denied) return denied;
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
      let q = db.from("transactions")
        .select("uuid_id, amount, currency, direction, status, description, recipient_name, fee_amount, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
      if (sub) q = q.eq("uuid_id", sub);
      const { data, error } = await q;
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }

    // ── Transfers (live only; 1.5% transfer fee via the app RPC) ──
    if (resource === "transfers" && method === "POST") {
      const denied = requireScope(key, "transfers:write"); if (denied) return denied;
      const ro = requireLive(key); if (ro) return ro;
      const { to_user_id, amount, currency, description, recipient_name } = body;
      const amt = Number(amount);
      if (!to_user_id || typeof to_user_id !== "string") return err(400, "invalid_request", "to_user_id is required.");
      if (!amt || amt <= 0) return err(400, "invalid_request", "amount must be greater than zero.");
      if (to_user_id === userId) return err(400, "invalid_request", "Cannot transfer to yourself.");
      const idempotencyKey = req.headers.get("idempotency-key") || body.idempotency_key || crypto.randomUUID();
      const { data, error } = await db.rpc("execute_transfer_with_fee", {
        p_from_user_id: userId, p_to_user_id: to_user_id, p_amount: amt,
        p_currency: typeof currency === "string" ? currency : "ZMW",
        p_reference_id: null, p_idempotency_key: `api:${idempotencyKey}`,
        p_description: description ?? null, p_recipient_name: recipient_name ?? null,
        p_payment_method: "wallet",
      });
      if (error) return err(422, "transfer_failed", error.message);
      const row = Array.isArray(data) ? data[0] : data;
      // Announce exactly once. The transfer RPC is idempotent: a
      // replayed request returns the SAME transaction_id and moves
      // no money, so the announcement is claimed against that id
      // (developer_event_dispatches, the payment_link.paid pattern)
      // before dispatching — a 23505 conflict means this transfer
      // was already announced and the replay stays silent.
      const txId = row?.transaction_id ?? null;
      let claimed = true;
      if (txId) {
        const { error: claimError } = await db
          .from("developer_event_dispatches")
          .insert({ event_key: `transaction.completed:${txId}`, user_id: userId });
        if (claimError) {
          if ((claimError as { code?: string }).code === "23505") {
            claimed = false;
          } else {
            console.error("transfer dispatch claim failed:", claimError.message ?? claimError);
          }
        }
      }
      if (claimed) {
        await dispatchEvent(db, userId, "transaction.completed", {
          transaction_id: txId, amount: amt,
          currency: typeof currency === "string" ? currency : "ZMW", to_user_id,
        }).catch(() => []);
      }
      return json(201, { data: row, mode: "live" });
    }

    // ── Payment link Bitcoin attempts (read) ──
    // "Pay with Bitcoin" attempts created on the hosted pay page:
    // merchants and shop connectors poll these to see a guest's
    // Bitcoin payment progress (waiting → detected → settled /
    // underpaid / expired). Settlements themselves are announced by
    // the payment_link.paid webhook (payment_method
    // bitcoin_onchain / bitcoin_lightning).
    if (resource === "payment-links" && sub && parts[2] === "attempts" && method === "GET") {
      const denied = requireScope(key, "payment_links:read"); if (denied) return denied;
      const { data: linkRow } = await db.from("payment_links")
        .select("id").eq("id", sub).eq("user_id", userId).maybeSingle();
      if (!linkRow) return err(404, "not_found", "Payment link not found.");
      const { data, error } = await db.from("payment_link_btc_attempts")
        .select("id, fiat_amount, fiat_currency, fee_payer, fee_percent, fee_sats, amount_sats, required_sats, seen_sats, received_sats, status, onchain_address, lightning_invoice, expires_at, settled_at, created_at")
        .eq("link_id", sub).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }

    // ── Payment links ──
    if (resource === "payment-links" && method === "GET") {
      const denied = requireScope(key, "payment_links:read"); if (denied) return denied;
      const { data, error } = await db.from("payment_links")
        .select("id, title, description, amount, currency, link_code, status, fee_payer, payment_count, total_collected, expires_at, redirect_url, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const { rate } = await feeContext();
      return json(200, {
        data: (data ?? []).map((row) => withAmounts(row as Record<string, unknown>, rate)),
        mode: modeOf(key),
      });
    }
    if (resource === "payment-links" && method === "POST") {
      const denied = requireScope(key, "payment_links:write"); if (denied) return denied;
      const ro = requireLive(key); if (ro) return ro;
      const { title, description, amount, currency, expires_at, fee_payer, redirect_url } = body;
      if (!title || typeof title !== "string") return err(400, "invalid_request", "title is required.");
      if (fee_payer !== undefined && fee_payer !== "seller" && fee_payer !== "buyer") {
        return err(400, "invalid_request", "fee_payer must be 'seller' or 'buyer'.");
      }
      // Resolution: explicit per-link choice > the merchant's
      // account default (their BMaGlass dashboard setting) > 'seller'.
      const { feePayerDefault, rate } = await feeContext();
      const resolvedFeePayer: FeePayer = fee_payer ?? feePayerDefault;
      // Optional buyer return context: after a completed payment the
      // hosted pay page offers "Return to store" pointing here.
      // Connectors may pass their order-received URL; omitted = the
      // buyer simply stays on the completion screen.
      let redirectUrl: string | null = null;
      if (redirect_url != null) {
        if (typeof redirect_url !== "string" || redirect_url.length > 2048) {
          return err(400, "invalid_request", "redirect_url must be a URL string of at most 2048 characters.");
        }
        try {
          const parsed = new URL(redirect_url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
          redirectUrl = parsed.toString();
        } catch {
          return err(400, "invalid_request", "redirect_url must be a valid http(s) URL.");
        }
      }
      const { data, error } = await db.from("payment_links").insert({
        user_id: userId, title: title.slice(0, 200), description: description ?? null,
        amount: amount != null ? Number(amount) : null,
        currency: typeof currency === "string" ? currency : "ZMW",
        expires_at: expires_at ?? null,
        fee_payer: resolvedFeePayer,
        redirect_url: redirectUrl,
      }).select("id, title, amount, currency, link_code, status, fee_payer, redirect_url, created_at").single();
      if (error) throw error;
      const out = withAmounts(data as Record<string, unknown>, rate);
      await dispatchEvent(db, userId, "payment_link.created", out).catch(() => []);
      return json(201, { data: out, mode: "live" });
    }

    // ── Bitcoin (custodial, read-only via API) ──
    if (resource === "bitcoin" && sub === "balance" && method === "GET") {
      const denied = requireScope(key, "bitcoin:read"); if (denied) return denied;
      const { data, error } = await db.from("crypto_wallets")
        .select("asset, balance_sats, available_sats, updated_at").eq("user_id", userId);
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }
    if (resource === "bitcoin" && sub === "deposit-address" && method === "GET") {
      const denied = requireScope(key, "bitcoin:read"); if (denied) return denied;
      const { data, error } = await db.from("btc_deposit_addresses")
        .select("address, derivation_path, is_active, created_at")
        .eq("user_id", userId).eq("is_active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) {
        return err(404, "no_deposit_address",
          "No custodial deposit address has been issued for this account yet. Issue one in the app's Bitcoin wallet first; the API does not derive addresses.");
      }
      return json(200, { data, mode: modeOf(key) });
    }
    if (resource === "bitcoin" && sub === "quote" && method === "POST") {
      const denied = requireScope(key, "bitcoin:read"); if (denied) return denied;
      // Quotes are read-only price locks stored by the app; creating one
      // moves no money, so test keys may use it — it calls the same live
      // price sources as the btc-trade function.
      const side = body.side === "sell" ? "sell" : "buy";
      const amountZmw = Number(body.amount_zmw);
      const amountSats = Number(body.amount_sats);
      if (side === "buy" && !(amountZmw >= 10)) return err(400, "invalid_request", "amount_zmw must be at least 10 for a buy quote.");
      if (side === "sell" && !(amountSats >= 1000)) return err(400, "invalid_request", "amount_sats must be at least 1000 for a sell quote.");
      const [cbRes, krRes] = await Promise.all([
        fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { signal: AbortSignal.timeout(8000) }),
        fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { signal: AbortSignal.timeout(8000) }),
      ]);
      if (!cbRes.ok || !krRes.ok) return err(502, "price_source_failed", "A Bitcoin price source is unavailable right now.");
      const cb = Number((await cbRes.json())?.data?.amount);
      const kr = Number((await krRes.json())?.result?.XXBTZUSD?.c?.[0]);
      if (!(cb > 0) || !(kr > 0) || Math.abs(cb - kr) / cb > 0.03) {
        return err(502, "price_divergence", "Bitcoin price sources diverge — refusing to quote.");
      }
      const { data: rateRow } = await db.from("exchange_rates").select("rate")
        .eq("from_currency", "USD").eq("to_currency", "ZMW")
        .gt("valid_until", new Date().toISOString())
        .order("valid_from", { ascending: false }).limit(1).maybeSingle();
      let usdZmw = Number(rateRow?.rate);
      if (!(usdZmw > 0)) {
        const fx = await fetch("https://api.exchangerate-api.com/v4/latest/USD", { signal: AbortSignal.timeout(8000) });
        usdZmw = Number((await fx.json())?.rates?.ZMW);
      }
      if (!(usdZmw > 0)) return err(502, "fx_unavailable", "No USD/ZMW rate available.");
      const midZmwPerBtc = cb * usdZmw;
      const feeBps = 150;
      let sats: number; let zmw: number; let feeZmw: number;
      if (side === "buy") {
        zmw = amountZmw; feeZmw = (zmw * feeBps) / 10000;
        sats = Math.floor(((zmw - feeZmw) / midZmwPerBtc) * 1e8);
      } else {
        sats = amountSats; zmw = (sats / 1e8) * midZmwPerBtc; feeZmw = (zmw * feeBps) / 10000; zmw = zmw - feeZmw;
      }
      const { data, error } = await db.from("btc_quotes").insert({
        user_id: userId, side, mid_rate_zmw: midZmwPerBtc, fee_bps: feeBps,
        fee_zmw: feeZmw, amount_zmw: side === "buy" ? zmw : zmw,
        amount_sats: sats, expires_at: new Date(Date.now() + 60_000).toISOString(),
      }).select("id, side, amount_zmw, amount_sats, fee_bps, fee_zmw, mid_rate_zmw, expires_at, created_at").single();
      if (error) throw error;
      return json(201, { data, mode: modeOf(key), note: "Quote only — execution happens in the app (btc-trade), not via the API." });
    }

    // ── Webhooks ──
    if (resource === "webhooks" && method === "GET") {
      const { data, error } = await db.from("developer_webhooks")
        .select("id, url, events, is_active, created_at").eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }
    if (resource === "webhooks" && method === "POST" && !sub) {
      const { url: hookUrl, events } = body;
      if (!hookUrl || typeof hookUrl !== "string") return err(400, "invalid_request", "url is required.");
      let parsed: URL;
      try { parsed = new URL(hookUrl); } catch { return err(400, "invalid_request", "url is not a valid URL."); }
      if (parsed.protocol !== "https:") return err(400, "invalid_request", "Webhook URLs must use HTTPS.");
      const evts = Array.isArray(events) && events.length > 0
        ? events.filter((e: unknown) => typeof e === "string" && KNOWN_EVENTS.includes(e as string))
        : KNOWN_EVENTS;
      const secret = "whsec_" + Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data, error } = await db.from("developer_webhooks").insert({
        user_id: userId, url: hookUrl, events: evts, secret,
      }).select("id, url, events, is_active, created_at").single();
      if (error) throw error;
      return json(201, { data: { ...data, secret }, mode: modeOf(key),
        warning: "Copy the secret now — it will never be shown again." });
    }
    if (resource === "webhooks" && sub && method === "DELETE") {
      const { data, error } = await db.from("developer_webhooks")
        .update({ is_active: false }).eq("id", sub).eq("user_id", userId).select("id").single();
      if (error || !data) return err(404, "not_found", "Webhook endpoint not found.");
      return json(200, { data: { id: data.id, is_active: false } });
    }
    if (resource === "webhooks" && sub && parts[2] === "test" && method === "POST") {
      const deliveries = await dispatchEvent(db, userId, "webhook.test", { ping: true, via: "developer-api" });
      const mine = deliveries.filter((d: any) => d.webhook_id === sub);
      return json(200, { data: mine, mode: modeOf(key) });
    }
    if (resource === "webhook-deliveries" && method === "GET") {
      const { data, error } = await db.from("developer_webhook_deliveries")
        .select("id, webhook_id, event_id, event_type, webhook_url, status, attempts, response_status, error_message, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json(200, { data, mode: modeOf(key) });
    }

    return err(404, "not_found", `No route for ${method} /${parts.join("/")}. See the OpenAPI spec for the shipped surface.`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return err(500, "internal_error", message);
  }
});
