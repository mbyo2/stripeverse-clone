import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVault,
  unlockVault,
  vaultExists,
  vaultBlobPresent,
  getVaultState,
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
    // Second write is an explicit, confirmed replacement (createVault
    // refuses silent overwrites — see the tri-state suite below).
    await createVault(MNEMONIC, "right-password", { replaceExisting: true });
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

// ── Regression fixture: the exact v1 format written on 2026-10-20 ──────
//
// This blob was produced with the production algorithm (v:1,
// PBKDF2-SHA256, 600_000 iterations, 16-byte salt, 12-byte IV,
// AES-256-GCM) encrypting the suite's test mnemonic under
// V1_FIXTURE_PASSWORD, with a creation timestamp of 2026-10-20. It pins
// the on-disk format: any future change that stops reading it would
// strand every existing self-custody wallet, so it must keep parsing
// and unlocking forever.
const V1_FIXTURE_BLOB =
  '{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"EBxQNvX/MUbcTCFWxpbsog==","iv":"EgIKOvgjCc48gZaw","data":"OOFdr55i5O1+ZWuG8j6dRKeYRfIdK9ApoR31Mb1ong2ZdJXWGzjjU9R+3JfFm02fI1v/PXqSNKWdHsPi8H+j1ORVQMkr/u7u3/E+jLnLMAnbQIoT8AFDsxcjnPe2dPoPL5LKLfIfal19KVd4/Af46dxp6kd5pDWsU8cPxd7m+8JEnkm9/g7yc7NratTHuQ4h4UEnPF0cy9EFWtIqDAAmCtaUiIcnbkDfyn+qtknIHE32/UE=","createdAt":"2026-10-20T09:15:00.000Z"}';
const V1_FIXTURE_PASSWORD = "fixture-password-2020";

describe("vault v1 regression fixture (2026-10-20 format)", () => {
  it("parses, reports its metadata, and unlocks with its password", async () => {
    localStorage.setItem("bmaglass.sc.vault.v1", V1_FIXTURE_BLOB);
    expect(getVaultState()).toBe("readable");
    expect(vaultExists()).toBe(true);
    expect(getVaultMeta()?.createdAt).toBe("2026-10-20T09:15:00.000Z");
    expect(await unlockVault(V1_FIXTURE_PASSWORD)).toBe(MNEMONIC);
  });

  it("still rejects a wrong password on the fixture", async () => {
    localStorage.setItem("bmaglass.sc.vault.v1", V1_FIXTURE_BLOB);
    await expect(unlockVault("not-the-password")).rejects.toThrow(/Incorrect wallet password/);
  });
});

