// p2p: the single client path into the P2P marketplace (scope §4.2).
//
//   POST { action, ... } with a user JWT → identity verified from the
//   JWT via the request client → dispatch to the Phase 0/1a RPCs via
//   the dedicated service-role client (every p2p_* callable is
//   EXECUTE-granted to service_role only; the RPCs re-verify the
//   actor's rights against the id we pass, and that id ALWAYS comes
//   from the JWT — see _shared/p2p-request.ts).
//
// Actions: the §4.2 table (payment methods, ads, orders, disputes,
// sanctions, blocks/reports, self reads) via _shared/p2p-request.ts,
// plus two actions implemented here:
//   send_message        — trade chat with §3.7 scanning/masking.
//   refresh_price_index — pg_cron caller (pg_net, every minute; see
//                         migration 20261023_p2p_price_index_cron.sql)
//                         that writes the next p2p_price_snapshots row.
//
// STORAGE DECISION — masked vs original chat text (§3.7):
// p2p_order_messages is evidence-grade: a trigger blocks UPDATE and
// DELETE for everyone, so masking after insert is impossible. The
// masked body is therefore the ONLY body ever stored; the original
// text is never persisted anywhere (scan_flags and risk-event detail
// carry categories and masked forms only). Because participants read
// chat through RLS on the stored rows, storage == delivery: the
// counterparty can only ever see the masked form, and a dispute sees
// the same masked record plus the flag/risk trail proving what was
// attempted. The sender is told a strike was recorded via the
// response `warning` field; the in-chat system notice deliberately
// omits the strike count (it is visible to both parties).
//
// KILL SWITCH: while platform_settings.p2p_enabled is false, only
// the marketplace-entry actions (create_ad, create_order) refuse.
// Lifecycle actions on existing orders — cancel, mark-paid, release,
// disputes, chat — always run: a pause must never strand escrow.
//
// INTERNAL HELPERS: p2p_write_risk / p2p_system_message have NO
// service_role grant by design (owner-context only, Phase 1a §5), so
// risk events and system messages from this layer are direct
// service-role table inserts in exactly the shapes those helpers use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceRoleClient,
  getSupabaseClient,
} from "../_shared/supabase-client.ts";
import {
  buildRpcArgs,
  isUuid,
  P2P_ACTIONS,
} from "../_shared/p2p-request.ts";
import { scanAdTerms, scanChatText } from "../_shared/p2p-chat-scan.ts";
import {
  buildSnapshotInsert,
  computeBtcIndex,
  fetchBtcUsdPrices,
  fetchUsdZmwFallback,
} from "../_shared/price-index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// PostgREST/RPC failures are plain objects with a message, not Error
// instances (the btc-trade lesson).
function thrownMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  const m = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof m === "string" && m.trim()) return m;
  return fallback;
}

const PAUSED_MESSAGE =
  "P2P trading is paused right now. Existing trades can still be finished, but new ads and orders are on hold.";

// ---------------------------------------------------------------------
// Small service-role helpers
// ---------------------------------------------------------------------

async function isAdmin(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

async function p2pEnabled(admin: any): Promise<boolean> {
  const { data } = await admin
    .from("platform_settings")
    .select("p2p_enabled")
    .limit(1)
    .maybeSingle();
  return data?.p2p_enabled === true;
}

async function insertSystemMessage(
  admin: any,
  orderId: string,
  body: string,
): Promise<void> {
  const { error } = await admin.from("p2p_order_messages").insert({
    order_id: orderId,
    sender_id: null,
    sender_type: "system",
    body,
  });
  if (error) console.error("p2p system message insert failed:", error);
}

async function insertRiskEvent(
  admin: any,
  event: {
    user_id: string;
    counterparty_id: string | null;
    order_id: string | null;
    signal: string;
    weight?: number;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("p2p_risk_events").insert({
    user_id: event.user_id,
    counterparty_id: event.counterparty_id,
    order_id: event.order_id,
    signal: event.signal,
    weight: event.weight ?? 1,
    detail: event.detail ?? {},
  });
  if (error) console.error("p2p risk event insert failed:", error);
}

// ---------------------------------------------------------------------
// refresh_price_index (cron caller)
// ---------------------------------------------------------------------

function isCronCall(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") || "").replace(
    "Bearer ",
    "",
  );
  if (serviceKey && bearer === serviceKey) return true;
  // The platform's other cron-invoked function also accepts an
  // optional CRON_SECRET header (process-scheduled-payments pattern).
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    return true;
  }
  return false;
}

