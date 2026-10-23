// Unit tests for supabase/functions/_shared/identity-core.ts — the
// pure decision logic of the verify-identity edge function
// (in-house face verification).
//
// Same transpile-loader style as tests/pos/pos-core.test.ts: load
// the REAL identity-core.ts source, transpile it, and test the
// resulting module — the code under test is byte-identical to what
// Deno runs. identity-core is import-free by design, so no
// specifier rewriting is needed.

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSourcePath = path.resolve(
  here,
  "../../supabase/functions/_shared/identity-core.ts",
);
const tmpModulePath = path.join(here, ".tmp-identity-core.mjs");

type Core = typeof import("../../supabase/functions/_shared/identity-core");
let core: Core;

beforeAll(async () => {
  const source = fs.readFileSync(coreSourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  fs.writeFileSync(tmpModulePath, outputText);
  core = await import(tmpModulePath);
});

/** A deterministic pseudo-embedding: a unit-ish vector whose first
 *  components are shaped by `seed`, padded to 128 dims. */
function embedding(seed: number[]): number[] {
  const v = new Array(128).fill(0);
  seed.forEach((n, i) => (v[i] = n));
  return v;
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and -1 for opposites", () => {
    const a = embedding([3, 4]);
    expect(core.cosineSimilarity(a, a)).toBeCloseTo(1, 10);
    expect(core.cosineSimilarity(a, embedding([-3, -4]))).toBeCloseTo(-1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(
      core.cosineSimilarity(embedding([1, 0]), embedding([0, 1])),
    ).toBeCloseTo(0, 10);
  });

  it("is scale-invariant (embeddings need not arrive normalised)", () => {
    const a = embedding([1, 2, 3]);
    const b = embedding([2, 4, 6]);
    expect(core.cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it("returns null for dimension mismatch and zero vectors", () => {
    expect(core.cosineSimilarity(embedding([1]), [1, 2, 3])).toBeNull();
    expect(
      core.cosineSimilarity(new Array(128).fill(0), embedding([1])),
    ).toBeNull();
  });
});

describe("isValidEmbedding / normaliseEmbedding", () => {
  it("accepts a plausible descriptor and rejects junk", () => {
    expect(core.isValidEmbedding(embedding([1, 2]))).toBe(true);
    expect(core.isValidEmbedding([1, 2, 3])).toBe(false); // too short
    expect(core.isValidEmbedding("nope")).toBe(false);
    const withNaN = embedding([1]);
    withNaN[5] = Number.NaN;
    expect(core.isValidEmbedding(withNaN)).toBe(false);
  });

  it("normalises to unit length and refuses the zero vector", () => {
    const n = core.normaliseEmbedding(embedding([3, 4]));
    expect(n).not.toBeNull();
    const len = Math.sqrt(n!.reduce((s, x) => s + x * x, 0));
    expect(len).toBeCloseTo(1, 10);
    expect(core.normaliseEmbedding(new Array(128).fill(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Challenge drawing + session validation
// ---------------------------------------------------------------------

describe("drawChallenges", () => {
  it("draws 3 distinct challenges from the known set", () => {
    const seq = [0.0, 0.5, 0.99, 0.1, 0.2];
    let i = 0;
    const drawn = core.drawChallenges(() => seq[i++ % seq.length]);
    expect(drawn).toHaveLength(core.CHALLENGES_PER_SESSION);
    expect(new Set(drawn).size).toBe(3);
    for (const c of drawn) {
      expect(core.LIVENESS_CHALLENGES).toContain(c);
    }
  });

  it("never repeats even when the RNG is degenerate", () => {
    const drawn = core.drawChallenges(() => 0);
    expect(new Set(drawn).size).toBe(3);
  });
});

describe("validateSession", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const base = {
    user_id: USER_A,
    challenges: ["blink", "smile", "nod"],
    expires_at: "2026-10-23T12:05:00Z",
    used_at: null,
  };

  it("accepts a fresh, own, unused session", () => {
    expect(core.validateSession(base, USER_A, now).ok).toBe(true);
  });

  it("refuses missing, foreign, used and expired sessions", () => {
    expect(core.validateSession(null, USER_A, now)).toMatchObject({
      ok: false,
      code: "session_not_found",
    });
    expect(core.validateSession(base, USER_B, now)).toMatchObject({
      ok: false,
      code: "session_not_found",
    });
    expect(
      core.validateSession(
        { ...base, used_at: "2026-10-23T12:01:00Z" },
        USER_A,
        now,
      ),
    ).toMatchObject({ ok: false, code: "session_used" });
    expect(
      core.validateSession(
        { ...base, expires_at: "2026-10-23T11:59:59Z" },
        USER_A,
        now,
      ),
    ).toMatchObject({ ok: false, code: "session_expired" });
  });
});

// ---------------------------------------------------------------------
// Transcript validation
// ---------------------------------------------------------------------

describe("validateTranscript", () => {
  const issued = ["turn_left", "blink", "smile"];
  const good = {
    mode: "live",
    entries: [
      { challenge: "turn_left", completed: true, duration_ms: 2100 },
      { challenge: "blink", completed: true, duration_ms: 1400 },
      { challenge: "smile", completed: true, duration_ms: 1800 },
    ],
  };

  it("accepts a transcript covering the issued challenges in order", () => {
    expect(core.validateTranscript(good, issued).ok).toBe(true);
  });

  it("refuses a different order, a missing challenge, an incomplete one", () => {
    const reordered = {
      mode: "live",
      entries: [good.entries[1], good.entries[0], good.entries[2]],
    };
    expect(core.validateTranscript(reordered, issued).ok).toBe(false);
    const short = { mode: "live", entries: good.entries.slice(0, 2) };
    expect(core.validateTranscript(short, issued)).toMatchObject({
      ok: false,
      code: "liveness_incomplete",
    });
    const incomplete = {
      mode: "live",
      entries: good.entries.map((e, i) =>
        i === 1 ? { ...e, completed: false } : e,
      ),
    };
    expect(core.validateTranscript(incomplete, issued).ok).toBe(false);
  });

  it("refuses zero-time completions and non-live transcripts", () => {
    const instant = {
      mode: "live",
      entries: good.entries.map((e) => ({ ...e, duration_ms: 5 })),
    };
    expect(core.validateTranscript(instant, issued)).toMatchObject({
      ok: false,
      code: "liveness_implausible",
    });
    expect(core.validateTranscript({ mode: "manual" }, issued)).toMatchObject({
      ok: false,
      code: "liveness_missing",
    });
    expect(core.validateTranscript(null, issued).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------

describe("findDedupeHits", () => {
  const selfie = embedding([1, 0.2, 0.1]);
  // The pinned version literal; the payload suite asserts
  // core.MODEL_VERSION equals it, so the two can never drift apart.
  const v = "human-faceres-3.3.6";

  it("finds another user's near-identical face, sorted strongest first", () => {
    const scan = core.findDedupeHits(
      selfie,
      [
        { user_id: USER_B, embedding: embedding([1, 0.21, 0.09]), model_version: v },
        { user_id: USER_C, embedding: embedding([0.98, 0.25, 0.12]), model_version: v },
      ],
      USER_A,
    );
    expect(scan.hits.map((h) => h.user_id)).toEqual([USER_B, USER_C]);
    expect(scan.hits[0].score).toBeGreaterThanOrEqual(core.DEDUPE_THRESHOLD);
    expect(scan.checked).toBe(2);
    expect(scan.skippedOtherVersion).toBe(0);
  });

  it("never flags the user's own enrollment or a different face", () => {
    const scan = core.findDedupeHits(
      selfie,
      [
        { user_id: USER_A, embedding: selfie, model_version: v },
        { user_id: USER_B, embedding: embedding([0, 1, 0.5]), model_version: v },
      ],
      USER_A,
    );
    expect(scan.hits).toEqual([]);
    expect(scan.checked).toBe(1);
  });

  it("skips dimension-mismatched enrollments instead of guessing", () => {
    const scan = core.findDedupeHits(
      selfie,
      [{ user_id: USER_B, embedding: [1, 0.2, 0.1], model_version: v }],
      USER_A,
    );
    expect(scan.hits).toEqual([]);
    expect(scan.checked).toBe(0);
  });

  it("skips other-model-version enrollments and counts them (audit V6)", () => {
    const scan = core.findDedupeHits(
      selfie,
      [
        // A near-identical face under a FOREIGN version label must
        // not hit: cosine across models is meaningless, and the
        // label is client-assertable history, never trusted.
        { user_id: USER_B, embedding: embedding([1, 0.21, 0.09]), model_version: "other-model-9" },
        { user_id: USER_C, embedding: embedding([1, 0.21, 0.09]), model_version: null },
      ],
      USER_A,
    );
    expect(scan.hits).toEqual([]);
    expect(scan.checked).toBe(0);
    expect(scan.skippedOtherVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------
// The assessment function + status state machine
// ---------------------------------------------------------------------

describe("decideVerification", () => {
  const hit = [{ user_id: USER_B, score: 0.9 }];

  it("NEVER auto-verifies: even a perfect clean pass goes to human review (audit V1/V2)", () => {
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: 0.99,
        dedupeHits: [],
      }),
    ).toEqual({ status: "review", reason: "clean_pass" });
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: core.MATCH_AUTO_THRESHOLD,
        dedupeHits: [],
      }).status,
    ).toBe("review");
  });

  it("annotates borderline matches as review triage, never a decision", () => {
    const mid = (core.MATCH_AUTO_THRESHOLD + core.MATCH_REVIEW_FLOOR) / 2;
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: mid,
        dedupeHits: [],
      }),
    ).toMatchObject({ status: "review", reason: "match_borderline" });
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: core.MATCH_REVIEW_FLOOR,
        dedupeHits: [],
      }).status,
    ).toBe("review");
  });

  it("annotates a clear non-match for the reviewer; liveness failure takes precedence", () => {
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: 0.1,
        dedupeHits: [],
      }),
    ).toMatchObject({ status: "review", reason: "match_below_floor" });
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: false,
        matchScore: 0.99,
        dedupeHits: [],
      }),
    ).toMatchObject({ status: "review", reason: "liveness_failed" });
  });

  it("a dedupe hit annotates the review item even on a perfect match score", () => {
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: 0.99,
        dedupeHits: hit,
      }),
    ).toMatchObject({ status: "review", reason: "dedupe_hit" });
  });

  it("manual submissions and unscored live matches go to review", () => {
    expect(
      core.decideVerification({
        mode: "manual",
        livenessOk: false,
        matchScore: null,
        dedupeHits: [],
      }),
    ).toMatchObject({ status: "review", reason: "manual_submission" });
    expect(
      core.decideVerification({
        mode: "live",
        livenessOk: true,
        matchScore: null,
        dedupeHits: [],
      }).reason,
    ).toBe("match_unscored");
  });
});

