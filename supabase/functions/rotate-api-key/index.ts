// rotate-api-key: <redacted>
// (CEO-approved API key system, 2026-11-09.)
//
// Request:  POST { key_id: string }
// Response: 200 { id, key_id, name, key, key_prefix, environment,
//                 scopes, created_at, replaced_key_id, grace_until }
//             The replacement `key` is returned EXACTLY ONCE (only its
//             SHA-256 hash is stored). The replaced key keeps working
//             until `grace_until` — 24 hours — so a merchant can swap
//             the key in their shop without downtime; after that it
//             expires like any expired key (401 api_key_expired).
//
// Auth: user JWT required. Users can only rotate their own keys.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { KEY_PREFIXES } from "../_shared/connector-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRACE_MS = 24 * 60 * 60 * 1000;

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
      return json(401, { error: "unauthorized", message: "Sign in to rotate an API key." });
    }

    const { key_id } = await req.json().catch(() => ({}));
    if (!key_id || typeof key_id !== "string") {
      return json(400, { error: "invalid_request", message: "key_id is required." });
    }

    const { data: old, error: readError } = await supabase
      .from("api_keys")
      .select("id, name, mode, scopes, is_active, expires_at")
      .eq("id", key_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!old) return json(404, { error: "not_found", message: "That key wasn't found." });
    if (!old.is_active) {
      return json(400, { error: "key_revoked", message: "A revoked key can't be rotated — create a new key instead." });
    }
    if (old.expires_at && new Date(old.expires_at).getTime() < Date.now()) {
      return json(400, { error: "key_expired", message: "An expired key can't be rotated — create a new key instead." });
    }

    const environment = old.mode === "live" ? "production" : "sandbox";
    const prefix = environment === "production" ? KEY_PREFIXES.production : KEY_PREFIXES.sandbox;
    const fullKey = secureKey(prefix);
    const keyHash = await sha256Hex(fullKey);
    const graceUntil = new Date(Date.now() + GRACE_MS).toISOString();

    const { data: row, error: insertError } = await supabase.from("api_keys").insert({
      user_id: user.id,
      name: old.name,
      key_hash: keyHash,
      key_prefix: prefix,
      mode: old.mode,
      scopes: old.scopes ?? [],
      expires_at: null,
    }).select("id, name, key_prefix, scopes, created_at").single();
    if (insertError) throw insertError;

    // The replaced key now runs on the grace clock. Authentication
    // already refuses keys past expires_at, so the grace window needs
    // no extra check there; rotation_grace_until records WHY this
    // expiry exists (the settings UI shows it).
    const { error: updateError } = await supabase.from("api_keys")
      .update({ expires_at: graceUntil, rotation_grace_until: graceUntil })
      .eq("id", old.id).eq("user_id", user.id);
    if (updateError) throw updateError;

    return json(200, {
      id: row.id,
      key_id: row.id,
      name: row.name,
      key: fullKey,
      key_prefix: row.key_prefix,
      environment,
      scopes: row.scopes,
      created_at: row.created_at,
      replaced_key_id: old.id,
      grace_until: graceUntil,
      warning: "Copy this key now — it will never be shown again. Your previous key keeps working for 24 hours.",
    });
  } catch (_error) {
    return json(500, {
      error: "internal_error",
      message: "The key couldn't be rotated. Please try again.",
    });
  }
});
