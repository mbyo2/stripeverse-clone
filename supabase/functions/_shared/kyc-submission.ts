// kyc-submission: pure mapping from a KYC submission payload to the
// document-URL columns of public.kyc_verifications.
//
// Bug this fixes: the frontend (KycVerification.tsx) submits
// data.idFrontUrl / data.idBackUrl / data.addressDocUrl (camelCase),
// but verifyKyc in the mobile-money edge function only destructured
// the personal fields and selfieImage — the three document URLs were
// silently dropped, so id_front_url / id_back_url / address_doc_url
// stayed NULL and P2P tier T2 (which requires those documents) could
// never be reached.
//
// This module is dependency-free (no imports, no Deno APIs) so the
// vitest suite can load it directly:
// tests/payments/kycSubmission.test.ts.

export interface KycDocumentFields {
  id_front_url: string | null;
  id_back_url: string | null;
  address_doc_url: string | null;
}

export interface KycExistingDocumentRow {
  id_front_url?: string | null;
  id_back_url?: string | null;
  address_doc_url?: string | null;
}

type Payload = Record<string, unknown> | null | undefined;

function pickDocumentUrl(
  payload: Payload,
  camelKey: string,
  snakeKey: string,
): string | null {
  if (!payload) return null;
  for (const key of [camelKey, snakeKey]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Extract the document URLs from a submission payload.
 * Accepts camelCase (idFrontUrl / idBackUrl / addressDocUrl — what
 * the frontend sends) and snake_case aliases (id_front_url /
 * id_back_url / address_doc_url). Missing, null, empty, whitespace-
 * only or non-string values map to null.
 */
export function extractKycDocumentUrls(payload: Payload): KycDocumentFields {
  return {
    id_front_url: pickDocumentUrl(payload, "idFrontUrl", "id_front_url"),
    id_back_url: pickDocumentUrl(payload, "idBackUrl", "id_back_url"),
    address_doc_url: pickDocumentUrl(payload, "addressDocUrl", "address_doc_url"),
  };
}

/** Document fields for an INSERT row: missing fields become null. */
export function buildKycDocumentInsertFields(payload: Payload): KycDocumentFields {
  return extractKycDocumentUrls(payload);
}

/**
 * Document fields for an UPDATE row: a provided URL overwrites the
 * stored one; an omitted URL preserves the existing value — the same
 * fall-back-to-existing semantics verifyKyc already uses for
 * address / selfie_url.
 */
export function buildKycDocumentUpdateFields(
  payload: Payload,
  existing: KycExistingDocumentRow | null | undefined,
): KycDocumentFields {
  const incoming = extractKycDocumentUrls(payload);
  return {
    id_front_url: incoming.id_front_url || existing?.id_front_url || null,
    id_back_url: incoming.id_back_url || existing?.id_back_url || null,
    address_doc_url: incoming.address_doc_url || existing?.address_doc_url || null,
  };
}
