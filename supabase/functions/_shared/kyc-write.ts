// kyc-write: write-confirmation guard for verifyKyc in the
// mobile-money edge function.
//
// Bug this fixes: verifyKyc issued its kyc_verifications writes with
// the caller's client and checked only the PostgREST `error`. A
// 0-row UPDATE returns no error — before the own-row UPDATE policy
// (migration 20261210) existed, every KYC re-submission by a plain
// user matched 0 rows, wrote nothing, and the handler still reported
// success. The write now requests the written row back
// (.select("id")) on both the insert and update paths, and the
// returned rows go through assertKycWriteLanded: an empty result is
// a hard failure carrying a crafted plain-language message, never a
// success. Silent success on a lost write is impossible.
//
// This module is dependency-free (no imports, no Deno APIs) so the
// vitest suite can load it directly: tests/payments/kycWrite.test.ts.

export const KYC_WRITE_LOST_MESSAGE =
  "We couldn't save your verification details just now, so nothing was changed. Please try again — if it keeps happening, please contact support.";

export class KycWriteLostError extends Error {
  constructor() {
    super(KYC_WRITE_LOST_MESSAGE);
    this.name = "KycWriteLostError";
  }
}

export function isKycWriteLostError(error: unknown): boolean {
  return error instanceof KycWriteLostError;
}

/**
 * Assert a PostgREST write that requested its rows back
 * (.select(...)) actually wrote one. Returns the written row.
 * Throws KycWriteLostError when the write landed on 0 rows.
 */
export function assertKycWriteLanded<T>(
  rows: readonly T[] | null | undefined,
): T {
  if (!rows || rows.length === 0) {
    throw new KycWriteLostError();
  }
  return rows[0];
}
