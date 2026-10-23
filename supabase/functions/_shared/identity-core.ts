// identity-core: the pure decision logic of the verify-identity edge
// function (in-house face verification — design note:
// docs/face-verification.md).
//
// Pure module — no imports, no Deno globals — so every decision the
// function makes (challenge drawing, session validation, transcript
// validation, cosine matching, dedupe, payload validation) is
// unit-testable byte-identically to what Deno runs, in the same
// transpile-loader style as _shared/pos-core.ts.
//
// SECURITY INVARIANTS that live here:
//   * The actor is never read from a payload: validateSubmitPayload
//     validates shapes only; the dispatcher stamps the JWT user id.
//   * A liveness session is single-use and short-lived, and the
//     transcript must cover the issued challenges IN THE ISSUED
//     ORDER — a transcript recorded against a different (or an
//     easier, self-chosen) challenge set never validates.
//   * NO AUTO-APPROVAL (delta security audit V1/V2, 2026-10-23):
//     embeddings and the liveness transcript are CLIENT-COMPUTED.
//     The server can validate their shape, order and timing, but it
//     cannot prove a real face was ever in front of a camera. So no
//     submission is ever auto-verified in this build: every outcome
//     is 'review', the score and dedupe results are TRIAGE for the
//     human reviewer (who sees the actual images), and enrolment
//     happens only on an admin's approval. Automatic approval
//     returns only when embeddings are computed server-side from
//     the stored images (future work).
//   * MODEL_VERSION is pinned HERE, server-side. Any version a
//     client claims is ignored, and comparisons only ever run
//     between embeddings of this exact version.

// ---------------------------------------------------------------------
// Challenges & sessions
// ---------------------------------------------------------------------

export const LIVENESS_CHALLENGES = [
  "blink",
  "turn_left",
  "turn_right",
  "smile",
  "nod",
] as const;

export type LivenessChallenge = (typeof LIVENESS_CHALLENGES)[number];

export const CHALLENGES_PER_SESSION = 3;
export const SESSION_TTL_MS = 5 * 60 * 1000;

/** Anti-brute-force: at most this many SUBMISSIONS per user per
 *  rolling 24 hours. Attempts are counted from identity_audit_log
 *  'submit_attempt' rows, which the edge function writes BEFORE
 *  payload validation — so malformed and refused attempts count
 *  exactly like decided ones (delta audit V5). Five is generous for
 *  a human fixing lighting/framing mistakes and far too few for
 *  automated face guessing against the match threshold. */
export const MAX_SUBMISSIONS_PER_24H = 5;

/** Session starts are cheap but not free of abuse value (each one
 *  mints a fresh challenge set to probe against), so they are
 *  rationed too: at most this many per user per rolling hour. */
export const MAX_SESSIONS_PER_HOUR = 30;

/** The ONLY embedding model version this deployment trusts. Pinned
 *  server-side (delta audit V6): the client may claim any version —
 *  it is ignored. Stored embeddings/enrolments carry this label,
 *  and match/dedupe comparisons skip (and count) rows of any other
 *  version, because cosine across embedding models is meaningless. */
export const MODEL_VERSION = "human-faceres-3.3.6";

export function submissionAllowed(submissionsLast24h: number): boolean {
  return submissionsLast24h < MAX_SUBMISSIONS_PER_24H;
}

export function sessionAllowed(sessionsLastHour: number): boolean {
  return sessionsLastHour < MAX_SESSIONS_PER_HOUR;
}

/** A reviewer must never decide their own verification — the same
 *  separation-of-duties rule as dispute rulings. Enforced in the
 *  edge function on admin_decide and admin_erase. */
export function isSelfDecision(actorId: string, subjectUserId: string): boolean {
  return actorId === subjectUserId;
}

