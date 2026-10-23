// verify-identity: the single client path into the in-house identity
// + face verification system (migration
// 20261031_identity_face_verification.sql; design note:
// docs/face-verification.md).
//
//   POST { action, ... } with a user JWT → identity verified from the
//   JWT via the request client → all DB work runs through the
//   dedicated service-role client (identity_verifications writes,
//   face_enrollments, liveness sessions and pending embeddings have
//   no client write path at all — templates never transit
//   PostgREST). The actor id ALWAYS comes from the JWT; the pure
//   decision logic lives in _shared/identity-core.ts.
//
// Actions:
//   start_session  → issues a single-use liveness session: 3 random
//                    challenges (blink / turn_left / turn_right /
//                    smile / nod), 5-minute expiry. Refused while
//                    platform_settings.face_verification_enabled is
//                    false (the p2p kill-switch posture: new entries
//                    pause, in-flight work always completes).
//   submit         → counts the attempt (fail-closed), validates
//                    the payload + session, verifies every referenced
//                    evidence object actually exists in the caller's
//                    own bucket folder, consumes the session, and
//                    records the verification in the HUMAN REVIEW
//                    queue. The client-computed match score and
//                    dedupe scan annotate the review item as decision
//                    support only — no submission is ever
//                    auto-verified in this build (delta audit
//                    V1/V2), and no face is enrolled at submit time.
//   get_status     → the caller's latest verification + whether a
//                    face is enrolled + the feature switch.
//   admin_list     → (admin) the review queue with signed photo URLs.
//   admin_decide   → (admin) approve (enrols the stored pending
//                    embedding AFTER winning a status-guarded claim
//                    on the row) or reject, with notes. An admin can
//                    never decide their own verification.
//   admin_erase    → (admin) the erasure path: deletes the subject's
//                    evidence files, pending embeddings and enrolment,
//                    and tombstones their verification rows. An admin
//                    cannot erase their own account either.
//
// SAFETY POSTURE (docs/face-verification.md, "Safety model"):
//   * Biometrics move only through this service-role function and
//     the private identity-evidence bucket — never through client-
//     readable tables, logs, or URLs. Server logs carry error CODES
//     only, never row contents, paths, scores, or embeddings.
//   * Every start, submission (decided OR refused), decision and
//     erasure writes an identity_audit_log row.
//   * Submissions are rationed per user per 24h (identity-core:
//     MAX_SUBMISSIONS_PER_24H) as an anti-brute-force control.
//   * Fail closed: a submission that cannot be finalised cleanly
//     lands in human review, never in a half-decided state.
//
// Every error is crafted plain language with a machine code — never
// raw system text (the platform's error-presentation rule).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getServiceRoleClient,
  getSupabaseClient,
} from "../_shared/supabase-client.ts";
import {
  canAdminDecide,
  cosineSimilarity,
  decideVerification,
  drawChallenges,
  findDedupeHits,
  isSelfDecision,
  isUuid,
  MAX_SESSIONS_PER_HOUR,
  MAX_SUBMISSIONS_PER_24H,
  MODEL_VERSION,
  normaliseEmbedding,
  sessionAllowed,
  statusAfterAdminDecision,
  submissionAllowed,
  validateSession,
  validateSubmitPayload,
  validateTranscript,
  SESSION_TTL_MS,
} from "../_shared/identity-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, code: string, error: string) {
  return json(status, { success: false, code, error });
}

const PAUSED_MESSAGE =
  "Face verification is not open yet. We will let you know as soon as it launches.";

// ---------------------------------------------------------------------
// Small service-role helpers (mirroring the p2p function's)
// ---------------------------------------------------------------------