async function fetchUsdZmw(admin: any): Promise<number> {
  const { data } = await admin
    .from("exchange_rates")
    .select("rate")
    .eq("from_currency", "USD")
    .eq("to_currency", "ZMW")
    .gt("valid_until", new Date().toISOString())
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.rate && Number(data.rate) > 0) return Number(data.rate);
  return fetchUsdZmwFallback();
}

async function handleRefreshPriceIndex(admin: any) {
  let prices: { coinbaseUsd: number; krakenUsd: number };
  let usdZmw: number;
  try {
    [prices, usdZmw] = await Promise.all([
      fetchBtcUsdPrices(),
      fetchUsdZmw(admin),
    ]);
  } catch (e) {
    // No snapshot is written: the RPCs' age-based staleness
    // (p2p_price_stale_minutes) takes over on its own.
    console.error("p2p price refresh: source fetch failed:", e);
    return json(503, {
      success: false,
      error: "Price sources are unavailable; no snapshot written.",
    });
  }
  const index = computeBtcIndex(prices.coinbaseUsd, prices.krakenUsd, usdZmw);
  const row = buildSnapshotInsert(index);
  const { error } = await admin.from("p2p_price_snapshots").insert(row);
  if (error) {
    console.error("p2p price refresh: snapshot insert failed:", error);
    return json(500, { success: false, error: "Snapshot insert failed." });
  }
  return json(200, { success: true, ...row });
}

// ---------------------------------------------------------------------
// send_message (§2.6 transport + §3.7 content controls)
// ---------------------------------------------------------------------

const OPEN_CHAT_STATUSES = ["escrow_locked", "paid_marked", "disputed"];
const CHAT_POST_CLOSE_MS = 24 * 3600 * 1000;
const STRIKE_WINDOW_MS = 90 * 24 * 3600 * 1000;

const SELLER_CHECKLIST_MESSAGE =
  "Safety reminder: never release Bitcoin because of pressure in chat. " +
  "Release only after you have checked INSIDE your own mobile-money or " +
  "bank account — not a screenshot, not an SMS — that the full amount " +
  "arrived from the buyer named on this order, then type the amount " +
  "and the reference you see there.";

const CONTACT_MASKED_MESSAGE =
  "Contact details in a message were hidden. Keep all communication " +
  "and payment inside this trade — moving off-platform removes every " +
  "protection the escrow gives you.";

