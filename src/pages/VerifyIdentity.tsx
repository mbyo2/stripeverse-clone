// /verify-identity — the in-house face verification flow.
// Steps: consent (recorded, Zambia DPA sensitive-data consent) →
// document capture → live camera movement check driven by the
// lazily-loaded face engine → submit → status.
//
// The honest degradation contract: if the camera, the model
// download, or the on-device face read fails at any point, the flow
// offers photo upload for MANUAL review instead of failing closed —
// a human decides from the photos, exactly like the review queue
// handles borderline automatic results.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Camera,
  CheckCircle2,
  Clock,
  FileUp,
  Loader2,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  IdentityActionError,
  startIdentitySession,
  submitVerification,
  uploadIdentityFile,
  type LivenessSession,
} from "@/services/identityService";
import {
  useInvalidateIdentity,
  useMyIdentityStatus,
} from "@/hooks/useIdentity";
import {
  canProceedFromConsent,
  challengePrompt,
  CHALLENGE_HINTS,
  CONSENT_TEXT_VERSION,
  documentStepComplete,
  identityStatusMeta,
  VERIFY_STEPS,
  type VerifyStep,
} from "@/utils/identityUi";
import {
  blobToImage,
  canvasToBlob,
  captureVideoFrame,
  loadFaceEngine,
  MODEL_VERSION,
  type FaceEngine,
  type FrameSignals,
} from "@/lib/faceEngine";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "national_id", label: "National ID (NRC)" },
  { value: "passport", label: "Passport" },
  { value: "driver_licence", label: "Driving licence" },
] as const;

function errorText(e: unknown, fallback: string): string {
  if (e instanceof IdentityActionError || e instanceof Error) return e.message;
  return fallback;
}

// ---------------------------------------------------------------------
// Small camera capture used for document photos
// ---------------------------------------------------------------------

