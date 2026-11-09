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
import {
  KEY_PREFIXES,
  sanitizeScopes,
} from "../_shared/connector-config.ts";

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

    const { name, type, scopes, expires_at } = await req.json().catch(() => ({}));
    const environment = (type === "production" || type === "live") ? "production" : "sandbox";
    const mode = environment === "production" ? "live" : "test";
    const prefix = environment === "production" ? KEY_PREFIXES.production : KEY_PREFIXES.sandbox;

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
