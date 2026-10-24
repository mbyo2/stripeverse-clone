// Tests for supabase/functions/_shared/invoice-settlement.ts
// (Final-QA FIX-2): the payable-state classification + plain-language
// refusals shared by the invoice-checkout function and its pages.
// Money movement itself is proven live against the settlement RPCs.
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(here, "../../supabase/functions/_shared/invoice-settlement.ts");
const tmpPath = path.join(here, ".tmp-invoice-settlement.mjs");
type Mod = typeof import("../../supabase/functions/_shared/invoice-settlement");
let mod: Mod;
beforeAll(async () => {
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(tmpPath, outputText);
  mod = await import(tmpPath);
});

describe("invoice payable states", () => {
  it("sent / pending / draft are payable", () => {
    expect(mod.invoicePayableError("sent")).toBeNull();
    expect(mod.invoicePayableError("pending")).toBeNull();
    expect(mod.invoicePayableError("draft")).toBeNull();
  });
  it("paid refuses as already paid (exactly-once surface)", () => {
    expect(mod.invoicePayableError("paid")).toBe("This invoice has already been paid.");
  });
  it("cancelled / expired refuse as no longer payable", () => {
    expect(mod.invoicePayableError("cancelled")).toMatch(/no longer payable/);
    expect(mod.invoicePayableError("expired")).toMatch(/no longer payable/);
  });
});

describe("payment request payable states", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();
  it("pending + unexpired is payable", () => {
    expect(mod.requestPayableError("pending", future)).toBeNull();
  });
  it("paid refuses as already paid", () => {
    expect(mod.requestPayableError("paid", future)).toMatch(/already been paid/);
  });
  it("pending but expired refuses as expired", () => {
    expect(mod.requestPayableError("pending", past)).toMatch(/expired/);
  });
});

describe("self-pay + error mapping", () => {
  it("issuer paying own invoice is refused", () => {
    expect(mod.selfPayError("invoice", "u1", "u1")).toMatch(/your own invoice/);
    expect(mod.selfPayError("request", "u1", "u1")).toMatch(/your own payment request/);
    expect(mod.selfPayError("invoice", "u1", "u2")).toBeNull();
  });
  it("known RPC refusals pass through; raw errors never surface", () => {
    expect(mod.mapSettlementError("This invoice has already been paid.", "invoice"))
      .toBe("This invoice has already been paid.");
    expect(mod.mapSettlementError("Insufficient balance: have 1, need 2", "invoice"))
      .toContain("Insufficient balance");
    const mapped = mod.mapSettlementError('relation "secret_table" does not exist', "invoice");
    expect(mapped).toMatch(/could not be paid/);
    expect(mapped).not.toContain("secret_table");
  });
});
