// escrow-settle: server-side escrow release and refund settlement.
//
// Flow:
//   1. Buyer creates escrow → atomic-transfer debits buyer (to_user_id=null,
//      reference_type='escrow_hold'). Funds leave buyer's wallet; the escrow
//      row tracks the obligation.
//   2. Buyer releases → this function credits the SELLER's wallet.
//   3. Buyer cancels → this function credits the BUYER's wallet (refund).
//
// Settlement itself runs inside public.settle_escrow() (migration
// 20261023_p0_remediation.sql): a single transaction that locks the
// escrow row, verifies the buyer, requires status 'funded' AND a real
// completed escrow_hold ledger entry (a forged 'funded' flag settles
// nothing), flips the status, credits the recipient's Main wallet and
// writes the settlement ledger row. This function only resolves the
// caller from their JWT, then calls that RPC through a dedicated
// service-role client (getServiceRoleClient — the caller's JWT is NOT
// forwarded: the RPC is EXECUTE-granted to service_role only, and it
// re-checks the buyer server-side from p_actor_id).
//
// Why not settle from here: the previous implementation credited via
// increment_wallet_balance as the caller, then updated the escrow row
// afterwards, unconditioned on status — a concurrent release+refund
// could both credit, a failed ledger write left the credit in place,
// and a client-forged 'funded' flag would settle against money that
// was never held.
//
// Input: { escrow_id: string, action: 'release' | 'refund' }
// Returns: { success, transaction_id, recipient_id }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient, getSupabaseClient } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Resolve the caller from their JWT ──
    // Request-scoped client (forwards the JWT) — used ONLY to identify
    // the caller. No money moves through it.
    const supabase = getSupabaseClient(req);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { escrow_id, action } = await req.json();
    if (!escrow_id) throw new Error("escrow_id required");
    if (!["release", "refund"].includes(action)) throw new Error("action must be 'release' or 'refund'");

    // ── Settle atomically in Postgres ──
    // Dedicated service-role client WITHOUT the caller's JWT (the
    // currency-convert / savings-transfer pattern): settle_escrow is
    // granted to service_role only, and a user auth.uid() in scope
    // would trip the balance-protection trigger on the credit leg.
    const admin = getServiceRoleClient();
    const { data, error } = await admin.rpc("settle_escrow", {
      p_escrow_id: escrow_id,
      p_action: action,
      p_actor_id: user.id,
    });

    if (error) {
      // Map the RPC's exceptions onto the same plain-language
      // responses this function has always given. Anything unmapped
      // is logged server-side and answered generically — raw database
      // errors never reach the client.
      const rpcMessage = error.message || "";
      if (rpcMessage.includes("Only the buyer can settle this escrow")) {
        return new Response(JSON.stringify({ error: "Only the buyer can settle this escrow" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (rpcMessage.includes("Escrow not found")) {
        throw new Error("Escrow not found");
      }
      if (rpcMessage.includes("Escrow already settled")) {
        throw new Error(`Escrow already settled (${action})`);
      }
      const fundedMatch = rpcMessage.match(/Escrow must be funded to settle \(current: [a-z_]+\)/);
      if (fundedMatch) {
        throw new Error(fundedMatch[0]);
      }
      if (rpcMessage.includes("Escrow must be funded to settle")) {
        throw new Error("Escrow must be funded to settle");
      }
      if (rpcMessage.includes("No completed hold found for this escrow")) {
        throw new Error("No completed hold found for this escrow");
      }
      if (rpcMessage.includes("Invalid escrow action")) {
        throw new Error("action must be 'release' or 'refund'");
      }
      console.error("settle_escrow RPC failed:", error);
      throw new Error("Settlement failed");
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error("settle_escrow returned no row for escrow", escrow_id);
      throw new Error("Settlement failed");
    }

    return new Response(JSON.stringify({
      success: true,
      transaction_id: row.transaction_id,
      recipient_id: row.recipient_id,
      action,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Settlement failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
