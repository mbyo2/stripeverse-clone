// Security-audit pins (2026-10-30 full audit of bmaglasspay.online).
//
// What is pinned:
//   1. The site serves real security headers from vercel.json (before the
//      audit the live site had NO CSP / nosniff / Referrer-Policy at all;
//      the only "security headers" code was a dead module that injected
//      meta tags browsers ignore for frame-ancestors, carried a placeholder
//      btcpay.example.com origin, and would have disabled the camera the
//      KYC live-capture depends on).
//   2. The CSP's inline-script allowance is exactly the SHA-256 of the
//      boot-watchdog script in index.html — recomputed here from source,
//      so editing the watchdog without regenerating the hash fails loudly.
//   3. script-src carries no bare 'unsafe-eval' / 'unsafe-inline'
//      ('wasm-unsafe-eval' is required for the Breez WASM SDK and is a
//      distinct token).
//   4. The dead src/lib/securityHeaders.ts module stays deleted.
//   5. The face-model assets under /models keep long-lived immutable
//      caching, and index.html preconnects to the Supabase origin.
//   6. The database hardening migration (DROP EXTENSION http — the
//      unauthenticated-SSRF fix — plus the service-role-only grant
//      tightening) stays in the repo so the fix is replayable.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const vercel = JSON.parse(read("vercel.json"));
const headerBlocks: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
  vercel.headers ?? [];
const globalBlock = headerBlocks.find((b) => b.source === "/(.*)");
const globalHeaders = new Map((globalBlock?.headers ?? []).map((h) => [h.key, h.value]));
const csp = globalHeaders.get("Content-Security-Policy") ?? "";
const directives = new Map(
  csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...tokens] = d.split(/\s+/);
      return [name, tokens] as const;
    }),
);

describe("vercel.json security headers", () => {
  it("serves a Content-Security-Policy on every route", () => {
    expect(csp).toBeTruthy();
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'self'"]);
  });

  it("script-src is self + wasm-unsafe-eval + the watchdog hash only", () => {
    const tokens = directives.get("script-src") ?? [];
    expect(tokens).toContain("'self'");
    expect(tokens).toContain("'wasm-unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-inline'");
    expect(tokens.some((t) => t.startsWith("'sha256-"))).toBe(true);
  });

  it("the CSP sha256 matches the inline watchdog script in index.html", () => {
    const html = read("index.html");
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !m[1].includes("ld+json"))
      .map((m) => m[2]);
    expect(scripts.length).toBe(1);
    const hash = createHash("sha256").update(scripts[0], "utf8").digest("base64");
    expect(csp).toContain(`'sha256-${hash}'`);
  });

  it("serves nosniff, a referrer policy, and a camera-preserving permissions policy", () => {
    expect(globalHeaders.get("X-Content-Type-Options")).toBe("nosniff");
    expect(globalHeaders.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const pp = globalHeaders.get("Permissions-Policy") ?? "";
    expect(pp).toContain("camera=(self)"); // KYC live capture + QR scan need it
    expect(pp).toContain("microphone=()");
  });

  it("keeps immutable caching for hashed assets and face models", () => {
    const cacheFor = (src: string) =>
      headerBlocks.find((b) => b.source === src)?.headers.find((h) => h.key === "Cache-Control")
        ?.value ?? "";
    expect(cacheFor("/assets/(.*)")).toContain("immutable");
    expect(cacheFor("/models/(.*)")).toContain("immutable");
  });

  it("the dead meta-tag securityHeaders module stays deleted", () => {
    expect(existsSync(resolve(root, "src/lib/securityHeaders.ts"))).toBe(false);
  });

  it("index.html preconnects to the Supabase origin", () => {
    expect(read("index.html")).toContain(
      '<link rel="preconnect" href="https://hhxwwozpvgktuqutfkhc.supabase.co" />',
    );
  });
});

describe("database hardening migration", () => {
  const migration = () =>
    read("supabase/migrations/20261248_security_audit_hardening.sql");

  it("drops the unused pgsql-http extension (the anon SSRF surface)", () => {
    expect(migration()).toContain("DROP EXTENSION IF EXISTS http;");
  });

  it("revokes anon/authenticated grants on the service-role-only tables", () => {
    const sql = migration();
    for (const table of [
      "btc_treasury",
      "pos_api_keys",
      "identity_verification_embeddings",
      "p2p_escrow_holds",
      "developer_event_dispatches",
      "payment_link_paid_dispatches",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated;`);
    }
  });
});
