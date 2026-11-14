// Webhook column drift (bug-free gate, 2026-11-14). The live `webhooks`
// table is keyed by the owning user (`user_id`, UNIQUE) with a `secret`
// column and a text[] `events` list — but client code and the
// transaction-webhook edge function filtered/selected on `business_id`
// and `webhook_secret`, neither of which exists live. Net effect:
//   - WebhookManager could never load a config (400) and could never
//     save one (it sent business_id = the user id, which update-webhook
//     treats as a merchant_accounts id to ownership-check -> 403).
//   - The business webhooks list always errored.
//   - transaction-webhook's merchant notification query errored, so NO
//     merchant transaction webhook was ever delivered, and every
//     signature came back empty.
//   - The client deliverWebhook subscription check indexed a text[]
//     as a map, so even a fixed query would have refused every event.
// These tests pin the corrected columns, the array-aware subscription
// check, and the bulk-payments recipient fix that shares the same
// root cause (a profiles select on a column that does not exist:
// `email` — resolution now goes through find_transfer_recipient).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isSubscribedToEvent } from "../../src/utils/webhookDelivery";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

describe("isSubscribedToEvent — live events is a text[]", () => {
  it("matches a name present in the array", () => {
    expect(
      isSubscribedToEvent(["transaction.completed", "test.webhook"], "test.webhook"),
    ).toBe(true);
  });

  it("refuses a name absent from the array", () => {
    expect(
      isSubscribedToEvent(["transaction.completed"], "transaction.failed"),
    ).toBe(false);
  });

  it("still accepts the legacy boolean-map shape", () => {
    expect(
      isSubscribedToEvent({ "transaction.completed": true }, "transaction.completed"),
    ).toBe(true);
    expect(
      isSubscribedToEvent({ "transaction.completed": false }, "transaction.completed"),
    ).toBe(false);
  });

  it("refuses null / undefined events", () => {
    expect(isSubscribedToEvent(null, "test.webhook")).toBe(false);
    expect(isSubscribedToEvent(undefined, "test.webhook")).toBe(false);
  });
});

describe("webhook column pins — client", () => {
  it("WebhookManager loads by user_id, never business_id", () => {
    const src = read("../../src/components/business/WebhookManager.tsx");
    expect(src).toContain(".eq('user_id', user.id)");
    expect(src).not.toContain(".eq('business_id', user.id)");
    expect(src).not.toContain("business_id: user.id");
  });

  it("WebhookManager converts the stored text[] into the UI boolean map", () => {
    const src = read("../../src/components/business/WebhookManager.tsx");
    expect(src).toContain("enabledNames.includes('payment_success')");
  });

  it("useBusinessData lists webhooks by user_id, never business_id", () => {
    const src = read("../../src/hooks/useBusinessData.ts");
    expect(src).toContain(".eq('user_id', user.id)");
    expect(src).not.toContain(".eq('business_id'");
  });

  it("webhookDelivery queries by user_id and signs with `secret`", () => {
    const src = read("../../src/utils/webhookDelivery.ts");
    expect(src).toContain(".eq('user_id', businessId)");
    expect(src).toContain(".select('secret')");
    expect(src).toContain("webhook.secret");
    expect(src).not.toContain(".select('webhook_secret')");
    expect(src).not.toContain(".eq('business_id', businessId)");
    expect(src).toContain("isSubscribedToEvent(webhook.events, eventType)");
  });
});

describe("webhook column pins — transaction-webhook edge function", () => {
  // Gate14 2026-11-14: the notification code moved into the shared
  // notifier (_shared/merchant-webhooks.ts) so the momo settlement
  // paths can use it too; transaction-webhook now just calls it.
  const shared = read("../../supabase/functions/_shared/merchant-webhooks.ts");
  const src = read("../../supabase/functions/transaction-webhook/index.ts");

  it("resolves merchant owners to user ids and notifies by user_id", () => {
    expect(shared).toContain('.in("user_id", ownerIds)');
    expect(shared).not.toContain(".in('business_id', merchantIds)");
    expect(shared).not.toContain(".eq('business_id'");
    expect(src).toContain("notifyMerchantWebhooks(supabaseClient, {");
  });

  it("signs with the secret from the fetched webhook row", () => {
    expect(shared).toContain("merchantWebhookSignature(hook.secret, body)");
    expect(shared).not.toContain(".select('webhook_secret')");
    expect(shared).not.toContain("webhook.business_id");
  });

  it("delivers the merchant-facing event names (payment_success / payment_failed)", () => {
    expect(shared).toContain('completed: "payment_success"');
    expect(shared).toContain('failed: "payment_failed"');
  });
});

describe("bulk payments — recipient resolution pins", () => {
  const src = read("../../src/hooks/useBulkPayments.ts");

  it("resolves phone/email recipients through find_transfer_recipient", () => {
    expect(src).toContain('"find_transfer_recipient"');
    expect(src).toContain("normalizeZambianPhone(item.recipient_phone)");
  });

  it("never selects from profiles on a phantom email column", () => {
    expect(src).not.toContain(".from('profiles')");
    expect(src).not.toContain("email.eq.");
  });
});

describe("generated types match the live webhooks table", () => {
  const types = read("../../src/integrations/supabase/types.ts");
  const block = types.slice(
    types.indexOf("webhooks: {"),
    types.indexOf("webhooks: {") + 1200,
  );

  it("carries user_id + secret + is_active, not business_id + webhook_secret", () => {
    expect(block).toContain("user_id: string");
    expect(block).toContain("secret: string");
    expect(block).not.toContain("business_id");
    expect(block).not.toContain("webhook_secret");
  });
});
