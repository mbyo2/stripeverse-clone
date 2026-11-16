import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Realtime channel factory — every subscription gets its OWN channel
 * name (2026-11-15 dashboard-crash fix).
 *
 * Why a fixed name is a crash: realtime-js 2.119 (shipped in
 * ed71612, deployed the morning of 2026-11-15) changed two things at
 * once:
 *   1. `supabase.channel(name)` DEDUPES by topic — it returns the
 *      existing channel when one with that name is still registered.
 *   2. `RealtimeChannel.on()` THROWS for postgres_changes/presence
 *      once the channel is joining or joined ("cannot add
 *      `postgres_changes` callbacks for realtime:<name> after
 *      `subscribe()`").
 * Effect cleanup calls `supabase.removeChannel(channel)`, which is
 * ASYNC (it awaits the server unsubscribe ack before tearing the
 * channel down). So a fast unmount → remount reuses the
 * still-joining channel and `.on()` throws inside the effect — and
 * the page error boundary renders "This page hit a problem".
 *
 * The crash path on the CEO's phone: the Header's NotificationBell
 * subscribes `notification_changes` on /login, then the login →
 * /dashboard navigation unmounts and remounts the bell before the
 * unsubscribe lands. The /notifications page is the same bug
 * deterministically: it subscribes `notification_changes` while its
 * own Header bell already holds that (joined) channel. Every other
 * fixed-name subscription (`dashboard-realtime`,
 * `security-monitoring`, `transactions_changes`,
 * `payment-updates`) has the identical race on remount.
 *
 * A per-instance suffix makes a collision impossible: a remount can
 * never be handed a previous mount's channel. The old channel is
 * still removed by the effect cleanup; while it drains, the old and
 * the new channel may both deliver the same row — handlers that
 * prepend must dedupe by id (NotificationBell + Notifications do;
 * useRealTimePayments already does).
 */

/** Unique channel name for one subscription instance. Pure — tested. */
export function uniqueChannelName(baseName: string): string {
  return `${baseName}:${crypto.randomUUID()}`;
}

/** Create a realtime channel that can never collide with a previous mount's still-tearing-down channel. */
export function createRealtimeChannel(baseName: string): RealtimeChannel {
  return supabase.channel(uniqueChannelName(baseName));
}

/**
 * Remove a channel created by createRealtimeChannel. Fire-and-forget
 * on purpose: effect cleanup must never await the unsubscribe.
 */
export function removeRealtimeChannel(channel: RealtimeChannel): void {
  void supabase.removeChannel(channel);
}