describe("vault tri-state detection + overwrite refusal", () => {
  it("absent: no blob under the vault key", () => {
    expect(getVaultState()).toBe("absent");
    expect(vaultBlobPresent()).toBe(false);
    expect(vaultExists()).toBe(false);
  });

  it("readable: a well-formed v1 vault", async () => {
    await createVault(MNEMONIC, "right-password");
    expect(getVaultState()).toBe("readable");
    expect(vaultBlobPresent()).toBe(true);
  });

  it("unreadable: any present blob that fails to parse or validate", () => {
    const cases: Array<[string, string]> = [
      ["not JSON at all", "this is not json{{{"],
      ["wrong version", JSON.stringify({ v: 2, kdf: "PBKDF2-SHA256" })],
      ["wrong kdf", JSON.stringify({ v: 1, kdf: "argon2" })],
      [
        "missing ciphertext field",
        JSON.stringify({
          v: 1,
          kdf: "PBKDF2-SHA256",
          iterations: 600000,
          salt: "EBxQNvX/MUbcTCFWxpbsog==",
          iv: "EgIKOvgjCc48gZaw",
          createdAt: "2026-10-20T09:15:00.000Z",
        }),
      ],
      [
        "corrupt base64 in salt",
        JSON.stringify({
          v: 1,
          kdf: "PBKDF2-SHA256",
          iterations: 600000,
          salt: "!!!not-base64!!!",
          iv: "EgIKOvgjCc48gZaw",
          data: "AAAA",
          createdAt: "2026-10-20T09:15:00.000Z",
        }),
      ],
    ];
    for (const [label, blob] of cases) {
      localStorage.setItem("bmaglass.sc.vault.v1", blob);
      expect(getVaultState(), label).toBe("unreadable");
      expect(vaultBlobPresent(), label).toBe(true);
      // Crucially NOT "exists": the unlock screen must not be offered,
      // and NOT "absent": the create screen must not be offered either.
      expect(vaultExists(), label).toBe(false);
    }
  });

  it("createVault refuses to overwrite a READABLE vault without the explicit flag", async () => {
    await createVault(MNEMONIC, "right-password");
    const before = localStorage.getItem("bmaglass.sc.vault.v1");
    await expect(createVault(MNEMONIC, "other-password")).rejects.toThrow(/already exists/);
    expect(localStorage.getItem("bmaglass.sc.vault.v1")).toBe(before);
  });

  it("createVault refuses to overwrite an UNREADABLE blob without the explicit flag", async () => {
    const broken = "corrupted{{{blob";
    localStorage.setItem("bmaglass.sc.vault.v1", broken);
    await expect(createVault(MNEMONIC, "right-password")).rejects.toThrow(/already exists/);
    // The possibly-recoverable blob is untouched.
    expect(localStorage.getItem("bmaglass.sc.vault.v1")).toBe(broken);
    expect(getVaultState()).toBe("unreadable");
  });

  it("an explicit replaceExisting:true over an unreadable blob succeeds and unlocks", async () => {
    localStorage.setItem("bmaglass.sc.vault.v1", "corrupted{{{blob");
    await createVault(MNEMONIC, "brand-new-password", { replaceExisting: true });
    expect(getVaultState()).toBe("readable");
    expect(await unlockVault("brand-new-password")).toBe(MNEMONIC);
  });
});

describe("storage persistence request", () => {
  it("navigator.storage.persist() is requested after create and after unlock", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const nav = globalThis as any;
    const hadNavigator = "navigator" in nav;
    const originalNavigator = nav.navigator;
    Object.defineProperty(nav, "navigator", {
      value: { ...(originalNavigator ?? {}), storage: { persist } },
      configurable: true,
      writable: true,
    });
    try {
      await createVault(MNEMONIC, "right-password");
      expect(persist).toHaveBeenCalled();
      persist.mockClear();
      await unlockVault("right-password");
      expect(persist).toHaveBeenCalled();
    } finally {
      if (hadNavigator) {
        Object.defineProperty(nav, "navigator", {
          value: originalNavigator,
          configurable: true,
          writable: true,
        });
      } else {
        delete nav.navigator;
      }
    }
  });

  it("vault operations never throw when storage persistence is unavailable", async () => {
    // No navigator.storage stub here (plain test environment): create
    // and unlock must simply work — persistence is best-effort armour.
    await createVault(MNEMONIC, "right-password");
    expect(await unlockVault("right-password")).toBe(MNEMONIC);
  });
});

describe("structural pins (vault safety)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, "../../src");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it("deleteVault retains exactly ONE caller in the whole app (the Danger-Zone doDelete)", () => {
    const callSites: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = fs.readFileSync(file, "utf8");
      // Call sites only — not the export definition in vault.ts and not
      // import statements (those never have "()" after the name).
      const matches = text.match(/(?<!function )deleteVault\(\)/g) ?? [];
      for (let i = 0; i < matches.length; i++) {
        callSites.push(path.relative(srcRoot, file));
      }
    }
    expect(callSites).toEqual(["pages/SelfCustodyWallet.tsx"]);
  });

  it("the recovery stage is wired: unreadable vaults never reach the create screen", () => {
    const page = fs.readFileSync(path.join(srcRoot, "pages/SelfCustodyWallet.tsx"), "utf8");
    expect(page).toContain("getVaultState()");
    expect(page).toContain('"recovery"');
    expect(page).toContain("couldn't be read");
    expect(page).toContain("recovery-import");
  });
});
