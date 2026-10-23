// identityService: the client path into the verify-identity edge
// function (in-house face verification) and the identity-evidence
// bucket. Modelled on src/services/p2pService.ts: every edge failure
// is unwrapped from the invoke error's response body and passed
// through toUserFacingError, so the user only ever sees crafted
// plain language, never a raw system response (the CEO's
// error-presentation rule).

import { supabase } from "@/integrations/supabase/client";
import { toUserFacingError } from "@/utils/userFacingError";

export const IDENTITY_BUCKET = "identity-evidence";

// ---------------------------------------------------------------------
// Types (mirror the edge function's response shapes)
// ---------------------------------------------------------------------

export interface IdentityVerificationSummary {
  id: string;
  status: string;
  document_type: string | null;
  created_at: string;
  decided_at: string | null;
  reviewer_notes: string | null;
}

export interface IdentityStatusResponse {
  success: boolean;
  enabled: boolean;
  face_verified: boolean;
  has_enrollment: boolean;
  verification: IdentityVerificationSummary | null;
}

export interface LivenessSession {
  session_id: string;
  challenges: string[];
  expires_at: string;
}

export interface SubmitResult {
  verification_id: string;
  status: string;
  reason: string;
}

export interface AdminReviewItem {
  id: string;
  user_id: string;
  user_email: string | null;
  status: string;
  document_type: string;
  match_score: number | null;
  dedupe: { checked: number; hits: { user_id: string; score: number }[] } | null;
  liveness: unknown;
  consent_given_at: string | null;
  created_at: string;
  document_front_url: string | null;
  document_back_url: string | null;
  selfie_url: string | null;
}

// ---------------------------------------------------------------------
// Edge action caller (the p2pService pattern)
// ---------------------------------------------------------------------

export class IdentityActionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "IdentityActionError";
    this.code = code;
  }
}

async function errorFromInvoke(
  error: unknown,
  fallback: string,
): Promise<IdentityActionError> {
  let message: string | null = null;
  let code: string | undefined;
  const context = (error as { context?: unknown })?.context as
    | { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> }
    | undefined;
  if (context && (typeof context.json === "function" || typeof context.clone === "function")) {
    try {
      const readable =
        typeof context.clone === "function" ? context.clone() : context;
      const payload = (await readable.json!()) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
      } | null;
      if (payload && typeof payload === "object") {
        if (typeof payload.error === "string" && payload.error.trim()) {
          message = payload.error;
        } else if (typeof payload.message === "string" && payload.message.trim()) {
          message = payload.message;
        }
        if (typeof payload.code === "string") code = payload.code;
      }
    } catch {
      // Body unreadable — fall through to the generic message.
    }
  }
  if (!message && error instanceof Error && error.message) {
    message = error.message;
  }
  return new IdentityActionError(toUserFacingError(message ?? fallback, fallback), code);
}

export async function identityAction<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
  fallback = "Something went wrong. Please try again.",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("verify-identity", {
    body: { action, ...body },
  });
  if (error) throw await errorFromInvoke(error, fallback);
  if (data && typeof data === "object" && (data as { success?: unknown }).success === false) {
    const d = data as { message?: string; error?: string; code?: string };
    throw new IdentityActionError(
      toUserFacingError(d.error ?? d.message ?? fallback, fallback),
      d.code,
    );
  }
  return data as T;
}

// ---------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------

export async function startIdentitySession(): Promise<LivenessSession> {
  return identityAction<LivenessSession>(
    "start_session",
    {},
    "We could not start the verification. Please try again.",
  );
}

export async function fetchMyIdentityStatus(): Promise<IdentityStatusResponse> {
  return identityAction<IdentityStatusResponse>(
    "get_status",
    {},
    "We couldn't load your verification status. Please try again.",
  );
}