function CameraCapture({
  facingMode,
  onCapture,
  onCancel,
}: {
  facingMode: "environment" | "user";
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  if (failed) {
    return (
      <Alert>
        <AlertDescription>
          The camera could not be opened. You can upload a photo of the
          document instead.
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Go back
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full rounded-lg bg-black aspect-[4/3] object-cover"
      />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={async () => {
            if (!videoRef.current) return;
            const blob = await canvasToBlob(captureVideoFrame(videoRef.current));
            onCapture(blob);
          }}
        >
          <Camera className="mr-2 h-4 w-4" /> Take photo
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Photo slot (preview + camera/upload actions) for the document step
// ---------------------------------------------------------------------

function PhotoSlot({
  title,
  optional,
  blob,
  onBlob,
}: {
  title: string;
  optional?: boolean;
  blob: Blob | null;
  onBlob: (blob: Blob | null) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <div className="space-y-2">
      <Label>
        {title}
        {optional && (
          <span className="text-muted-foreground font-normal"> (optional)</span>
        )}
      </Label>
      {previewUrl ? (
        <div className="space-y-2">
          <img
            src={previewUrl}
            alt={title}
            className="w-full max-h-64 object-contain rounded-lg border bg-muted"
          />
          <Button variant="outline" size="sm" onClick={() => onBlob(null)}>
            <RotateCcw className="mr-2 h-4 w-4" /> Retake
          </Button>
        </div>
      ) : cameraOpen ? (
        <CameraCapture
          facingMode="environment"
          onCapture={(b) => {
            onBlob(b);
            setCameraOpen(false);
          }}
          onCancel={() => setCameraOpen(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCameraOpen(true)}>
            <Camera className="mr-2 h-4 w-4" /> Use camera
          </Button>
          <label>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onBlob(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" asChild>
              <span>
                <FileUp className="mr-2 h-4 w-4" /> Upload photo
              </span>
            </Button>
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------

interface TranscriptEntryState {
  challenge: string;
  completed: boolean;
  duration_ms: number;
}

export default function VerifyIdentity() {
  const { user } = useAuth();
  const { toast } = useToast();
  const invalidate = useInvalidateIdentity();
  const statusQuery = useMyIdentityStatus();

  const [step, setStep] = useState<VerifyStep>("consent");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [documentType, setDocumentType] = useState<string>("national_id");
  const [frontBlob, setFrontBlob] = useState<Blob | null>(null);
  const [backBlob, setBackBlob] = useState<Blob | null>(null);
  const [manualSelfie, setManualSelfie] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);

  // Liveness session state
  const [engineReady, setEngineReady] = useState(false);
  const [engineFailed, setEngineFailed] = useState(false);
  const [session, setSession] = useState<LivenessSession | null>(null);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeTimedOut, setChallengeTimedOut] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<FaceEngine | null>(null);
  const entriesRef = useRef<TranscriptEntryState[]>([]);
  const scoresRef = useRef<{ real: number[]; live: number[] }>({
    real: [],
    live: [],
  });
  const challengeStartRef = useRef<number>(0);
  const runIdRef = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopStream, [stopStream]);

  // Camera hygiene: leaving the liveness step (finishing, retrying,
  // falling back) kills the challenge loop and stops every camera
  // track immediately — the camera is never left running on another
  // step.
  useEffect(() => {
    if (step !== "liveness") {
      runIdRef.current++;
      stopStream();
      setEngineReady(false);
    }
  }, [step, stopStream]);

  const existing = statusQuery.data?.verification ?? null;
  const existingMeta = identityStatusMeta(existing?.status ?? null);

  // ---------------------------------------------------------------
  // Liveness loop
  // ---------------------------------------------------------------

  const runChallenges = useCallback(
    async (engine: FaceEngine, sess: LivenessSession) => {
      const runId = ++runIdRef.current;
      entriesRef.current = [];
      scoresRef.current = { real: [], live: [] };
      setChallengeIndex(0);
      setChallengeTimedOut(false);

      for (let i = 0; i < sess.challenges.length; i++) {
        if (runIdRef.current !== runId) return;
        const challenge = sess.challenges[i];
        setChallengeIndex(i);
        challengeStartRef.current = performance.now();
        const startedAt = challengeStartRef.current;
        let baselineSmile: number[] = [];
        let peakYaw = 0;
        let peakPitch = 0;
        let completed = false;

        while (performance.now() - startedAt < 25_000) {
          if (runIdRef.current !== runId) return;
          const video = videoRef.current;
          if (!video) return;
          let s: FrameSignals;
          try {
            s = await engine.analyseFrame(video);
          } catch {
            return;
          }
          if (s.facePresent) {
            peakYaw = Math.max(peakYaw, Math.abs(s.yawDeg));
            peakPitch = Math.max(peakPitch, Math.abs(s.pitchDeg));
            if (s.realScore !== null) scoresRef.current.real.push(s.realScore);
            if (s.liveScore !== null) scoresRef.current.live.push(s.liveScore);
            if (baselineSmile.length < 4 && challenge === "smile") {
              baselineSmile.push(s.smileRatio);
            }
            switch (challenge) {
              case "blink":
                completed = s.blink;
                break;
              case "turn_left":
                completed = s.facing === "left" || s.yawDeg <= -25;
                break;
              case "turn_right":
                completed = s.facing === "right" || s.yawDeg >= 25;
                break;
              case "nod":
                completed =
                  s.headTilt === "down" ||
                  s.headTilt === "up" ||
                  Math.abs(s.pitchDeg) >= 18;
                break;
              case "smile": {
                const base =
                  baselineSmile.length > 0
                    ? baselineSmile.reduce((a, b) => a + b, 0) /
                      baselineSmile.length
                    : 0;
                completed =
                  s.smileRatio >= 0.55 ||
                  (base > 0 &&
                    s.smileRatio >= base * 1.15 &&
                    s.smileRatio >= base + 0.03);
                break;
              }
            }
          }
          if (completed) break;
          await new Promise((r) => setTimeout(r, 180));
        }

        if (!completed) {
          if (runIdRef.current === runId) setChallengeTimedOut(true);
          return;
        }
        entriesRef.current.push({
          challenge,
          completed: true,
          duration_ms: Math.round(performance.now() - startedAt),
        });
      }

      // All challenges done: capture a centred selfie + descriptors,
      // upload, submit.
      if (runIdRef.current !== runId) return;
      setBusy(true);
      try {
        const video = videoRef.current;
        if (!video || !user) throw new Error("capture_failed");
        const selfieCanvas = captureVideoFrame(video);
        const selfieBlob = await canvasToBlob(selfieCanvas);
        const selfieDescriptor = await engine.descriptorFor(selfieCanvas);
        let documentDescriptor: number[] | null = null;
        if (frontBlob) {
          try {
            const docImage = await blobToImage(frontBlob);
            documentDescriptor = await engine.descriptorFor(docImage);
          } catch {
            documentDescriptor = null;
          }
        }

        if (!selfieDescriptor || !documentDescriptor) {
          // Photos exist but the on-device face read failed: offer
          // the manual route with the same captures.
          runIdRef.current++;
          stopStream();
          setEngineReady(false);
          setManualSelfie(selfieBlob);
          setEngineFailed(true);
          setError(
            "We could not read the faces from those photos clearly enough for the face comparison. You can send the same photos for a manual review instead.",
          );
          return;
        }

        const avg = (xs: number[]) =>
          xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        const transcript = {
          mode: "live" as const,
          entries: entriesRef.current,
          antispoof_score: avg(scoresRef.current.real),
          liveness_score: avg(scoresRef.current.live),
        };

        const frontPath = await uploadIdentityFile(frontBlob!, user.id, "document-front");
        const backPath = backBlob
          ? await uploadIdentityFile(backBlob, user.id, "document-back")
          : null;
        const selfiePath = await uploadIdentityFile(selfieBlob, user.id, "selfie");

        const result = await submitVerification({
          sessionId: sess.session_id,
          documentType,
          documentFrontPath: frontPath,
          documentBackPath: backPath,
          selfiePath,
          mode: "live",
          selfieEmbedding: selfieDescriptor,
          documentEmbedding: documentDescriptor,
          modelVersion: MODEL_VERSION,
          liveness: transcript,
          consentTextVersion: CONSENT_TEXT_VERSION,
        });
        setFinalStatus(result.status);
        setStep("done");
        invalidate();
        stopStream();
      } catch (e) {
        setError(
          errorText(e, "Your verification could not be submitted. Please try again."),
        );
      } finally {
        setBusy(false);
      }
    },
    [backBlob, documentType, frontBlob, invalidate, stopStream, user],
  );

  const beginLiveness = useCallback(async () => {
    setError(null);
    setEngineFailed(false);
    setBusy(true);
    try {
      const sess = await startIdentitySession();
      setSession(sess);
      const engine = await loadFaceEngine();
      engineRef.current = engine;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setEngineReady(true);
      setBusy(false);
      // The video element is always mounted in the liveness step,
      // so it can be attached directly.
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      void runChallenges(engine, sess);
    } catch (e) {
      setBusy(false);
      if (e instanceof IdentityActionError) {
        setError(e.message);
        return;
      }
      // Camera or model unavailable: degrade to manual photo review.
      setEngineFailed(true);
    }
  }, [runChallenges]);

  // ---------------------------------------------------------------
  // Manual submission (photo upload, human review)
  // ---------------------------------------------------------------

  const submitManual = useCallback(async () => {
    if (!user || !frontBlob || !manualSelfie) return;
    setBusy(true);
    setError(null);
    try {
      const sess = session ?? (await startIdentitySession());
      const frontPath = await uploadIdentityFile(frontBlob, user.id, "document-front");
      const backPath = backBlob
        ? await uploadIdentityFile(backBlob, user.id, "document-back")
        : null;
      const selfiePath = await uploadIdentityFile(manualSelfie, user.id, "selfie");
      const result = await submitVerification({
        sessionId: sess.session_id,
        documentType,
        documentFrontPath: frontPath,
        documentBackPath: backPath,
        selfiePath,
        mode: "manual",
        selfieEmbedding: null,
        documentEmbedding: null,
        modelVersion: null,
        liveness: { mode: "manual" },
        consentTextVersion: CONSENT_TEXT_VERSION,
      });
      setFinalStatus(result.status);
      setStep("done");
      invalidate();
      toast({ title: "Photos sent for review" });
    } catch (e) {
      setError(
        errorText(e, "Your photos could not be submitted. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }, [backBlob, documentType, frontBlob, invalidate, manualSelfie, session, toast, user]);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  const stepIndex = VERIFY_STEPS.findIndex((s) => s.id === step);
  const showWizard = wizardOpen || (!existing && !statusQuery.isLoading);
  const resultMeta = identityStatusMeta(finalStatus ?? existing?.status ?? null);

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <ScanFace className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Face Verification</h1>
            <p className="text-sm text-muted-foreground">
              Prove the face on this account is the face on your document.
            </p>
          </div>
        </div>

        {statusQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : statusQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>We couldn't load your status</AlertTitle>
            <AlertDescription>
              Check your connection and reload the page to try again.
            </AlertDescription>
          </Alert>
        ) : statusQuery.data && !statusQuery.data.enabled && !existing ? (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Face verification is not open yet</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                We are finishing the last checks before this opens. Your
                existing identity verification on the{" "}
                <Link to="/kyc" className="underline font-medium">
                  KYC page
                </Link>{" "}
                is unaffected.
              </p>
            </CardContent>
          </Card>
        ) : !showWizard ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {resultMeta.verified ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : existing?.status === "review" || existing?.status === "pending" ? (
                  <Clock className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                {resultMeta.headline}
                <Badge variant={resultMeta.tone}>{resultMeta.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{resultMeta.body}</p>
              {existing?.status === "rejected" && existing.reviewer_notes && (
                <Alert>
                  <AlertTitle>Reviewer's note</AlertTitle>
                  <AlertDescription>{existing.reviewer_notes}</AlertDescription>
                </Alert>
              )}
              {resultMeta.canRetry && (
                <Button
                  onClick={() => {
                    setFinalStatus(null);
                    setWizardOpen(true);
                    setStep("consent");
                  }}
                >
                  Start a new attempt
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                {VERIFY_STEPS.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Badge variant={i === stepIndex ? "default" : i < stepIndex ? "secondary" : "outline"}>
                      {i + 1}. {s.label}
                    </Badge>
                    {i < VERIFY_STEPS.length - 1 && (
                      <span className="text-muted-foreground">→</span>
                    )}
                  </div>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && step !== "liveness" && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {step === "consent" && (
                <div className="space-y-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    What we capture, and why
                  </h2>
                  <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                    <li>
                      Photos of your identity document and a short selfie
                      check where you follow simple movements on camera.
                    </li>
                    <li>
                      The movements and the selfie are compared on your
                      device against the photo on your document, and a
                      person on our review team then compares the
                      photos and makes the decision — nothing is
                      approved automatically. A mathematical template
                      of your face is stored so the match can be
                      re-checked later.
                    </li>
                    <li>
                      <strong className="text-foreground">
                        Why: fraud prevention.
                      </strong>{" "}
                      If this account is ever used to defraud someone,
                      the verified face is on record. The same face
                      cannot verify a second BMaGlass Pay account.
                    </li>
                    <li>
                      Your photos are stored privately — only you and
                      the verification review team can see them. Face
                      data is sensitive personal data under the Zambia
                      Data Protection Act; we process it only for this
                      verification.
                    </li>
                    <li>
                      You can withdraw this consent at any time by
                      contacting support. Withdrawing closes
                      face-verified features on your account.
                    </li>
                  </ul>
                  <label className="flex items-start gap-3 text-sm cursor-pointer">
                    <Checkbox
                      checked={consentChecked}
                      onCheckedChange={(v) => setConsentChecked(v === true)}
                    />
                    <span>
                      I understand what is captured and why, and I agree
                      to BMaGlass Pay capturing and storing my document
                      photos, selfie and face template for identity
                      verification and fraud prevention.
                    </span>
                  </label>
                  <Button
                    disabled={!canProceedFromConsent(consentChecked)}
                    onClick={() => setStep("document")}
                  >
                    Continue
                  </Button>
                </div>
              )}

              {step === "document" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label>Document type</Label>
                    <Select value={documentType} onValueChange={setDocumentType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <PhotoSlot
                    title="Front of document"
                    blob={frontBlob}
                    onBlob={setFrontBlob}
                  />
                  <PhotoSlot
                    title="Back of document"
                    optional
                    blob={backBlob}
                    onBlob={setBackBlob}
                  />
                  <p className="text-xs text-muted-foreground">
                    Make sure the photo on the document is clear and
                    readable — the face check compares your selfie
                    against it.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("consent")}>
                      Back
                    </Button>
                    <Button
                      disabled={!documentStepComplete(!!frontBlob)}
                      onClick={() => setStep("liveness")}
                    >
                      Continue to face check
                    </Button>
                  </div>
                </div>
              )}

              {step === "liveness" && (
                <div className="space-y-4">
                  {!engineFailed && (
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full rounded-lg bg-black aspect-[4/3] object-cover"
                    />
                  )}
                  {!engineReady && !engineFailed && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        The face check runs on your device: a short
                        camera session where you follow three simple
                        movements. Nothing is recorded as video — only
                        the final selfie photo is uploaded.
                      </p>
                      <Button onClick={beginLiveness} disabled={busy}>
                        {busy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="mr-2 h-4 w-4" />
                        )}
                        Start the camera check
                      </Button>
                      {error && (
                        <Alert variant="destructive">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {engineReady && session && (
                    <div className="space-y-3">
                      {busy ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Checking your photos and submitting…
                        </div>
                      ) : challengeTimedOut ? (
                        <Alert variant="destructive">
                          <AlertTitle>That movement was not detected</AlertTitle>
                          <AlertDescription>
                            Make sure your face is well lit and fully in
                            frame, then try the check again.
                            <div className="mt-3 flex gap-2">
                              <Button size="sm" onClick={beginLiveness}>
                                Try again
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  runIdRef.current++;
                                  stopStream();
                                  setEngineReady(false);
                                  setEngineFailed(true);
                                }}
                              >
                                Send photos for manual review instead
                              </Button>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <div className="text-center space-y-1">
                          <p className="text-lg font-semibold">
                            {challengePrompt(session.challenges[challengeIndex] ?? "")}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {
                              CHALLENGE_HINTS[
                                session.challenges[challengeIndex] as keyof typeof CHALLENGE_HINTS
                              ]
                            }
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Movement {challengeIndex + 1} of {session.challenges.length}
                          </p>
                        </div>
                      )}
                      {error && (
                        <Alert>
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {engineFailed && (
                    <div className="space-y-4">
                      <Alert>
                        <AlertTitle>Manual review instead</AlertTitle>
                        <AlertDescription>
                          The automatic camera check is not available
                          right now. Upload a clear selfie of yourself
                          holding nothing in front of your face, and a
                          person will compare it with your document
                          photo.
                        </AlertDescription>
                      </Alert>
                      {error && (
                        <Alert variant="destructive">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      )}
                      <PhotoSlot
                        title="Selfie"
                        blob={manualSelfie}
                        onBlob={setManualSelfie}
                      />
                      <Button
                        disabled={!manualSelfie || busy}
                        onClick={submitManual}
                      >
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send photos for manual review
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {step === "done" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    {resultMeta.verified ? (
                      <CheckCircle2 className="h-6 w-6 text-primary" />
                    ) : finalStatus === "review" ? (
                      <Clock className="h-6 w-6 text-muted-foreground" />
                    ) : (
                      <XCircle className="h-6 w-6 text-destructive" />
                    )}
                    <h2 className="font-semibold">{resultMeta.headline}</h2>
                    <Badge variant={resultMeta.tone}>{resultMeta.label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{resultMeta.body}</p>
                  <div className="flex gap-2">
                    <Button asChild>
                      <Link to="/p2p/profile">Go to my P2P profile</Link>
                    </Button>
                    {resultMeta.canRetry && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFinalStatus(null);
                          setFrontBlob(null);
                          setBackBlob(null);
                          setManualSelfie(null);
                          setEngineFailed(false);
                          setEngineReady(false);
                          setSession(null);
                          setStep("consent");
                        }}
                      >
                        Try again
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
}
