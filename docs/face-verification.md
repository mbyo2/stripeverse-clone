# Face verification (in-house, "Sumsub-like") — design note

Branch: `feat/face-verification`. Status: built, **not deployed**, and
shipped dark — `platform_settings.face_verification_enabled` defaults
to `false`, and the `verify-identity` edge function refuses session
creation while it is off. Nothing in this build changes any existing
flow; tier gating on face verification is a deliberate follow-up (see
"Deliberately not in this build").

The CEO's purpose: face verification like Binance does for P2P — so
that if something goes wrong, **the fraudster's face is on record**,
matched to the identity document they presented, and the same face
cannot quietly verify a second account.

## Architecture

| Layer | Artefact |
| --- | --- |
| Migration | `supabase/migrations/20261031_identity_face_verification.sql` |
| Decision core | `supabase/functions/_shared/identity-core.ts` (pure, import-free, unit-tested byte-identically to what Deno runs) |
| Edge function | `supabase/functions/verify-identity/index.ts` (JWT dispatch, p2p/pos pattern; `verify_jwt = true` in `supabase/config.toml`) |
| Client engine | `src/lib/faceEngine.ts` (lazy dynamic import, `/verify-identity` only) |
| Client service/hooks | `src/services/identityService.ts`, `src/hooks/useIdentity.ts` |
| User page | `src/pages/VerifyIdentity.tsx` — route `/verify-identity` (ProtectedPage) |
| Admin page | `src/pages/AdminIdentity.tsx` — route `/admin/identity` (RoleGuardedPage, `admin`) |
| Surfaces | Face-verification card on `/p2p/profile`; "Identity Review" card on the admin dashboard |
| Proofs | `supabase/qa/identity_verification_proofs.sql` (honest header: what only post-deploy smoke can prove) |
| Tests | `tests/identity/identity-core.test.ts`, `tests/identity/identityUi.test.ts` |

### Data model

- `identity-evidence` — private storage bucket, 10 MiB, image mimes +
  PDF (SVG excluded by design). Policies: a user can INSERT and SELECT
  only under their own `<user_id>/` folder prefix; admins
  (`public.has_role(auth.uid(),'admin'::app_role)`) can SELECT all;
  **no UPDATE or DELETE policy for anyone** — evidence is immutable
  through the API; the only deletion path is the audited erasure
  action (service role).
- `identity_verifications` — one row per submission: status (see
  below), document type, storage paths, liveness transcript (jsonb),
  `match_score`, `dedupe` outcome (jsonb), consent timestamp +
  consent text version, reviewer fields, `decided_at`. RLS: users
  SELECT their own rows — **column-scoped** to the safe status
  columns only (`id, user_id, status, document_type, created_at,
  updated_at, decided_at, reviewer_notes`) so the owner can never
  read `dedupe`, `match_score` or `liveness` off their own row
  (audit V3: that was a dedupe oracle); admins SELECT all via the
  policy, with full-row reads in practice served by the edge
  function; **no client writes** — the edge function (service role)
  is the only writer.
- `identity_liveness_sessions` — server-issued challenge sets
  (3 challenges, 5-minute expiry, single-use `used_at`). RLS on,
  **no policies** — service-role only.
- `identity_verification_embeddings` — the selfie embedding captured
  with each submission, held apart from the readable verification row
  so an admin approval can still enrol the face. RLS on, no policies.
- `face_enrollments` — the face on record: one template per user,
  written only on auto-verification or admin approval. RLS on, no
  policies. Embeddings are `double precision[]` — no pgvector exists
  anywhere in this project's migrations, and cosine similarity is
  computed in TypeScript (`identity-core`), so no extension
  assumption is made.
- `identity_audit_log` — the safety audit trail (see Safety model).
  RLS on, no policies.
- `platform_settings.face_verification_enabled` — kill switch,
  ships `false`.

### Flow

1. **Consent** (`/verify-identity`, step 1): plain-language capture
   explanation (what is captured, why — fraud prevention and the face
   on record; one face per account; who can see it; withdrawal via
   support). The Continue button is gated on an explicit checkbox;
   the server refuses any submission without `consent: true` + a
   consent text version, and stamps `consent_given_at` +
   `consent_text_version` (`face-consent-v1`) on the row. Consent
   therefore precedes any capture step in the UI, and no submission
   can exist without it.
2. **Document** (step 2): type (national ID / passport / driving
   licence), front photo via camera (`getUserMedia`) or file upload,
   back optional.
