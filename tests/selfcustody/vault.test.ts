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

  it("enforces a minimum password length of 12 characters", async () => {
    await expect(createVault(MNEMONIC, "short")).rejects.toThrow(/at least 12 characters/);
    expect(vaultExists()).toBe(false);
    // 11 characters is still too short; exactly 12 is accepted.
    await expect(createVault(MNEMONIC, "12345678901")).rejects.toThrow(/at least 12 characters/);
    expect(vaultExists()).toBe(false);
    await createVault(MNEMONIC, "123456789012");
    expect(vaultExists()).toBe(true);
    expect(await unlockVault("123456789012")).toBe(MNEMONIC);
  });

  it("unlock does not re-check the minimum (a legacy vault with a shorter password still opens)", async () => {
    // Build a vault blob by hand with an 8-character password — the
    // shape createVault produced before the minimum was raised to 12 —
    // and prove unlockVault still decrypts it: the length rule gates
    // creation only, so nobody is locked out of an existing vault.
    const password = "oldpass8";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify({ mnemonic: MNEMONIC })),
    );
    const b64 = (bytes: Uint8Array) => {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    localStorage.setItem(
      "bmaglass.sc.vault.v1",
      JSON.stringify({
        v: 1,
        kdf: "PBKDF2-SHA256",
        iterations: 600_000,
        salt: b64(salt),
        iv: b64(iv),
        data: b64(new Uint8Array(cipher)),
        createdAt: new Date().toISOString(),
      }),
    );
    expect(vaultExists()).toBe(true);
    expect(await unlockVault(password)).toBe(MNEMONIC);
  });

  it("deleteVault removes the vault; unlock then fails as 'no wallet'", async () => {
    await createVault(MNEMONIC, "right-password");
    deleteVault();
    expect(vaultExists()).toBe(false);
    await expect(unlockVault("right-password")).rejects.toThrow(/No self-custody wallet/);
  });
});
