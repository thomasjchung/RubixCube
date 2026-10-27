import { useEffect, useRef, useState } from "react";
import type { Pad, Point } from "../vision/hands";

export type PadState = "off" | "on" | "ready";

export interface Overlay {
  /** detected (or guide) face: corners and 9 sticker centers as raw-frame fractions, with live colors */
  face?: { corners: Point[]; centers: Point[]; colors?: (string | null)[]; dashed?: boolean } | null;
  /** rectangular pads, in displayed coordinates */
  pads?: { pad: Pad; state: PadState; editable?: boolean }[];
  /** circular "wherever your hands rested" pads, in displayed coordinates; radius as a fraction of height */
  rest?: { at: Point; r: number; state: PadState }[];
  /** palm centers in displayed coordinates */
  palms?: Point[];
}

export type PointerKind = "down" | "move" | "up";

interface Props {
  stream: MediaStream;
  /** called every animation frame with the video element; return an overlay to draw */
  onFrame: (video: HTMLVideoElement, now: number) => Overlay | void;
  /** pointer events in displayed normalized coordinates */
  onPointer?: (kind: PointerKind, p: Point) => void;
}

const FILL: Record<PadState, string> = { off: "rgba(255,255,255,.10)", on: "rgba(239,68,68,.45)", ready: "rgba(34,197,94,.55)" };

/** Mirrored camera preview with the detected face, pads and palms drawn on top. */
export function CameraStage({ stream, onFrame, onPointer }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const v = video.current!;
    v.srcObject = stream;
    v.onloadedmetadata = () => v.videoWidth && setAspect(v.videoWidth / v.videoHeight);
    v.play().catch(() => {});
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (v.readyState < 2) return;
      const ov = cb.current(v, now) || {};
      draw(canvas.current!, v, ov);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stream]);

  const pointer = (kind: PointerKind) => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onPointer) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (kind === "down") e.currentTarget.setPointerCapture(e.pointerId);
    onPointer(kind, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <div className="cam" style={{ aspectRatio: String(aspect) }}>
      <video ref={video} muted playsInline />
      <canvas ref={canvas} onPointerDown={pointer("down")} onPointerMove={pointer("move")} onPointerUp={pointer("up")} />
    </div>
  );
}

function draw(c: HTMLCanvasElement, v: HTMLVideoElement, ov: Overlay) {
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const lw = Math.max(2, w / 400);
  // The canvas is mirrored with CSS like the video: draw faces in raw coordinates and convert
  // displayed coordinates with x -> 1 - x.

  if (ov.face) {
    const { corners, centers, colors, dashed } = ov.face;
    const px = (p: Point) => [p.x * w, p.y * h] as const;
    // Points along the face's edges, for the inner grid lines (corners: TL, TR, BR, BL).
    const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const [tl, tr, br, bl] = corners;
    ctx.lineWidth = lw;
    ctx.setLineDash(dashed ? [10, 8] : []);
    ctx.strokeStyle = dashed ? "rgba(255,255,255,.55)" : "#a78bfa";
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      ctx.moveTo(...px(lerp(tl, tr, t)));
      ctx.lineTo(...px(lerp(bl, br, t)));
      ctx.moveTo(...px(lerp(tl, bl, t)));
      ctx.lineTo(...px(lerp(tr, br, t)));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const cell = Math.hypot((tr.x - tl.x) * w, (tr.y - tl.y) * h) / 3;
    centers.forEach((c, k) => {
      const fill = colors?.[k];
      if (!fill) return;
      const p = cell * 0.36;
      const [x, y] = px(c);
      ctx.fillStyle = fill;
      ctx.fillRect(x - p / 2, y - p / 2, p, p);
      ctx.strokeStyle = "#000";
      ctx.strokeRect(x - p / 2, y - p / 2, p, p);
    });
  }

  for (const { pad, state, editable } of ov.pads ?? []) {
    const rx = (1 - pad.x - pad.w) * w;
    ctx.fillStyle = FILL[state];
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = lw;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.roundRect(rx, pad.y * h, pad.w * w, pad.h * h, 24);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (editable) {
      // resize handle at the displayed bottom-right corner
      const hx = (1 - pad.x - pad.w) * w, hy = (pad.y + pad.h) * h;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(7, w / 110), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const { at, r, state } of ov.rest ?? []) {
    ctx.fillStyle = FILL[state];
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = lw;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc((1 - at.x) * w, at.y * h, r * h, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const p of ov.palms ?? []) {
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc((1 - p.x) * w, p.y * h, Math.max(8, w / 90), 0, Math.PI * 2);
    ctx.fill();
  }
}
