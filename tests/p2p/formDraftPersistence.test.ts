// Regression tests for the P2P/KYC form-persistence hardening
// (CEO report 2026-11-03: "p2p … is not keeping things in the form
// fields and I can't even complete p2p KYC").
//
// Desktop QA could not reproduce data loss in-session (tab switches
// and 70-second waits preserved every value), but form state held
// only in React state dies with the page — and on a phone the
// browser routinely discards background tabs, so any interruption
// (reload, discarded tab, browser restart, being pulled away
// mid-form) wiped the P2P forms entirely, while the KYC wizard's
// draft sat in sessionStorage, which a discarded tab also destroys.
//
// The fix pinned here:
//  1. A shared localStorage draft helper (src/lib/formDraft.ts).
//  2. The P2P new-ad form and the P2P profile payment-method form
//     save as the user types, restore on return, and clear on
//     success.
//  3. The KYC submit button explains, in plain language, exactly
//     what is still missing instead of sitting silently disabled —
//     a greyed-out button with no reason reads as a broken form and
//     was the other half of "can't complete KYC".

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) =>
  fs.readFileSync(path.join(here, rel), "utf8");

const helper = readSrc("../../src/lib/formDraft.ts");
const newAd = readSrc("../../src/pages/P2PNewAd.tsx");
const profile = readSrc("../../src/pages/P2PProfile.tsx");
const wizard = readSrc("../../src/components/wallet/KycVerification.tsx");
const faceVerify = readSrc("../../src/pages/VerifyIdentity.tsx");

describe("formDraft helper — durable localStorage drafts", () => {
  it("loads, saves and clears drafts via localStorage", () => {
    expect(helper).toContain("export function loadFormDraft");
    expect(helper).toContain("export function saveFormDraft");
    expect(helper).toContain("export function clearFormDraft");
    expect(helper).toContain("localStorage.getItem(key)");
    expect(helper).toContain("localStorage.setItem(key, JSON.stringify(value))");
    expect(helper).toContain("localStorage.removeItem(key)");
  });

  it("never uses sessionStorage (discarded mobile tabs destroy it)", () => {
    expect(helper).not.toContain("sessionStorage");
    expect(newAd).not.toContain("sessionStorage");
    expect(profile).not.toContain("sessionStorage");
  });
});

describe("P2P new-ad form — draft survives interruption", () => {
  it("saves, restores and clears a per-user draft", () => {
    expect(newAd).toContain("p2p-new-ad-draft:");
    expect(newAd).toContain("loadFormDraft(draftKey)");
    expect(newAd).toContain("saveFormDraft(draftKey, {");
    expect(newAd).toContain("clearFormDraft(draftKey)");
  });

  it("does not start saving before the restore pass has run", () => {
    expect(newAd).toContain("draftRestoredRef");
    expect(newAd).toContain("if (!draftKey || !draftRestoredRef.current) return;");
  });
});

describe("P2P profile payment-method form — draft survives interruption", () => {
  it("saves, restores and clears a per-user draft", () => {
    expect(profile).toContain("p2p-payment-method-draft:");
    expect(profile).toContain("loadFormDraft(methodDraftKey)");
    expect(profile).toContain("saveFormDraft(methodDraftKey, {");
    expect(profile).toContain("clearFormDraft(methodDraftKey)");
  });
});

describe("Face verification — captured photos survive interruption", () => {
  it("saves, restores and clears a per-user draft including the photos", () => {
    expect(faceVerify).toContain("face-verify-draft:");
    expect(faceVerify).toContain("loadFormDraft<FaceVerifyDraft & Record<string, unknown>>(draftKey)");
    expect(faceVerify).toContain("saveFormDraft(draftKey, {");
    expect(faceVerify).toContain("clearFormDraft(draftKey)");
  });

  it("round-trips photos through data URLs so Blobs can be rebuilt", () => {
    expect(faceVerify).toContain("blobToDataUrl");
    expect(faceVerify).toContain("dataUrlToBlob");
  });

  it("never resumes into the camera step without its document photo", () => {
    expect(faceVerify).toContain('if (draft.step === "liveness" && front)');
  });

  it("tells the user their progress is saved on the device", () => {
    expect(faceVerify).toContain("saved on this device as you go");
  });
});

describe("KYC wizard — submit explains what is missing", () => {
  it("builds a plain-language missing-items list", () => {
    expect(wizard).toContain("const missingItems: string[] = [];");
    expect(wizard).toContain("Still needed before you can submit:");
  });

  it("gates the submit button on that same list (one source of truth)", () => {
    expect(wizard).toContain("disabled={submitting || missingItems.length > 0}");
  });

  it("tells the user their entries are saved on the device as they go", () => {
    expect(wizard).toContain("saved on this");
  });
});
