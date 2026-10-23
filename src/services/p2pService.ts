// P2P data service (Phase 1c) — the ONLY client path to the P2P
// marketplace.
//
// Writes: every state change goes through the `p2p` edge function
// (POST /functions/v1/p2p { action, ... }) with the user's JWT. The
// p2p_* RPCs are service_role-only, so the client never calls them
// directly — this module doesn't either.
//
// Reads: direct PostgREST selects on exactly the tables Phase 1a's
// RLS policies open to the client (active ads, own orders/messages/
// disputes, the public trader projection, price snapshots). The
// p2p_* tables are not in the generated Database types (types regen
// is a known deferred item), so reads go through the untyped client
// with the row interfaces below as the contract — the same
// `(supabase as any)` pattern other untyped tables use.
//
// Errors: the edge function answers with crafted plain language
// ({ error, code? }). We surface that message (run through
// toUserFacingError as the platform's never-show-raw rule requires)
// and keep the machine `code` for the few states the UI renders
// specially (e.g. settle_delay_active).

import { supabase } from "@/integrations/supabase/client";
import { toUserFacingError } from "@/utils/userFacingError";

// ---------------------------------------------------------------------
// Row shapes (mirror the Phase 0/1a table definitions)
// ---------------------------------------------------------------------

export interface P2pAd {
  id: string;
  owner_id: string;
  side: "sell_crypto" | "buy_crypto";
  asset: string;
  fiat_currency: string;
  price_type: "fixed" | "margin";
  fixed_price_zmw: number | null;
  margin_percent: number | null;
  total_amount_minor: number;
  min_order_zmw: number;
  max_order_zmw: number;
  payment_method_types: string[];
  payment_window_minutes: number;
  settle_delay_minutes: number;
  terms: string | null;
  min_counterparty_tier: string;
  min_counterparty_trades: number;
  status: "active" | "paused" | "exhausted" | "closed";
  created_at: string;
  updated_at: string;
}

