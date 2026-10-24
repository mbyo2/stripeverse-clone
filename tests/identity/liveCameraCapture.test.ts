// Regression tests for the CEO's live-camera directive (2026-10-24):
// every FACE image — the /verify-identity selfie and document
// photos, and the /kyc selfie step — is captured with the LIVE
// CAMERA only. File upload for faces was an impersonation hole (a
// stolen photo of another person could be uploaded), so the file
// picker / gallery / drag-drop code paths were removed entirely
// from those flows. Paper documents in /kyc (NRC/Passport front and
// back, proof of address) remain file uploads via DocumentUploader.
//
// These are source-wiring tests in the same style as
// tests/kyc/kycWizardFlow.test.ts: they pin the absence of the
// upload paths (the security property) and the presence of the
// camera paths, which is what a future refactor must not undo. The
// browser behaviour itself is proven by the live QA pass.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8");

const verifyPage = readSrc("../../src/pages/VerifyIdentity.tsx");
const camera = readSrc("../../src/components/identity/LiveCameraCapture.tsx");
const wizard = readSrc("../../src/components/wallet/KycVerification.tsx");
const uploader = readSrc("../../src/components/wallet/DocumentUploader.tsx");

describe("VerifyIdentity — no file-upload path remains anywhere in the flow", () => {
  it("contains no file input and no upload-picker copy", () => {
    expect(verifyPage).not.toContain('type="file"');
    expect(verifyPage).not.toContain("accept=");
    expect(verifyPage).not.toContain("Upload photo");
    expect(verifyPage).not.toContain("Upload a clear selfie");
    expect(verifyPage).not.toContain("FileUp");
  });

  it("captures document photos with the rear camera and the selfie with the front camera", () => {
    const slots = verifyPage.match(/<LivePhotoSlot/g) ?? [];
    expect(slots.length).toBe(3);
    const rear = verifyPage.match(/facingMode="environment"/g) ?? [];
    expect(rear.length).toBe(2);
    expect(verifyPage).toContain('facingMode="user"');
  });

  it("still uploads the CAPTURED photos to the same evidence paths", () => {
    expect(verifyPage).toContain('uploadIdentityFile(frontBlob!, user.id, "document-front")');
    expect(verifyPage).toContain('uploadIdentityFile(selfieBlob, user.id, "selfie")');
    expect(verifyPage).toContain('uploadIdentityFile(manualSelfie, user.id, "selfie")');
  });
});

describe("LiveCameraCapture — the camera component itself", () => {
  it("opens the camera with getUserMedia and never offers a file", () => {
    expect(camera).toContain("navigator.mediaDevices.getUserMedia");
    expect(camera).not.toContain('type="file"');
    expect(camera).not.toContain("<input");
    expect(camera).not.toContain("dataTransfer");
  });

  it("speaks plain language on failure — never a raw browser error", () => {
    expect(camera).toContain("Camera access was blocked.");
    expect(camera).toContain("No camera could be found on this device.");
    expect(camera).toContain("The camera could not be started.");
    // The caught error's name is used ONLY to choose the message;
    // its raw text is never rendered.
    expect(camera).not.toContain("error.message");
    expect(camera).not.toContain("err.message");
  });

  it("cannot submit a surrounding form (the KYC wizard lesson)", () => {
    const typeButtons = camera.match(/type="button"/g) ?? [];
    expect(typeButtons.length).toBeGreaterThanOrEqual(4);
  });
});

describe("KycVerification — selfie is live-camera only, documents stay uploads", () => {
  it("has no file input for the selfie (or anywhere in the wizard)", () => {
    expect(wizard).not.toContain('type="file"');
    expect(wizard).not.toContain("selfie-upload");
    expect(wizard).not.toContain("handleSelfieUpload");
    expect(wizard).not.toContain("Select Image");
  });

  it("captures the selfie with the front camera and stamps the capture time", () => {
    expect(wizard).toContain("<LiveCameraCapture");
    expect(wizard).toContain('facingMode="user"');
    expect(wizard).toContain("handleSelfieCapture");
    expect(wizard).toContain("lastModified: capturedAt");
  });

  it("keeps the paper documents on the file-upload path", () => {
    expect(wizard).toContain('documentType="id_front"');
    expect(wizard).toContain('documentType="id_back"');
    expect(wizard).toContain('documentType="address_proof"');
    expect(uploader).toContain('type="file"');
  });
});
