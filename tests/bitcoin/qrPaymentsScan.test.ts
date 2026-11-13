// QR Payments scan rebuild (CEO order, 2026-11-13: "QR payments is
// incomplete. It can't even scan the qr code even if you have allowed
// the camera"). These tests pin:
//   1. parseBmaglassQrPayment — the classifier for the page's own
//      codes: valid BMaGlass payment codes (with/without amount),
//      non-BMaGlass codes (shown, never paid), and invalid text.
//   2. mapCameraError — every camera failure maps to crafted,
//      plain-language copy; no raw browser error name ever leaks.
//   3. The old scanner is gone — no hand-rolled getUserMedia /
//      BarcodeDetector loop in the page, and the new scanner owns
//      the camera through the lazy html5-qrcode path with torch,
//      image-upload and manual-paste fallbacks.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBmaglassQrPayment,
  type BmaglassQrPayload,
} from "../../src/lib/qrPaymentsPayload";
import {
  mapCameraError,
  CAMERA_DENIED,
  CAMERA_NOT_FOUND,
  CAMERA_BUSY,
  CAMERA_UNAVAILABLE,
  CAMERA_GENERIC,
} from "../../src/lib/qrCameraError";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const RECIPIENT = "11111111-2222-3333-4444-555555555555";
const validCode = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    platform: "bmaglass",
    version: "1.0",
    type: "p2p_transfer",
    recipient: RECIPIENT,
    amount: 25.5,
    currency: "ZMW",
    description: "Lunch",
    timestamp: "2026-11-13T08:00:00.000Z",
    ...overrides,
  });

describe("parseBmaglassQrPayment — valid BMaGlass codes", () => {
  it("classifies a full personal code with amount and description", () => {
    const result = parseBmaglassQrPayment(validCode());
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.payload).toEqual({
      type: "p2p_transfer",
      recipient: RECIPIENT,
      amount: 25.5,
      currency: "ZMW",
      description: "Lunch",
    } satisfies BmaglassQrPayload);
  });

  it("classifies a merchant code and a static code with no amount", () => {
    const merchant = parseBmaglassQrPayment(validCode({ type: "merchant_payment", amount: 100 }));
    expect(merchant.status).toBe("valid");
    if (merchant.status === "valid") expect(merchant.payload.type).toBe("merchant_payment");
    const staticCode = parseBmaglassQrPayment(validCode({ amount: null }));
    expect(staticCode.status).toBe("valid");
    if (staticCode.status === "valid") expect(staticCode.payload.amount).toBeNull();
  });

  it("drops a non-finite, zero or negative amount instead of prefilling it wrong", () => {
    for (const amount of [0, -5, "25.5"]) {
      const result = parseBmaglassQrPayment(validCode({ amount }));
      expect(result.status).toBe("valid");
      if (result.status === "valid") expect(result.payload.amount).toBeNull();
    }
  });

  it("keeps a non-ZMW currency on the payload so the page can refuse to pay it", () => {
    const result = parseBmaglassQrPayment(validCode({ currency: "USD", amount: 10 }));
    expect(result.status).toBe("valid");
    if (result.status === "valid") expect(result.payload.currency).toBe("USD");
  });

  it("trims surrounding whitespace from the scanned text", () => {
    expect(parseBmaglassQrPayment(`  ${validCode()}\n`).status).toBe("valid");
  });
});

describe("parseBmaglassQrPayment — refusals", () => {
  it("marks other JSON and plain text as non-BMaGlass (shown, never paid)", () => {
    for (const raw of [
      JSON.stringify({ platform: "other", recipient: RECIPIENT }),
      JSON.stringify({ recipient: RECIPIENT }),
      "hello world",
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    ]) {
      const result = parseBmaglassQrPayment(raw);
      expect(result.status, raw).toBe("non-bmaglass");
      if (result.status === "non-bmaglass") expect(result.raw).toBe(raw);
    }
  });

  it("marks a BMaGlass code with no recipient as invalid", () => {
    expect(parseBmaglassQrPayment(validCode({ recipient: "" })).status).toBe("invalid");
    expect(parseBmaglassQrPayment(validCode({ recipient: undefined })).status).toBe("invalid");
    expect(parseBmaglassQrPayment("").status).toBe("invalid");
    expect(parseBmaglassQrPayment("   ").status).toBe("invalid");
  });
});

