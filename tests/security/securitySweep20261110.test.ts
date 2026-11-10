// Pins for the 2026-11-10 security-sweep fix mission.
//
// Each defect class fixed in that mission gets a pin here so a
// regression fails loudly. Pure-logic pins import the real modules;
// edge-function pins assert on the deployed source (the functions run
// on Deno, so their behaviour is pinned by source contract + the
// live behaviour probes in the mission report, not by importing them
// into vitest).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { escapeHtml } from "../../src/utils/p2pUi";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const fn = (p: string) => read(`supabase/functions/${p}`);

describe("stored XSS — TransactionReceipt print window", () => {
  it("escapeHtml neutralises a cross-user script payload", () => {
    const payload = `"><img src=x onerror=alert(1)><script>alert("pwned")</script>'`;
    const out = escapeHtml(payload);
    // Escaping neutralises by breaking the markup: no raw < or >
    // survives, so no tag or attribute can ever be parsed — the
    // literal text "onerror=" left over is inert.
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    expect(out).toContain("&quot;");
    expect(out).toContain("&#39;");
  });

  it("TransactionReceipt escapes every interpolated receipt field", () => {
    const src = read("src/components/TransactionReceipt.tsx");
    expect(src).toContain('import { escapeHtml } from "@/utils/p2pUi"');
    for (const field of ["recipient_name", "reference", "category", "payment_method"]) {
      expect(src).toContain(`escapeHtml(transaction.${field}`);
    }
    // No raw interpolation of a transaction field survives inside
    // the document.write() template.
    const writeBlock = src.slice(src.indexOf("win.document.write"));
    expect(writeBlock).not.toMatch(/\$\{transaction\.(recipient_name|reference|category|payment_method|status)\}/);
    expect(writeBlock).not.toContain("${transaction.status}");
  });

  it("atomic-transfer allow-lists reference_type and payment_method", () => {
    const src = fn("atomic-transfer/index.ts");
    for (const t of ["send_money", "transfer", "qr_payment", "bill_payment", "bnpl_installment", "bulk_payment", "escrow_hold", "refund"]) {
      expect(src).toContain(`"${t}"`);
    }
    for (const m of ["wallet", "bank_transfer", "mobile_money", "card", "bank", "bitcoin", "qr_code", "manual", "ussd"]) {
      expect(src).toContain(`"${m}"`);
    }
    expect(src).toContain('throw new Error("Unknown reference_type")');
    expect(src).toContain('throw new Error("Unknown payment_method")');
  });
});

describe("mobile-money-sim is gone", () => {
  it("the function directory and every reference are deleted", () => {
    expect(existsSync(resolve(root, "supabase/functions/mobile-money-sim"))).toBe(false);
    expect(read("supabase/config.toml")).not.toContain("mobile-money-sim");
  });
});

describe("developer-api webhook gates", () => {
  it("webhook routes require scope, and POST/test require live", () => {
    const src = fn("developer-api/index.ts");
    expect(src).toContain('requireScope(key, "webhooks:read")');
    expect(src).toContain('requireScope(key, "webhooks:write")');
    // POST and test both call requireLive after the write-scope check.
    const postBlock = src.slice(src.indexOf('resource === "webhooks" && method === "POST"'));
    expect(postBlock).toContain("requireLive(key)");
    const testBlock = src.slice(src.indexOf('parts[2] === "test"'));
    expect(testBlock).toContain("requireLive(key)");
    // The legacy webhooks:manage umbrella still grants both.
    expect(src).toContain('held.includes("webhooks:manage")');
  });

  it("developer-api is rate-limited per key", () => {
    const src = fn("developer-api/index.ts");
    expect(src).toContain('p_action: "developer_api"');
    expect(src).toContain("check_advanced_rate_limit");
  });
});

describe("checkout intent hardening", () => {
  it("create-checkout-intent rate-limits, honours idempotency and caps pending intents", () => {
    const src = fn("create-checkout-intent/index.ts");
    expect(src).toContain("check_advanced_rate_limit");
    expect(src).toContain("MAX_PENDING_INTENTS_PER_LINK = 50");
    expect(src).toContain("idempotency_key");
    expect(src).toContain("duplicate: true");
    expect(src).toContain("429");
  });

  it("verify-checkout-status rate-limits per IP and per intent", () => {
    const src = fn("verify-checkout-status/index.ts");
    expect(src).toContain("p_action: 'verify_checkout_status'");
    expect(src).toContain("p_action: 'verify_checkout_status_intent'");
    expect(src).toContain("429");
  });

  it("payment-link-checkout rate-limits per IP and per link", () => {
    const src = fn("payment-link-checkout/index.ts");
    expect(src).toContain('p_action: "payment_link_checkout"');
    expect(src).toContain('p_action: "payment_link_checkout_link"');
  });
});

describe("transaction-webhook signature fix", () => {
  it("verifies HMAC-SHA256 over the raw body with hex handling", () => {
    const src = fn("transaction-webhook/index.ts");
    expect(src).toContain("const rawBody = await req.text()");
    expect(src).toContain("validateWebhookSignature(req, rawBody, webhookData)");
    expect(src).toContain("/^[0-9a-f]{64}$/");
    expect(src).not.toContain("atob(expectedSig)");
    expect(src).not.toContain("encoder.encode(JSON.stringify(webhookData))");
  });

  it("generateWebhookSignature uses the passed client (no undefined supabase)", () => {
    const src = fn("transaction-webhook/index.ts");
    expect(src).toContain("generateWebhookSignature(supabaseClient, payload, webhook.business_id)");
    expect(src).toContain("async function generateWebhookSignature(supabaseClient: any, payload: any, businessId: string)");
    expect(src).not.toMatch(/await supabase\n\s+\.from\('webhooks'\)/);
  });
});

