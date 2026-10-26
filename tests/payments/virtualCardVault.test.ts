// Virtual-card vault + lifecycle (Workstream B, 2026-10-26).
//
//   * The vault module runs for real here (WebCrypto AES-256-GCM,
//     the exact code Deno runs in the edge functions): round-trip,
//     IV freshness, tamper and wrong-key refusal.
//   * The edge functions and pages cannot be executed by vitest, so
//     — the repo's established pattern — their security wiring is
//     pinned from source: gate-before-decrypt ordering, password
//     re-auth, audit writes, no secret logging, the Details page
//     having NO direct virtual_cards write left, and the migration
//     closing the owner UPDATE policy.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_VAULT_KEY_VERSION,
  decryptCardDetails,
  encryptCardDetails,
} from "../../supabase/functions/_shared/card-vault";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const manageFn = read("../../supabase/functions/manage-virtual-card/index.ts");
const createFn = read("../../supabase/functions/create-virtual-card/index.ts");
const detailsPage = read("../../src/pages/VirtualCardDetails.tsx");
const migration = read(
  "../../supabase/migrations/20261116_virtual_card_vault_and_manage.sql",
);

const KEY = Buffer.from(new Uint8Array(32).map((_, i) => i + 1)).toString("base64");
const OTHER_KEY = Buffer.from(new Uint8Array(32).map((_, i) => 200 - i)).toString("base64");