describe("mapCameraError — plain-language camera failures", () => {
  it("maps each failure kind to its crafted message", () => {
    const denied = new DOMException("Permission denied", "NotAllowedError");
    expect(mapCameraError(denied)).toBe(CAMERA_DENIED);
    expect(mapCameraError(new DOMException("No device", "NotFoundError"))).toBe(CAMERA_NOT_FOUND);
    expect(mapCameraError(new DOMException("Track start error", "NotReadableError"))).toBe(CAMERA_BUSY);
    expect(mapCameraError(new DOMException("Secure context required", "SecurityError"))).toBe(
      CAMERA_UNAVAILABLE,
    );
    expect(mapCameraError(new Error("boom"))).toBe(CAMERA_GENERIC);
    expect(mapCameraError(undefined)).toBe(CAMERA_GENERIC);
  });

  it("never leaks a raw browser error name into the user-facing copy", () => {
    const messages = [
      mapCameraError(new DOMException("x", "NotAllowedError")),
      mapCameraError(new DOMException("x", "NotFoundError")),
      mapCameraError(new DOMException("x", "NotReadableError")),
      mapCameraError(new DOMException("x", "OverconstrainedError")),
    ];
    for (const message of messages) {
      expect(message).not.toContain("NotAllowedError");
      expect(message).not.toContain("NotFoundError");
      expect(message).not.toContain("NotReadableError");
      expect(message).not.toContain("OverconstrainedError");
      expect(message).not.toContain("DOMException");
    }
  });

  it("every message tells the user what to do next", () => {
    for (const message of [CAMERA_DENIED, CAMERA_NOT_FOUND, CAMERA_BUSY, CAMERA_UNAVAILABLE, CAMERA_GENERIC]) {
      expect(message).toMatch(/scan from an image|paste the code/i);
    }
  });
});

describe("the old hand-rolled scanner is gone from the page", () => {
  const page = read("../../src/pages/QrPayments.tsx");
  const scanner = read("../../src/components/qr/QrPaymentsScanner.tsx");

  it("the page no longer requests the camera or decodes frames itself", () => {
    expect(page).not.toContain("getUserMedia");
    expect(page).not.toContain("BarcodeDetector");
    expect(page).not.toContain("videoRef");
    expect(page).not.toContain("scanInterval");
    expect(page).not.toContain("srcObject");
    expect(page).not.toContain("HAVE_ENOUGH_DATA");
  });

  it("the page delegates scanning to QrPaymentsScanner and classifies with parseBmaglassQrPayment", () => {
    expect(page).toContain("QrPaymentsScanner");
    expect(page).toContain("@/lib/qrPaymentsPayload");
    expect(page).toContain("parseBmaglassQrPayment(rawValue)");
    expect(page).toContain("onScan={handleScanResult}");
  });

  it("a scan still only fills the review panel — it never pays by itself", () => {
    const handler = page.slice(page.indexOf("const handleScanResult"), page.indexOf("useEffect(() => {", page.indexOf("const handleScanResult")));
    expect(handler).toContain("setScannedPayload");
    expect(handler).not.toContain("atomic-transfer");
    expect(handler).not.toContain("supabase.functions.invoke");
    expect(handler).not.toContain("handlePayScanned");
  });
});

describe("generation — the code the page renders must decode", () => {
  const page = read("../../src/pages/QrPayments.tsx");

  it("renders the payment QR at level M, not H", () => {
    // Rendered decode matrix (2026-11-13, headless Chromium +
    // html5-qrcode): the ~210-char BMaGlass payload at 220px FAILS
    // to decode at level H (and at 300px/H), but decodes at
    // 220px/M, 220px/L and 320px/H. H pushes the code to a higher
    // QR version whose modules are too small at this size, so the
    // very code the page generates could not be read back. M keeps
    // the 220px display and 15% error correction.
    expect(page).toContain('level="M"');
    expect(page).not.toContain('level="H"');
    expect(page).toContain("size={220}");
  });
});

describe("the new scanner — camera, torch, fallbacks, lazy decoder", () => {
  const scanner = read("../../src/components/qr/QrPaymentsScanner.tsx");

  it("decodes through html5-qrcode, reached only via dynamic import", () => {
    expect(scanner).toContain('await import("html5-qrcode")');
    for (const line of scanner.split("\n")) {
      if (line.includes('from "html5-qrcode"')) {
        expect(line).toContain("import type");
      }
    }
    expect(scanner).toContain("scanner.start(");
    expect(scanner).toContain('facingMode: "environment"');
    expect(scanner).toContain("qrbox");
  });

  it("the reader element is mounted before the decoder starts (the old ordering bug)", () => {
    // The start is deferred past mount (the 50ms settle), and the
    // reader div is rendered unconditionally above the phase overlays.
    expect(scanner).toContain("setTimeout(resolve, 50)");
    expect(scanner).toContain('id={readerId}');
    expect(scanner).toContain("Let the view mount so the reader element has size");
  });

  it("shows a visible scanning state and stops the stream on unmount", () => {
    expect(scanner).toContain("Scanning…");
    expect(scanner).toContain("await scanner.stop()");
    expect(scanner).toContain("scanner.clear()");
  });

  it("offers a torch toggle only where the running camera supports it", () => {
    expect(scanner).toContain(".torchFeature()");
    expect(scanner).toContain("isSupported()");
    expect(scanner).toContain(".apply(next)");
    expect(scanner).toContain("Turn the torch on");
    expect(scanner).toContain("torchSupported");
  });

  it("offers scan-from-image and paste-the-code fallbacks in every state", () => {
    expect(scanner).toContain("scanFile");
    expect(scanner).toContain("Scan from an image");
    expect(scanner).toContain("Or paste the code");
    expect(scanner).toContain("Use this code");
    expect(scanner).toContain("NO_QR_IN_IMAGE");
  });

  it("maps camera failures to plain language and offers a retry", () => {
    expect(scanner).toContain("mapCameraError");
    expect(scanner).toContain("Try the camera again");
    expect(scanner).toContain("CAMERA_UNAVAILABLE");
  });
});