export interface SubmitVerificationInput {
  sessionId: string;
  documentType: string;
  documentFrontPath: string;
  documentBackPath: string | null;
  selfiePath: string;
  mode: "live" | "manual";
  selfieEmbedding: number[] | null;
  documentEmbedding: number[] | null;
  /** Informational only: the server IGNORES any client-claimed
   *  model version and pins its own (audit V6). Kept in the payload
   *  so a future server-side inference service can see what the
   *  client ran. */
  modelVersion: string | null;
  liveness: unknown;
  consentTextVersion: string;
}

export async function submitVerification(
  input: SubmitVerificationInput,
): Promise<SubmitResult> {
  return identityAction<SubmitResult>(
    "submit",
    {
      session_id: input.sessionId,
      document_type: input.documentType,
      document_front_path: input.documentFrontPath,
      document_back_path: input.documentBackPath,
      selfie_path: input.selfiePath,
      mode: input.mode,
      selfie_embedding: input.selfieEmbedding,
      document_embedding: input.documentEmbedding,
      model_version: input.modelVersion,
      liveness: input.liveness,
      consent: true,
      consent_text_version: input.consentTextVersion,
    },
    "Your verification could not be submitted. Please try again.",
  );
}

// ---------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------

export async function fetchIdentityReviewQueue(): Promise<AdminReviewItem[]> {
  const res = await identityAction<{ items: AdminReviewItem[] }>(
    "admin_list",
    {},
    "The review queue could not be loaded. Please try again.",
  );
  return res.items ?? [];
}

export async function decideIdentityVerification(
  verificationId: string,
  decision: "approve" | "reject",
  notes: string,
): Promise<{ status: string }> {
  return identityAction<{ status: string }>(
    "admin_decide",
    { verification_id: verificationId, decision, notes },
    "The decision could not be saved. Please try again.",
  );
}

/** Erasure (admin): permanently delete a user's biometric artefacts
 *  — evidence files, pending embeddings, enrolment — and tombstone
 *  their verification rows. Server-enforced separation of duties:
 *  an admin cannot erase their own account. */
export async function eraseIdentityData(
  userId: string,
): Promise<{ erased_verifications: number; erased_files: number }> {
  return identityAction<{ erased_verifications: number; erased_files: number }>(
    "admin_erase",
    { user_id: userId },
    "The erasure could not be completed. Please try again.",
  );
}

// ---------------------------------------------------------------------
// Uploads (identity-evidence bucket; paths pinned <user_id>/<kind>-<ts>)
// ---------------------------------------------------------------------

function safeExtension(file: File | Blob, fallback = "jpg"): string {
  const name = (file as File).name ?? "";
  const fromName = name.includes(".") ? name.split(".").pop() : undefined;
  const ext = (fromName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 5) return ext;
  if (file.type === "image/png") return "png";
  if (file.type === "application/pdf") return "pdf";
  return fallback;
}

/** Upload one verification photo under the caller's own folder and
 *  return its storage path (the only thing the submit call needs).
 *  Upload failures are crafted: the flow can always fall back to a
 *  retry or a manual-review submission. */
export async function uploadIdentityFile(
  file: File | Blob,
  userId: string,
  kind: "document-front" | "document-back" | "selfie",
): Promise<string> {
  // Client-side sanity ONLY (UX): the bucket's own size limit and
  // mime allowlist are the enforcement; this just fails fast with a
  // plain message instead of a storage error after a long upload.
  const MAX_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new IdentityActionError(
      "That photo is larger than 10 MB. Please use a smaller photo and try again.",
    );
  }
  if (
    file.type &&
    !file.type.startsWith("image/") &&
    file.type !== "application/pdf"
  ) {
    throw new IdentityActionError(
      "That file is not a photo. Please choose an image of your document or selfie.",
    );
  }
  const path = `${userId}/${kind}-${Date.now()}.${safeExtension(file)}`;
  const { error } = await supabase.storage
    .from(IDENTITY_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
  if (error) {
    throw new IdentityActionError(
      "A photo could not be uploaded. Check your connection and try again — nothing has been submitted yet.",
    );
  }
  return path;
}
