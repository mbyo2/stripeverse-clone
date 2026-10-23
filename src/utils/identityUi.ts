// identityUi: the pure UI logic of the in-house face verification
// flow (/verify-identity, /p2p/profile status card, /admin/identity
// review queue). No React, no I/O — the pages render from these
// tables and helpers so the copy and the state machine are testable
// in one place (tests/identity/identityUi.test.ts).
//
// The status set mirrors the identity_verifications CHECK constraint
// and _shared/identity-core.ts exactly.

export type IdentityStatus =
  | "none"
  | "pending"
  | "liveness_failed"
  | "match_failed"
  | "review"
  | "auto_verified"
  | "approved"
  | "rejected"
  | "erased";

export type IdentityTone = "default" | "secondary" | "destructive" | "outline";

export interface IdentityStatusMeta {
  label: string;
  tone: IdentityTone;
  headline: string;
  body: string;
  /** The user may start a fresh attempt from this state. */
  canRetry: boolean;
  /** This state means the face is on record and accepted. */
  verified: boolean;
}

export const IDENTITY_STATUS_META: Record<IdentityStatus, IdentityStatusMeta> = {
  none: {
    label: "Not verified",
    tone: "outline",
    headline: "Verify your face",
    body: "Confirm your identity document and complete a short camera movement check. It takes about a minute.",
    canRetry: true,
    verified: false,
  },
  pending: {
    label: "Saving…",
    tone: "secondary",
    headline: "Saving your verification",
    body: "Your verification was received and is being recorded.",
    canRetry: false,
    verified: false,
  },
  liveness_failed: {
    label: "Movement check failed",
    tone: "destructive",
    headline: "We could not confirm the movements were live",
    body: "The camera movement check did not complete properly. Your photos are on record, but the check needs to pass before your face can be verified. Try again in good light, holding the phone at eye level.",
    canRetry: true,
    verified: false,
  },
  match_failed: {
    label: "Face did not match",
    tone: "destructive",
    headline: "Your selfie did not match your document photo",
    body: "The face in the selfie does not appear to be the face on the document. Make sure you are verifying your own document, remove anything covering your face, and try again in good light.",
    canRetry: true,
    verified: false,
  },
  review: {
    label: "Under review",
    tone: "secondary",
    headline: "A person is reviewing your verification",
    body: "Every verification is decided by a person on our review team, who compares your selfie with your document photo. We will update this page when the review is done.",
    canRetry: false,
    verified: false,
  },
  auto_verified: {
    label: "Face verified",
    tone: "default",
    headline: "Your face is verified",
    body: "Your selfie matched your document and your face is now on record for this account. One account per face is enforced: the same face cannot verify a second BMaGlass Pay account.",
    canRetry: false,
    verified: true,
  },
  approved: {
    label: "Face verified",
    tone: "default",
    headline: "Your face is verified",
    body: "A reviewer approved your verification and your face is now on record for this account. One account per face is enforced: the same face cannot verify a second BMaGlass Pay account.",
    canRetry: false,
    verified: true,
  },
  rejected: {
    label: "Verification rejected",
    tone: "destructive",
    headline: "Your verification was rejected",
    body: "A reviewer could not accept this verification. Read the reviewer's note below and try again with clear photos of your own document.",
    canRetry: true,
    verified: false,
  },
  erased: {
    label: "Data erased",
    tone: "outline",
    headline: "Your face verification data was erased",
    body: "Your document photos, selfie and face template were permanently deleted, as requested. Nothing about your face is on record anymore. You can verify again whenever you are ready.",
    canRetry: true,
    verified: false,
  },
};

export function identityStatusMeta(status: string | null | undefined): IdentityStatusMeta {
  if (status && status in IDENTITY_STATUS_META) {
    return IDENTITY_STATUS_META[status as IdentityStatus];
  }
  return IDENTITY_STATUS_META.none;
}

// ---------------------------------------------------------------------
// The wizard's steps
// ---------------------------------------------------------------------

export type VerifyStep = "consent" | "document" | "liveness" | "done";

