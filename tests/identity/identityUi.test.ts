// Unit tests for src/utils/identityUi.ts — the pure UI logic of the
// face-verification flow: the status state machine's copy and retry
// rules, consent/document gating, challenge copy, and the admin
// transcript/dedupe summaries.

import { describe, it, expect } from "vitest";
import {
  canProceedFromConsent,
  challengePrompt,
  CHALLENGE_HINTS,
  CHALLENGE_PROMPTS,
  CONSENT_TEXT_VERSION,
  dedupeSummary,
  documentStepComplete,
  formatMatchScore,
  IDENTITY_STATUS_META,
  identityStatusMeta,
  LIVENESS_CHALLENGES,
  summariseTranscript,
  VERIFY_STEPS,
  type IdentityStatus,
} from "@/utils/identityUi";

describe("status state machine", () => {
  const ALL: IdentityStatus[] = [
    "none",
    "pending",
    "liveness_failed",
    "match_failed",
    "review",
    "auto_verified",
    "approved",
    "rejected",
    "erased",
  ];

  it("has complete meta for every status the DB can hold (plus none)", () => {
    for (const s of ALL) {
      const meta = IDENTITY_STATUS_META[s];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.headline.length).toBeGreaterThan(0);
      expect(meta.body.length).toBeGreaterThan(0);
    }
  });

  it("only auto_verified and approved count as verified", () => {
    for (const s of ALL) {
      expect(IDENTITY_STATUS_META[s].verified).toBe(
        s === "auto_verified" || s === "approved",
      );
    }
  });

  it("retry is offered exactly from the states a fresh attempt can fix", () => {
    const retryable = ALL.filter((s) => IDENTITY_STATUS_META[s].canRetry);
    expect(retryable.sort()).toEqual(
      ["erased", "liveness_failed", "match_failed", "none", "rejected"].sort(),
    );
    // A row in review must not invite a duplicate submission.
    expect(IDENTITY_STATUS_META.review.canRetry).toBe(false);
    expect(IDENTITY_STATUS_META.pending.canRetry).toBe(false);
  });

  it("falls back to the none meta for unknown or missing statuses", () => {
    expect(identityStatusMeta(null)).toBe(IDENTITY_STATUS_META.none);
    expect(identityStatusMeta("bogus")).toBe(IDENTITY_STATUS_META.none);
    expect(identityStatusMeta("review")).toBe(IDENTITY_STATUS_META.review);
  });
});

describe("step gating", () => {
  it("consent step requires an active tick", () => {
    expect(canProceedFromConsent(true)).toBe(true);
    expect(canProceedFromConsent(false)).toBe(false);
    expect(CONSENT_TEXT_VERSION).toBe("face-consent-v1");
  });

  it("document step requires the front capture only (back is optional)", () => {
    expect(documentStepComplete(true)).toBe(true);
    expect(documentStepComplete(false)).toBe(false);
  });

  it("the wizard has the four steps in order", () => {
    expect(VERIFY_STEPS.map((s) => s.id)).toEqual([
      "consent",
      "document",
      "liveness",
      "done",
    ]);
  });
});

describe("challenge copy", () => {
  it("every challenge the edge can issue has a prompt and a hint", () => {
    for (const c of LIVENESS_CHALLENGES) {
      expect(CHALLENGE_PROMPTS[c].length).toBeGreaterThan(0);
      expect(CHALLENGE_HINTS[c].length).toBeGreaterThan(0);
      expect(challengePrompt(c)).toBe(CHALLENGE_PROMPTS[c]);
    }
    expect(challengePrompt("unknown")).toMatch(/instruction/i);
  });
});

describe("admin summaries", () => {
  it("summarises a live transcript entry by entry with scores", () => {
    const lines = summariseTranscript({
      mode: "live",
      entries: [
        { challenge: "blink", completed: true, duration_ms: 1500 },
        { challenge: "nod", completed: false, duration_ms: 900 },
      ],
      antispoof_score: 0.93,
      liveness_score: 0.81,
    });
    expect(lines[0]).toContain("completed in 1.5s");
    expect(lines[1]).toContain("NOT completed");
    expect(lines[2]).toContain("0.93");
    expect(lines[3]).toContain("0.81");
  });

  it("summarises manual and missing transcripts honestly", () => {
    expect(summariseTranscript({ mode: "manual" })[0]).toMatch(/Manual/);
    expect(summariseTranscript(null)[0]).toMatch(/No movement-check/);
    expect(summariseTranscript({})[0]).toMatch(/No movement-check/);
  });

  it("summarises dedupe outcomes with the strongest hit only as a number", () => {
    expect(dedupeSummary({ checked: 12, hits: [] })).toContain("12");
    const s = dedupeSummary({
      checked: 12,
      hits: [
        { user_id: "u1", score: 0.81 },
        { user_id: "u2", score: 0.93 },
      ],
    });
    expect(s).toContain("2 other enrolled account(s)");
    expect(s).toContain("0.93");
    expect(dedupeSummary(null)).toContain("0 enrolled");
  });

  it("formats match scores for reviewers, null as a manual submission", () => {
    expect(formatMatchScore(0.8734)).toBe("0.87");
    expect(formatMatchScore(null)).toMatch(/manual/i);
    expect(formatMatchScore(undefined)).toMatch(/manual/i);
  });
});
