// generate-api-key: <redacted>
// (CEO-approved API key system, 2026-11-09.)
//
// Request:  POST { name?: string, type?: "sandbox" | "production" |
//                  "test" | "live", scopes?: string[], expires_at?: string }
// Response: 200 { id, key_id, name, key, key_prefix, environment, type,
//                 scopes, created_at }
//             The full `key` is returned EXACTLY ONCE. Only its SHA-256
//             hash is stored in the database. It can never be retrieved
//             again.
//
// Environments: sandbox keys carry the bmg_sandbox_ prefix and run on
// mainnet formats with simulated money; production keys carry
// bmg_live_ and move real money. The environment is a property of the
// key itself — nothing a client sends can change it. ("test"/"live"
// are accepted as legacy spellings of sandbox/production; the stored
// mode column keeps its historical 'test' | 'live' values.)
//
// Scopes: least-privilege allowlist (see _shared/connector-config.ts).
// No issuable scope can withdraw, pay out, change a settlement
// destination, change the business country, or manage keys. A request
// naming any other scope is refused whole — never silently trimmed.
//
// Auth: user JWT required. Keys are scoped to the authenticated user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { withinLimit } from "../_shared/rate-limit.ts";
import {
  KEY_PREFIXES,
  sanitizeScopes,
} from "../_shared/connector-config.ts";

// Workstream E (security audit 2026-11-15): key-minting was unbounded —
// live-proven 25 keys minted in 34s by one user, 0x429, no cap. A
// leaked session (or a bot account) could mint keys without end, and
// each live key moves real money. 10 mints/hour per user is generous
// for legitimate use (dashboards mint a handful); 20 active keys per
// user caps the row spam and the blast radius.
const MAX_MINTS_PER_HOUR = 10;
const MAX_ACTIVE_KEYS_PER_USER = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function secureKey(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${hex}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "unauthorized", message: "Sign in to create an API key." });
    }

    // Workstream E: mint rate limit (10/hour per user). Fail-open on
    // limiter error, like every other check_advanced_rate_limit caller.
    const mintOk = await withinLimit(supabase, `user:${user.id}`, "generate_api_key", MAX_MINTS_PER_HOUR, 60);
    if (!mintOk) {
      return json(429, {
        error: "rate_limited",
        message: "Too many API keys created. Please wait a while before creating another.",
      });
    }

    // Workstream E: active-key cap. Revoke an old key before minting
    // past the cap (revoke-api-key, or the dashboard key list).
    const { count: activeCount } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);
    if ((activeCount ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
      return json(400, {
        error: "key_limit_reached",
        message: `You already have ${MAX_ACTIVE_KEYS_PER_USER} active API keys. Revoke one before creating another.`,
      });
    }

    const { name, type, scopes, expires_at } = await req.json().catch(() => ({}));
    const environment = (type === "production" || type === "live") ? "production" : "sandbox";
    const mode = environment === "production" ? "live" : "test";
    const prefix = environment === "production" ? KEY_PREFIXES.production : KEY_PREFIXES.sandbox;

    // WSC audit 2026-11-15 (Low): an expires_at in the past minted an
    // already-dead key (200, then 401 api_key_expired on first use).
    // Reject it at mint time instead of issuing a key that can never work.
    if (expires_at != null && expires_at !== "") {
      const expMs = Date.parse(String(expires_at));
      if (!Number.isFinite(expMs)) {
        return json(400, { error: "invalid_request", message: "expires_at must be an ISO 8601 date." });
      }
      if (expMs <= Date.now()) {
        return json(400, { error: "invalid_request", message: "expires_at must be in the future." });
      }
    }

    const { scopes: cleanScopes, rejected } = sanitizeScopes(scopes);
    if (rejected.length > 0) {
      return json(400, {
        error: "scope_not_available",
        message: `These scopes can't be issued: ${rejected.join(", ")}. API keys can never withdraw, pay out, change settlement details or manage other keys.`,
      });
    }

    const fullKey = secureKey(prefix);
    const keyHash = await sha256Hex(fullKey);

    const { data: row, error } = await supabase.from("api_keys").insert({
      user_id: user.id,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "API Key",
      key_hash: keyHash,
      key_prefix: prefix,
      mode,
      scopes: cleanScopes,
      expires_at: expires_at || null,
    }).select("id, name, key_prefix, scopes, created_at").single();

    if (error) throw error;

    return json(200, {
      id: row.id,
      key_id: row.id,
      name: row.name,
      key: fullKey,
      key_prefix: row.key_prefix,
      environment,
      type: mode,
      scopes: row.scopes,
      created_at: row.created_at,
      warning: "Copy this key now — it will never be shown again.",
    });
  } catch (_error) {
    return json(500, {
      error: "internal_error",
      message: "The key couldn't be created. Please try again.",
    });
  }
});
