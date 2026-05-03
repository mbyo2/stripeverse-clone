import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMessage, isAddress, getAddress } from "https://esm.sh/viem@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cErr } = await supabase.auth.getClaims(token);
    if (cErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Invalid body" }, 400);

    const { address, chainId, signature, nonce, label } = body as {
      address?: string; chainId?: number; signature?: string; nonce?: string; label?: string | null;
    };
    if (!address || !chainId || !signature || !nonce) {
      return json({ error: "Missing fields" }, 400);
    }
    if (!isAddress(address)) return json({ error: "Invalid address" }, 400);

    // Verify nonce belongs to this user, address, and is not expired
    const { data: nrow, error: nErr } = await admin
      .from("crypto_address_nonces")
      .select("id, expires_at, address, user_id")
      .eq("user_id", userId)
      .eq("nonce", nonce)
      .eq("address", address.toLowerCase())
      .maybeSingle();
    if (nErr || !nrow) return json({ error: "Invalid nonce" }, 400);
    if (new Date(nrow.expires_at).getTime() < Date.now()) {
      return json({ error: "Nonce expired" }, 400);
    }

    const message = `BMaGlass Pay — link wallet\n\nAddress: ${getAddress(address)}\nUser: ${userId}\nNonce: ${nonce}`;
    const valid = await verifyMessage({
      address: getAddress(address),
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return json({ error: "Invalid signature" }, 400);

    // Persist verified wallet (server-side, bypasses tampering)
    const { error: upErr } = await admin
      .from("vendor_crypto_wallets")
      .upsert(
        {
          user_id: userId,
          chain_id: chainId,
          address: address.toLowerCase(),
          label: label ?? null,
          signature,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "user_id,chain_id,address" }
      );
    if (upErr) return json({ error: upErr.message }, 500);

    // Burn nonce
    await admin.from("crypto_address_nonces").delete().eq("id", nrow.id);

    return json({ success: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}