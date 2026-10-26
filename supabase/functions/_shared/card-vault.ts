// Card-details vault — envelope encryption for platform-generated
// virtual card secrets (PAN + CVV).
//
// Design (2026-10-26, Workstream B):
//   * AES-256-GCM via WebCrypto (the same primitive set the
//     Mastercard XBS module uses, so vitest runs the exact code Deno
//     runs).
//   * The data key lives ONLY in the CARD_VAULT_KEY edge-function
//     secret (base64, 32 bytes). It is never stored in the database,
//     never in a repo file, and never returned to a client.
//   * Each card gets a fresh random 96-bit IV; the PAN+CVV pair is
//     encrypted as one JSON envelope, so one ciphertext + one IV per
//     card (virtual_cards.details_ciphertext / details_iv,
//     vault_key_version = 1).
//   * Decryption happens only inside the service-role
//     manage-virtual-card function, after ownership + admin gate +
//     password re-auth have all passed, and every reveal is audited.
//   * Legacy platform cards (created before the vault) have no
//     ciphertext: their PAN/CVV were shown once at creation and are
//     unrecoverable by construction — callers must say so honestly
//     rather than inventing a number.

export const CARD_VAULT_KEY_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importVaultKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyBase64.trim());
  if (raw.length !== 32) {
    throw new Error("CARD_VAULT_KEY must be 32 bytes (base64).");
  }
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** The configured vault key from the environment, or null when unset. */
export function cardVaultKeyFromEnv(): string | null {
  const value = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
    ?.env.get("CARD_VAULT_KEY");
  return value && value.trim() ? value.trim() : null;
}

export interface VaultedCardDetails {
  pan: string;
  cvv: string | null;
}

export interface VaultEnvelope {
  ciphertext: string; // base64
  iv: string; // base64
  keyVersion: number;
}

/** Encrypt a card's PAN (+ CVV when one exists) into a vault envelope. */
export async function encryptCardDetails(
  details: VaultedCardDetails,
  keyBase64: string,
): Promise<VaultEnvelope> {
  const key = await importVaultKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(
    JSON.stringify({ pan: details.pan, cvv: details.cvv ?? null }),
  );
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
    keyVersion: CARD_VAULT_KEY_VERSION,
  };
}

/** Decrypt a vault envelope. Throws on tampering or a wrong key. */
export async function decryptCardDetails(
  envelope: VaultEnvelope,
  keyBase64: string,
): Promise<VaultedCardDetails> {
  const key = await importVaultKey(keyBase64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plain)) as VaultedCardDetails;
  if (!parsed || typeof parsed.pan !== "string") {
    throw new Error("Vault envelope did not contain card details.");
  }
  return { pan: parsed.pan, cvv: parsed.cvv ?? null };
}
