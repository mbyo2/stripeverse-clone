// receiving-admin: admin operations for local receiving accounts
// (migration 20261246) — JWT on (see supabase/config.toml).
//
// Gates, in order:
//   1. Authentication (caller resolved from their JWT).
//   2. Role gate: admin / super_admin (canUseReceivingAdminFor).
//   3. The admin_* RPCs are called through the dedicated
//      service-role client (NO caller JWT forwarded) with the
//      caller's id passed as p_actor_id. This is the house money
//      pattern: protect_wallet_balance neutralises balance UPDATEs
//      made under a user session, so the credit RPC must run
//      JWT-free; the RPCs re-check the actor's role themselves and
//      write the audit rows under the actor id.
//
// Actions (all POST JSON { action, ... }):
//   create_partner    { name, currencies, status, notes }
//   update_partner    { partner_id, status, currencies, notes }
//   assign_account    { account_id, partner_id, account_holder_name,
//                       routing_number, account_number, iban, bic,
//                       sort_code }
//   set_account_status{ account_id, status }
//   record_deposit    { account_id, amount, sender_name,
//                       sender_reference }
//   credit_deposit    { deposit_id }  → exactly-once wallet credit
//   reject_deposit    { deposit_id, reason }
//
// Business refusals raised by the RPCs are returned as
// { success: false, error: <crafted message> } with HTTP 200 so the
// client can show the crafted copy as-is; only auth failures use
// 401/403.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceRoleClient } from "../_shared/supabase-client.ts";
import {
  canUseReceivingAdminFor,
  isReceivingAdminAction,
  RECEIVING_ADMIN_REFUSAL_MESSAGE,
  receivingRpcErrorMessage,
} from "../_shared/receiving-accounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[RECEIVING-ADMIN] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Dedicated service-role client (no caller JWT forwarded) — the
  // money-path rule from _shared/supabase-client.ts.
  const supabase = getServiceRoleClient();

  try {
    logStep("Function started");

    // ── 1. Authentication ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json(
        { success: false, status: "unauthorized", error: "Please sign in to continue." },
        401,
      );
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.id) {
      return json(
        { success: false, status: "unauthorized", error: "Please sign in to continue." },
        401,
      );
    }

    // ── 2. Role gate ──
    if (!(await canUseReceivingAdminFor(supabase, user.id))) {
      return json(
        { success: false, status: "forbidden", error: RECEIVING_ADMIN_REFUSAL_MESSAGE },
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!isReceivingAdminAction(action)) {
      return json(
        { success: false, status: "bad_request", error: "That action isn't available." },
        400,
      );
    }
    logStep("Action", { action, actor: user.id });

    // ── 3. Dispatch to the service-role RPCs ──
    let rpcName = "";
    let rpcArgs: Record<string, unknown> = {};
    switch (action) {
      case "create_partner":
        rpcName = "admin_create_receiving_partner";
        rpcArgs = {
          p_actor_id: user.id,
          p_name: str(body.name),
          p_currencies: strArray(body.currencies),
          p_status: str(body.status) ?? "prospect",
          p_notes: str(body.notes),
        };
        break;
      case "update_partner":
        rpcName = "admin_update_receiving_partner";
        rpcArgs = {
          p_actor_id: user.id,
          p_partner_id: str(body.partner_id),
          p_status: str(body.status),
          p_currencies: strArray(body.currencies),
          p_notes: str(body.notes),
        };
        break;
      case "assign_account":
        rpcName = "admin_assign_receiving_account";
        rpcArgs = {
          p_actor_id: user.id,
          p_account_id: str(body.account_id),
          p_partner_id: str(body.partner_id),
          p_account_holder_name: str(body.account_holder_name),
          p_routing_number: str(body.routing_number),
          p_account_number: str(body.account_number),
          p_iban: str(body.iban),
          p_bic: str(body.bic),
          p_sort_code: str(body.sort_code),
        };
        break;
      case "set_account_status":
        rpcName = "admin_set_receiving_account_status";
        rpcArgs = {
          p_actor_id: user.id,
          p_account_id: str(body.account_id),
          p_status: str(body.status),
        };
        break;
      case "record_deposit":
        rpcName = "admin_record_receiving_deposit";
        rpcArgs = {
          p_actor_id: user.id,
          p_account_id: str(body.account_id),
          p_amount: typeof body.amount === "number" ? body.amount : null,
          p_sender_name: str(body.sender_name),
          p_sender_reference: str(body.sender_reference),
        };
        break;
      case "credit_deposit":
        rpcName = "admin_credit_receiving_deposit";
        rpcArgs = { p_actor_id: user.id, p_deposit_id: str(body.deposit_id) };
        break;
      case "reject_deposit":
        rpcName = "admin_reject_receiving_deposit";
        rpcArgs = {
          p_actor_id: user.id,
          p_deposit_id: str(body.deposit_id),
          p_reason: str(body.reason),
        };
        break;
    }

    const { data, error } = await supabase.rpc(rpcName, rpcArgs);
    if (error) {
      logStep("RPC refusal", { action, message: error.message });
      return json({ success: false, status: "refused", error: receivingRpcErrorMessage(error) });
    }
    logStep("Action complete", { action });
    return json({ success: true, status: "ok", data });
  } catch (err) {
    logStep("Unhandled error", { message: err instanceof Error ? err.message : String(err) });
    return json(
      { success: false, status: "error", error: "Something went wrong on our side. Please try again." },
      500,
    );
  }
});
