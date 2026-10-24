// Regression tests for the /kyc wizard flow (KycVerification.tsx +
// DocumentUploader.tsx), pinning the fixes for the live defect where
// the wizard threw users back to Personal Info and lost their data:
//
//  1. DocumentUploader's buttons live inside the wizard's <form> —
//     without type="button" they SUBMITTED the whole KYC form
//     mid-upload (verified: the shared Button sets no default type).
//  2. The storage policy for kyc-documents requires the first path
//     segment to be the owner's auth uid; the uploader used
//     `kyc/<id-number>/…`, so every upload was RLS-rejected and no
//     document ever landed (bucket object count was 0 in production).
//  3. Radix TabsContent unmounts inactive tabs, destroying the
//     uploader's selected-file/preview state on every step switch —
//     the panels are forceMount-ed now, and an in-progress draft is
//     kept in sessionStorage so no transition can lose entered data.
//  4. Mount hydration resolves asynchronously and used to overwrite
//     fields the user had already typed; it is dirty-field-guarded.
//  5. ID document types are restricted to NRC + Passport (CEO ruling).
//
// These are source-wiring tests in the same style as the other UI
// suites (tests/admin/superadminUi.test.ts): the browser behaviour
// itself is proven by the live end-to-end QA pass.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) =>
  fs.readFileSync(path.join(here, rel), "utf8");

const uploader = readSrc("../../src/components/wallet/DocumentUploader.tsx");
const wizard = readSrc("../../src/components/wallet/KycVerification.tsx");

describe("DocumentUploader — buttons inside the wizard form", () => {
  it("upload and remove buttons cannot submit the parent form", () => {
    const typeButtons = uploader.match(/type="button"/g) ?? [];
    expect(typeButtons.length).toBe(2);
    expect(uploader).toContain("onClick={uploadDocument}");
    expect(uploader).toContain("onClick={removeFile}");
  });
});

describe("DocumentUploader — storage path matches the bucket policy", () => {
  it("builds the object path with the owner id as the first segment", () => {
    expect(uploader).toContain(
      "const filePath = `${userId}/${documentType}_${Date.now()}.${fileExt}`",
    );
  });

  it("no longer prefixes paths with kyc/ (policy rejects that segment)", () => {
    expect(uploader).not.toContain("`kyc/${fileName}`");
    expect(uploader).not.toContain("kyc/${userId}");
  });
});

describe("KycVerification — step transitions cannot lose data", () => {
  it("keeps every tab panel mounted across step switches", () => {
    const mounts = wizard.match(/forceMount/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(3);
    expect(wizard).toContain('<TabsContent value="personal" forceMount>');
    expect(wizard).toContain('<TabsContent value="documents" forceMount>');
    expect(wizard).toContain('<TabsContent value="address" forceMount>');
  });

  it("persists an in-progress draft per user and clears it on submit", () => {
    expect(wizard).toContain("kyc-draft:");
    expect(wizard).toContain("sessionStorage.setItem(draftKey");
    expect(wizard).toContain("sessionStorage.removeItem(draftKey)");
  });

  it("hydration can never overwrite a field the user already edited", () => {
    expect(wizard).toContain("dirtyFieldsRef");
    expect(wizard).toContain("dirtyFieldsRef.current.has(key)");
  });

  it("hands the uploaders the auth user id, never the ID number", () => {
    expect(wizard).not.toContain("userId={formData.idNumber}");
    const handovers = wizard.match(/userId=\{authUserId/g) ?? [];
    expect(handovers.length).toBe(3);
  });

  it("uploads the selfie under the owner's id segment too", () => {
    expect(wizard).not.toContain("`kyc/${userData.user.id}/selfie_");
    expect(wizard).toContain("`${userData.user.id}/selfie_${Date.now()}.jpg`");
  });
});

describe("KycVerification — document types are NRC + Passport only", () => {
  it("offers exactly the two permitted ID types", () => {
    expect(wizard).toContain(
      '<SelectItem value="national_id">National Registration Card (NRC)</SelectItem>',
    );
    expect(wizard).toContain('<SelectItem value="passport">Passport</SelectItem>');
    expect(wizard).not.toContain("drivers_license");
    expect(wizard).not.toContain("voter_card");
    expect(wizard).not.toContain("Driver's License");
    expect(wizard).not.toContain("Voter's Card");
  });
});
