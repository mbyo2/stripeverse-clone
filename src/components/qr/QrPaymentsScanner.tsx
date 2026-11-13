import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CameraOff, Flashlight, FlashlightOff, ImagePlus, Loader2, X } from "lucide-react";
import type { Html5Qrcode as Html5QrcodeInstance } from "html5-qrcode";
import {
  CAMERA_UNAVAILABLE,
  NO_QR_IN_IMAGE,
  mapCameraError,
} from "@/lib/qrCameraError";

// QR Payments scan tab (rebuilt 2026-11-13, CEO order: "QR payments
// is incomplete. It can't even scan the qr code even if you have
// allowed the camera").
//
// ROOT CAUSE of the old failure, proven by a local rendered pass:
// the old tab called getUserMedia and tried to attach the stream to
// the <video> element BEFORE setScanMode(true) mounted that element
// — videoRef.current was null at attach time, the `if` guard skipped
// the attach silently, and nothing ever re-attached after mount.
// The camera permission was granted and a live stream was acquired,
// but the video stayed black (readyState 0, no srcObject) with a
// "Scanning…" badge forever and no error. Its only decoder was the
// bare BarcodeDetector API — absent on Safari/Firefox — with decode
// failures swallowed by an empty catch.
//
// This component replaces that hand-rolled loop with the proven
// html5-qrcode path the Bitcoin send forms already use (QrScanButton):
// the reader element is mounted FIRST, the decoder owns attach /
// play / decode, and it is reached only through a dynamic import()
// so it never lands in the initial chunk. On top of that it adds
// what the CEO's order requires: a visible camera view with a clear
// "scanning…" state, a torch toggle where the device supports one,
// and fallback paths (scan from an image, paste the code manually)
// so the screen is never dead — plus plain-language errors when
// the camera is blocked or unavailable.
//
// A successful scan only hands the raw text back to the page, which
// classifies it and shows the review panel. Scanning never pays
// anything by itself.

type ScanPhase = "starting" | "scanning" | "decoding" | "error";

type QrPaymentsScannerProps = {
  /** Called with the raw decoded text once a code is read. */
  onScan: (rawText: string) => void;
  /** Called when the user closes the scanner (X). */
  onClose: () => void;
};