/** Draw CHALLENGES_PER_SESSION distinct challenges. `rand` is
 *  injected so tests are deterministic; production passes a
 *  CSPRNG-backed source (crypto.getRandomValues in the edge
 *  function) — challenge unpredictability is part of the anti-replay
 *  posture, so Math.random is never used there. Distinctness
 *  matters: repeating one movement three times would let a single
 *  recorded clip satisfy the session. */
export function drawChallenges(rand: () => number): LivenessChallenge[] {
  const pool = [...LIVENESS_CHALLENGES];
  const drawn: LivenessChallenge[] = [];
  while (drawn.length < CHALLENGES_PER_SESSION && pool.length > 0) {
    const idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    drawn.push(pool.splice(idx, 1)[0]);
  }
  return drawn;
}

export interface SessionLike {
  user_id: string;
  challenges: string[];
  expires_at: string;
  used_at: string | null;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; code: string; error: string };

const fail = (code: string, error: string): CheckResult => ({
  ok: false,
  code,
  error,
});

/** A session validates only for its owner, unused, unexpired. */
export function validateSession(
  session: SessionLike | null,
  userId: string,
  nowMs: number,
): CheckResult {
  if (!session) {
    return fail(
      "session_not_found",
      "That verification session could not be found. Please start again.",
    );
  }
  if (session.user_id !== userId) {
    return fail(
      "session_not_found",
      "That verification session could not be found. Please start again.",
    );
  }
  if (session.used_at) {
    return fail(
      "session_used",
      "That verification session has already been used. Please start again.",
    );
  }
  if (new Date(session.expires_at).getTime() <= nowMs) {
    return fail(
      "session_expired",
      "That verification session has expired. Please start again — you will get a fresh set of movements.",
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Embeddings: cosine similarity
// ---------------------------------------------------------------------

/** Face embeddings are stored and compared as plain number arrays
 *  (this project has no pgvector). A usable embedding is a finite
 *  vector of plausible dimensionality — Human's FaceRes descriptor
 *  is the current producer, but the bounds stay model-agnostic so a
 *  model swap does not silently change validation. */
export const EMBEDDING_MIN_DIMS = 32;
export const EMBEDDING_MAX_DIMS = 4096;

export function isValidEmbedding(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false;
  if (v.length < EMBEDDING_MIN_DIMS || v.length > EMBEDDING_MAX_DIMS) {
    return false;
  }
  return v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** L2-normalised copy, or null for a zero vector (a zero vector has
 *  no direction, so it can neither match nor dedupe — treating it
 *  as "no embedding" keeps it out of every decision). */
export function normaliseEmbedding(v: number[]): number[] | null {
  let sum = 0;
  for (const n of v) sum += n * n;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return null;
  return v.map((n) => n / norm);
}

/** Cosine similarity in [-1, 1]; null when the vectors cannot be
 *  compared (dimension mismatch or a zero vector). */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  const na = normaliseEmbedding(a);
  const nb = normaliseEmbedding(b);
  if (!na || !nb) return null;
  let dot = 0;
  for (let i = 0; i < na.length; i++) dot += na[i] * nb[i];
  // Clamp float dust at the poles.
  return Math.max(-1, Math.min(1, dot));
}

// ---------------------------------------------------------------------
// Match + dedupe thresholds
// ---------------------------------------------------------------------

// Cosine thresholds for L2-normalised face embeddings. Published
// verification operating points for modern embedding models
// (FaceNet / ArcFace family, and Human's own FaceRes guidance that
// a normalised similarity above ~0.5 indicates a match) put the
// same-person region roughly between 0.4 and 0.6 depending on the
// false-accept rate a product can tolerate.
//
// POST-AUDIT ROLE (V1/V2): these thresholds NO LONGER DECIDE
// anything. Because the embeddings are client-computed, the score
// is decision SUPPORT for the human reviewer — it orders and
// annotates the review queue ("assessed: clean pass / borderline /
// below floor / dedupe hit"), and the dedupe scan flags possible
// duplicate accounts for that same human. The bands are kept from
// the original calibration because they remain the right triage
// semantics:
//   MATCH_STRONG (0.62) — the strict end of the same-person region:
//     at or above, the assessment shown to the reviewer is a clean
//     pass (still their decision, on the real images).
//   MATCH_REVIEW_FLOOR (0.42) — below this the two faces are, with
//     practical certainty, different people; the assessment says so,
//     so the reviewer can reject quickly and confidently.
//   DEDUPE_THRESHOLD (0.70) — dedupe accuses a SECOND account of
//     being the same person, a stronger claim than "these two
//     photos match", so it demands a stronger signal. A hit never
//     rejects anyone by itself: it flags the review item with both
//     accounts' identities for the human (admins only — never the
//     submitting user).
export const MATCH_AUTO_THRESHOLD = 0.62;
export const MATCH_REVIEW_FLOOR = 0.42;
export const DEDUPE_THRESHOLD = 0.7;

export interface DedupeHit {
  user_id: string;
  score: number;
}

export interface DedupeScan {
  hits: DedupeHit[];
  /** Same-version enrolments actually compared. */
  checked: number;
  /** Enrolments skipped because their model version differs from
   *  the pinned MODEL_VERSION — cosine across models is
   *  meaningless, so a skipped row is neither a hit nor a clear. */
  skippedOtherVersion: number;
}

/** Compare a selfie embedding against every OTHER user's enrolled
 *  template OF THE PINNED MODEL VERSION. Dimension-mismatched or
 *  malformed rows are skipped, never treated as matches or clears. */
export function findDedupeHits(
  selfieEmbedding: number[],
  enrollments: {
    user_id: string;
    embedding: number[];
    model_version?: string | null;
  }[],
  selfUserId: string,
): DedupeScan {
  const hits: DedupeHit[] = [];
  let checked = 0;
  let skippedOtherVersion = 0;
  for (const e of enrollments) {
    if (e.user_id === selfUserId) continue;
    if (e.model_version !== MODEL_VERSION) {
      skippedOtherVersion++;
      continue;
    }
    if (!isValidEmbedding(e.embedding)) continue;
    checked++;
    const score = cosineSimilarity(selfieEmbedding, e.embedding);
    if (score !== null && score >= DEDUPE_THRESHOLD) {
      hits.push({ user_id: e.user_id, score });
    }
  }
  return {
    hits: hits.sort((x, y) => y.score - x.score),
    checked,
    skippedOtherVersion,
  };
}

// ---------------------------------------------------------------------
// Liveness transcript validation
// ---------------------------------------------------------------------

export interface TranscriptEntry {
  challenge: string;
  completed: boolean;
  duration_ms: number;
}

export interface LiveTranscript {
  mode: "live";
  entries: TranscriptEntry[];
  antispoof_score?: number | null;
  liveness_score?: number | null;
}

export interface ManualTranscript {
  mode: "manual";
}

// A real human movement cannot complete in a blink: each challenge
// must have taken at least this long from prompt to detection. The
// floor is deliberately low (a fast blink is ~300ms) — it exists to
// refuse transcripts that were clearly synthesised in zero time,
// not to grade the user's speed.
export const MIN_CHALLENGE_MS = 300;
// The whole set must fit inside the session's life with slack for
// the upload that follows.
export const MAX_TRANSCRIPT_MS = SESSION_TTL_MS;

/** The transcript must be a live transcript covering EXACTLY the
 *  issued challenges, in the issued order, each completed, with
 *  plausible timings. Anything else is a liveness failure — the
 *  submission is still recorded (the face stays on record) but it
 *  can never auto-verify. */
export function validateTranscript(
  transcript: unknown,
  issuedChallenges: string[],
): CheckResult {
  if (
    !transcript ||
    typeof transcript !== "object" ||
    (transcript as { mode?: unknown }).mode !== "live"
  ) {
    return fail(
      "liveness_missing",
      "We could not confirm those movements were live. Please try the camera check again, or send photos for a manual review.",
    );
  }
  const entries = (transcript as LiveTranscript).entries;
  if (!Array.isArray(entries) || entries.length !== issuedChallenges.length) {
    return fail(
      "liveness_incomplete",
      "Some of the requested movements were not completed. Please try the camera check again.",
    );
  }
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as TranscriptEntry;
    if (!e || e.challenge !== issuedChallenges[i] || e.completed !== true) {
      return fail(
        "liveness_incomplete",
        "Some of the requested movements were not completed. Please try the camera check again.",
      );
    }
    if (
      typeof e.duration_ms !== "number" ||
      !Number.isFinite(e.duration_ms) ||
      e.duration_ms < MIN_CHALLENGE_MS
    ) {
      return fail(
        "liveness_implausible",
        "Those movements completed too quickly to check properly. Please try again, following each prompt as it appears.",
      );
    }
    total += e.duration_ms;
  }
  if (total > MAX_TRANSCRIPT_MS) {
    return fail(
      "liveness_expired",
      "The movement check took too long and the session expired. Please start again.",
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------

export type VerificationStatus =
  | "pending"
  | "liveness_failed"
  | "match_failed"
  | "review"
  | "auto_verified"
  | "rejected"
  | "approved";

export interface DecisionInput {
  mode: "live" | "manual";
  livenessOk: boolean;
  /** Cosine of selfie vs document portrait; null when no
   *  embeddings were produced (manual mode). */
  matchScore: number | null;
  dedupeHits: DedupeHit[];
}

export interface Decision {
  /** ALWAYS 'review' in this build — see the security invariants
   *  at the top of this file. The field stays so the day
   *  server-side inference lands, automatic outcomes return by
   *  changing this one function and its tests. */
  status: VerificationStatus;
  /** Machine-readable ASSESSMENT for the reviewer and the audit
   *  trail — a triage label, not a trust decision. */
  reason: string;
}

/** The single assessment function. EVERY submission goes to human
 *  review (audit V1/V2): the embeddings and transcript are
 *  client-computed, so they annotate the review item — they never
 *  approve it. Enrolment happens only in admin_decide, after a
 *  reviewer has compared the actual selfie and document images.
 *  Order matters for the label the reviewer sees first: manual,
 *  then liveness, then the match band, then dedupe. */
export function decideVerification(input: DecisionInput): Decision {
  if (input.mode === "manual") {
    return { status: "review", reason: "manual_submission" };
  }
  if (!input.livenessOk) {
    return { status: "review", reason: "liveness_failed" };
  }
  if (input.matchScore === null) {
    // Live mode without a computable match (dimension mismatch,
    // zero vector): the reviewer works from the images alone.
    return { status: "review", reason: "match_unscored" };
  }
  if (input.matchScore < MATCH_REVIEW_FLOOR) {
    return { status: "review", reason: "match_below_floor" };
  }
  if (input.dedupeHits.length > 0) {
    return { status: "review", reason: "dedupe_hit" };
  }
  if (input.matchScore < MATCH_AUTO_THRESHOLD) {
    return { status: "review", reason: "match_borderline" };
  }
  return { status: "review", reason: "clean_pass" };
}

/** Only a row waiting in the review queue can be decided, and only
 *  to approved / rejected. */
export function canAdminDecide(status: string): boolean {
  return status === "review";
}

export function statusAfterAdminDecision(
  decision: string,
): VerificationStatus | null {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return null;
}

// ---------------------------------------------------------------------
// Submit payload validation
// ---------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

export const DOCUMENT_TYPES = [
  "national_id",
  "passport",
  "driver_licence",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Storage paths are pinned: <user_id>/<file>. A path outside the
 *  caller's own folder is never accepted, whatever the body claims —
 *  this is the server-side twin of the bucket's INSERT policy. */
export function isOwnStoragePath(path: unknown, userId: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 300) return false;
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  const first = path.split("/")[0];
  return first === userId;
}

export interface SubmitPayload {
  sessionId: string;
  documentType: DocumentType;
  documentFrontPath: string;
  documentBackPath: string | null;
  selfiePath: string;
  mode: "live" | "manual";
  selfieEmbedding: number[] | null;
  documentEmbedding: number[] | null;
  liveness: LiveTranscript | ManualTranscript;
  consent: boolean;
  consentTextVersion: string;
}

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; error: string };

const bad = (code: string, error: string): Validation<never> => ({
  ok: false,
  code,
  error,
});

export function validateSubmitPayload(
  body: Record<string, unknown>,
  userId: string,
): Validation<SubmitPayload> {
  if (!isUuid(body.session_id)) {
    return bad(
      "session_invalid",
      "That verification session is not valid. Please start again.",
    );
  }
  if (body.consent !== true || typeof body.consent_text_version !== "string" ||
      body.consent_text_version.length === 0 || body.consent_text_version.length > 40) {
    return bad(
      "consent_required",
      "Face verification needs your consent first. Please go back to the consent step and confirm you understand what is captured and why.",
    );
  }
  if (
    typeof body.document_type !== "string" ||
    !(DOCUMENT_TYPES as readonly string[]).includes(body.document_type)
  ) {
    return bad(
      "document_type_invalid",
      "Choose the type of document you photographed: national ID, passport or driving licence.",
    );
  }
  for (const field of ["document_front_path", "selfie_path"] as const) {
    if (!isOwnStoragePath(body[field], userId)) {
      return bad(
        "upload_path_invalid",
        "One of the photos could not be matched to your upload. Please upload the photos again.",
      );
    }
  }
  if (
    body.document_back_path !== undefined &&
    body.document_back_path !== null &&
    !isOwnStoragePath(body.document_back_path, userId)
  ) {
    return bad(
      "upload_path_invalid",
      "One of the photos could not be matched to your upload. Please upload the photos again.",
    );
  }

  const mode = body.mode === "manual" ? "manual" : "live";

  let selfieEmbedding: number[] | null = null;
  let documentEmbedding: number[] | null = null;
  if (mode === "live") {
    if (!isValidEmbedding(body.selfie_embedding) ||
        !isValidEmbedding(body.document_embedding)) {
      return bad(
        "embedding_invalid",
        "We could not read the face data from those photos. Please try again in better light, or send photos for a manual review instead.",
      );
    }
    selfieEmbedding = body.selfie_embedding;
    documentEmbedding = body.document_embedding;
    if (selfieEmbedding.length !== documentEmbedding.length) {
      return bad(
        "embedding_invalid",
        "We could not read the face data from those photos. Please try again in better light, or send photos for a manual review instead.",
      );
    }
    // body.model_version is deliberately NOT read: the trusted
    // version is the server-pinned MODEL_VERSION constant (audit
    // V6). A client-supplied label can never steer comparisons.
  }

  const livenessRaw = body.liveness;
  if (
    !livenessRaw ||
    typeof livenessRaw !== "object" ||
    (livenessRaw as { mode?: unknown }).mode !== mode
  ) {
    return bad(
      "liveness_missing",
      "The movement check results were not included. Please try again, or send photos for a manual review.",
    );
  }

  return {
    ok: true,
    value: {
      sessionId: body.session_id,
      documentType: body.document_type as DocumentType,
      documentFrontPath: body.document_front_path as string,
      documentBackPath: (body.document_back_path as string | null) ?? null,
      selfiePath: body.selfie_path as string,
      mode,
      selfieEmbedding,
      documentEmbedding,
      liveness: livenessRaw as LiveTranscript | ManualTranscript,
      consent: true,
      consentTextVersion: body.consent_text_version,
    },
  };
}
