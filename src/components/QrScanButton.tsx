import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CameraOff, ImagePlus, Loader2, ScanLine } from "lucide-react";
import type { Html5Qrcode as Html5QrcodeInstance } from "html5-qrcode";

// Scan-to-send (CEO ask, 2026-10-25). A "Scan" button beside the
// destination field of the Bitcoin send forms; opens a camera sheet
// with a viewfinder, a Cancel control, and a "Scan from an image"
// fallback for devices without a usable camera.
//
// The decoder (html5-qrcode, ZXing-based with a native
// BarcodeDetector fast path where the browser offers one) is loaded
// with a dynamic import() ONLY when the scanner opens — it is never
// part of the initial or wallet chunks, so the wallet speed work is
// untouched until a user actually scans.
//
// A successful scan only hands the raw text back to the form, which
// fills the destination field for review. Scanning never sends,
// prepares, or confirms anything.

const CAMERA_UNAVAILABLE =
  "The camera isn't available in this browser. You can scan from an image instead, or close this and paste the destination.";
const CAMERA_DENIED =
  "Camera access was denied. Allow camera permission in your browser settings and try again — or scan from an image, or paste the destination instead.";
const CAMERA_NOT_FOUND =
  "No camera was found on this device. You can scan from an image instead, or close this and paste the destination.";
const CAMERA_BUSY =
  "Your camera is being used by another app right now. Close that app and try again — or scan from an image, or paste the destination instead.";
const CAMERA_GENERIC =
  "The camera could not be started. You can scan from an image instead, or close this and paste the destination.";
const NO_QR_IN_IMAGE =
  "No QR code could be found in that image. Try a clearer image, use the camera, or paste the destination instead.";

/** Map camera start failures to crafted, plain-language copy. */
function mapCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const haystack = `${name} ${message}`.toLowerCase();
  if (haystack.includes("notallowed") || haystack.includes("permission") || haystack.includes("denied")) {
    return CAMERA_DENIED;
  }
  if (
    haystack.includes("notfound") ||
    haystack.includes("devicesnotfound") ||
    haystack.includes("no camera") ||
    haystack.includes("no video input")
  ) {
    return CAMERA_NOT_FOUND;
  }
  if (
    haystack.includes("notreadable") ||
    haystack.includes("in use") ||
    haystack.includes("track start") ||
    haystack.includes("video source")
  ) {
    return CAMERA_BUSY;
  }
  if (haystack.includes("secure") || haystack.includes("mediadevices")) {
    return CAMERA_UNAVAILABLE;
  }
  return CAMERA_GENERIC;
}

type ScanPhase = "starting" | "scanning" | "decoding" | "error";

type QrScanButtonProps = {
  /** Called with the raw decoded text once a code is read. */
  onScan: (rawText: string) => void;
  disabled?: boolean;
  className?: string;
};

export function QrScanButton({ onScan, disabled, className }: QrScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const readerId = useRef(`qr-reader-${Math.random().toString(36).slice(2, 10)}`).current;
  // The parent passes a fresh handler identity on most renders; going
  // through a ref keeps the camera lifecycle stable while scanning.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const openRef = useRef(false);
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
      // Element already gone (dialog closed) — the stream is stopped.
    }
  }, []);

  const finishWithResult = useCallback(
    (text: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      void stopScanner();
      setOpen(false);
      onScanRef.current(text);
    },
    [stopScanner],
  );

  const startCamera = useCallback(async () => {
    const session = ++sessionRef.current;
    setPhase("starting");
    setErrorMessage(null);
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
      // Let the dialog finish mounting so the reader element has size.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!openRef.current || session !== sessionRef.current) return;
      const scanner = new Html5Qrcode(readerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => finishWithResult(decodedText),
        () => {
          // Per-frame misses are normal while aiming the camera.
        },
      );
      if (!openRef.current || session !== sessionRef.current) {
        void stopScanner();
        return;
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

  useEffect(() => {
    openRef.current = open;
    if (open) {
      handledRef.current = false;
      void startCamera();
    } else {
      sessionRef.current++;
      void stopScanner();
    }
  }, [open, startCamera, stopScanner]);

  // Never leak a camera stream if the form unmounts mid-scan.
  useEffect(
    () => () => {
      openRef.current = false;
      sessionRef.current++;
      void stopScanner();
    },
    [stopScanner],
  );

  const close = useCallback(() => {
    sessionRef.current++;
    void stopScanner();
    setOpen(false);
  }, [stopScanner]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Scan a QR code"
      >
        <ScanLine className="h-4 w-4 mr-1.5" />
        Scan
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else setOpen(true);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan a QR code</DialogTitle>
            <DialogDescription>
              Point your camera at a Bitcoin or Lightning QR code. The
              destination fills in for you to check — nothing is sent
              until you review and confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="relative w-full aspect-square overflow-hidden rounded-lg bg-black">
            <div id={readerId} className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
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
            {phase === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
                <CameraOff className="h-8 w-8" />
                <p className="text-sm">{errorMessage}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => void startCamera()}>
                  Try the camera again
                </Button>
              </div>
            )}
          </div>

          {phase === "scanning" && (
            <p className="text-center text-sm text-muted-foreground">
              Hold the code inside the frame — it fills in automatically.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4 mr-1.5" />
              Scan from an image
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
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
        </DialogContent>
      </Dialog>
    </>
  );
}

export default QrScanButton;
