// Unit tests for supabase/functions/_shared/kyc-submission.ts — the
// payload → kyc_verifications document-column mapping used by
// verifyKyc in the mobile-money edge function. The helper is
// dependency-free, so it is imported directly (repo pattern:
// tests/admin/accountFreeze.test.ts).

import { describe, it, expect } from "vitest";
import {
  buildKycDocumentInsertFields,
  buildKycDocumentUpdateFields,
  extractKycDocumentUrls,
} from "../../supabase/functions/_shared/kyc-submission";

const FRONT = "https://example.test/kyc/front.jpg";
const BACK = "https://example.test/kyc/back.jpg";
const ADDRESS = "https://example.test/kyc/address.pdf";
const OLD_FRONT = "https://example.test/kyc/old-front.jpg";
const OLD_BACK = "https://example.test/kyc/old-back.jpg";
const OLD_ADDRESS = "https://example.test/kyc/old-address.pdf";

const existing = {
  id_front_url: OLD_FRONT,
  id_back_url: OLD_BACK,
  address_doc_url: OLD_ADDRESS,
};

describe("extractKycDocumentUrls — camelCase (what the frontend sends)", () => {
  it("maps idFrontUrl/idBackUrl/addressDocUrl to the snake_case columns", () => {
    expect(
      extractKycDocumentUrls({
        idFrontUrl: FRONT,
        idBackUrl: BACK,
        addressDocUrl: ADDRESS,
      }),
    ).toEqual({
      id_front_url: FRONT,
      id_back_url: BACK,
      address_doc_url: ADDRESS,
    });
  });

  it("trims surrounding whitespace from URLs", () => {
    expect(extractKycDocumentUrls({ idFrontUrl: `  ${FRONT}  ` }).id_front_url).toBe(FRONT);
  });
});

describe("extractKycDocumentUrls — snake_case aliases", () => {
  it("accepts id_front_url/id_back_url/address_doc_url", () => {
    expect(
      extractKycDocumentUrls({
        id_front_url: FRONT,
        id_back_url: BACK,
        address_doc_url: ADDRESS,
      }),
    ).toEqual({
      id_front_url: FRONT,
      id_back_url: BACK,
      address_doc_url: ADDRESS,
    });
  });

  it("prefers camelCase when both spellings are present", () => {
    expect(
      extractKycDocumentUrls({ idFrontUrl: FRONT, id_front_url: OLD_FRONT }).id_front_url,
    ).toBe(FRONT);
  });

  it("falls back to the snake_case alias when camelCase is empty", () => {
    expect(
      extractKycDocumentUrls({ idFrontUrl: "", id_front_url: FRONT }).id_front_url,
    ).toBe(FRONT);
  });
});

describe("buildKycDocumentInsertFields — missing fields become null", () => {
  it("returns null for every column on an empty payload", () => {
    expect(buildKycDocumentInsertFields({})).toEqual({
      id_front_url: null,
      id_back_url: null,
      address_doc_url: null,
    });
  });

  it("returns null for explicit null / empty / non-string values", () => {
    expect(
      buildKycDocumentInsertFields({
        idFrontUrl: null,
        idBackUrl: "",
        addressDocUrl: 42,
      }),
    ).toEqual({
      id_front_url: null,
      id_back_url: null,
      address_doc_url: null,
    });
  });

  it("tolerates a null/undefined payload", () => {
    expect(buildKycDocumentInsertFields(null)).toEqual({
      id_front_url: null,
      id_back_url: null,
      address_doc_url: null,
    });
    expect(buildKycDocumentInsertFields(undefined)).toEqual({
      id_front_url: null,
      id_back_url: null,
      address_doc_url: null,
    });
  });

  it("keeps provided URLs and nulls only the missing ones", () => {
    expect(buildKycDocumentInsertFields({ idFrontUrl: FRONT })).toEqual({
      id_front_url: FRONT,
      id_back_url: null,
      address_doc_url: null,
    });
  });
});

describe("buildKycDocumentUpdateFields — fall back to existing", () => {
  it("preserves existing values when the payload omits them", () => {
    expect(buildKycDocumentUpdateFields({}, existing)).toEqual(existing);
  });

  it("preserves existing values when the payload sends explicit nulls", () => {
    expect(
      buildKycDocumentUpdateFields(
        { idFrontUrl: null, idBackUrl: null, addressDocUrl: null },
        existing,
      ),
    ).toEqual(existing);
  });

  it("overwrites when the payload provides new URLs", () => {
    expect(
      buildKycDocumentUpdateFields(
        { idFrontUrl: FRONT, idBackUrl: BACK, addressDocUrl: ADDRESS },
        existing,
      ),
    ).toEqual({
      id_front_url: FRONT,
      id_back_url: BACK,
      address_doc_url: ADDRESS,
    });
  });

  it("overwrites only the provided columns and preserves the rest", () => {
    expect(buildKycDocumentUpdateFields({ idBackUrl: BACK }, existing)).toEqual({
      id_front_url: OLD_FRONT,
      id_back_url: BACK,
      address_doc_url: OLD_ADDRESS,
    });
  });

  it("accepts snake_case aliases on update too", () => {
    expect(buildKycDocumentUpdateFields({ address_doc_url: ADDRESS }, existing)).toEqual({
      id_front_url: OLD_FRONT,
      id_back_url: OLD_BACK,
      address_doc_url: ADDRESS,
    });
  });

  it("returns nulls when there is no existing row and nothing is provided", () => {
    expect(buildKycDocumentUpdateFields({}, null)).toEqual({
      id_front_url: null,
      id_back_url: null,
      address_doc_url: null,
    });
  });
});