describe("admin decision state machine", () => {
  it("only review rows can be decided, to approved or rejected", () => {
    expect(core.canAdminDecide("review")).toBe(true);
    for (const s of ["pending", "auto_verified", "approved", "rejected", "match_failed", "erased"]) {
      expect(core.canAdminDecide(s)).toBe(false);
    }
    expect(core.statusAfterAdminDecision("approve")).toBe("approved");
    expect(core.statusAfterAdminDecision("reject")).toBe("rejected");
    expect(core.statusAfterAdminDecision("whatever")).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Submit payload validation
// ---------------------------------------------------------------------

describe("validateSubmitPayload", () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const liveBody = () => ({
    session_id: sessionId,
    consent: true,
    consent_text_version: "face-consent-v1",
    document_type: "national_id",
    document_front_path: `${USER_A}/document-front-1.jpg`,
    document_back_path: `${USER_A}/document-back-1.jpg`,
    selfie_path: `${USER_A}/selfie-1.jpg`,
    mode: "live",
    selfie_embedding: embedding([1, 0.3]),
    document_embedding: embedding([1, 0.31]),
    model_version: "human-faceres-1",
    liveness: { mode: "live", entries: [] },
  });

  it("accepts a well-formed live submission", () => {
    const res = core.validateSubmitPayload(liveBody(), USER_A);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.mode).toBe("live");
      expect(res.value.documentType).toBe("national_id");
    }
  });

  it("refuses without consent, with a bad session id, or a foreign upload path", () => {
    expect(
      core.validateSubmitPayload({ ...liveBody(), consent: false }, USER_A),
    ).toMatchObject({ ok: false, code: "consent_required" });
    expect(
      core.validateSubmitPayload({ ...liveBody(), session_id: "x" }, USER_A),
    ).toMatchObject({ ok: false, code: "session_invalid" });
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), selfie_path: `${USER_B}/selfie-1.jpg` },
        USER_A,
      ),
    ).toMatchObject({ ok: false, code: "upload_path_invalid" });
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), document_front_path: "../etc/passwd" },
        USER_A,
      ),
    ).toMatchObject({ ok: false, code: "upload_path_invalid" });
  });

  it("refuses mismatched or missing embeddings in live mode", () => {
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), document_embedding: [1, 2, 3] },
        USER_A,
      ),
    ).toMatchObject({ ok: false, code: "embedding_invalid" });
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), selfie_embedding: undefined },
        USER_A,
      ),
    ).toMatchObject({ ok: false, code: "embedding_invalid" });
  });

  it("accepts a manual submission with no embeddings and a manual transcript", () => {
    const res = core.validateSubmitPayload(
      {
        session_id: sessionId,
        consent: true,
        consent_text_version: "face-consent-v1",
        document_type: "passport",
        document_front_path: `${USER_A}/document-front-1.jpg`,
        selfie_path: `${USER_A}/selfie-1.jpg`,
        mode: "manual",
        liveness: { mode: "manual" },
      },
      USER_A,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.selfieEmbedding).toBeNull();
      expect(res.value.documentBackPath).toBeNull();
    }
  });

  it("ignores any client-claimed model version (audit V6: the server pins its own)", () => {
    const without = liveBody() as Record<string, unknown>;
    delete without.model_version;
    expect(core.validateSubmitPayload(without, USER_A).ok).toBe(true);
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), model_version: "attacker-chosen-9000" },
        USER_A,
      ).ok,
    ).toBe(true);
    expect(core.MODEL_VERSION).toBe("human-faceres-3.3.6");
  });

  it("refuses a live body whose transcript claims manual mode (and vice versa)", () => {
    expect(
      core.validateSubmitPayload(
        { ...liveBody(), liveness: { mode: "manual" } },
        USER_A,
      ),
    ).toMatchObject({ ok: false, code: "liveness_missing" });
  });
});