async function handleSendMessage(admin: any, user: any, body: any) {
  const orderId = body?.order_id;
  if (!isUuid(orderId)) return json(400, { error: "order_id must be a valid id" });
  const rawBody = typeof body?.body === "string" ? body.body : "";
  const attachmentPath =
    typeof body?.attachment_path === "string" ? body.attachment_path : null;
  if (rawBody.length > 2000) {
    return json(400, { error: "Messages are limited to 2,000 characters." });
  }
  if (!rawBody.trim() && !attachmentPath) {
    return json(400, { error: "Write a message or attach a file first." });
  }

  const { data: order } = await admin
    .from("p2p_orders")
    .select(
      "id, advertiser_id, taker_id, status, completed_at, cancelled_at, updated_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return json(404, { error: "That trade could not be found." });

  const isParticipant =
    order.advertiser_id === user.id || order.taker_id === user.id;
  let senderType = "user";
  if (!isParticipant) {
    // §2.6/§3.7: support rows exist only on disputed orders, only
    // from an admin — a "support" message on an undisputed order is
    // impossible by construction.
    if (!(await isAdmin(admin, user.id))) {
      return json(403, { error: "You are not part of this trade." });
    }
    const { data: dispute } = await admin
      .from("p2p_disputes")
      .select("id")
      .eq("order_id", orderId)
      .eq("status", "open")
      .maybeSingle();
    if (!dispute) {
      return json(403, {
        error: "Support can only join a trade chat while a dispute is open.",
      });
    }
    senderType = "support";
  }

  // Chat window (§2.6): open while the order is live, then read-only
  // 24h after it closes.
  if (!OPEN_CHAT_STATUSES.includes(order.status)) {
    const closedAt = new Date(
      order.completed_at ?? order.cancelled_at ?? order.updated_at,
    ).getTime();
    if (Date.now() - closedAt > CHAT_POST_CLOSE_MS) {
      return json(400, {
        error: "This trade is closed and its chat is now read-only.",
      });
    }
  }

  if (senderType === "support") {
    // Staff messages are not scanned and never strike anyone.
    const { data: row, error } = await admin
      .from("p2p_order_messages")
      .insert({
        order_id: orderId,
        sender_id: user.id,
        sender_type: "support",
        body: rawBody,
        attachment_path: attachmentPath,
        scan_flags: [],
      })
      .select()
      .single();
    if (error) {
      console.error("p2p support message insert failed:", error);
      return json(500, { error: "Your message could not be sent. Please try again." });
    }
    return json(200, { success: true, message: row });
  }

  const scan = scanChatText(rawBody);
  const { data: row, error } = await admin
    .from("p2p_order_messages")
    .insert({
      order_id: orderId,
      sender_id: user.id,
      sender_type: "user",
      body: scan.maskedText,
      attachment_path: attachmentPath,
      scan_flags: scan.flags,
    })
    .select()
    .single();
  if (error) {
    console.error("p2p message insert failed:", error);
    return json(500, { error: "Your message could not be sent. Please try again." });
  }

  const counterpartyId =
    order.advertiser_id === user.id ? order.taker_id : order.advertiser_id;
  const response: Record<string, unknown> = {
    success: true,
    message: row,
    masked: scan.hasContactDetails,
    flags: scan.categories,
  };

  if (scan.hasContactDetails) {
    // Strike pipeline (§3.7/§3.9): one strike per message, counted
    // over a rolling 90 days. Strike 1 applies rung 0 (warning);
    // strike 3 applies rung 1 (7-day P2P pause) unless a rung ≥ 1
    // sanction is already active. Rungs 2+ stay human (admins rule
    // them from disputes) — automation accuses, humans convict.
    const since = new Date(Date.now() - STRIKE_WINDOW_MS).toISOString();
    const { count } = await admin
      .from("p2p_risk_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("signal", "chat_contact_share")
      .gte("created_at", since);
    const strike = (count ?? 0) + 1;

    await insertRiskEvent(admin, {
      user_id: user.id,
      counterparty_id: counterpartyId,
      order_id: orderId,
      signal: "chat_contact_share",
      weight: 1,
      detail: { categories: scan.categories, strike },
    });

    let pausedNow = false;
    if (strike === 1) {
      const { error: sErr } = await admin.rpc("p2p_apply_sanction", {
        p_user_id: user.id,
        p_scope: "p2p",
        p_level: 0,
        p_reason_code: "chat_contact_details",
        p_detail: "Warning — contact details shared in trade chat (strike 1 of 3).",
        p_applied_by: "system",
      });
      if (sErr) console.error("p2p rung-0 sanction failed:", sErr);
    } else if (strike >= 3) {
      const { data: activeSanctions } = await admin
        .from("user_sanctions")
        .select("level, expires_at")
        .eq("user_id", user.id)
        .eq("scope", "p2p")
        .eq("status", "active")
        .gte("level", 1);
      const alreadyPaused = (activeSanctions ?? []).some(
        (s: any) => !s.expires_at || new Date(s.expires_at).getTime() > Date.now(),
      );
      if (!alreadyPaused) {
        const { error: sErr } = await admin.rpc("p2p_apply_sanction", {
          p_user_id: user.id,
          p_scope: "p2p",
          p_level: 1,
          p_reason_code: "chat_contact_details",
          p_detail: `Three contact-detail strikes in 90 days (strike ${strike}).`,
          p_applied_by: "system",
          p_duration: "7 days",
        });
        if (sErr) console.error("p2p rung-1 sanction failed:", sErr);
        else pausedNow = true;
      }
    }

    await insertSystemMessage(admin, orderId, CONTACT_MASKED_MESSAGE);
    response.warning =
      `Sharing contact details is against P2P rules — strike ${strike} of 3. ` +
      "Three strikes within 90 days pauses P2P trading for 7 days." +
      (pausedNow ? " Your P2P trading is now paused for 7 days." : "");
  }

  if (scan.hasReleasePressure) {
    // Arm the target (§3.7): the checklist lands in the chat as a
    // system message at the moment of the attempt.
    await insertSystemMessage(admin, orderId, SELLER_CHECKLIST_MESSAGE);
    response.pressure_warning = true;
  }

  return json(200, response);
}

// ---------------------------------------------------------------------
// RPC dispatch
// ---------------------------------------------------------------------

function rpcErrorResponse(error: any) {
  console.error("p2p rpc failed:", error);
  // P0001 is a deliberate RAISE from our RPCs — its message is crafted
  // plain language written for the user, so it passes through.
  if (error?.code === "P0001") return json(400, { error: error.message });
  if (error?.code === "23505") {
    return json(400, {
      error: "That already exists — it may have been saved already. Check first, and try again if needed.",
    });
  }
  if (error?.code === "42501") {
    return json(403, { error: "You don't have permission to do that." });
  }
  return json(500, {
    error: "Something went wrong on our side. Please try again.",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    if (!action || !(action in P2P_ACTIONS)) {
      return json(400, { error: `Unknown action: ${action}` });
    }

    const admin = getServiceRoleClient();

    // Cron caller first: its credential is the service key itself,
    // which is not a user JWT and must never reach the user path.
    if (action === "refresh_price_index") {
      if (!isCronCall(req)) return json(403, { error: "Forbidden" });
      return handleRefreshPriceIndex(admin);
    }

    // Identity: verified from the JWT via the request client. All DB
    // work then runs through the service-role client (see header).
    const requestClient = getSupabaseClient(req);
    const token = (req.headers.get("Authorization") || "").replace(
      "Bearer ",
      "",
    );
    const {
      data: { user },
      error: authError,
    } = await requestClient.auth.getUser(token);
    if (authError || !user) {
      return json(401, { error: "Unauthorized" });
    }

    if (action === "send_message") {
      return handleSendMessage(admin, user, body);
    }

    const built = buildRpcArgs(action, body);
    if (!built.ok) return json(400, { error: built.error });
    const { spec, args } = built.value;

    if (spec.admin && !(await isAdmin(admin, user.id))) {
      return json(403, { error: "You don't have permission to do that." });
    }

    if (spec.entry && !(await p2pEnabled(admin))) {
      return json(503, { error: PAUSED_MESSAGE });
    }

    if (spec.actorArg) args[spec.actorArg] = user.id;
    if (spec.rpc === "p2p_apply_sanction") args.p_applied_by = "admin";

    // §3.7: ad terms go through the same scan at posting. A contact
    // hit refuses the ad (terms are contract text — they are never
    // silently rewritten) and writes a risk event. Terms hits are
    // NOT chat strikes (§3.9 rung 0 names chat strikes specifically).
    if (action === "create_ad" && typeof args.p_terms === "string") {
      const termScan = scanAdTerms(args.p_terms);
      if (termScan.hasContactDetails) {
        await insertRiskEvent(admin, {
          user_id: user.id,
          counterparty_id: null,
          order_id: null,
          signal: "ad_terms_contact",
          weight: 1,
          detail: { categories: termScan.categories },
        });
        return json(400, {
          error:
            "Your ad terms include contact details. Communication and payment must stay inside the trade — remove phone numbers, links and messaging-app names from your terms and try again.",
        });
      }
    }

    const { data, error } = await admin.rpc(spec.rpc, args);
    if (error) return rpcErrorResponse(error);

    // Evidence-bearing refusals return { success: false, code,
    // message } instead of raising (a raise would roll back the risk
    // event the RPC just wrote). Surface them as client errors with
    // the structured payload intact.
    if (data && typeof data === "object" && "success" in data) {
      if ((data as any).success === false) {
        return json(400, {
          ...data,
          error: (data as any).message ?? "That could not be done.",
        });
      }
      return json(200, data);
    }

    switch (spec.wrap) {
      case "tier":
        return json(200, { tier: data });
      case "unmatured_sats":
        return json(200, { unmatured_sats: Number(data) });
      case "sanction_id":
        return json(200, { success: true, sanction_id: data });
      case "void":
        return json(200, { success: true });
      default:
        return json(200, { success: true, data });
    }
  } catch (e) {
    console.error("p2p error:", e);
    return json(500, {
      error: thrownMessage(e, "Something went wrong. Please try again."),
    });
  }
});
