// Mastercard Cross-Border Services payload encryption (JWE).
//
// Brief §1.2A: XBS requires the request payload to be encrypted in
// addition to OAuth 1.0a signing, using the project's encryption
// keystore. The documented shape is JWE compact serialisation with
// RSA-OAEP key wrapping and AES-GCM content encryption.
//
// Sandbox reality (checked against the brief, 2026-10-23): the XBS
// sandbox serves stubs with static responses and does not require a
// live encrypted round-trip to answer; MTF/production enforce
// encryption with the program's issued keys. So the edge function
// ships this module BUILT and UNIT-TESTED, and only encrypts when
// MASTERCARD_XBS_ENCRYPTION is explicitly enabled in the function
// environment — flipping that flag (plus the production key swap) is
// the MTF step, not a code change.
//
// Algorithms: alg=RSA-OAEP-256, enc=A256GCM — JWE compact form
//   base64url(header) . base64url(wrappedKey) . base64url(iv) .
//   base64url(ciphertext) . base64url(tag)
// WebCrypto's AES-GCM encrypt appends the 16-byte tag to the
// ciphertext; JWE carries it separately, so encrypt splits it off
// and decrypt re-attaches it. Only WebCrypto is used, so the vitest
// suite runs the exact code Deno runs.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encrypt a JSON payload to a JWE compact string with a public PEM. */
export async function encryptXbsPayload(
  payload: unknown,
  publicKeyPem: string,
): Promise<string> {
  if (typeof publicKeyPem !== "string" || !publicKeyPem.includes("PUBLIC KEY")) {
    throw new Error("Mastercard encryption key is not configured.");
  }
  const publicKey = await globalThis.crypto.subtle.importKey(
    "spki",
    pemToDer(publicKeyPem).buffer as ArrayBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );

  const header = { alg: "RSA-OAEP-256", enc: "A256GCM", typ: "JWE" };
  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );

  const cek = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const wrappedKey = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      await globalThis.crypto.subtle.exportKey("raw", cek),
    ),
  );

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherWithTag = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(encodedHeader),
        tagLength: 128,
      },
      cek,
      plaintext,
    ),
  );
  const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - 16);
  const tag = cipherWithTag.slice(cipherWithTag.length - 16);

  return [
    encodedHeader,
    base64UrlEncode(wrappedKey),
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(tag),
  ].join(".");
}

/** Decrypt a JWE compact string with the matching private PEM. */
export async function decryptXbsPayload(
  jwe: string,
  privateKeyPem: string,
): Promise<unknown> {
  const parts = jwe.split(".");
  if (parts.length !== 5) throw new Error("Invalid encrypted payload.");
  const [encodedHeader, wrappedB64, ivB64, cipherB64, tagB64] = parts;

  const privateKey = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem).buffer as ArrayBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const cekRaw = await globalThis.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64UrlDecode(wrappedB64),
  );
  const cek = await globalThis.crypto.subtle.importKey(
    "raw",
    cekRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const cipher = base64UrlDecode(cipherB64);
  const tag = base64UrlDecode(tagB64);
  const combined = new Uint8Array(cipher.length + tag.length);
  combined.set(cipher, 0);
  combined.set(tag, cipher.length);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(ivB64),
      additionalData: new TextEncoder().encode(encodedHeader),
      tagLength: 128,
    },
    cek,
    combined,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
