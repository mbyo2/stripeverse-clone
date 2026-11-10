import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Delivers the Breez SDK Nodeless (Liquid) API key to authenticated clients.
// The key is a per-partner credential — exposing it to signed-in users is
// expected for the WASM/browser flow, but we still gate it behind JWT verification
// (verify_jwt = true in supabase/config.toml) AND an in-code requireAuth:
// the gateway flag alone must never be the only thing standing between
// this key and the internet.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if ("response" in auth && !("user" in auth)) return auth.response;

  const apiKey = Deno.env.get("BREEZ_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "BREEZ_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ apiKey, network: "mainnet" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