async function isAdmin(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

async function faceVerificationEnabled(admin: any): Promise<boolean> {
  const { data } = await admin
    .from("platform_settings")
    .select("face_verification_enabled")
    .limit(1)
    .maybeSingle();
  return data?.face_verification_enabled === true;
}

/** CSPRNG in [0, 1) for challenge drawing — Math.random is never
 *  used for anything security-relevant in this function. */
function secureRandom01(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

/** Server logs carry the error CODE only — never the error object,
 *  whose details could echo row contents, paths, or constraint
 *  values back into log storage. */
function logErr(label: string, e: unknown) {
  const code = (e as { code?: unknown } | null)?.code;
  console.error(label, typeof code === "string" ? code : "db_error");
}

/** Best-effort audit write (identity_audit_log). Detail payloads are
 *  machine codes and counts only — never biometrics. A failed audit
 *  write is logged by code and never changes the caller's outcome:
 *  the fail-closed behaviour lives in the decision logic itself. */
async function writeAudit(
  admin: any,
  entry: {
    userId: string;
    actorId: string;
    action: string;
    outcome: string;
    detail?: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("identity_audit_log").insert({
    user_id: entry.userId,
    actor_id: entry.actorId,
    action: entry.action,
    outcome: entry.outcome,
    detail: entry.detail ?? {},
  });
  if (error) logErr("verify-identity: audit write failed:", error);
}

// ---------------------------------------------------------------------
// start_session
// ---------------------------------------------------------------------

async function handleStartSession(admin: any, user: any) {
  if (!(await faceVerificationEnabled(admin))) {
    return fail(503, "face_verification_paused", PAUSED_MESSAGE);
  }
  // Session ration, fail-closed (audit V5): fresh challenge sets
  // are probe material, so issuance is capped per user per hour.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentSessions, error: sessionCountError } = await admin
    .from("identity_liveness_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", hourAgo);
  if (sessionCountError) {
    logErr("verify-identity: session count failed:", sessionCountError);
    return fail(
      500,
      "session_create_failed",
      "We could not start the verification. Please try again.",
    );
  }
  if (!sessionAllowed(recentSessions ?? 0)) {
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "session_started",
      outcome: "rate_limited",
      detail: { sessions_1h: recentSessions ?? 0 },
    });
    return fail(
      429,
      "session_rate_limited",
      "You've started a lot of verification sessions in the last hour. Please wait a little and try again.",
    );
  }
  const challenges = drawChallenges(secureRandom01);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("identity_liveness_sessions")
    .insert({
      user_id: user.id,
      challenges,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) {
    logErr("verify-identity: session insert failed:", error);
    return fail(
      500,
      "session_create_failed",
      "We could not start the verification. Please try again.",
    );
  }
  await writeAudit(admin, {
    userId: user.id,
    actorId: user.id,
    action: "session_started",
    outcome: "ok",
    detail: { challenge_count: challenges.length },
  });
  return json(200, {
    success: true,
    session_id: data.id,
    challenges,
    expires_at: expiresAt,
  });
}

// ---------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------

async function handleSubmit(admin: any, user: any, body: any) {
  // -- Attempt ration FIRST, fail-closed (audit V5). The count comes
  // from identity_audit_log 'submit_attempt' rows; this attempt's
  // own row is written BEFORE payload validation, so malformed and
  // refused attempts count exactly like decided ones. A count error
  // refuses the submission — the ration never fails open.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: priorAttempts, error: countError } = await admin
    .from("identity_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("action", "submit_attempt")
    .gte("created_at", dayAgo);
  if (countError) {
    logErr("verify-identity: attempt count failed:", countError);
    return fail(
      500,
      "submit_failed",
      "Your verification could not be submitted. Please try again.",
    );
  }
  if (!submissionAllowed(priorAttempts ?? 0)) {
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "submit_rejected",
      outcome: "attempt_limit",
      detail: { attempts_24h: priorAttempts ?? 0 },
    });
    return fail(
      429,
      "attempt_limit",
      `You've reached the limit of ${MAX_SUBMISSIONS_PER_24H} verification attempts in 24 hours. Please wait until tomorrow and try again — this limit protects your account from automated guessing.`,
    );
  }
  const { error: attemptError } = await admin
    .from("identity_audit_log")
    .insert({
      user_id: user.id,
      actor_id: user.id,
      action: "submit_attempt",
      outcome: "received",
      detail: {},
    });
  if (attemptError) {
    // The audit trail is part of the control: if the attempt cannot
    // be recorded, the submission does not proceed.
    logErr("verify-identity: attempt write failed:", attemptError);
    return fail(
      500,
      "submit_failed",
      "Your verification could not be submitted. Please try again.",
    );
  }

  const validated = validateSubmitPayload(body ?? {}, user.id);
  if (!validated.ok) {
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "submit_rejected",
      outcome: validated.code,
    });
    return fail(400, validated.code, validated.error);
  }
  const payload = validated.value;

  const { data: session } = await admin
    .from("identity_liveness_sessions")
    .select("id, user_id, challenges, expires_at, used_at")
    .eq("id", payload.sessionId)
    .maybeSingle();
  const sessionCheck = validateSession(session, user.id, Date.now());
  if (!sessionCheck.ok) {
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "submit_rejected",
      outcome: sessionCheck.code,
    });
    return fail(400, sessionCheck.code, sessionCheck.error);
  }

  // Evidence existence (audit V1): the referenced objects must
  // ACTUALLY exist in identity-evidence under the caller's own
  // folder — a path string alone proves nothing. Checked before the
  // session is consumed, so an upload problem doesn't burn it.
  const referencedPaths = [
    payload.documentFrontPath,
    payload.selfiePath,
    ...(payload.documentBackPath ? [payload.documentBackPath] : []),
  ];
  for (const path of referencedPaths) {
    const basename = path.split("/").pop() as string;
    const { data: found, error: listError } = await admin.storage
      .from("identity-evidence")
      .list(user.id, { search: basename, limit: 10 });
    const exists =
      !listError &&
      (found ?? []).some((o: any) => o.name === basename);
    if (!exists) {
      await writeAudit(admin, {
        userId: user.id,
        actorId: user.id,
        action: "submit_rejected",
        outcome: "evidence_missing",
      });
      return fail(
        400,
        "evidence_missing",
        "One of your photos could not be found in secure storage. Please upload the photos again and resubmit.",
      );
    }
  }

  // Consume the session BEFORE any assessment work, atomically: a
  // session can never be replayed, even if the rest of the submit
  // fails partway.
  const { data: consumed } = await admin
    .from("identity_liveness_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("id", payload.sessionId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "submit_rejected",
      outcome: "session_used",
    });
    return fail(
      400,
      "session_used",
      "That verification session has already been used. Please start again.",
    );
  }

  // Assessment (decision SUPPORT for the human reviewer — audit
  // V1/V2: client-computed embeddings and a client-attested
  // transcript can annotate a review item; they can never approve
  // it). A bad transcript is recorded as the assessment, not a
  // refusal: the photos still go in front of the reviewer.
  let livenessOk = true;
  if (payload.mode === "live") {
    const t = validateTranscript(payload.liveness, session.challenges);
    livenessOk = t.ok;
  }

  const matchScore =
    payload.selfieEmbedding && payload.documentEmbedding
      ? cosineSimilarity(payload.selfieEmbedding, payload.documentEmbedding)
      : null;

  // Dedupe: the selfie against every other enrolled face OF THE
  // PINNED MODEL VERSION (audit V6). Skipped other-version rows are
  // counted for the audit trail.
  let dedupeScan = { hits: [] as { user_id: string; score: number }[], checked: 0, skippedOtherVersion: 0 };
  if (payload.selfieEmbedding) {
    const { data: enrollments } = await admin
      .from("face_enrollments")
      .select("user_id, embedding, model_version");
    dedupeScan = findDedupeHits(
      payload.selfieEmbedding,
      (enrollments ?? []) as {
        user_id: string;
        embedding: number[];
        model_version: string | null;
      }[],
      user.id,
    );
  }

  const decision = decideVerification({
    mode: payload.mode,
    livenessOk,
    matchScore,
    dedupeHits: dedupeScan.hits,
  });

  const nowIso = new Date().toISOString();
  const { data: row, error: insertError } = await admin
    .from("identity_verifications")
    .insert({
      user_id: user.id,
      // Every submission lands in human review in this build.
      status: decision.status,
      document_type: payload.documentType,
      document_front_path: payload.documentFrontPath,
      document_back_path: payload.documentBackPath,
      selfie_path: payload.selfiePath,
      liveness: payload.liveness,
      match_score:
        matchScore === null ? null : Math.round(matchScore * 100000) / 100000,
      dedupe: { checked: dedupeScan.checked, hits: dedupeScan.hits },
      consent_given_at: nowIso,
      consent_text_version: payload.consentTextVersion,
    })
    .select("id")
    .single();
  if (insertError) {
    logErr("verify-identity: verification insert failed:", insertError);
    await writeAudit(admin, {
      userId: user.id,
      actorId: user.id,
      action: "submit_rejected",
      outcome: "insert_failed",
    });
    return fail(
      500,
      "submit_failed",
      "Your verification could not be saved. Please try again.",
    );
  }
  const verificationId = row.id as string;

  // The pending embedding lives in its own service-role-only table
  // so an admin approval can still enrol this face. It is labelled
  // with the SERVER-PINNED model version — never a client claim.
  if (payload.selfieEmbedding) {
    const normalised = normaliseEmbedding(payload.selfieEmbedding);
    if (normalised) {
      const { error: embError } = await admin
        .from("identity_verification_embeddings")
        .insert({
          verification_id: verificationId,
          user_id: user.id,
          embedding: normalised,
          model_version: MODEL_VERSION,
        });
      if (embError) {
        // Not fatal to the review (the reviewer works from the
        // photos), but an approval then cannot enrol a template —
        // recorded in the audit trail, code only.
        logErr("verify-identity: embedding insert failed:", embError);
        await writeAudit(admin, {
          userId: user.id,
          actorId: user.id,
          action: "submit_finalize_failed",
          outcome: "embedding_store_failed",
          detail: { verification_id: verificationId },
        });
      }
    }
  }

  await writeAudit(admin, {
    userId: user.id,
    actorId: user.id,
    action: "submit_decided",
    outcome: decision.status,
    detail: {
      reason: decision.reason,
      mode: payload.mode,
      dedupe_hits: dedupeScan.hits.length,
      dedupe_skipped_other_version: dedupeScan.skippedOtherVersion,
    },
  });

  // The submitting user learns the outcome and the reason CATEGORY
  // only — never the score, and never who a dedupe hit matched.
  return json(200, {
    success: true,
    verification_id: verificationId,
    status: decision.status,
    reason: decision.reason,
  });
}

