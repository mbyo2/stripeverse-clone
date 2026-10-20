/**
 * Encrypted on-device vault for the SELF-CUSTODY wallet.
 *
 * Design rules (security-critical — do not weaken):
 *  - The mnemonic exists in exactly two places: this device's encrypted
 *    vault blob, and the in-memory session while unlocked (session.ts).
 *  - It is NEVER sent to Supabase, any API, analytics, or logs. This module
 *    imports nothing network-related and performs no I/O besides
 *    localStorage on this device.
 *  - Encryption: PBKDF2-HMAC-SHA256 (600,000 iterations) over a user-set
 *    wallet password → AES-256-GCM. Random 16-byte salt + 12-byte IV per
 *    vault. AES-GCM's auth tag makes wrong passwords and tampering fail
 *    decryption — there is no separate password hash to leak or bypass.
 *  - The password is never stored anywhere. If it is lost, the vault is
 *    undecryptable; recovery is ONLY via the user's written seed phrase
 *    (import flow), which is the correct self-custody property.
 *
 * Storage: localStorage (small blob, synchronous). The blob reveals nothing
 * but the fact a vault exists and its creation date.
 */

const VAULT_STORAGE_KEY = "bmaglass.sc.vault.v1";
const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSWORD_LENGTH = 8;

export interface VaultMeta {
  createdAt: string;
}

interface VaultRecord {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext (AES-GCM, includes auth tag)
  createdAt: string; // plaintext metadata only — never key material
}

interface VaultPlaintext {
  mnemonic: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function readRecord(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultRecord;
    if (parsed.v !== 1 || parsed.kdf !== "PBKDF2-SHA256") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function vaultExists(): boolean {
  return readRecord() !== null;
}

export function getVaultMeta(): VaultMeta | null {
  const record = readRecord();
  return record ? { createdAt: record.createdAt } : null;
}

/** Encrypt and store the mnemonic under a new wallet password. Overwrites any existing vault. */
export async function createVault(mnemonic: string, password: string): Promise<VaultMeta> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Wallet password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext: VaultPlaintext = { mnemonic: mnemonic.trim().toLowerCase() };
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  const record: VaultRecord = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  return { createdAt: record.createdAt };
}

/**
 * Decrypt the vault with the wallet password and return the mnemonic.
 * Throws on a wrong password or a tampered vault (AES-GCM auth failure) —
 * callers must surface that as "incorrect password", never retry silently.
 */
export async function unlockVault(password: string): Promise<string> {
  const record = readRecord();
  if (!record) throw new Error("No self-custody wallet exists on this device");
  const key = await deriveKey(password, base64ToBytes(record.salt), record.iterations);
  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv) as BufferSource },
      key,
      base64ToBytes(record.data) as BufferSource,
    );
  } catch {
    throw new Error("Incorrect wallet password (or the vault on this device is corrupted)");
  }
  const parsed = JSON.parse(new TextDecoder().decode(plainBuffer)) as VaultPlaintext;
  if (!parsed.mnemonic) throw new Error("Vault contents are invalid");
  return parsed.mnemonic;
}

/** Permanently remove the vault from this device. Funds are recoverable ONLY via the seed phrase. */
export function deleteVault(): void {
  localStorage.removeItem(VAULT_STORAGE_KEY);
}

export { MIN_PASSWORD_LENGTH };
