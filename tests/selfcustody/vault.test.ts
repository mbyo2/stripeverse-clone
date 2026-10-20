import { describe, it, expect, beforeEach } from "vitest";
import {
  createVault,
  unlockVault,
  vaultExists,
  deleteVault,
  getVaultMeta,
} from "../../src/lib/selfcustody/vault";

// In-memory localStorage shim (the vault targets the browser store; Node has none).
class MemoryStorage {
  private map = new Map<string, string>();
  getItem = (k: string) => (this.map.has(k) ? this.map.get(k)! : null);
  setItem = (k: string, v: string) => void this.map.set(k, String(v));
  removeItem = (k: string) => void this.map.delete(k);
  clear = () => this.map.clear();
}

const MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

describe("vault (PBKDF2 + AES-GCM)", () => {
  it("round-trips: create then unlock with the same password returns the mnemonic", async () => {
    expect(vaultExists()).toBe(false);
    const meta = await createVault(MNEMONIC, "correct horse battery");
    expect(vaultExists()).toBe(true);
    expect(meta.createdAt).toBeTruthy();
    expect(getVaultMeta()?.createdAt).toBe(meta.createdAt);
    const unlocked = await unlockVault("correct horse battery");
    expect(unlocked).toBe(MNEMONIC);
  });

  it("rejects a wrong password (AES-GCM authentication fails)", async () => {
    await createVault(MNEMONIC, "right-password");
    await expect(unlockVault("wrong-password")).rejects.toThrow(/Incorrect wallet password/);
  });

  it("rejects a tampered vault blob", async () => {
    await createVault(MNEMONIC, "right-password");
    const raw = JSON.parse(localStorage.getItem("bmaglass.sc.vault.v1")!);
    // Flip a character inside the ciphertext.
    raw.data = (raw.data[0] === "A" ? "B" : "A") + raw.data.slice(1);
    localStorage.setItem("bmaglass.sc.vault.v1", JSON.stringify(raw));
    await expect(unlockVault("right-password")).rejects.toThrow(/Incorrect wallet password/);
  });

  it("stores no plaintext mnemonic anywhere in the stored blob", async () => {
    await createVault(MNEMONIC, "right-password");
    const blob = localStorage.getItem("bmaglass.sc.vault.v1")!;
    expect(blob).not.toContain("legal winner");
    expect(blob).not.toContain("sausage");
  });

  it("two vaults for the same mnemonic+password differ (random salt/IV)", async () => {
    await createVault(MNEMONIC, "right-password");
    const first = localStorage.getItem("bmaglass.sc.vault.v1");
    await createVault(MNEMONIC, "right-password");
    const second = localStorage.getItem("bmaglass.sc.vault.v1");
    expect(first).not.toBe(second);
  });

  it("enforces a minimum password length", async () => {
    await expect(createVault(MNEMONIC, "short")).rejects.toThrow(/at least 8 characters/);
    expect(vaultExists()).toBe(false);
  });

  it("deleteVault removes the vault; unlock then fails as 'no wallet'", async () => {
    await createVault(MNEMONIC, "right-password");
    deleteVault();
    expect(vaultExists()).toBe(false);
    await expect(unlockVault("right-password")).rejects.toThrow(/No self-custody wallet/);
  });
});