// ---------------------------------------------------------------------
// get_status
// ---------------------------------------------------------------------

async function handleGetStatus(admin: any, user: any) {
  const enabled = await faceVerificationEnabled(admin);
  const { data: latest } = await admin
    .from("identity_verifications")
    .select(
      "id, status, document_type, created_at, decided_at, reviewer_notes",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: enrollment } = await admin
    .from("face_enrollments")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const status = (latest?.status as string | undefined) ?? null;
  return json(200, {
    success: true,
    enabled,
    face_verified: status === "auto_verified" || status === "approved",
    has_enrollment: !!enrollment,
    verification: latest
      ? {
          id: latest.id,
          status: latest.status,
          document_type: latest.document_type,
          created_at: latest.created_at,
          decided_at: latest.decided_at,
          // Reviewer notes are the user's explanation when rejected;
          // the match score is deliberately not returned to users.
          reviewer_notes:
            latest.status === "rejected" ? latest.reviewer_notes : null,
        }
      : null,
  });
}

// ---------------------------------------------------------------------
// Admin: review queue + decision
// ---------------------------------------------------------------------

async function signedUrl(admin: any, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await admin.storage
    .from("identity-evidence")
    .createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

async function handleAdminList(admin: any, user: any) {
  if (!(await isAdmin(admin, user.id))) {
    return fail(
      403,
      "forbidden",
      "You don't have permission to do that.",
    );
  }
  const { data: rows, error } = await admin
    .from("identity_verifications")
    .select(
      "id, user_id, status, document_type, document_front_path, document_back_path, selfie_path, liveness, match_score, dedupe, consent_given_at, created_at",
    )
    .eq("status", "review")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    logErr("verify-identity: admin list failed:", error);
    return fail(
      500,
      "list_failed",
      "The review queue could not be loaded. Please try again.",
    );
  }
  const items = [];
  for (const r of rows ?? []) {
    // Best-effort account email so the reviewer can identify whose
    // verification this is; the user id alone is a poor label. A
    // lookup failure degrades to null, never to a failed queue.
    let userEmail: string | null = null;
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(r.user_id);
      userEmail = authUser?.user?.email ?? null;
    } catch {
      userEmail = null;
    }
    items.push({
      id: r.id,
      user_id: r.user_id,
      user_email: userEmail,
      status: r.status,
      document_type: r.document_type,
      match_score: r.match_score,
      dedupe: r.dedupe,
      liveness: r.liveness,
      consent_given_at: r.consent_given_at,
      created_at: r.created_at,
      document_front_url: await signedUrl(admin, r.document_front_path),
      document_back_url: await signedUrl(admin, r.document_back_path),
      selfie_url: await signedUrl(admin, r.selfie_path),
    });
  }
  return json(200, { success: true, items });
}