export interface P2pOrder {
  id: string;
  ad_id: string;
  advertiser_id: string;
  taker_id: string;
  crypto_seller_id: string;
  fiat_buyer_id: string;
  asset: string;
  fiat_currency: string;
  crypto_amount_minor: number;
  fiat_amount_zmw: number;
  price_zmw: number;
  index_snapshot: {
    index_zmw?: number;
    snapshot_id?: string;
    captured_at?: string;
  } | null;
  fee_minor: number;
  payment_method_snapshot: {
    method_id?: string;
    type?: string;
    account_number?: string;
    account_name?: string;
    bank_name?: string | null;
  } | null;
  buyer_payment_method_id: string | null;
  rail_reference: string | null;
  settle_delay_minutes: number;
  status: string;
  expires_at: string;
  paid_marked_at: string | null;
  seller_deadline_at: string | null;
  appeal_flagged_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2pPaymentClaim {
  order_id: string;
  payment_method_id: string;
  rail_reference: string;
  amount_sent_zmw: number;
  payer_name_attested: string | null;
  claimed_at: string;
  proof_file_hash: string | null;
  proof_storage_path: string | null;
}

export interface P2pMessage {
  id: string;
  order_id: string;
  sender_id: string | null;
  sender_type: "user" | "system" | "support";
  body: string;
  attachment_path: string | null;
  scan_flags: Array<{ category: string; masked: string }> | unknown[];
  created_at: string;
}

export interface P2pDispute {
  id: string;
  order_id: string;
  opened_by: string;
  reason: string;
  detail: string | null;
  status: string;
  affects_escrow: boolean;
  negotiation_ends_at: string | null;
  proposed_outcome: string | null;
  proposed_by: string | null;
  proposed_at: string | null;
  closed_via: string | null;
  ruled_by: string | null;
  ruled_at: string | null;
  ruling_notes: string | null;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2pEvidence {
  id: string;
  dispute_id: string;
  submitter_id: string;
  kind: "statement" | "file";
  body: string | null;
  storage_path: string | null;
  file_hash: string | null;
  created_at: string;
}

export interface P2pPaymentMethod {
  id: string;
  user_id: string;
  type: "mobile_money" | "bank";
  account_number: string;
  account_name: string;
  bank_name: string | null;
  is_primary: boolean;
  status: "active" | "disabled" | "removed";
  verified_name_match: boolean;
  created_at: string;
  updated_at: string;
}

export interface P2pTraderPublic {
  user_id: string;
  nickname: string | null;
  trades_completed: number;
  trades_as_buyer: number;
  trades_as_seller: number;
  disputes_won: number;
  disputes_lost: number;
  volume_zmw_completed: number;
  median_release_minutes: number | null;
  first_trade_at: string | null;
}

export interface P2pTraderProfile extends P2pTraderPublic {
  orders_cancelled_unpaid: number;
  orders_expired_unpaid: number;
  disputes_opened: number;
  last_trade_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2pBlock {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

export interface P2pSanction {
  id: string;
  user_id: string;
  scope: string;
  level: number;
  reason_code: string;
  detail: string | null;
  applied_by: string;
  starts_at: string;
  expires_at: string | null;
  status: string;
  created_at: string;
}

export interface P2pPriceSnapshot {
  id: string;
  asset: string;
  index_zmw: number;
  sources: Record<string, unknown>;
  is_stale: boolean;
  created_at: string;
}

export interface P2pAuditEntry {
  id: string;
  order_id: string | null;
  actor_id: string | null;
  actor_type: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface P2pRiskEvent {
  id: string;
  user_id: string;
  counterparty_id: string | null;
  order_id: string | null;
  signal: string;
  weight: number;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface P2pLimits {
  tier: string;
  can_trade: boolean;
  can_post_ads: boolean;
  max_order_zmw: number;
  daily_cap_zmw: number;
  daily_used_zmw: number;
  daily_remaining_zmw: number;
  max_open_orders: number;
  open_orders: number;
  orders_today: number;
  orders_day_cap: number;
  trade_hold: boolean;
  hold_reason: string | null;
  reasons: string[];
}

// ---------------------------------------------------------------------
// Edge action caller
// ---------------------------------------------------------------------

export class P2pActionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "P2pActionError";
    this.code = code;
  }
}

/** Idempotency keys are required on every state transition (8–80
 *  chars at the edge). One key per user intent: generate it when the
 *  form opens/submits once, reuse it across retries of that intent. */
export function newIdempotencyKey(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `p2p-${uuid}`.slice(0, 80);
}

async function errorFromInvoke(
  error: unknown,
  fallback: string,
): Promise<P2pActionError> {
  let message: string | null = null;
  let code: string | undefined;
  const context = (error as { context?: unknown })?.context as
    | { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> }
    | undefined;
  if (context && (typeof context.json === "function" || typeof context.clone === "function")) {
    try {
      const readable =
        typeof context.clone === "function" ? context.clone() : context;
      const payload = (await readable.json!()) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
      } | null;
      if (payload && typeof payload === "object") {
        if (typeof payload.error === "string" && payload.error.trim()) {
          message = payload.error;
        } else if (typeof payload.message === "string" && payload.message.trim()) {
          message = payload.message;
        }
        if (typeof payload.code === "string") code = payload.code;
      }
    } catch {
      // Body unreadable — fall through to the generic message.
    }
  }
  if (!message && error instanceof Error && error.message) {
    message = error.message;
  }
  return new P2pActionError(toUserFacingError(message ?? fallback, fallback), code);
}

export async function p2pAction<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
  fallback = "Something went wrong. Please try again.",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("p2p", {
    body: { action, ...body },
  });
  if (error) throw await errorFromInvoke(error, fallback);
  if (data && typeof data === "object" && (data as { success?: unknown }).success === false) {
    const d = data as { message?: string; error?: string; code?: string };
    throw new P2pActionError(
      toUserFacingError(d.error ?? d.message ?? fallback, fallback),
      d.code,
    );
  }
  return data as T;
}

// Convenience wrappers for the three self reads.
export async function fetchMyLimits(): Promise<P2pLimits> {
  const res = await p2pAction<{ data?: P2pLimits } & Partial<P2pLimits>>(
    "get_limits",
    {},
    "We couldn't load your P2P limits. Please try again.",
  );
  // The dispatcher wraps a bare jsonb RPC return as { success, data };
  // tolerate the unwrapped shape too so a dispatcher change can't
  // silently blank the limits banner.
  return (res.data ?? (res as P2pLimits)) as P2pLimits;
}

export async function fetchMyTier(): Promise<string> {
  const res = await p2pAction<{ tier?: string }>(
    "get_tier",
    {},
    "We couldn't load your verification tier. Please try again.",
  );
  return res.tier ?? "T0";
}

export async function fetchMyUnmaturedHoldsSats(): Promise<number> {
  const res = await p2pAction<{ unmatured_sats?: number }>(
    "get_unmatured_holds",
    {},
    "We couldn't load your safety-hold balance. Please try again.",
  );
  return Number(res.unmatured_sats ?? 0);
}

export interface SendMessageResult {
  success: boolean;
  message: P2pMessage;
  masked?: boolean;
  flags?: string[];
  warning?: string;
  pressure_warning?: boolean;
}

export function sendTradeMessage(
  orderId: string,
  body: string,
  attachmentPath?: string | null,
): Promise<SendMessageResult> {
  return p2pAction<SendMessageResult>(
    "send_message",
    { order_id: orderId, body, attachment_path: attachmentPath ?? undefined },
    "Your message could not be sent. Please try again.",
  );
}

// ---------------------------------------------------------------------
// Direct RLS reads
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function orThrow<T>(res: { data: T; error: { message: string } | null }, fallback: string): T {
  if (res.error) throw new Error(toUserFacingError(res.error.message, fallback));
  return res.data;
}

export async function fetchP2pEnabled(): Promise<boolean> {
  const res = await db
    .from("platform_settings")
    .select("p2p_enabled")
    .eq("id", true)
    .maybeSingle();
  if (res.error) return false;
  return res.data?.p2p_enabled === true;
}

export async function fetchLatestPriceSnapshot(): Promise<P2pPriceSnapshot | null> {
  const res = await db
    .from("p2p_price_snapshots")
    .select("*")
    .eq("asset", "BTC")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) return null;
  return (res.data as P2pPriceSnapshot | null) ?? null;
}

export async function fetchActiveAds(): Promise<P2pAd[]> {
  const res = await db
    .from("p2p_ads")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(200);
  return orThrow(res, "We couldn't load the marketplace. Please try again.") as P2pAd[];
}

export async function fetchMyAds(userId: string): Promise<P2pAd[]> {
  const res = await db
    .from("p2p_ads")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  return orThrow(res, "We couldn't load your ads. Please try again.") as P2pAd[];
}

export async function fetchTraderPublicProfiles(
  userIds: string[],
): Promise<Record<string, P2pTraderPublic>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return {};
  const res = await db
    .from("p2p_trader_public")
    .select("*")
    .in("user_id", unique);
  if (res.error) return {};
  const map: Record<string, P2pTraderPublic> = {};
  for (const row of (res.data ?? []) as P2pTraderPublic[]) map[row.user_id] = row;
  return map;
}

