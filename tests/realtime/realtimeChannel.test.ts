// Regression tests for the 2026-11-15 12:35 CAT dashboard crash
// (src/lib/realtimeChannel.ts).
//
// The CEO's phone showed the app's own error wall on /dashboard —
// "This page hit a problem" — with the shell and bottom nav intact.
// The console error was:
//
//   Error: cannot add `postgres_changes` callbacks for
//   realtime:notification_changes after `subscribe()`.
//
// Root cause: realtime-js 2.119 (shipped in ed71612, deployed the
// morning of 2026-11-15) changed the realtime contract:
//   1. `supabase.channel(name)` DEDUPES by topic — it returns the
//      existing channel when one with that name is still registered.
//   2. `RealtimeChannel.on()` THROWS for postgres_changes/presence
//      once the channel is joining or joined.
// Effect cleanup calls `supabase.removeChannel(channel)`, which is
// ASYNC (it awaits the server unsubscribe ack before tearing the
// channel down). So a fast unmount → remount — the Header's
// NotificationBell subscribes `notification_changes` on /login and
// again on /dashboard — reuses the still-joining channel and `.on()`
// throws inside the effect, which the page error boundary renders
// as the wall. The /notifications page is the same bug
// deterministically: it subscribes the same name its own Header
// bell already holds.
//
// The fix: every subscription gets a unique channel name per mount
// (createRealtimeChannel), so a remount can never be handed a
// previous mount's channel. These tests pin that contract against a
// faithful fake of the realtime-js 2.119 behaviour (dedupe +
// on-throws-when-joining/joined + async teardown), verified against
// node_modules/@supabase/realtime-js@2.119.0, plus a source-level
// guard that no fixed-name `supabase.channel(` call site survives.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { uniqueChannelName } from "../../src/lib/realtimeChannel";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../src");
const read = (rel: string) => fs.readFileSync(path.resolve(SRC, rel), "utf8");

// ---------------------------------------------------------------------
// Faithful fake of the realtime-js 2.119 contract.
// ---------------------------------------------------------------------

type ChannelState = "closed" | "joining" | "joined";

class FakeChannel {
  readonly topic: string;
  state: ChannelState = "closed";
  bindings = 0;
  constructor(topic: string) {
    this.topic = topic;
  }
  on(type: string): this {
    // RealtimeChannel.on (realtime-js 2.119.0, RealtimeChannel.js):
    // throws when the channel is joined OR joining and the type is
    // presence / postgres_changes.
    if (
      (this.state === "joined" || this.state === "joining") &&
      (type === "presence" || type === "postgres_changes")
    ) {
      throw new Error(
        `cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`,
      );
    }
    this.bindings += 1;
    return this;
  }
  subscribe(): this {
    this.state = "joining";
    return this;
  }
}

class FakeRealtimeClient {
  private channels: FakeChannel[] = [];
  // RealtimeClient.channel (realtime-js 2.119.0): returns the
  // existing channel when one with that topic is still registered.
  channel(name: string): FakeChannel {
    const topic = `realtime:${name}`;
    const existing = this.channels.find((c) => c.topic === topic);
    if (existing) return existing;
    const chan = new FakeChannel(topic);
    this.channels.push(chan);
    return chan;
  }
  // RealtimeClient.removeChannel: async — teardown happens only
  // after the unsubscribe resolves, NOT synchronously.
  async removeChannel(channel: FakeChannel): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    channel.state = "closed";
    this.channels = this.channels.filter((c) => c !== channel);
  }
}

// The subscription pattern every realtime effect in the app follows:
// .channel(name).on(...).subscribe(), with cleanup that does NOT
// await the removal (React effect cleanup cannot await).
function mountSubscription(client: FakeRealtimeClient, name: string): FakeChannel {
  return client.channel(name).on("postgres_changes").subscribe();
}
function unmountSubscription(client: FakeRealtimeClient, channel: FakeChannel): void {
  void client.removeChannel(channel);
}

describe("realtime-js 2.119 remount race (2026-11-15 dashboard crash)", () => {
  it("a fixed channel name throws on a fast unmount → remount", () => {
    const client = new FakeRealtimeClient();
    // Login page: the Header bell subscribes.
    const first = mountSubscription(client, "notification_changes");
    expect(first.state).toBe("joining");
    // Login → dashboard navigation: cleanup fires but the async
    // teardown has not landed yet.
    unmountSubscription(client, first);
    // Dashboard remounts the bell synchronously: the same name
    // returns the still-joining channel and .on() throws — the crash.
    expect(() => mountSubscription(client, "notification_changes")).toThrow(
      "cannot add `postgres_changes` callbacks for realtime:notification_changes after `subscribe()`.",
    );
  });

  it("a fixed channel name also throws when two live components share it", () => {
    const client = new FakeRealtimeClient();
    // /notifications: the Header bell holds the channel…
    mountSubscription(client, "notification_changes");
    // …and the page itself subscribes the same name.
    expect(() => mountSubscription(client, "notification_changes")).toThrow(
      /after `subscribe\(\)`/,
    );
  });

  it("uniqueChannelName survives the same remount sequence", () => {
    const client = new FakeRealtimeClient();
    const first = mountSubscription(client, uniqueChannelName("notification_changes"));
    unmountSubscription(client, first);
    // The remount gets a fresh channel: no throw, and both
    // subscriptions exist independently while the old one drains.
    const second = mountSubscription(client, uniqueChannelName("notification_changes"));
    expect(second).not.toBe(first);
    expect(second.state).toBe("joining");
    expect(second.bindings).toBe(1);
  });

  it("uniqueChannelName never repeats a name", () => {
    const names = new Set(Array.from({ length: 100 }, () => uniqueChannelName("dashboard-realtime")));
    expect(names.size).toBe(100);
    for (const name of names) {
      expect(name.startsWith("dashboard-realtime:")).toBe(true);
    }
  });

  it("a remount after teardown completes is safe either way", async () => {
    const client = new FakeRealtimeClient();
    const first = mountSubscription(client, "notification_changes");
    unmountSubscription(client, first);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Teardown landed: the fixed name is free again.
    const second = mountSubscription(client, "notification_changes");
    expect(second).not.toBe(first);
  });
});

describe("no fixed-name realtime subscription survives in src", () => {
  it("every supabase.channel( call goes through createRealtimeChannel", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/supabase\.channel\(/.test(text)) offenders.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    // The factory itself is the one allowed direct call.
    expect(offenders).toEqual(["lib/realtimeChannel.ts"]);
  });

  it("all six subscriber sites use the factory", () => {
    const sites = [
      "components/notifications/NotificationBell.tsx",
      "pages/Notifications.tsx",
      "hooks/useDashboardData.ts",
      "components/security/SecurityMonitor.tsx",
      "components/wallet/EnhancedTransactionManager.tsx",
      "hooks/useRealTimePayments.ts",
    ];
    for (const site of sites) {
      expect(read(site)).toContain("createRealtimeChannel");
      expect(read(site)).toContain("removeRealtimeChannel");
    }
  });

  it("the two prepend handlers dedupe by id (old + new channel overlap)", () => {
    for (const site of [
      "components/notifications/NotificationBell.tsx",
      "pages/Notifications.tsx",
    ]) {
      expect(read(site)).toContain("current.some((n) => n.id ===");
    }
  });
});
