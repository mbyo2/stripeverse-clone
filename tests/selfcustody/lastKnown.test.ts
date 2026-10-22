import { describe, it, expect, beforeEach } from "vitest";
import { loadLastKnown, saveLastKnown, clearLastKnown } from "../../src/lib/selfcustody/lastKnown";

// In-memory localStorage shim (same pattern as vault.test.ts).
class MemoryStorage {
  private map = new Map<string, string>();
  getItem = (k: string) => (this.map.has(k) ? this.map.get(k)! : null);
  setItem = (k: string, v: string) => void this.map.set(k, String(v));
  removeItem = (k: string) => void this.map.delete(k);
  clear = () => this.map.clear();
}

const XPUB_A = "zpub6rFR7y4Q2AijMKK7vJdUwhKxTCHkePcSKtXpJJzagRPJPHMnJPPqzDxrWnXhB8C4zZRXFANzNDzFqaFjshFvYDBZKVYKzY5BXCWuPzSyBmA";
const XPUB_B = "zpubB-synthetic-test-key";

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

describe("lastKnown (on-device last-good scan reading)", () => {
  it("returns null when nothing was stored", () => {
    expect(loadLastKnown(XPUB_A)).toBeNull();
  });

  it("round-trips a reading", () => {
    const data = { receiveIndex: 3, balanceSats: 42_000, updatedAt: 1_760_000_000_000 };
    saveLastKnown(XPUB_A, data);
    expect(loadLastKnown(XPUB_A)).toEqual(data);
  });

  it("keys readings by zpub — wallets never mix", () => {
    saveLastKnown(XPUB_A, { receiveIndex: 1, balanceSats: 100, updatedAt: 1 });
    saveLastKnown(XPUB_B, { receiveIndex: 9, balanceSats: 200, updatedAt: 2 });
    expect(loadLastKnown(XPUB_A)?.balanceSats).toBe(100);
    expect(loadLastKnown(XPUB_B)?.receiveIndex).toBe(9);
  });

  it("a later save overwrites the earlier reading", () => {
    saveLastKnown(XPUB_A, { receiveIndex: 0, balanceSats: 0, updatedAt: 1 });
    saveLastKnown(XPUB_A, { receiveIndex: 2, balanceSats: 500, updatedAt: 2 });
    expect(loadLastKnown(XPUB_A)).toEqual({ receiveIndex: 2, balanceSats: 500, updatedAt: 2 });
  });

  it("clear removes only that wallet's reading", () => {
    saveLastKnown(XPUB_A, { receiveIndex: 0, balanceSats: 1, updatedAt: 1 });
    saveLastKnown(XPUB_B, { receiveIndex: 0, balanceSats: 2, updatedAt: 1 });
    clearLastKnown(XPUB_A);
    expect(loadLastKnown(XPUB_A)).toBeNull();
    expect(loadLastKnown(XPUB_B)?.balanceSats).toBe(2);
  });

  it("corrupt or invalid stored data reads as null, never throws", () => {
    localStorage.setItem("bmaglass.sc.lastknown.v1", "{not json");
    expect(loadLastKnown(XPUB_A)).toBeNull();
    localStorage.setItem("bmaglass.sc.lastknown.v1", JSON.stringify({ [XPUB_A]: { receiveIndex: -1, balanceSats: "x" } }));
    expect(loadLastKnown(XPUB_A)).toBeNull();
  });

  it("refuses to save an invalid reading", () => {
    saveLastKnown(XPUB_A, { receiveIndex: -2, balanceSats: 10, updatedAt: 1 });
    expect(loadLastKnown(XPUB_A)).toBeNull();
  });
});
