// generate-api-key: create a real, cryptographically secure API key.
//
// Request:  POST { name?: string, type?: "live" | "test", scopes?: string[], expires_at?: string }
// Response: 200 { id, name, key, key_prefix, type, created_at }
//             The full `key` is returned EXACTLY ONCE. Only its SHA-256 hash
//             is stored in the database. It can never be retrieved again.
//
// Auth: user JWT required. Keys are scoped to the authenticated user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getSupabaseClient } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, type, scopes, expires_at } = await req.json().catch(() => ({}));
    const keyType = type === "live" ? "live" : "test";
    const prefix = keyType === "live" ? "bmp_live_" : "bmp_test_";
    const fullKey = secureKey(prefix);
    const keyHash = await sha256Hex(fullKey);

    const { data: row, error } = await supabase.from("api_keys").insert({
      user_id: user.id,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "API Key",
      key_hash: keyHash,
      key_prefix: prefix,
      mode: keyType,
      scopes: Array.isArray(scopes) ? scopes.filter((s) => typeof s === "string").slice(0, 20) : [],
      expires_at: expires_at || null,
    }).select("id, name, key_prefix, created_at").single();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        id: row.id,
        name: row.name,
        key: fullKey,
        key_prefix: row.key_prefix,
        type: keyType,
        created_at: row.created_at,
        warning: "Copy this key now — it will never be shown again.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
