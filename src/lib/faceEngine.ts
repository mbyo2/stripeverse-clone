// faceEngine: the lazy browser face-ML wrapper for /verify-identity.
//
// Library choice (design note: docs/face-verification.md):
// @vladmandic/human is the ONE package that provides BOTH halves of
// this flow —
//   * face mesh + rotation + gestures (blink / facing left / facing
//     right / head up / head down are computed by the library), which
//     drive the liveness challenges, and
//   * a face embedding (FaceResult.embedding, the FaceRes
//     descriptor), which the server matches by cosine similarity.
// @mediapipe/tasks-vision has landmarks and blendshapes but NO
// embedding model (it would need a second library for matching), and
// face-api.js is unmaintained. Human additionally ships dedicated
// antispoof and liveness models whose scores ride along in the
// transcript as extra evidence for reviewers.
//
// This module is only ever reached through a dynamic import from the
// verify-identity page, so neither the library (~1MB of TFJS) nor
// its models touch the main bundle or any other page. If loading or
// the camera fails, the page degrades to photo upload for manual
// review — this module's failures are expected and handled there.
//
// MODELS: served from OUR OWN ORIGIN. The five model pairs the
// enabled pipeline needs (blazeface, facemesh, faceres, antispoof,
// liveness) are vendored verbatim from @vladmandic/human@3.3.6 into
// public/models/human/ (~11MB) and pinned to that version — no
// third-party CDN is in the trust path for biometric processing, so
// there is no CDN integrity or availability risk to manage. Bump
// MODEL_VERSION and re-vendor the files together when the library
// is upgraded; never mix model versions.

export const MODEL_VERSION = "human-faceres-3.3.6";
const MODEL_BASE_URL = "/models/human/";

export interface FrameSignals {
  facePresent: boolean;
  /** Detection confidence 0..1. */
  faceScore: number;
  /** Head rotation in degrees (0 when no face). */
  yawDeg: number;
  pitchDeg: number;
  /** A blink gesture fired on this frame. */
  blink: boolean;
  facing: "left" | "right" | "center" | null;
  headTilt: "up" | "down" | null;
  /** Mouth-corner width / cheek width — rises when smiling. */
  smileRatio: number;
  /** Lip gap / cheek width. */
  mouthOpenRatio: number;
  /** Antispoof model score (real-face confidence), when available. */
  realScore: number | null;
  /** Liveness model score, when available. */
  liveScore: number | null;
}

export interface FaceEngine {
  version: string;
  analyseFrame: (video: HTMLVideoElement) => Promise<FrameSignals>;
  /** Face embedding for a still image, or null when no usable face
   *  is in it. */
  descriptorFor: (
    source: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  ) => Promise<number[] | null>;
}

const NO_FACE: FrameSignals = {
  facePresent: false,
  faceScore: 0,
  yawDeg: 0,
  pitchDeg: 0,
  blink: false,
  facing: null,
  headTilt: null,
  smileRatio: 0,
  mouthOpenRatio: 0,
  realScore: null,
  liveScore: null,
};

// MediaPipe face-mesh topology indices (Human's facemesh output).
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const LIP_TOP = 13;
const LIP_BOTTOM = 14;
const CHEEK_LEFT = 454;
const CHEEK_RIGHT = 234;

function dist(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

type HumanInstance = {
  detect: (input: unknown) => Promise<{
    face: Array<Record<string, unknown>>;
    gesture: Array<{ face?: number; gesture?: string }>;
  }>;
  load: () => Promise<void>;
  warmup: () => Promise<void>;
};

let enginePromise: Promise<FaceEngine> | null = null;

async function createEngine(): Promise<FaceEngine> {
  const mod = (await import("@vladmandic/human")) as unknown as {
    Human: new (config: Record<string, unknown>) => HumanInstance;
  };
  const human = new mod.Human({
    backend: "webgl",
    modelBasePath: MODEL_BASE_URL,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { enabled: true, rotation: true, maxFaces: 1 },
      mesh: { enabled: true },
      iris: { enabled: false },
      attention: { enabled: false },
      description: { enabled: true },
      emotion: { enabled: false },
      antispoof: { enabled: true },
      liveness: { enabled: true },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: true },
    segmentation: { enabled: false },
  });
  await human.load();
  await human.warmup();

  async function detectFace(input: unknown) {
    const result = await human.detect(input);
    const face = result.face?.[0];
    return { result, face };
  }

  return {
    version: MODEL_VERSION,

    async analyseFrame(video) {
      const { result, face } = await detectFace(video);
      if (!face) return NO_FACE;
      const gestures = (result.gesture ?? [])
        .filter((g) => g.face === 0)
        .map((g) => g.gesture ?? "");
      const rotation = face.rotation as
        | { angle?: { yaw?: number; pitch?: number } }
        | undefined;
      const toDeg = (rad: number | undefined) =>
        typeof rad === "number" ? (rad * 180) / Math.PI : 0;
      const mesh = (face.mesh as number[][] | undefined) ?? [];
      let smileRatio = 0;
      let mouthOpenRatio = 0;
      if (mesh.length > CHEEK_LEFT) {
        const cheekWidth = dist(mesh[CHEEK_RIGHT], mesh[CHEEK_LEFT]);
        if (cheekWidth > 0) {
          smileRatio = dist(mesh[MOUTH_LEFT], mesh[MOUTH_RIGHT]) / cheekWidth;
          mouthOpenRatio = dist(mesh[LIP_TOP], mesh[LIP_BOTTOM]) / cheekWidth;
        }
      }
      return {
        facePresent: true,
        faceScore: Number(face.faceScore ?? face.score ?? 0),
        yawDeg: toDeg(rotation?.angle?.yaw),
        pitchDeg: toDeg(rotation?.angle?.pitch),
        blink: gestures.some((g) => g.startsWith("blink")),
        facing: gestures.includes("facing left")
          ? "left"
          : gestures.includes("facing right")
            ? "right"
            : gestures.includes("facing center")
              ? "center"
              : null,
        headTilt: gestures.includes("head down")
          ? "down"
          : gestures.includes("head up")
            ? "up"
            : null,
        smileRatio,
        mouthOpenRatio,
        realScore: typeof face.real === "number" ? face.real : null,
        liveScore: typeof face.live === "number" ? face.live : null,
      };
    },

    async descriptorFor(source) {
      const { face } = await detectFace(source);
      if (!face) return null;
      const embedding =
        (face.embedding as number[] | undefined) ??
        (face.descriptor as number[] | undefined);
      if (!Array.isArray(embedding) || embedding.length === 0) return null;
      return embedding.map((n) => Number(n));
    },
  };
}

/** Load (once) and return the shared engine. Rejects when the
 *  library or its models cannot load — the caller degrades to the
 *  manual photo flow. */
export function loadFaceEngine(): Promise<FaceEngine> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((e) => {
      // A failed load must not poison the singleton: a retry (better
      // connection) gets a fresh attempt.
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

/** Snapshot the current video frame to a canvas at native size. */
export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("capture_failed"))),
      type,
      quality,
    );
  });
}

/** Load a File/Blob as an HTMLImageElement for descriptor reads. */
export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}
