// Beta-screenshot storage fix (2026-11-10 sweep, migration 20261258).
//
// What is pinned:
//   1. The storage policies reference the live bucket id
//      `beta_screenshots` — never the retired 'Beta Feedback
//      Screenshots' name. The bucket was renamed in April 2026
//      (migration 20260419173302) while the policies kept the old
//      name, so every screenshot upload was 403-denied and the
//      bucket stayed empty; admins could not list it either.
//   2. The upload policy stays user-scoped (foldername[1] =
//      auth.uid()) and the admin-list policy stays admin-only.
//   3. The app uploads under the uploader's own folder
//      (`<uid>/<file>`), matching the policy — never the shared
//      `feedback/` prefix, which could never satisfy the
//      user-scoped check.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const migration = read(
  "supabase/migrations/20261258_fix_beta_screenshot_storage_policies.sql",
);
const feedbackService = read("src/utils/feedbackService.ts");

describe("migration 20261258 — beta screenshot storage policies", () => {
  it("points both policies at the live bucket id", () => {
    expect(migration).toContain("bucket_id = 'beta_screenshots'");
    expect(migration).not.toContain("Beta Feedback Screenshots");
    expect(migration).not.toContain("beta-feedback-screenshots");
  });

  it("keeps the admin-only list policy", () => {
    expect(migration).toContain(
      '"Admins can list beta feedback screenshots v2"',
    );
    expect(migration).toContain("has_role(auth.uid(), 'admin'");
  });

  it("keeps the upload policy user-scoped", () => {
    expect(migration).toContain(
      '"Beta feedback screenshots user-scoped upload"',
    );
    expect(migration).toContain(
      "(storage.foldername(name))[1] = (auth.uid())::text",
    );
  });
});

describe("client — beta screenshot upload matches the policy", () => {
  it("uploads under the uploader's own folder, not the shared prefix", () => {
    expect(feedbackService).toContain("`${user.id}/${fileName}`");
    expect(feedbackService).not.toContain("`feedback/${fileName}`");
    expect(feedbackService).not.toContain("'feedback/'");
  });

  it("resolves the signed-in user before uploading", () => {
    expect(feedbackService).toContain("supabase.auth.getUser()");
  });
});
