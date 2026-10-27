// Hand detection for the timer, using MediaPipe's hand landmarker.

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let loading: Promise<HandLandmarker> | null = null;

export function loadHandLandmarker(): Promise<HandLandmarker> {
  loading ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    try {
      return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
    } catch {
      return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
    }
  })();
  return loading;
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in normalized coordinates of the *displayed* (mirrored) video. */
export interface Pad {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_PADS: Pad[] = [
  { x: 0.02, y: 0.66, w: 0.3, h: 0.32 },
  { x: 0.68, y: 0.66, w: 0.3, h: 0.32 },
];

const PADS_KEY = "cfop-coach-pads";

export function loadPads(): Pad[] {
  try {
    const p = JSON.parse(localStorage.getItem(PADS_KEY) ?? "null");
    if (Array.isArray(p) && p.length === 2) return p;
  } catch {
    /* fall through */
  }
  return DEFAULT_PADS.map((p) => ({ ...p }));
}

export function savePads(pads: Pad[]) {
  try {
    localStorage.setItem(PADS_KEY, JSON.stringify(pads));
  } catch {
    /* storage unavailable */
  }
}

export const inPad = (p: Point, r: Pad) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Palm centers in displayed (mirrored) normalized coordinates, sorted left to right. */
export function readPalms(lm: HandLandmarker, video: HTMLVideoElement, now: number): Point[] {
  const res = lm.detectForVideo(video, now);
  return res.landmarks
    .map((pts) => {
      const ids = [0, 5, 9, 13, 17];
      const x = ids.reduce((s, i) => s + pts[i].x, 0) / ids.length;
      const y = ids.reduce((s, i) => s + pts[i].y, 0) / ids.length;
      return { x: 1 - x, y };
    })
    .sort((a, b) => a.x - b.x);
}