describe("card vault — AES-GCM envelope", () => {
  it("round-trips PAN + CVV", async () => {
    const env = await encryptCardDetails({ pan: "5399000000001234", cvv: "123" }, KEY);
    expect(env.keyVersion).toBe(CARD_VAULT_KEY_VERSION);
    expect(env.ciphertext).not.toContain("5399000000001234");
    const out = await decryptCardDetails(env, KEY);
    expect(out).toEqual({ pan: "5399000000001234", cvv: "123" });
  });

  it("round-trips a PAN with no CVV (Mastercard Processing issuance)", async () => {
    const env = await encryptCardDetails({ pan: "5399000000009999", cvv: null }, KEY);
    const out = await decryptCardDetails(env, KEY);
    expect(out).toEqual({ pan: "5399000000009999", cvv: null });
  });

  it("uses a fresh IV per envelope", async () => {
    const a = await encryptCardDetails({ pan: "5399000000001234", cvv: "123" }, KEY);
    const b = await encryptCardDetails({ pan: "5399000000001234", cvv: "123" }, KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a wrong key and tampered ciphertext", async () => {
    const env = await encryptCardDetails({ pan: "5399000000001234", cvv: "123" }, KEY);
    await expect(decryptCardDetails(env, OTHER_KEY)).rejects.toThrow();
    const raw = Buffer.from(env.ciphertext, "base64");
    raw[0] = raw[0] ^ 0xff;
    await expect(
      decryptCardDetails({ ...env, ciphertext: raw.toString("base64") }, KEY),
    ).rejects.toThrow();
  });

  it("rejects a non-32-byte key", async () => {
    await expect(
      encryptCardDetails({ pan: "5399000000001234", cvv: "123" }, Buffer.from("short").toString("base64")),
    ).rejects.toThrow();
  });
});

describe("manage-virtual-card — reveal path ordering", () => {
  it("enforces auth, then the admin card gate, then ownership, before any decrypt", () => {
    const authIdx = manageFn.indexOf("auth.getUser(token)");
    const gateIdx = manageFn.indexOf('.in("role", ["admin", "super_admin"])');
    const ownIdx = manageFn.indexOf("CARD_COLUMNS}, details_ciphertext");
    const reauthIdx = manageFn.indexOf("signInWithPassword");
    const decryptIdx = manageFn.indexOf("decryptCardDetails(");
    for (const idx of [authIdx, gateIdx, ownIdx, reauthIdx, decryptIdx]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    expect(authIdx).toBeLessThan(gateIdx);
    expect(gateIdx).toBeLessThan(ownIdx);
    expect(ownIdx).toBeLessThan(decryptIdx);
    expect(reauthIdx).toBeLessThan(decryptIdx);
  });

  it("keeps the public Coming Soon refusal for non-admins", () => {
    expect(manageFn).toContain("Virtual cards are coming soon");
    expect(manageFn).toContain("403");
  });

  it("verifies the re-auth password against the caller's own email", () => {
    expect(manageFn).toContain("email: user.email");
    expect(manageFn).toContain("SUPABASE_ANON_KEY");
  });

  it("audits reveals and lifecycle actions to card_access_audit", () => {
    expect(manageFn).toContain('from("card_access_audit")');
    expect(manageFn).toContain('audit("reveal", false)');
    expect(manageFn).toContain('audit("reveal", true)');
    expect(manageFn).toContain('audit("terminate", true)');
  });

  it("never logs card secrets", () => {
    expect(manageFn).not.toMatch(/console\.log\([^)]*(pan|cvv|card_number|password)/i);
    expect(manageFn).not.toContain("details.pan }");
  });

  it("legacy (unvaulted) cards get the honest state, never an invented number", () => {
    expect(manageFn).toContain("vaulted: false");
    expect(manageFn).toContain("can't be displayed again");
    // The vaulted:false branch is reached before decrypt is attempted.
    expect(manageFn.indexOf("vaulted: false")).toBeLessThan(manageFn.indexOf("decryptCardDetails("));
  });

  it("terminate wipes the vault envelope", () => {
    expect(manageFn).toContain("details_ciphertext: null");
    expect(manageFn).toContain("details_iv: null");
  });

  it("card fetch never returns ciphertext in a non-reveal response shape", () => {
    // The only response carrying a PAN is the reveal success.
    const panResponses = manageFn.split("card_number: details.pan").length - 1;
    expect(panResponses).toBe(1);
  });
});

describe("create-virtual-card — new cards are vaulted", () => {
  it("encrypts PAN+CVV under the env-only vault key on the local path", () => {
    expect(createFn).toContain("cardVaultKeyFromEnv()");
    expect(createFn).toContain("encryptCardDetails({ pan: cardNumber, cvv }, vaultKey)");
    expect(createFn).toContain("details_ciphertext: envelope.ciphertext");
  });

  it("keeps the admin-only creation gate", () => {
    expect(createFn).toContain("Virtual cards are coming soon");
  });
});

describe("migration — vault columns, audit table, RLS gap closed", () => {
  it("adds the envelope columns and the generated vaulted flag", () => {
    expect(migration).toContain("details_ciphertext TEXT");
    expect(migration).toContain("details_iv TEXT");
    expect(migration).toContain("GENERATED ALWAYS AS (details_ciphertext IS NOT NULL) STORED");
  });

  it("drops the owner UPDATE policy (direct-DB writes closed)", () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users can update own card settings" ON public.virtual_cards',
    );
  });

  it("audit table is service-role only", () => {
    expect(migration).toContain("card_access_audit");
    expect(migration).toContain("REVOKE ALL ON public.card_access_audit FROM anon, authenticated");
  });
});

describe("VirtualCardDetails — no direct DB writes remain", () => {
  it("contains no direct virtual_cards UPDATE at all", () => {
    expect(detailsPage).not.toMatch(/from\('virtual_cards'\)\s*\.update\(/);
  });

  it("routes freeze, terminate and limits through manage-virtual-card", () => {
    expect(detailsPage).toContain("action: 'set_status'");
    expect(detailsPage).toContain("action: 'terminate'");
    expect(detailsPage).toContain("action: 'set_limits'");
    expect(detailsPage).toContain("action: 'reveal'");
  });

  it("never selects the ciphertext columns", () => {
    expect(detailsPage).not.toMatch(/select\([^)]*details_ciphertext/);
    expect(detailsPage).toContain("has_vaulted_details");
  });

  it("shows the honest legacy state for unvaulted cards", () => {
    expect(detailsPage).toContain("created before secure card storage");
    expect(detailsPage).toContain("can't be displayed again for this card");
  });

  it("reveal auto-hides after 30 seconds and clears on close", () => {
    expect(detailsPage).toContain("setRevealSecondsLeft(30)");
    expect(detailsPage).toContain("clearReveal()");
  });

  it("keeps the honesty framing: not a network card", () => {
    expect(detailsPage).toContain("isn't a Visa, Mastercard, or bank card");
  });
});
