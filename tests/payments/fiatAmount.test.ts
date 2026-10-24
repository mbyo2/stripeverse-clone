// Regression tests for supabase/functions/_shared/fiat-amount.ts
// (Final-QA FIX-1). The bug: a 10.001 ZMW send was ACCEPTED — sender
// debited 10.001 + fee, recipient credited a rounded 10.00. Fiat
// amounts are now refused above two decimal places at every entry
// point, via this shared validator. Byte-identical transpile-loader
// style, same as tests/pos/pos-core.test.ts.
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(here, "../../supabase/functions/_shared/fiat-amount.ts");
const tmpPath = path.join(here, ".tmp-fiat-amount.mjs");
type Mod = typeof import("../../supabase/functions/_shared/fiat-amount");
let mod: Mod;
beforeAll(async () => {
  const source = fs.readFileSync(srcPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(tmpPath, outputText);
  mod = await import(tmpPath);
});

describe("validateFiatAmount — FIX-1 regression cases", () => {
  it("refuses 10.001 (the original bug amount)", () => {
    const r = mod.validateFiatAmount(10.001);
    expect(r.ok).toBe(false);
  });
  it("refuses 10.005 (binary-float trap: stored as 10.004999…)", () => {
    expect(mod.validateFiatAmount(10.005).ok).toBe(false);
    expect(mod.validateFiatAmount("10.005").ok).toBe(false);
  });
  it("accepts 10.01", () => {
    expect(mod.validateFiatAmount(10.01)).toEqual({ ok: true, amount: 10.01 });
  });
  it("accepts integer 10", () => {
    expect(mod.validateFiatAmount(10)).toEqual({ ok: true, amount: 10 });
  });
  it("accepts the string '10.00'", () => {
    expect(mod.validateFiatAmount("10.00")).toEqual({ ok: true, amount: 10 });
  });
  it("accepts '1e2' scientific form as 100", () => {
    expect(mod.validateFiatAmount("1e2")).toEqual({ ok: true, amount: 100 });
  });
  it("refuses zero, negatives, NaN, Infinity, junk", () => {
    for (const bad of [0, -5, NaN, Infinity, -Infinity, "abc", "1,000.00", "", "  ", null, undefined, {}, [], true, "0x10", "10.001", "0.001"]) {
      expect(mod.validateFiatAmount(bad as never).ok, String(bad)).toBe(false);
    }
  });
  it("refuses amounts above the cap", () => {
    expect(mod.validateFiatAmount(1_000_000.01).ok).toBe(false);
    expect(mod.validateFiatAmount(60, 50).ok).toBe(false);
    expect(mod.validateFiatAmount(50, 50)).toEqual({ ok: true, amount: 50 });
  });
  it("decimalPlacesOf expands scientific notation", () => {
    expect(mod.decimalPlacesOf("1.5e-3")).toBe(4);
    expect(mod.decimalPlacesOf("10.00")).toBe(2);
    expect(mod.decimalPlacesOf("1e2")).toBe(0);
    expect(mod.decimalPlacesOf("abc")).toBeNull();
  });
  it("parseFiatAmount mirrors the validator", () => {
    expect(mod.parseFiatAmount("25.554")).toBeNull();
    expect(mod.parseFiatAmount("25.55")).toBe(25.55);
  });
});