3. **Liveness** (step 3): `start_session` returns 3 challenges drawn
   from `blink / turn_left / turn_right / smile / nod`. The page
   evaluates them live from face-mesh signals; a centred selfie is
   captured at the end. The client computes two embeddings with the
   face engine: selfie and document portrait.
4. **Submit**: photos upload to `identity-evidence/<user_id>/…`
   first; `submit` then carries only storage paths + embeddings +
   transcript. The server, in order: counts the attempt from the
   audit log and writes this attempt's row *before* validating
   anything (fail-closed ration); validates the payload and the
   session; **verifies every referenced evidence object actually
   exists** in the caller's own bucket folder (a path string alone
   proves nothing); consumes the session atomically; validates the
   transcript against the issued challenges (exact order,
   per-challenge duration ≥ 300 ms, within the session TTL); and
   computes the cosine match + dedupe scan as **decision support**.
   The row is written directly into the review queue.
5. **Outcome**: the user learns the outcome category only
   ("under review"). **No submission is ever auto-verified in this
   build** (delta security audit V1/V2, 2026-10-23): embeddings and
   the liveness transcript are computed/attested on the user's
   device, so they can annotate a review item but can never approve
   it. The trust anchor is the human reviewer comparing the actual
   selfie and document images side-by-side (signed URLs, 600 s),
   with the score, dedupe hits and transcript assessment as support.
   Approval enrols the stored pending embedding; rejection requires
   a **mandatory** note the user can read. Automatic approval
   returns only when embeddings are computed server-side from the
   stored images (future work).

### Status vocabulary

`pending` (transient, never a resting state) → `review` (the resting
state of every submission in this build) → `approved` / `rejected`
(admin decisions) / `erased` (erasure tombstone). `liveness_failed`
and `match_failed` survive in the vocabulary as **assessment
labels** in the audit trail and reviewer UI (the recorded reason a
review item needs attention), not as submit outcomes; `auto_verified`
is reserved for the future server-side-inference build and is never
written today.

### Assessment thresholds (`identity-core.ts`, named constants)

Cosine similarity on L2-normalised FaceRes embeddings. These bands
**triage** the review queue — they are the labels a reviewer sees
("assessed: clean pass / borderline / below floor / dedupe hit") —
they do not approve or reject anyone:

- `MATCH_AUTO_THRESHOLD = 0.62` — at or above: assessed a clean
  pass. Face-embedding same-person cosine scores for a decent
  capture typically sit at 0.7+; 0.62 keeps margin for
  phone-camera document photos while staying well clear of
  different-person scores (typically < 0.3). (The constant keeps its
  historical name; its role is now the strong-match band.)
- `MATCH_REVIEW_FLOOR = 0.42` — below: assessed a clear non-match,
  so the reviewer can reject quickly and confidently.
- `DEDUPE_THRESHOLD = 0.70` — stricter than the match band, because
  dedupe compares two live-quality enrolment selfies, not a document
  photo. A hit flags the review item as a possible duplicate
  account for the human; it never decides anything by itself.

### ML library choice

**`@vladmandic/human` 3.3.6** — the one package providing *both*
halves of the flow: face mesh + rotation + gestures (the library
itself emits blink / facing-left / facing-right / head-up / head-down
gestures, driving the challenges) *and* a face embedding
(`FaceResult.embedding`, FaceRes descriptor) for matching, plus
dedicated antispoof and liveness models whose scores ride along in
the transcript as reviewer evidence. MediaPipe Tasks Vision offers
landmarks/blendshapes but no embedding model (matching would need a
second library); face-api.js is unmaintained. The library loads by
dynamic import on `/verify-identity` only — no main-bundle cost.

## Safety model

Safety is the acceptance bar for this build (CEO direction,
2026-10-23). Each control below names where it is enforced.

1. **Biometric isolation.** Face templates live only in
   `face_enrollments` and `identity_verification_embeddings` — RLS
   on, zero client policies, zero client grants; they can never
   transit PostgREST. Photos live only in the private
   `identity-evidence` bucket under the owner's `<user_id>/` prefix.
   Admins see photos only through the `verify-identity` function's
   `admin_list`, which checks the admin role in `user_roles` first
   and then mints **600-second signed URLs**. No other user can ever
   receive another user's embedding, photo, or signed URL — every
   user action derives its actor from the JWT, never the payload
   (`identity-core` validates shapes only).