export const VERIFY_STEPS: { id: VerifyStep; label: string }[] = [
  { id: "consent", label: "Consent" },
  { id: "document", label: "Document" },
  { id: "liveness", label: "Face check" },
  { id: "done", label: "Result" },
];

/** Consent must be an active, recorded agreement — the Continue
 *  button stays disabled until the user ticks the box (the consent
 *  is sensitive-data consent under the Zambia Data Protection Act,
 *  and the version below pins the wording agreed to). */
export const CONSENT_TEXT_VERSION = "face-consent-v1";

export function canProceedFromConsent(consentChecked: boolean): boolean {
  return consentChecked === true;
}

export function documentStepComplete(frontCaptured: boolean): boolean {
  return frontCaptured === true;
}

// ---------------------------------------------------------------------
// Liveness challenges (mirror of _shared/identity-core.ts)
// ---------------------------------------------------------------------

export const LIVENESS_CHALLENGES = [
  "blink",
  "turn_left",
  "turn_right",
  "smile",
  "nod",
] as const;

export type LivenessChallenge = (typeof LIVENESS_CHALLENGES)[number];

export const CHALLENGE_PROMPTS: Record<LivenessChallenge, string> = {
  blink: "Blink your eyes",
  turn_left: "Turn your head slowly to your left",
  turn_right: "Turn your head slowly to your right",
  smile: "Smile",
  nod: "Nod your head up and down",
};

export const CHALLENGE_HINTS: Record<LivenessChallenge, string> = {
  blink: "Look at the camera and blink naturally, twice if needed.",
  turn_left: "Turn until your ear is almost facing the camera, then come back to centre.",
  turn_right: "Turn until your ear is almost facing the camera, then come back to centre.",
  smile: "Give a clear, wide smile and hold it for a moment.",
  nod: "Move your chin down towards your chest, then back up.",
};

export function challengePrompt(challenge: string): string {
  return (CHALLENGE_PROMPTS as Record<string, string>)[challenge] ??
    "Follow the instruction on screen";
}

// ---------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------

export interface TranscriptLike {
  mode?: string;
  entries?: { challenge: string; completed: boolean; duration_ms: number }[];
  antispoof_score?: number | null;
  liveness_score?: number | null;
}

/** One-line-per-fact summary of a stored liveness transcript for
 *  the review queue — the reviewer sees what the machine observed
 *  before they compare the photos themselves. */
export function summariseTranscript(liveness: unknown): string[] {
  const t = (liveness ?? {}) as TranscriptLike;
  if (t.mode === "manual") {
    return ["Manual photo submission — no camera movement check was run."];
  }
  if (t.mode !== "live" || !Array.isArray(t.entries)) {
    return ["No movement-check transcript was recorded."];
  }
  const lines = t.entries.map(
    (e) =>
      `${challengePrompt(e.challenge)} — ${e.completed ? "completed" : "NOT completed"} in ${(e.duration_ms / 1000).toFixed(1)}s`,
  );
  if (typeof t.antispoof_score === "number") {
    lines.push(`Anti-spoof score: ${t.antispoof_score.toFixed(2)}`);
  }
  if (typeof t.liveness_score === "number") {
    lines.push(`Liveness model score: ${t.liveness_score.toFixed(2)}`);
  }
  return lines;
}

export interface DedupeLike {
  checked?: number;
  hits?: { user_id: string; score: number }[];
}

export function dedupeSummary(dedupe: unknown): string {
  const d = (dedupe ?? {}) as DedupeLike;
  const hits = Array.isArray(d.hits) ? d.hits : [];
  if (hits.length === 0) {
    return `No duplicate face found across ${d.checked ?? 0} enrolled face(s).`;
  }
  return `Possible duplicate: this face matches ${hits.length} other enrolled account(s) — strongest score ${Math.max(...hits.map((h) => h.score)).toFixed(2)}.`;
}

/** Format a stored cosine score for a reviewer; scores are evidence
 *  for admins only and are never shown to the submitting user. */
export function formatMatchScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "No score (manual submission)";
  return Number(score).toFixed(2);
}
