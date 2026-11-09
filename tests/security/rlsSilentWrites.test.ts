// Silent-write fixes (2026-11-09, migration 20261257).
//
// What is pinned:
//   1. The migration that repairs the policy/grant layer stays in the
//      repo: owner INSERT/DELETE policies + grants on notifications,
//      the admin DELETE policy on beta_feedback, the
//      request_webhook_retry RPC (no blanket UPDATE on
//      webhook_delivery_logs), and the view privilege strips.
//   2. The dead client insert into public.transactions stays removed —
//      client-side transaction inserts are blocked BY DESIGN ("Block
//      client-side transaction inserts") and money rows are created
//      only by server functions/RPCs.
//   3. The webhook retry hook goes through the RPC and surfaces
//      failures instead of failing silently.
//   4. NotificationContext.createNotification surfaces a crafted,
//      plain-language error when the insert fails.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migration = read(
  "supabase/migrations/20261257_fix_silent_client_writes_and_views.sql",
);

describe("migration 20261257 — notifications owner writes", () => {
  it("adds owner-scoped INSERT and DELETE policies", () => {
    expect(migration).toContain('"Users can create their own notifications"');
    expect(migration).toContain('"Users can delete their own notifications"');
    expect(migration).toContain(
      "GRANT INSERT, DELETE ON TABLE public.notifications TO authenticated",
    );
  });
});

describe("migration 20261257 — beta_feedback admin delete", () => {
  it("adds an admin-scoped DELETE policy and the grant", () => {
    expect(migration).toContain('"Admins can delete beta feedback"');
    expect(migration).toContain(
      "GRANT DELETE ON TABLE public.beta_feedback TO authenticated",
    );
    expect(migration).toContain("'super_admin'::app_role");
  });
});

describe("migration 20261257 — webhook retry RPC", () => {
  it("creates request_webhook_retry as SECURITY DEFINER with tight ACLs", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.request_webhook_retry(p_log_id uuid)",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain(
      "REVOKE EXECUTE ON FUNCTION public.request_webhook_retry(uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.request_webhook_retry(uuid) TO authenticated, service_role",
    );
  });

  it("grants no direct UPDATE on webhook_delivery_logs to clients", () => {
    expect(migration).not.toMatch(
      /GRANT[^;]*UPDATE[^;]*webhook_delivery_logs[^;]*authenticated/i,
    );
  });
});

describe("migration 20261257 — view privileges", () => {
  it("strips write privileges on both audited views", () => {
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\n  ON TABLE public.merchant_accounts_safe FROM anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\n  ON TABLE public.p2p_trader_public FROM anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.p2p_trader_public TO anon",
    );
  });
});

describe("client — dead transaction insert stays removed", () => {
  const bankHooks = read("src/hooks/useBankTransfers.ts");

  it("useBankTransfers has no transactions insert and no useInitiateBankTransfer", () => {
    expect(bankHooks).not.toContain("useInitiateBankTransfer");
    expect(bankHooks).not.toMatch(/from\(['"]transactions['"]\)\s*\.insert/);
  });
});

describe("client — webhook retry goes through the RPC and is not silent", () => {
  const hook = read("src/hooks/useWebhookRetries.ts");

  it("calls request_webhook_retry instead of updating the table", () => {
    expect(hook).toContain("request_webhook_retry");
    expect(hook).not.toMatch(/from\(['"]webhook_delivery_logs['"]\)\s*\.update/);
  });

  it("surfaces retry failures with a crafted error toast", () => {
    expect(hook).toContain("onError");
    expect(hook).toContain("toUserFacingError");
  });
});

describe("client — notification creation is not silent", () => {
  const ctx = read("src/contexts/NotificationContext.tsx");

  it("createNotification toasts a crafted error on failure", () => {
    const start = ctx.indexOf("const createNotification");
    const end = ctx.indexOf("const enablePushNotifications");
    const body = ctx.slice(start, end);
    expect(body).toContain("toast({");
    expect(body).toContain("toUserFacingError");
  });
});