2. **Nothing biometric in logs, errors, or responses.** Server logs
   write error *codes* only (`logErr` in the edge function); the
   top-level catch logs the exception *name* only. Error responses
   are crafted `{ success: false, code, error }` plain language.
   `get_status` deliberately does not return the match score; the
   submit response carries only the verification id, the status and
   a reason category — a dedupe hit's identity and score are shown
   **only** to admins in the review queue, never to the subject.
   Audit `detail` payloads are codes and counts only.
3. **Anti-replay / anti-brute-force.** Challenge sets are drawn
   server-side from a CSPRNG (`crypto.getRandomValues`; never
   `Math.random`) — 3 distinct challenges, **5-minute expiry**,
   **single-use**, consumed atomically (`UPDATE … WHERE used_at IS
   NULL`) before any assessment work, so a session cannot be
   replayed even if the rest of the submit fails. The transcript
   must cover the issued challenges in the issued order with
   plausible timing. Submissions are rationed to
   **`MAX_SUBMISSIONS_PER_24H = 5`** per user (rolling 24 h), and
   session starts to **`MAX_SESSIONS_PER_HOUR = 30`** — both
   **fail-closed**: attempts are counted from `identity_audit_log`
   `submit_attempt` rows that are written *before* payload
   validation (malformed and refused attempts count exactly like
   decided ones), and a count-query error refuses the submission
   rather than waving it through (audit V5). The refusal is a
   plain-language wait message. Every `session_started`,
   `submit_attempt`, `submit_decided`, `submit_rejected` (including
   payload/session/limit/evidence refusals),
   `submit_finalize_failed`, `admin_decision`,
   `admin_decision_blocked` and `erasure` writes an
   `identity_audit_log` row with actor, subject, outcome and
   code-level detail. Additionally, `submit` verifies server-side
   that every referenced evidence object **actually exists** in the
   caller's own bucket folder before the session is consumed —
   invented paths are refused with an audit row (audit V1).
4. **Client hygiene.** Selfie frames, captured photos and embeddings
   exist **in component memory only** — no `localStorage`,
   `sessionStorage` or IndexedDB anywhere in the identity client
   (grep-verified). Camera tracks are stopped on unmount, on leaving
   the liveness step, and on every fallback path. The ML **models
   are self-hosted**: the five model pairs the enabled pipeline needs
   are vendored verbatim from `@vladmandic/human@3.3.6` into
   `public/models/human/` (~11 MB) and served from our own origin
   (`/models/human/`), version-pinned with the library — no
   third-party CDN is in the trust path for biometric processing, so
   there is no CDN integrity/availability risk to manage.
5. **Consent + erasure.** Consent is captured before any capture
   step is reachable, is required by the server on every submission,
   and is stored on the verification row with its text version
   (`face-consent-v1`). Erasure is **built**, not just spec'd: the
   `admin_erase` edge action (admin-gated, audited, reachable from
   the `/admin/identity` detail view) permanently deletes the
   account's evidence files from the bucket, all pending embeddings,
   and the enrolment, then tombstones the verification rows
   (status `erased`, artefact fields nulled; consent proof and
   timestamps remain as the audit anchor). Ordering is fail-closed —
   files first, any failure aborts and is audited as `failed`; an
   erasure is never reported that did not happen. Runbook: user asks
   support (in-app contact or email) → support verifies the request
   comes from the account holder → an admin opens the account's
   item in `/admin/identity` (or, for accounts with nothing in the
   review queue, uses the same `admin_erase` action — a user-lookup
   erasure control outside the queue is a small pre-launch UI
   follow-up; the edge action already accepts any user id) → the
   audit row + the user's status screen ("Data erased") confirm
   completion.
6. **Admin safety.** `admin_decide` and `admin_erase` re-check the
   admin role from `user_roles` on **every** call inside the
   service-role function (the route guard is only a UI convenience).
   A reviewer can never decide — or erase — **their own**
   verification (`isSelfDecision`, enforced server-side; the block
   itself is audited). Decisions are claimed with a **single
   status-guarded update** (`… WHERE id = ? AND status = 'review'`),
   so concurrent approve/reject races resolve to exactly one winner
   and the loser gets a crafted "already decided" response; the
   enrolment is written only *after* the claim is won, idempotently
   (upsert keyed by user), and an enrolment failure hands the claim
   back to the review queue as compensation — an approved-but-
   unenrolled verification is never the resting state (audit V4).
   At the data layer, writes to `identity_verifications` exist only
   via the service role, and the only client-visible policy layer is
   the column-scoped SELECT of Safety item 1/V3. Rejection requires
   a note (client + server enforced). The embedding **model version
   is pinned server-side** (`MODEL_VERSION` in `identity-core`): any
   client-claimed version is ignored, stored templates carry the
   pinned label, match/dedupe comparisons run only within that
   version, and skipped other-version rows are counted in the audit
   detail (audit V6).
