// Unit tests for supabase/functions/_shared/mastercard-oauth.ts —
// the OAuth 1.0a signer every Mastercard Move call depends on.
//
// The centrepiece is a KNOWN TEST VECTOR: a throwaway RSA key pair
// generated for this suite only (never used anywhere else), fixed
// nonce/timestamp/body/URL, and the signature an independent
// implementation (Node's OpenSSL-backed signer) produced for those
// exact inputs. RSASSA-PKCS1-v1_5 is deterministic, so the module
// must reproduce that signature byte-for-byte — if the base-string
// construction, percent-encoding, body hash or signing algorithm
// drifts, this suite fails.

import { describe, it, expect } from "vitest";
import {
  buildParameterString,
  buildSignatureBaseString,
  computeBodyHash,
  percentEncode,
  signMastercardRequest,
} from "../../supabase/functions/_shared/mastercard-oauth";

const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDQ9gmhKRtUmkke
BIVmpkodBe44QFI7pZ+G4EwJDXO2kTpvmfxYqSxQDEmcBx+WTpT0DKMDPh8HsZHu
WLIPD9rDTypDfOjee6/6qdC5+OVrX/2fiUZG5wEzt0sHqj4Eki7nK2ZENeb4Ll1d
pDmU+1X1ZZ1SSTC6VOs9s3PZoQVXkNcTyIeHTgJy+NZubjlesi91G6Nfsbc8K7lo
D4srTeLnSzUs0ynzm6BuFqZC8eYP3OWeqvw9ymD/mTVY+1mP4/D2TonVZNVlM+BR
6CU365nYnIDCfV8w9wD09gr05q5PpLXRZ7MIUqgB9oi4TcvCPF2GJOFmoDZ0remi
iAgGtKJHAgMBAAECggEAIrHvWGBsZsg1QrQqeCg9HwOIkbNwU/IEgk8EoO4oW9RS
OQx+vzPbpTDdGfh+0KSci8b7XAL5APyFR+dXLTQLNSmUUV9QhPxRdFO00eQXJ5Rp
Fo+i6QvbAby5yvyDzpt9CSoGEWZHwsZj/zPQ0cFHfPbRv8NiQVXvNy/wGN7o9ahM
lOtWO5tXMejF7RomIGOKyyrY9vgfFkD/LPxbR3zYLC60k91GzHEC8NMUSst8iKdZ
oTbA1yULpULrcT//O0eKxbcF3vystVFAm2D/AFpwWuvdkqgXPbMxGmd1chpOqnsH
vFsi3kDM3O7MWj4rPeR9hmfs8sfu3ktMMIh6sQj1UQKBgQDrHppO1JCFbQhSsuu0
fzdPWBp1xRZyZdZTof09dNdT8U74Ge57KpI5JDdc4LVw0wL+gyqqfk8KUOUzSVAF
+iab+Leo46ZT4G9wOk/E2HZpMX6FUFraD1BRBPSoL1T7Avt8IWVKcWJOrfMKExia
Nz2Lc353oCFR5eqF+aC1FLF+FwKBgQDjhLo12lU/ozZzMk2vhmfruvS6zPBQjmN6
yHJm16TUpQ7jgg7QdTerosz4AnplBl4H4786HkuAyXx1PcguiVW4tkNJxtTT4kjn
WuCs2SX19VMdvxjLXKsIT7JXaDwhH+Xb5DGGtKkDzhlR/eCeCE1UUO/OdmdT7Nos
ve6Znh1LUQKBgQDJduOKAKIFcjPbiOxnMUrXdgrWNxbQ12obJ4azDlcj2nVsKewr
JYM960Z1EyblkinSo9n/VVOs5zw+AefL91j19NyKnuZ6oKlcZNrNNR3hbUOYQA5Z
Ix4TDkgFhOkwXJHY/1SnwRgXiv3h+BLwsbzOrRwErPVgE74tJoUKJL0h6QKBgCsp
le37gqq0+vJ1u5kuBW8KI72AfaK6sJKtjk6GYIXa3m040jin1CzikMIILlIWGCal
BTUwZCCFmO/hDaYOdc25/h/z8ZJU3oHNkswX0gTMSr1c8IY8CVJlVC8S3j1mgMPr
kZ29jkbjhZgxcrhoWMtDI4tmmQmp6GYOjkJkZahRAoGBAJ4w70ih9E7/hk9MjWP0
q3xQMb7ZR36glGYX+FOs9oJC1RPP0x+nANa2jlkMxMRPbmYy5kVkK8c5+HZc1oGs
zbXZCSKO/sVVVnYxp6QHc0kvML09p9q0ZYu6IYtw77ZsfVy9gZ3VrLZtHrk5TJGI
GtvBrsPof9HHEyxccd6TtsNN
-----END PRIVATE KEY-----`;

const VECTOR = {
  method: "POST",
  url: "https://sandbox.api.mastercard.com/send/v1/partners/test-partner/crossborder/quotes",
  body: JSON.stringify({ amount: "25.00", currency: "ZMW" }),
  consumerKey: "test-consumer-key-123",
  nonce: "abc123nonce",
  timestamp: "1700000000",
  bodyHash: "TKJwT/190HqrzvGIQ6Z2InfuAmhVgHoaEh/Ngx6VliU=",
  signature: "S+97lgcsrbbOuDnM1oZsMi0Ag0GNnP982dcaK7FPfMBW4K01bFbKL+0xHFAlLUyoyvT6gtwvVSusqMvmdxRaX0Mo/c5jPGOWK4Vweu6/AsF/NfS9KJkBU7DhKqcff2wYvTjq5NBUf7QtfpAb9dsxcBCClHwo/3LSXOdbWTjhQ7wuXtV9Gvy1JVPaKtqHixM9VQe7Lg0thqMWS90tGgOeuKFbFajvjplpamo9tW60J6st4F0RA5PQ9VGwxY2PfK4iQS6dgDqvK0M1rq0KfDW/FIHvVlFpkEoBnsAByFn5J8YWCdm8u8GWdSA+lzqZhCCkKOro6oqiWmzixBYDlksoJg==",
};

describe("percentEncode (RFC 3986)", () => {
  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });
  it("encodes spaces and slashes", () => {
    expect(percentEncode("a b/c")).toBe("a%20b%2Fc");
  });
});

describe("computeBodyHash", () => {
  it("matches the SHA-256 of the empty body", async () => {
    expect(await computeBodyHash("")).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });
  it("matches the vector body hash", async () => {
    expect(await computeBodyHash(VECTOR.body)).toBe(VECTOR.bodyHash);
  });
});

describe("signature base string", () => {
  it("sorts parameters and percent-encodes keys and values", () => {
    const ps = buildParameterString({
      oauth_timestamp: "1700000000",
      oauth_consumer_key: "test-consumer-key-123",
      oauth_body_hash: VECTOR.bodyHash,
    });
    expect(ps.indexOf("oauth_body_hash=")).toBe(0);
    expect(ps).toContain("oauth_body_hash=TKJwT%2F190HqrzvGIQ6Z2InfuAmhVgHoaEh%2FNgx6VliU%3D");
  });

  it("builds the exact vector base string", () => {
    const base = buildSignatureBaseString(VECTOR.method, VECTOR.url, {
      oauth_body_hash: VECTOR.bodyHash,
      oauth_consumer_key: VECTOR.consumerKey,
      oauth_nonce: VECTOR.nonce,
      oauth_signature_method: "RSA-SHA256",
      oauth_timestamp: VECTOR.timestamp,
      oauth_version: "1.0",
    });
    expect(base.startsWith("POST&https%3A%2F%2Fsandbox.api.mastercard.com")).toBe(true);
    expect(base).toContain("oauth_nonce%3Dabc123nonce");
  });

  it("includes URL query parameters in the signed set", () => {
    const base = buildSignatureBaseString("GET", "https://sandbox.api.mastercard.com/x?include_balance=true", {
      oauth_consumer_key: "k",
    });
    expect(base).toContain("include_balance");
  });
});

describe("signMastercardRequest — known test vector", () => {
  it("reproduces the vector signature in the Authorization header", async () => {
    const header = await signMastercardRequest(
      VECTOR.method,
      VECTOR.url,
      {
        consumerKey: VECTOR.consumerKey,
        body: VECTOR.body,
        nonce: VECTOR.nonce,
        timestamp: VECTOR.timestamp,
      },
      TEST_PRIVATE_KEY_PEM,
    );
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain(`oauth_consumer_key="${VECTOR.consumerKey}"`);
    expect(header).toContain(`oauth_nonce="${VECTOR.nonce}"`);
    expect(header).toContain(`oauth_timestamp="${VECTOR.timestamp}"`);
    expect(header).toContain('oauth_signature_method="RSA-SHA256"');
    expect(header).toContain(`oauth_body_hash="${percentEncode(VECTOR.bodyHash)}"`);
    expect(header).toContain(`oauth_signature="${percentEncode(VECTOR.signature)}"`);
  });

  it("changes the signature when the body changes (body hash is bound in)", async () => {
    const a = await signMastercardRequest("POST", VECTOR.url, {
      consumerKey: VECTOR.consumerKey, body: VECTOR.body, nonce: VECTOR.nonce, timestamp: VECTOR.timestamp,
    }, TEST_PRIVATE_KEY_PEM);
    const b = await signMastercardRequest("POST", VECTOR.url, {
      consumerKey: VECTOR.consumerKey, body: "{\"amount\":\"26.00\"}", nonce: VECTOR.nonce, timestamp: VECTOR.timestamp,
    }, TEST_PRIVATE_KEY_PEM);
    expect(a).not.toBe(b);
  });

  it("fails loudly on a missing or malformed signing key", async () => {
    await expect(signMastercardRequest("GET", VECTOR.url, {
      consumerKey: "k", body: "", nonce: "n", timestamp: "1",
    }, "")).rejects.toThrow("not configured");
  });
});
