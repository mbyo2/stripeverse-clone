// Unit tests for supabase/functions/_shared/p2p-chat-scan.ts — the
// §3.7 trade-chat content scanner/masker used by the p2p edge
// function's send_message action.
//
// The module is import-free by design, so this suite loads the REAL
// source, transpiles it, and tests the resulting module — the code
// under test is byte-identical to what Deno runs (same loader
// pattern as tests/bitcoin/btc-core.test.ts).

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadShared(name: string) {
  const source = fs.readFileSync(
    path.resolve(here, "../../supabase/functions/_shared", name),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: name,
  });
  const tmp = path.join(here, `.tmp-${name.replace(/\.ts$/, ".mjs")}`);
  fs.writeFileSync(tmp, outputText);
  return import(tmp);
}

type Scanner = typeof import("../../supabase/functions/_shared/p2p-chat-scan");
let scan: Scanner;

beforeAll(async () => {
  scan = await loadShared("p2p-chat-scan.ts");
});

describe("phone detection & masking (§3.7)", () => {
  it("masks a spaced Zambian mobile, keeping the §3.7 shape", () => {
    const r = scan.scanChatText("call me on 0977 123 456 when ready");
    expect(r.hasContactDetails).toBe(true);
    expect(r.categories).toContain("phone");
    expect(r.maskedText.startsWith("call me on 09")).toBe(true);
    expect(r.maskedText.endsWith("56 when ready")).toBe(true);
    expect(r.maskedText).toContain("•");
    expect(r.maskedText).not.toContain("771");
    expect(r.maskedText).not.toContain("123");
  });

  it("masks an international +260 number", () => {
    const r = scan.scanChatText("my number is +260977123456 ok");
    expect(r.categories).toContain("phone");
    expect(r.maskedText).toContain("+26");
    expect(r.maskedText).toContain("56");
    expect(r.maskedText).not.toContain("9771234");
  });

  it("masks a contiguous 0-prefixed number", () => {
    const r = scan.scanChatText("0771234567 is my airtel line");
    expect(r.categories).toContain("phone");
    expect(r.maskedText).not.toContain("0771234567");
  });

  it("flags two numbers but dedupes the phone category (one strike)", () => {
    const r = scan.scanChatText("call 0977123456 or 0966111222");
    expect(r.flags.filter((f: any) => f.category === "phone")).toHaveLength(2);
    expect(r.categories.filter((c: string) => c === "phone")).toHaveLength(1);
  });

  it("does NOT flag a bare rail-reference-like digit run", () => {
    const r = scan.scanChatText("the transfer reference is 8827364550");
    expect(r.categories).not.toContain("phone");
    expect(r.maskedText).toBe("the transfer reference is 8827364550");
  });

  it("does NOT flag amounts or short numbers", () => {
    const r = scan.scanChatText("I sent K500 for 100000 sats, order 42");
    expect(r.flags).toHaveLength(0);
    expect(r.maskedText).toBe("I sent K500 for 100000 sats, order 42");
  });
});

describe("links, emails, messaging apps (§3.7)", () => {
  it("replaces a full URL with [link hidden]", () => {
    const r = scan.scanChatText("pay via https://example.com/pay?id=3 please");
    expect(r.categories).toContain("url");
    expect(r.maskedText).toBe("pay via [link hidden] please");
  });

  it("flags a wa.me link as both a URL and a messaging app", () => {
    const r = scan.scanChatText("reach me at wa.me/260977123456");
    expect(r.categories).toContain("url");
    expect(r.categories).toContain("messaging_app");
    expect(r.maskedText).toBe("reach me at [link hidden]");
    // digits inside the link must not double-report as a phone
    expect(r.categories).not.toContain("phone");
  });

  it("masks an email to the §3.7 shape", () => {
    const r = scan.scanChatText("email john.doe@gmail.com instead");
    expect(r.categories).toContain("email");
    expect(r.maskedText).toBe("email j•••@g•••.com instead");
  });

  it("flags a bare WhatsApp mention WITHOUT changing the text", () => {
    const text = "message me on WhatsApp when you are done";
    const r = scan.scanChatText(text);
    expect(r.categories).toContain("messaging_app");
    expect(r.hasContactDetails).toBe(true);
    expect(r.maskedText).toBe(text);
  });

  it("flags a bare Telegram mention", () => {
    const r = scan.scanChatText("find me on telegram");
    expect(r.categories).toContain("messaging_app");
  });
});

describe("release pressure (§3.7)", () => {
  it("detects 'release first' pressure without masking anything", () => {
    const text = "I already paid, release the BTC first, trust me";
    const r = scan.scanChatText(text);
    expect(r.hasReleasePressure).toBe(true);
    expect(r.categories).toContain("release_pressure");
    expect(r.hasContactDetails).toBe(false);
    expect(r.maskedText).toBe(text);
  });

  it("detects urgency pressure", () => {
    const r = scan.scanChatText("hurry up and send it, I am in a hurry");
    expect(r.hasReleasePressure).toBe(true);
  });
});

describe("clean traffic & ad terms", () => {
  it("leaves a clean trade message completely untouched", () => {
    const text = "I have sent the money, please check your account";
    const r = scan.scanChatText(text);
    expect(r.flags).toHaveLength(0);
    expect(r.hasContactDetails).toBe(false);
    expect(r.hasReleasePressure).toBe(false);
    expect(r.maskedText).toBe(text);
  });

  it("scanAdTerms applies the same scan to ad terms", () => {
    const r = scan.scanAdTerms("Fast trades. WhatsApp me for a better rate.");
    expect(r.hasContactDetails).toBe(true);
    expect(r.categories).toContain("messaging_app");
  });
});