export async function fetchMyOrders(userId: string): Promise<P2pOrder[]> {
  const res = await db
    .from("p2p_orders")
    .select("*")
    .or(`advertiser_id.eq.${userId},taker_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100);
  return orThrow(res, "We couldn't load your orders. Please try again.") as P2pOrder[];
}

export async function fetchOrder(orderId: string): Promise<P2pOrder | null> {
  const res = await db
    .from("p2p_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (res.error) throw new Error(toUserFacingError(res.error.message, "We couldn't load this trade. Please try again."));
  return (res.data as P2pOrder | null) ?? null;
}

export async function fetchOrderClaim(orderId: string): Promise<P2pPaymentClaim | null> {
  const res = await db
    .from("p2p_payment_claims")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (res.error) return null;
  return (res.data as P2pPaymentClaim | null) ?? null;
}

export async function fetchOrderMessages(orderId: string): Promise<P2pMessage[]> {
  const res = await db
    .from("p2p_order_messages")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .limit(500);
  return orThrow(res, "We couldn't load the trade chat. Please try again.") as P2pMessage[];
}

export async function fetchDisputeByOrder(orderId: string): Promise<P2pDispute | null> {
  const res = await db
    .from("p2p_disputes")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (res.error) return null;
  return (res.data as P2pDispute | null) ?? null;
}

export async function fetchDispute(disputeId: string): Promise<P2pDispute | null> {
  const res = await db
    .from("p2p_disputes")
    .select("*")
    .eq("id", disputeId)
    .maybeSingle();
  if (res.error) throw new Error(toUserFacingError(res.error.message, "We couldn't load this dispute. Please try again."));
  return (res.data as P2pDispute | null) ?? null;
}

export async function fetchDisputeEvidence(disputeId: string): Promise<P2pEvidence[]> {
  const res = await db
    .from("p2p_dispute_evidence")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true })
    .limit(200);
  return orThrow(res, "We couldn't load the evidence. Please try again.") as P2pEvidence[];
}

export async function fetchMyPaymentMethods(userId: string): Promise<P2pPaymentMethod[]> {
  const res = await db
    .from("p2p_payment_methods")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "removed")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  return orThrow(res, "We couldn't load your payment methods. Please try again.") as P2pPaymentMethod[];
}

export async function fetchMyTraderProfile(userId: string): Promise<P2pTraderProfile | null> {
  const res = await db
    .from("p2p_trader_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) return null;
  return (res.data as P2pTraderProfile | null) ?? null;
}

export async function fetchMyBlocks(userId: string): Promise<P2pBlock[]> {
  const res = await db
    .from("p2p_blocks")
    .select("*")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });
  return orThrow(res, "We couldn't load your blocked traders. Please try again.") as P2pBlock[];
}

export async function fetchMySanctions(userId: string): Promise<P2pSanction[]> {
  const res = await db
    .from("user_sanctions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (res.error) return [];
  return (res.data ?? []) as P2pSanction[];
}

export interface KycState {
  status: "verified" | "pending" | "rejected" | "not_started";
  fullName: string | null;
  rejectionReason: string | null;
}

export async function fetchMyKycState(userId: string): Promise<KycState> {
  const { data, error } = await supabase
    .from("kyc_verifications")
    .select("first_name, last_name, id_number, verified_at, metadata")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return { status: "not_started", fullName: null, rejectionReason: null };
  const metadata = (data.metadata ?? {}) as { rejection_reason?: string };
  const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
  if (metadata.rejection_reason) {
    return { status: "rejected", fullName, rejectionReason: metadata.rejection_reason };
  }
  if (data.verified_at) return { status: "verified", fullName, rejectionReason: null };
  if (data.id_number) return { status: "pending", fullName, rejectionReason: null };
  return { status: "not_started", fullName, rejectionReason: null };
}

// ---------------------------------------------------------------------
// Admin reads (RLS: admins read all of these)
// ---------------------------------------------------------------------

export async function fetchOpenDisputes(): Promise<P2pDispute[]> {
  const res = await db
    .from("p2p_disputes")
    .select("*")
    .eq("status", "open")
    .order("sla_due_at", { ascending: true })
    .limit(100);
  return orThrow(res, "We couldn't load the dispute queue. Please try again.") as P2pDispute[];
}

export async function fetchRecentDisputes(): Promise<P2pDispute[]> {
  const res = await db
    .from("p2p_disputes")
    .select("*")
    .neq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (res.error) return [];
  return (res.data ?? []) as P2pDispute[];
}

export async function fetchAllSanctions(): Promise<P2pSanction[]> {
  const res = await db
    .from("user_sanctions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  return orThrow(res, "We couldn't load sanctions. Please try again.") as P2pSanction[];
}

export async function fetchOrderAuditLog(orderId: string): Promise<P2pAuditEntry[]> {
  const res = await db
    .from("p2p_audit_log")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (res.error) return [];
  return (res.data ?? []) as P2pAuditEntry[];
}

export async function fetchRiskEventsForUsers(userIds: string[]): Promise<P2pRiskEvent[]> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return [];
  const res = await db
    .from("p2p_risk_events")
    .select("*")
    .in("user_id", unique)
    .order("created_at", { ascending: false })
    .limit(50);
  if (res.error) return [];
  return (res.data ?? []) as P2pRiskEvent[];
}

export async function fetchOrdersByIds(ids: string[]): Promise<P2pOrder[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const res = await db.from("p2p_orders").select("*").in("id", unique);
  if (res.error) return [];
  return (res.data ?? []) as P2pOrder[];
}

export async function fetchOrdersForUsers(userIds: string[]): Promise<P2pOrder[]> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return [];
  const res = await db
    .from("p2p_orders")
    .select("*")
    .or(
      unique
        .map((id) => `advertiser_id.eq.${id},taker_id.eq.${id}`)
        .join(","),
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (res.error) return [];
  return (res.data ?? []) as P2pOrder[];
}

export async function fetchDisputesByOrderIds(orderIds: string[]): Promise<P2pDispute[]> {
  const unique = [...new Set(orderIds)].filter(Boolean);
  if (unique.length === 0) return [];
  const res = await db.from("p2p_disputes").select("*").in("order_id", unique);
  if (res.error) return [];
  return (res.data ?? []) as P2pDispute[];
}

export async function fetchKycNames(
  userIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from("kyc_verifications")
    .select("user_id, first_name, last_name")
    .in("user_id", unique);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
    if (name) map[row.user_id] = name;
  }
  return map;
}

// ---------------------------------------------------------------------
// Evidence / proof files
//
// Files live in the `p2p-evidence` storage bucket (paths are pinned
// into claims/evidence rows with a SHA-256 of the bytes, §3.5/§3.6).
// The hash is computed client-side over the exact bytes uploaded.
// ---------------------------------------------------------------------

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

export async function uploadP2pEvidenceFile(
  file: File,
  folder: string,
): Promise<{ path: string; hash: string }> {
  const hash = await sha256Hex(file);
  const path = `${folder}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from("p2p-evidence")
    .upload(path, file, { upsert: false });
  if (error) {
    throw new P2pActionError(
      "The file could not be uploaded. You can continue without it — a typed statement carries the same weight — or try again.",
    );
  }
  return { path, hash };
}

export async function p2pEvidenceSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("p2p-evidence")
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
