// Plain-language camera failure copy for the QR Payments scanner.
//
// The old QrPayments scanner swallowed its failures: a denied camera
// and a missing camera produced terse one-liners, and the worst
// failure — the stream attaching to nothing — produced no error at
// all. Every message here names what happened and what to do next,
// and none of them leaks a raw browser error name (NotAllowedError
// and friends never reach the screen). The scanner always offers
// the next step alongside the message: retry the camera, scan from
// an image, or paste the code.

export const CAMERA_UNAVAILABLE =
  "The camera isn't available in this browser. You can scan from an image instead, or paste the code below.";
export const CAMERA_DENIED =
  "Camera access was denied. Allow camera permission in your browser settings and try again — or scan from an image, or paste the code below instead.";
export const CAMERA_NOT_FOUND =
  "No camera was found on this device. You can scan from an image instead, or paste the code below.";
export const CAMERA_BUSY =
  "Your camera is being used by another app right now. Close that app and try again — or scan from an image, or paste the code below instead.";
export const CAMERA_GENERIC =
  "The camera could not be started. You can scan from an image instead, or paste the code below.";
export const NO_QR_IN_IMAGE =
  "No QR code could be found in that image. Try a clearer image, use the camera, or paste the code below instead.";

/** Map a camera start failure to crafted, plain-language copy. */
export function mapCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const haystack = `${name} ${message}`.toLowerCase();
  if (
    haystack.includes("notallowed") ||
    haystack.includes("permission") ||
    haystack.includes("denied")
  ) {
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
