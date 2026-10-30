// Explains a Bitcoin transaction's confirmation progress in plain language.
// Fetches real chain facts from the Esplora node, then streams an AI explanation.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getTipHeight, getTx, confirmationsFor, MIN_CONFIRMATIONS, IS_TESTNET } from "../_shared/bitcoin.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: "Please sign in." }, 401);

  let txid = "";
  try {
    txid = String((await req.json())?.txid ?? "").trim().toLowerCase();
  } catch { /* handled below */ }
  if (!/^[0-9a-f]{64}$/.test(txid)) return json({ error: "A transaction ID is 64 letters/numbers (0-9, a-f)." }, 400);

  // Real chain facts
  let facts: Record<string, unknown>;
  try {
    const [tx, tip] = await Promise.all([getTx(txid), getTipHeight()]);
    const confs = confirmationsFor(tip, tx.status?.block_height);
    const { data: ours } = await admin
      .from("btc_onchain_deposits")
      .select("status, confirmations, amount_sats")
      .eq("txid", txid)
      .eq("user_id", auth.user.id);
    facts = {
      network: IS_TESTNET ? "testnet" : "mainnet",
      found: true,
      confirmed: tx.status?.confirmed ?? false,
      confirmations: confs,
      required_confirmations_for_credit: MIN_CONFIRMATIONS,
      block_height: tx.status?.block_height ?? null,
      current_tip_height: tip,
      outputs: tx.vout.map((o) => ({ address: o.scriptpubkey_address, btc: o.value / 1e8 })).slice(0, 10),
      matches_this_users_deposit_address: (ours?.length ?? 0) > 0,
      app_deposit_records: ours ?? [],
    };
  } catch (e) {
    const notFound = String(e).includes("404") || String(e).includes("400");
    if (!notFound) return json({ error: "Couldn't reach the Bitcoin network. Try again shortly." }, 502);
    facts = { found: false, network: IS_TESTNET ? "testnet" : "mainnet" };
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured." }, 500);

  const instructions =
    "You help users of the BMaGlass Pay Bitcoin wallet understand a transaction. Use ONLY the facts given. " +
    "In under 150 words, plain language, no jargon: 1) where the transaction stands, 2) roughly how long until it's done " +
    "(a block is ~10 minutes), 3) what the user should do next. The app credits a deposit to the wallet balance once it reaches " +
    "the required confirmations and sends an alert. If not found, explain it may not have been broadcast yet, could be a typo, " +
    "or on another network, and suggest checking the ID. If it doesn't match their deposit address, say it won't credit their balance. Never invent numbers.";

  const upstream = await fetch(GATEWAY, {
    method: "POST",
    signal: req.signal,
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input: `Transaction ${txid}\nFacts: ${JSON.stringify(facts)}`,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    let message = "The AI assistant couldn't answer right now.";
    try { message = (await upstream.json())?.error?.message || (await Promise.resolve(message)); } catch { /* keep */ }
    if (upstream.status === 402) message = "AI credits are used up. Add credits to keep using this feature.";
    if (upstream.status === 429) message = "Too many requests right now — please wait a minute and try again.";
    return json({ error: message }, upstream.status);
  }

  // Convert SSE into a plain-text stream of answer text.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "response.output_text.delta" && evt.delta) controller.enqueue(enc.encode(evt.delta));
              if (evt.type === "error" || evt.type === "response.failed") {
                controller.enqueue(enc.encode("\n\n[The AI stopped before finishing. Please try again later.]"));
              }
            } catch { /* partial line */ }
          }
        }
      } catch (_e) { /* client aborted */ }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Tx-Facts": encodeURIComponent(JSON.stringify({ found: facts.found, confirmations: facts.confirmations ?? 0, required: facts.required_confirmations_for_credit ?? MIN_CONFIRMATIONS })),
      "Access-Control-Expose-Headers": "X-Tx-Facts",
    },
  });
});
