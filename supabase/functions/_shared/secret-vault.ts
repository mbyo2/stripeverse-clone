// Secret vault — envelope encryption for merchant-supplied API
// credentials (the mobile-money rail keys a merchant pastes to
// connect their own gateway account).
//
// Design mirrors the platform's card vault (_shared/card-vault.ts):
//   * AES-256-GCM via WebCrypto — the same primitive set, so vitest
//     runs the exact code Deno runs.
//   * The data key lives ONLY in the MOMO_VAULT_KEY edge-function
//     secret (base64, 32 bytes). It is never stored in the database,
//     never in a repo file, and never returned to a client.
//   * Each credential gets a fresh random 96-bit IV; one ciphertext +
//     one IV per credential, vault_key_version = 1.
//   * Decryption happens only inside service-role edge functions,
//     at the moment the credential is used against the gateway.
//   * The merchant can never read their saved secret back — the UI
//     is write-only after save and shows a last-4 hint only.

export const SECRET_VAULT_KEY_VERSION = 1;

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
    throw new Error("MOMO_VAULT_KEY must be 32 bytes (base64).");
  }
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** The configured vault key from the environment, or null when unset. */
// deno-lint-ignore no-explicit-any
export function secretVaultKeyFromEnv(envGet?: (k: string) => string | undefined): string | null {
  const get = envGet ?? ((globalThis as any)?.Deno?.env?.get as ((k: string) => string | undefined) | undefined);
  const value = get?.("MOMO_VAULT_KEY");
  return value && value.trim() ? value.trim() : null;
}

export interface SecretEnvelope {
  ciphertext: string; // base64
  iv: string; // base64
  keyVersion: number;
}

export async function encryptSecret(plaintext: string, keyBase64: string): Promise<SecretEnvelope> {
  const key = await importVaultKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
    keyVersion: SECRET_VAULT_KEY_VERSION,
  };
}

export async function decryptSecret(envelope: SecretEnvelope, keyBase64: string): Promise<string> {
  const key = await importVaultKey(keyBase64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  return decoder.decode(plain);
}

/** Last-4 hint for display. Never enough to reconstruct anything. */
export function secretHint(secret: string): string {
  const s = secret.trim();
  return s.length >= 4 ? s.slice(-4) : "••••";
}