export function QrPaymentsScanner({ onScan, onClose }: QrPaymentsScannerProps) {
  const [phase, setPhase] = useState<ScanPhase>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [pastedCode, setPastedCode] = useState("");

  const readerId = useRef(`qr-payments-reader-${Math.random().toString(36).slice(2, 10)}`).current;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const openRef = useRef(true);
  const sessionRef = useRef(0);
  const handledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // Already stopped — nothing to release.
    }
    try {
      scanner.clear();
    } catch {
      // Element already gone — the stream is stopped.
    }
  }, []);

  const finishWithResult = useCallback(
    (text: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      void stopScanner();
      onScanRef.current(text);
    },
    [stopScanner],
  );

  const startCamera = useCallback(async () => {
    const session = ++sessionRef.current;
    setPhase("starting");
    setErrorMessage(null);
    setTorchSupported(false);
    setTorchOn(false);
    if (
      typeof window === "undefined" ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setErrorMessage(CAMERA_UNAVAILABLE);
      setPhase("error");
      return;
    }
    try {
      await stopScanner();
      const { Html5Qrcode } = await import("html5-qrcode");
      // Let the view mount so the reader element has size before
      // the decoder attaches its video to it — the old tab attached
      // to an element that did not exist yet, which was the bug.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!openRef.current || session !== sessionRef.current) return;
      const scanner = new Html5Qrcode(readerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => finishWithResult(decodedText),
        () => {
          // Per-frame misses are normal while aiming the camera.
        },
      );
      if (!openRef.current || session !== sessionRef.current) {
        void stopScanner();
        return;
      }
      // Torch, where the running camera offers it — hidden otherwise.
      try {
        const torch = scanner.getRunningTrackCameraCapabilities().torchFeature();
        if (torch.isSupported()) setTorchSupported(true);
      } catch {
        // No capabilities surface — the toggle simply stays hidden.
      }
      setPhase("scanning");
    } catch (err) {
      if (!openRef.current || session !== sessionRef.current) return;
      setErrorMessage(mapCameraError(err));
      setPhase("error");
    }
  }, [finishWithResult, readerId, stopScanner]);

  const scanFromImage = useCallback(
    async (file: File) => {
      setPhase("decoding");
      setErrorMessage(null);
      try {
        await stopScanner();
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(readerId);
        scannerRef.current = scanner;
        const text = await scanner.scanFile(file, false);
        finishWithResult(text);
      } catch {
        setErrorMessage(NO_QR_IN_IMAGE);
        setPhase("error");
      }
    },
    [finishWithResult, readerId, stopScanner],
  );

  const toggleTorch = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    const next = !torchOn;
    try {
      await scanner.getRunningTrackCameraCapabilities().torchFeature().apply(next);
      setTorchOn(next);
    } catch {
      // The device refused the toggle — hide it rather than strand
      // a button that does nothing.
      setTorchSupported(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  // The page mounts this component only after the user taps
  // "Open Camera", so the camera starts on mount — on a user
  // gesture, as mobile browsers expect.
  useEffect(() => {
    openRef.current = true;
    handledRef.current = false;
    void startCamera();
    return () => {
      openRef.current = false;
      sessionRef.current++;
      void stopScanner();
    };
    // Start exactly once per mount; restarts go through startCamera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPastedCode = useCallback(() => {
    const text = pastedCode.trim();
    if (!text) return;
    finishWithResult(text);
  }, [finishWithResult, pastedCode]);

  return (
    <div className="space-y-4">
      <div
        data-testid="qr-scanner-view"
        className="relative w-full aspect-square max-w-sm mx-auto rounded-2xl overflow-hidden bg-black"
      >
        <div
          id={readerId}
          className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        />
        {phase === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}
        {phase === "decoding" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Reading the image…</p>
          </div>
        )}
        {phase === "scanning" && (
          <>
            <div className="absolute inset-8 border-2 border-primary/60 rounded-xl pointer-events-none" />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <Badge variant="secondary" className="animate-pulse">
                Scanning…
              </Badge>
            </div>
          </>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
            <CameraOff className="h-8 w-8" />
            <p className="text-sm">{errorMessage}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void startCamera()}>
              Try the camera again
            </Button>
          </div>
        )}
        {(phase === "scanning" || phase === "starting") && (
          <div className="absolute top-2 right-2 flex gap-2">
            {torchSupported && phase === "scanning" && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => void toggleTorch()}
                aria-label={torchOn ? "Turn the torch off" : "Turn the torch on"}
              >
                {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => onCloseRef.current()}
              aria-label="Close the scanner"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {phase === "scanning" && (
        <p className="text-center text-sm text-muted-foreground">
          Point your camera at a BMaGlass QR code — it fills in automatically.
        </p>
      )}

      <div className="flex items-center justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4 mr-1.5" />
          Scan from an image
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose an image containing a QR code"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void scanFromImage(file);
        }}
      />

      <div className="space-y-2">
        <Label htmlFor="qr-paste-code">Or paste the code</Label>
        <div className="flex gap-2">
          <Input
            id="qr-paste-code"
            placeholder="Paste a BMaGlass QR code here"
            value={pastedCode}
            onChange={(e) => setPastedCode(e.target.value)}
          />
          <Button type="button" variant="outline" disabled={!pastedCode.trim()} onClick={submitPastedCode}>
            Use this code
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          No camera? Upload a photo of the code, or paste the code text — the payment review works the same.
        </p>
      </div>
    </div>
  );
}

export default QrPaymentsScanner;
