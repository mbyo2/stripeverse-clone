// LiveCameraCapture + LivePhotoSlot — the ONLY way a face photo
// (and, in the face-verification flow, a document photo) can be
// produced on BMaGlass Pay: a live camera capture via getUserMedia.
//
// CEO directive (2026-10-24): file uploads for faces are an
// impersonation hole — a stolen photo of another person could be
// uploaded — so there is deliberately NO file picker, gallery path,
// or drag-and-drop here, and NO fallback to one. If the camera
// cannot be opened, the component says so in plain language and
// stops; the caller cannot proceed with a saved photo instead.
//
// The component never renders a raw browser error (name or message):
// every failure maps to a crafted, plain-language explanation plus a
// next step (the error-presentation rule).

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, RotateCcw } from "lucide-react";

export type CameraFacingMode = "user" | "environment";

type CameraStatus = "starting" | "live" | "denied" | "unavailable" | "failed";

const CAMERA_MESSAGES: Record<
  Exclude<CameraStatus, "starting" | "live">,
  string
> = {
  denied:
    "Camera access was blocked. We cannot take your photo without it. Allow camera access for this site in your browser settings, then tap Try again.",
  unavailable:
    "No camera could be found on this device. These photos must be taken with a live camera, so please open this page on a device with a camera — for example your phone — and try again.",
  failed:
    "The camera could not be started. Close any other app that may be using the camera, then tap Try again.",
};

function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// ---------------------------------------------------------------------
// LiveCameraCapture — live preview with a Capture button. Hands the
// captured frame to the parent as a JPEG Blob. The capture instant is
// genuine: the frame is drawn from the live stream at tap time.
// ---------------------------------------------------------------------

export function LiveCameraCapture({
  facingMode,
  onCapture,
  onCancel,
  captureLabel = "Take photo",
}: {
  facingMode: CameraFacingMode;
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
  captureLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [attempt, setAttempt] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    (async () => {
      if (!isCameraSupported()) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
      } catch (firstError) {
        // A device may lack the requested camera (no rear camera on a
        // laptop, no front camera on a desktop). Any LIVE camera keeps
        // the control intact, so retry once with no preference before
        // deciding the camera truly cannot be opened.
        const name = (firstError as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          if (!cancelled) setStatus("denied");
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch {
          if (!cancelled) {
            setStatus(name === "NotFoundError" ? "unavailable" : "failed");
          }
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      if (!cancelled) setStatus("live");
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, attempt, stopStream]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (blob) onCapture(blob);
  }, [onCapture]);

  if (status === "denied" || status === "unavailable" || status === "failed") {
    return (
      <Alert>
        <AlertDescription>
          {CAMERA_MESSAGES[status]}
          <div className="mt-3 flex gap-2">
            {status !== "unavailable" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Try again
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Go back
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full rounded-lg bg-black aspect-[4/3] object-cover"
        />
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting the camera…
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={status !== "live"}
          onClick={capture}
        >
          <Camera className="mr-2 h-4 w-4" /> {captureLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// LivePhotoSlot — one photo position in a verification flow. Empty:
// a single "take photo" action that opens the live camera. Filled:
// the captured photo with a Retake action that re-opens the camera
// (cancelling a retake keeps the existing photo). There is no state
// in which this slot offers a file.
// ---------------------------------------------------------------------

export function LivePhotoSlot({
  title,
  optional,
  facingMode,
  blob,
  onBlob,
  captureButtonLabel = "Take photo with camera",
  hint,
}: {
  title: string;
  optional?: boolean;
  facingMode: CameraFacingMode;
  blob: Blob | null;
  onBlob: (blob: Blob | null) => void;
  captureButtonLabel?: string;
  hint?: string;
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
      {cameraOpen ? (
        <LiveCameraCapture
          facingMode={facingMode}
          onCapture={(b) => {
            onBlob(b);
            setCameraOpen(false);
          }}
          onCancel={() => setCameraOpen(false)}
        />
      ) : previewUrl ? (
        <div className="space-y-2">
          <img
            src={previewUrl}
            alt={title}
            className="w-full max-h-64 object-contain rounded-lg border bg-muted"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCameraOpen(true)}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Retake
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCameraOpen(true)}
          >
            <Camera className="mr-2 h-4 w-4" /> {captureButtonLabel}
          </Button>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      )}
    </div>
  );
}
