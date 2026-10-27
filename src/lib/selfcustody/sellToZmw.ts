/**
 * Client for SELF-CUSTODY sell-to-ZMW (edge function
 * `btc-sell-selfcustody`, migration 20261235).
 *
 * The user sells Bitcoin held in THIS self-custody wallet: an intent
 * locks a quote server-side (platform rate, 1.5% fee, ZMW due,
 * 30-minute window + 60-minute grace for the deposit to be credited),
 * the user sends the BTC to the platform (their own custodial deposit
 * address, or a platform Lightning invoice), and when the platform's
 * existing deposit settlement credits it, the intent settles
 * exactly-once: ZMW lands in the user's platform ZMW wallet.
 *
 * This module never touches the seed phrase. The in-app send itself
 * goes through the existing Spark plumbing (spark.ts) — this module
 * only talks to the sell function.
 */
import { supabase } from "@/integrations/supabase/client";

export type SellRail = "onchain" | "lightning";
export type SellPhase = "awaiting" | "received" | "settled" | "expired" | "cancelled";

export interface SellIntent {
  intent_id: string;
  rail: SellRail;
  status: string;
  mid_rate_zmw: number;
  fee_bps: number;
  fee_zmw: number;
  expected_sats: number;
  expected_zmw: number;
  deposit_address: string | null;
  lightning_payment_id: string | null;
  bolt11: string | null;
  deposit_txid: string | null;
  deposit_vout: number | null;
  actual_sats: number | null;
  zmw_credited: number | null;
  fee_zmw_actual: number | null;
  expires_at: string;
  settle_deadline: string;
  settled_at: string | null;
  created_at: string;
  phase?: SellPhase;
  settle_outcome?: string | null;
  settle_error?: string;
}

export interface SellQuotePreview {
  mid_rate_zmw: number;
  fee_bps: number;
  fee_zmw: number;
  amount_sats: number;
  amount_zmw: number;
  locked: boolean;
}

/** Plain-language tracker copy — the only status text the UI shows. */
export const SELL_PHASE_COPY: Record<SellPhase, string> = {
  awaiting:
    "Waiting for your Bitcoin to arrive. Send it to the address or invoice below — this page updates on its own.",
  received:
    "Your Bitcoin has been seen and is confirming. Your ZMW is credited as soon as it is fully received.",
  settled: "Settled — the ZMW is in your platform ZMW wallet.",
  expired:
    "This sell expired before the Bitcoin was fully received. Any Bitcoin that did arrive stays in your custodial Bitcoin wallet — you can sell it from there at a fresh quote.",
  cancelled: "This sell was cancelled. Nothing was sent or credited for it.",
};

export function sellPhaseOf(intent: SellIntent): SellPhase {
  if (intent.phase) return intent.phase;
  if (intent.status === "settled") return "settled";
  if (intent.status === "cancelled") return "cancelled";
  if (intent.status === "expired") return "expired";
  return "awaiting";
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("btc-sell-selfcustody", { body });
  if (error) throw error;
  return data as T;
}

export function previewSellQuote(input: { amount_sats: number } | { amount_zmw: number }): Promise<SellQuotePreview> {
  return invoke<SellQuotePreview>({ action: "quote_preview", ...input });
}

export function createSellIntent(input: {
  rail: SellRail;
  amount_sats: number;
  lightning_payment_id?: string;
}): Promise<SellIntent> {
  return invoke<SellIntent>({ action: "create_intent", ...input });
}

export function checkSellIntent(intentId: string): Promise<SellIntent> {
  return invoke<SellIntent>({ action: "check", intent_id: intentId });
}

export function cancelSellIntent(intentId: string): Promise<SellIntent> {
  return invoke<SellIntent>({ action: "cancel", intent_id: intentId });
}

export async function listSellIntents(): Promise<SellIntent[]> {
  const data = await invoke<{ intents: SellIntent[] }>({ action: "list" });
  return data.intents;
}

/** Create a custodial Lightning invoice via the existing lightning-service. */
export async function createCustodialInvoice(amountSats: number): Promise<{ payment_id: string; bolt11: string }> {
  const { data, error } = await supabase.functions.invoke("lightning-service", {
    body: { action: "create_invoice", amount_sats: amountSats, description: "Self-custody sell to ZMW" },
  });
  if (error) throw error;
  return data as { payment_id: string; bolt11: string };
}

/** Poll a custodial Lightning invoice's status (settles the deposit when paid). */
export async function checkCustodialInvoice(paymentId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke("lightning-service", {
    body: { action: "check_status", breez_invoice_id: paymentId },
  });
  if (error) throw error;
  return data as { status: string };
}

/** Get (or allocate) the user's custodial on-chain deposit address via the existing btc-onchain receive. */
export async function getCustodialDepositAddress(): Promise<{ address: string }> {
  const { data, error } = await supabase.functions.invoke("btc-onchain", {
    body: { action: "receive" },
  });
  if (error) throw error;
  return data as { address: string };
}