async function handleAdminDecide(admin: any, user: any, body: any) {
  if (!(await isAdmin(admin, user.id))) {
    return fail(
      403,
      "forbidden",
      "You don't have permission to do that.",
    );
  }
  const verificationId = body?.verification_id;
  if (!isUuid(verificationId)) {
    return fail(400, "id_invalid", "That verification could not be found.");
  }
  const next = statusAfterAdminDecision(String(body?.decision ?? ""));
  if (!next) {
    return fail(
      400,
      "decision_invalid",
      "Choose approve or reject for this verification.",
    );
  }
  const notes =
    typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
  if (next === "rejected" && notes.length === 0) {
    return fail(
      400,
      "notes_required",
      "Add a short note explaining the rejection — the user will see it.",
    );
  }

  const { data: row } = await admin
    .from("identity_verifications")
    .select("id, user_id, status")
    .eq("id", verificationId)
    .maybeSingle();
  if (!row) {
    return fail(404, "not_found", "That verification could not be found.");
  }
  // Separation of duties: a reviewer never decides their own
  // verification, and the block itself is audited.
  if (isSelfDecision(user.id, row.user_id)) {
    await writeAudit(admin, {
      userId: row.user_id,
      actorId: user.id,
      action: "admin_decision_blocked",
      outcome: "self_decision",
      detail: { verification_id: verificationId },
    });
    return fail(
      403,
      "self_decision",
      "You can't decide your own verification. Ask another admin to review it.",
    );
  }
  if (!canAdminDecide(row.status)) {
    return fail(
      409,
      "already_decided",
      "This verification has already been decided.",
    );
  }

  // Claim the decision with a SINGLE status-guarded update (audit
  // V4): exactly one decider can win the 'review' -> decided
  // transition. Enrolment happens only AFTER the claim is won, so a
  // losing racer can never leave a template enrolled behind a
  // rejected (or someone else's) decision.
  const nowIso = new Date().toISOString();
  const { data: claimed } = await admin
    .from("identity_verifications")
    .update({
      status: next,
      reviewer_id: user.id,
      reviewer_notes: notes || null,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", verificationId)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    await writeAudit(admin, {
      userId: row.user_id,
      actorId: user.id,
      action: "admin_decision",
      outcome: "already_decided",
      detail: { verification_id: verificationId },
    });
    return fail(
      409,
      "already_decided",
      "This verification has already been decided.",
    );
  }

  if (next === "approved") {
    // Enrol the face from the pending embedding captured at submit
    // (manual submissions have none — approval then rests on the
    // photos the reviewer compared, and no template is stored).
    // Only a template of the pinned model version may enrol.
    const { data: pending } = await admin
      .from("identity_verification_embeddings")
      .select("embedding, model_version")
      .eq("verification_id", verificationId)
      .maybeSingle();
    if (pending?.embedding && pending.model_version === MODEL_VERSION) {
      const { error: enrolError } = await admin
        .from("face_enrollments")
        .upsert(
          {
            user_id: row.user_id,
            embedding: pending.embedding,
            model_version: MODEL_VERSION,
            verification_id: verificationId,
            updated_at: nowIso,
          },
          { onConflict: "user_id" },
        );
      if (enrolError) {
        logErr("verify-identity: decide enrol failed:", enrolError);
        // Compensate: hand the claim back to the review queue so
        // the item stays decidable — an approved-but-unenrolled
        // verification must never be the resting state. (The
        // upsert is atomic, so a failed enrol wrote nothing.)
        const { error: revertError } = await admin
          .from("identity_verifications")
          .update({
            status: "review",
            reviewer_id: null,
            reviewer_notes: null,
            decided_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", verificationId)
          .eq("status", "approved")
          .eq("reviewer_id", user.id);
        await writeAudit(admin, {
          userId: row.user_id,
          actorId: user.id,
          action: "admin_decision",
          outcome: revertError ? "compensation_failed" : "decide_failed",
          detail: { verification_id: verificationId, stage: "enrol" },
        });
        return fail(
          500,
          "decide_failed",
          "The decision could not be saved. Please try again.",
        );
      }
    } else if (pending?.embedding) {
      // A pending template of a foreign model version never enrols.
      await writeAudit(admin, {
        userId: row.user_id,
        actorId: user.id,
        action: "admin_decision",
        outcome: "enrol_skipped_other_version",
        detail: { verification_id: verificationId },
      });
    }
  }

  await writeAudit(admin, {
    userId: row.user_id,
    actorId: user.id,
    action: "admin_decision",
    outcome: next,
    detail: { verification_id: verificationId },
  });
  return json(200, { success: true, status: next });
}

// ---------------------------------------------------------------------
// Admin: erasure (consent withdrawal / data-subject request)
// ---------------------------------------------------------------------
//
// Deletes EVERY biometric artefact for the target user — evidence
// files in the bucket, pending embeddings, and the enrolment — and
// tombstones their verification rows (status 'erased', artefact
// fields nulled; consent proof and timestamps remain so the audit
// anchor survives). Fail-closed ordering: files first, and any
// failure aborts before further deletion with an audited 'failed'
// outcome — an erasure is never reported that did not happen.
// An admin cannot erase their OWN account (separation of duties);
// another admin runs it.

async function handleAdminErase(admin: any, user: any, body: any) {
  if (!(await isAdmin(admin, user.id))) {
    return fail(
      403,
      "forbidden",
      "You don't have permission to do that.",
    );
  }
  const targetUserId = body?.user_id;
  if (!isUuid(targetUserId)) {
    return fail(400, "id_invalid", "That account could not be found.");
  }
  if (isSelfDecision(user.id, targetUserId)) {
    await writeAudit(admin, {
      userId: targetUserId,
      actorId: user.id,
      action: "admin_decision_blocked",
      outcome: "self_erasure",
    });
    return fail(
      403,
      "self_erasure",
      "You can't erase your own account's verification data. Ask another admin to run the erasure.",
    );
  }

  const { data: rows, error: loadError } = await admin
    .from("identity_verifications")
    .select("id, document_front_path, document_back_path, selfie_path")
    .eq("user_id", targetUserId);
  if (loadError) {
    logErr("verify-identity: erase load failed:", loadError);
    return fail(
      500,
      "erase_failed",
      "The erasure could not be completed. Nothing was deleted — please try again.",
    );
  }
  const verificationIds = (rows ?? []).map((r: any) => r.id as string);
  const paths = Array.from(
    new Set(
      (rows ?? []).flatMap((r: any) =>
        [r.document_front_path, r.document_back_path, r.selfie_path].filter(
          (p): p is string => typeof p === "string" && p.length > 0,
        ),
      ),
    ),
  );

  const eraseFailed = async (stage: string) => {
    await writeAudit(admin, {
      userId: targetUserId,
      actorId: user.id,
      action: "erasure",
      outcome: "failed",
      detail: { stage },
    });
    return fail(
      500,
      "erase_failed",
      "The erasure could not be completed. Please try again — if it keeps failing, escalate before telling the user it is done.",
    );
  };

  if (paths.length > 0) {
    const { error: removeError } = await admin.storage
      .from("identity-evidence")
      .remove(paths);
    if (removeError) {
      logErr("verify-identity: erase storage failed:", removeError);
      return eraseFailed("storage");
    }
  }
  if (verificationIds.length > 0) {
    const { error: embError } = await admin
      .from("identity_verification_embeddings")
      .delete()
      .in("verification_id", verificationIds);
    if (embError) {
      logErr("verify-identity: erase embeddings failed:", embError);
      return eraseFailed("embeddings");
    }
  }
  const { error: enrolError } = await admin
    .from("face_enrollments")
    .delete()
    .eq("user_id", targetUserId);
  if (enrolError) {
    logErr("verify-identity: erase enrollment failed:", enrolError);
    return eraseFailed("enrollment");
  }
  if (verificationIds.length > 0) {
    const nowIso = new Date().toISOString();
    const { error: tombstoneError } = await admin
      .from("identity_verifications")
      .update({
        status: "erased",
        document_front_path: null,
        document_back_path: null,
        selfie_path: null,
        liveness: {},
        match_score: null,
        dedupe: {},
        reviewer_notes: "Biometric data erased on request.",
        decided_at: nowIso,
        updated_at: nowIso,
      })
      .in("id", verificationIds);
    if (tombstoneError) {
      logErr("verify-identity: erase tombstone failed:", tombstoneError);
      return eraseFailed("tombstone");
    }
  }

  await writeAudit(admin, {
    userId: targetUserId,
    actorId: user.id,
    action: "erasure",
    outcome: "completed",
    detail: {
      verifications: verificationIds.length,
      files: paths.length,
    },
  });
  return json(200, {
    success: true,
    erased_verifications: verificationIds.length,
    erased_files: paths.length,
  });
}

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

const ACTIONS = [
  "start_session",
  "submit",
  "get_status",
  "admin_list",
  "admin_decide",
  "admin_erase",
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    if (!action || !(ACTIONS as readonly string[]).includes(action)) {
      return fail(400, "unknown_action", `Unknown action: ${action}`);
    }

    const admin = getServiceRoleClient();

    // Identity: verified from the JWT via the request client. All DB
    // work then runs through the service-role client (see header).
    const requestClient = getSupabaseClient(req);
    const token = (req.headers.get("Authorization") || "").replace(
      "Bearer ",
      "",
    );
    const {
      data: { user },
      error: authError,
    } = await requestClient.auth.getUser(token);
    if (authError || !user) {
      return fail(
        401,
        "not_signed_in",
        "Your session has expired. Please sign in again to continue.",
      );
    }

    switch (action) {
      case "start_session":
        return handleStartSession(admin, user);
      case "submit":
        return handleSubmit(admin, user, body);
      case "get_status":
        return handleGetStatus(admin, user);
      case "admin_list":
        return handleAdminList(admin, user);
      case "admin_decide":
        return handleAdminDecide(admin, user, body);
      case "admin_erase":
        return handleAdminErase(admin, user, body);
      default:
        return fail(400, "unknown_action", `Unknown action: ${action}`);
    }
  } catch (e) {
    // Unexpected failures are logged server-side (error NAME only —
    // messages can embed request data) and answered with the generic
    // crafted message: raw system text never reaches the client.
    console.error(
      "verify-identity error:",
      e instanceof Error ? e.name : "unknown",
    );
    return fail(
      500,
      "internal",
      "Something went wrong on our side. Please try again.",
    );
  }
});
