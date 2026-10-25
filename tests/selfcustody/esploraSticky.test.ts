// Workstream C pins: the sticky Esplora endpoint preference.
// When the primary endpoint (mempool.space) is blocked or down on
// the user's network, the canonical fallback loop costs a full
// failed-request round trip on EVERY chain call — and a wallet
// scan makes dozens. Once an endpoint answers, it is tried first
// for the rest of the page session; the other remains fallback.

import { describe, it, expect, beforeEach } from "vitest";
import {
  ESPLORA_BASES,
  esploraOrderFor,
  currentEsploraOrder,
  noteEsploraSuccess,
  resetEsploraPreference,
} from "../../src/lib/selfcustody/chain";

beforeEach(() => {
  resetEsploraPreference();
});

describe("esploraOrderFor — preferred base first, canonical order otherwise", () => {
  it("primary preferred → canonical order", () => {
    expect(esploraOrderFor(ESPLORA_BASES[0])).toEqual([...ESPLORA_BASES]);
  });

  it("fallback preferred → fallback first, primary second", () => {
    expect(esploraOrderFor(ESPLORA_BASES[1])).toEqual([ESPLORA_BASES[1], ESPLORA_BASES[0]]);
  });

  it("always contains every endpoint exactly once", () => {
    for (const base of ESPLORA_BASES) {
      const order = esploraOrderFor(base);
      expect(new Set(order).size).toBe(ESPLORA_BASES.length);
      expect(order).toContain(ESPLORA_BASES[0]);
      expect(order).toContain(ESPLORA_BASES[1]);
    }
  });
});

describe("noteEsploraSuccess — the sticky preference moves and recovers", () => {
  it("a success on the fallback makes it the first tried", () => {
    noteEsploraSuccess(ESPLORA_BASES[1]);
    expect(currentEsploraOrder()[0]).toBe(ESPLORA_BASES[1]);
  });

  it("a later success on the primary re-earns the preference", () => {
    noteEsploraSuccess(ESPLORA_BASES[0]);
    expect(currentEsploraOrder()[0]).toBe(ESPLORA_BASES[0]);
  });

  it("unknown endpoints are ignored", () => {
    noteEsploraSuccess("https://example.invalid/api");
    expect(currentEsploraOrder()[0]).toBe(ESPLORA_BASES[0]);
  });
});