describe("checkout-webhook receipt path", () => {
  it("send-receipt accepts the service-role bearer as an internal caller", () => {
    const src = fn("send-receipt/index.ts");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toContain("isInternalCall");
    expect(src).toContain("!isInternalCall && transaction.user_id");
  });

  it("checkout-webhook logs the receipt invoke result instead of swallowing it", () => {
    const src = fn("checkout-webhook/index.ts");
    expect(src).toContain("send-receipt failed:");
    expect(src).not.toContain(".catch((e) => console.error('send-receipt invoke error:', e))");
  });
});

describe("payout-submit atomic claim", () => {
  it("claims the batch with a draft-only update and proceeds only if claimed", () => {
    const src = fn("payout-submit/index.ts");
    expect(src).toContain(".eq('status', 'draft')");
    expect(src).toContain("if (claimError || !claimed)");
    expect(src).toContain("Atomic claim");
  });
});

describe("btc-onchain explorer outage handling", () => {
  it("gatherUtxos falls back to the persisted set and fails with a crafted 503", () => {
    const src = fn("btc-onchain/index.ts");
    expect(src).toContain("explorer UTXO scan failed, using persisted set");
    expect(src).toContain('throw new Error("UTXO_SCAN_UNAVAILABLE")');
    expect(src).toContain("UTXO_SCAN_UNAVAILABLE_MESSAGE");
    expect(src).toContain("Bitcoin network data is temporarily unavailable");
    expect(src).toContain('return json(503, { error: UTXO_SCAN_UNAVAILABLE_MESSAGE })');
  });

  it("the raw Esplora error never reaches the top-level response", () => {
    const src = fn("btc-onchain/index.ts");
    const topCatch = src.slice(src.indexOf('e.message === "UTXO_SCAN_UNAVAILABLE"'));
    expect(topCatch).toContain("503");
  });
});

describe("auth hygiene", () => {
  it("no bare auth.getUser() remains in the flagged functions", () => {
    for (const f of ["btc-payment/index.ts", "mobile-money/index.ts", "ussd-payment/index.ts", "validate-card-access/index.ts"]) {
      expect(fn(f)).not.toContain("auth.getUser()");
    }
    // btc-payment uses the caller authenticated once, above.
    expect(fn("btc-payment/index.ts")).toContain("const userId = user?.id;");
  });

  it("requireAdmin accepts admin OR super_admin", () => {
    const src = fn("_shared/auth.ts");
    expect(src).toContain("required_role: 'super_admin'");
    expect(src).toContain("isAdmin && !isSuperAdmin");
  });

  it("get-breez-config requires auth in code, not only at the gateway", () => {
    const src = fn("get-breez-config/index.ts");
    expect(src).toContain("requireAuth(req, corsHeaders)");
  });

  it("every supabase-js edge import is pinned to 2.49.1", () => {
    // No floating `@2` import (quote-terminated) may remain anywhere.
    const { execSync } = require("node:child_process");
    const out = execSync("grep -rn \"supabase-js@2['\\\"]\" supabase/functions --include='*.ts' || true", { cwd: root, encoding: "utf8" });
    expect(out.trim()).toBe("");
    expect(fn("_shared/supabase-client.ts")).toContain("@supabase/supabase-js@2.49.1");
  });
});

describe("config.toml matches the live verify_jwt map", () => {
  it("lists every deployed function and the two known disagreements are fixed", () => {
    const cfg = read("supabase/config.toml");
    expect(cfg).not.toContain("[functions.mobile-money-sim]");
    const sections = [...cfg.matchAll(/\[functions\.([^\]]+)\]\nverify_jwt = (true|false)/g)];
    expect(sections.length).toBe(74);
    const map = new Map(sections.map((m) => [m[1], m[2]]));
    // Live is true for both (config previously said false).
    expect(map.get("fetch-exchange-rates")).toBe("true");
    expect(map.get("dispatch-webhook")).toBe("true");
    // In-code-gated functions stay false at the gateway.
    expect(map.get("developer-api")).toBe("false");
    expect(map.get("transaction-webhook")).toBe("false");
    expect(map.get("checkout-webhook")).toBe("false");
    expect(map.get("create-checkout-intent")).toBe("false");
  });
});

describe(".env hygiene", () => {
  it(".env is ignored and a template exists instead", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toContain(".env");
    expect(gitignore).toContain("!.env.example");
    expect(existsSync(resolve(root, ".env.example"))).toBe(true);
  });
});

describe("raw error text", () => {
  it("the replaced sites return crafted messages, not error.message", () => {
    expect(fn("audit-manager/index.ts")).toContain("Something went wrong while managing audit logs");
    expect(fn("dispatch-webhook/index.ts")).toContain("Something went wrong while sending the webhook");
    expect(fn("feature-management/index.ts")).toContain("Something went wrong while updating features");
    expect(fn("process-webhook-retries/index.ts")).toContain("Something went wrong while retrying webhooks");
    expect(fn("revoke-api-key/index.ts")).toContain("The API key could not be revoked");
    expect(fn("btc-trade/index.ts")).toContain("The trade could not be completed");
    expect(fn("data-backup/index.ts")).toContain("Backup of ${tableName} failed");
  });
});