describe("submissionAllowed (daily attempt limit)", () => {
  it("allows attempts under the daily cap", () => {
    expect(core.MAX_SUBMISSIONS_PER_24H).toBe(5);
    expect(core.submissionAllowed(0)).toBe(true);
    expect(core.submissionAllowed(4)).toBe(true);
  });

  it("blocks at and beyond the daily cap", () => {
    expect(core.submissionAllowed(5)).toBe(false);
    expect(core.submissionAllowed(9)).toBe(false);
  });
});

describe("isSelfDecision (separation of duties)", () => {
  it("detects a reviewer deciding their own verification", () => {
    expect(core.isSelfDecision(USER_A, USER_A)).toBe(true);
    expect(core.isSelfDecision(USER_A, USER_B)).toBe(false);
  });

  it("is the same gate the erasure path uses for self-erasure", () => {
    // admin_erase refuses when actor == subject, via this predicate.
    expect(core.isSelfDecision(USER_B, USER_B)).toBe(true);
    expect(core.isSelfDecision(USER_B, USER_A)).toBe(false);
  });
});

describe("sessionAllowed (hourly session ration)", () => {
  it("allows under the cap and blocks at it", () => {
    expect(core.MAX_SESSIONS_PER_HOUR).toBe(30);
    expect(core.sessionAllowed(0)).toBe(true);
    expect(core.sessionAllowed(29)).toBe(true);
    expect(core.sessionAllowed(30)).toBe(false);
  });
});