7. **Fail closed.** Missing/expired/reused sessions, malformed
   embeddings (dimension bounds 32–4096, finite numbers, zero-vector
   rejection), storage paths outside the caller's own folder,
   referenced evidence objects that don't exist, and transcripts
   that don't match the issued challenges all refuse the submission
   with a crafted message and an audit row. There is no
   half-decided state: a submission is written once, directly into
   `review`; enrolment exists only behind an admin's guarded
   approval (item 6); `face_verified` derives from the verification
   status, not from the enrolment's existence. If the pending
   embedding cannot be stored, the review still proceeds from the
   photos and the failure is audited (an approval then enrols no
   template — the reviewer's photo comparison is the record).

## Honest capability limits (vs Sumsub)

- The liveness check is **challenge-based and client-side**. It is
  **not** certified presentation-attack detection (no ISO 30107 PAD
  evaluation) and is **not deepfake-proof**. The transcript is
  **client-attested**: embeddings and movement results are computed
  on the user's device; the server validates their shape, order and
  timing, but a sophisticated attacker with a modified client can
  fabricate all of them. The transcript and the antispoof/liveness
  model scores are therefore a **deterrent and reviewer evidence,
  not proof** — which is exactly why this build has **no
  auto-approval**: the trust anchor at our scale is the **human
  review of the real stored images**. Automatic approval returns
  only with server-side inference (embeddings recomputed from the
  stored images by a service we control, or a certified vendor).
- What the system **does** guarantee, even so: for every approved
  account, a face was compared by a human against the presented
  identity document and is **on record** (photos + template); one
  face cannot quietly enrol twice (dedupe flags + human review of
  hits); every submission, refusal and decision is audited; and a
  **dispute-time re-check** is possible later because the enrolment
  template is retained — a trader can be asked to re-verify and be
  compared 1:1 against the face on record.
- The certified-vendor route (Smile ID / Sumsub — see the Binance
  face-verification research note, 2026-10-23) remains the upgrade
  path if fraud pressure outgrows this control. This build is the
  deterrent + evidence layer, and it is documented as such rather
  than oversold.

## Data-protection posture

Face data is **sensitive personal data under the Zambia Data
Protection Act 2021**. Posture: explicit versioned consent before
capture; purpose limitation (verification + fraud prevention only);
private bucket + service-role-only templates (see Safety model 1);
immutable evidence (no UPDATE/DELETE policies); recorded consent
survives erasure as a tombstone so the processing history stays
accountable; erasure on request is built and audited. **Retention:
there is no automatic deletion TTL in this build** — evidence is
retained while the account is active (it is the fraud record the
feature exists to keep) and deleted on erasure request or account
closure; setting an automatic retention period is a policy decision
for the CEO before launch, recorded here as an open item. Before
launch: confirm DPC registration covers biometric processing and
complete a short DPIA for this feature (operations follow-up, not a
code task). Data residency: everything biometric lives in the
project's Supabase region and on our own origin — no third-party
processor receives face data in this design.

## Deliberately NOT in this build

- **Enforcement**: `face_verification_enabled` ships OFF and no tier
  or feature gates on face verification yet (Phase-0 identity tiers
  are unchanged). Wiring face verification into P2P tier limits is a
  follow-up once the flow is proven live.
- **Dispute-time re-check wiring**: the enrolment template makes it
  possible; the dispute-console action is a follow-up.
- **Attempt-limit tuning**: 5 submissions / 24 h is the shipped
  starting point; session starts are unrationed (they prove
  nothing). Tune from the audit log after real traffic.
- **Dedupe at scale**: the dedupe scan compares against all
  enrolments in memory in the edge function — correct and simple at
  current scale; it needs an indexed/vector strategy before the
  enrolment count reaches the tens of thousands.
- **Erasure UI outside the review queue**: `admin_erase` accepts any
  user id, but the only button today is on a queued review item; a
  user-lookup erasure control is a pre-launch follow-up (see Safety
  model 5).
- **HEIC uploads**: phone-camera captures are JPEG via canvas; a
  HEIC file upload may fail descriptor extraction and fall back to
  manual review — acceptable, and the fallback is the designed path.
- Document authenticity checks (MRZ, holograms, issuer databases)
  are out of scope for an in-house build; reviewers judge document
  plausibility from the photos, and the match is face-to-document,
  not document-to-issuer.
