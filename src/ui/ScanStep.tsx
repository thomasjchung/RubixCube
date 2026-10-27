import { useEffect, useRef, useState } from "react";
import { CENTER, COLOR_NAMES, FACES, State, validateState } from "../cube/model";
import { classifyScan, grabFrame, guideBox, Lab, RGB, rgbCss, sampleGrid } from "../vision/colors";
import { LiveFaceDetector, squareFace } from "../vision/stickers";
import { CameraStage, Overlay } from "./CameraStage";
import { CubeNet } from "./CubeNet";
import { saveFrame } from "./saveFrame";
import { useOpenCV } from "./useOpenCV";

// Faces to show, in order, and which face's center should be on top while showing each.
// Positions are faces of the cube as held for scrambling (U R F D L B = 0..5).
const ORDER = [
  { face: 2, top: 0, how: (c: string[]) => `${c[2]} center facing the camera, ${c[0]} on top.` },
  { face: 1, top: 0, how: (c: string[]) => `Turn the cube left: ${c[1]} faces the camera, ${c[0]} still on top.` },
  { face: 5, top: 0, how: (c: string[]) => `Turn left again: ${c[5]} faces the camera, ${c[0]} on top.` },
  { face: 4, top: 0, how: (c: string[]) => `Turn left again: ${c[4]} faces the camera, ${c[0]} on top.` },
  { face: 0, top: 5, how: (c: string[]) => `Tip the top toward the camera: ${c[0]} faces the camera, ${c[5]} on top.` },
  { face: 3, top: 2, how: (c: string[]) => `${c[3]} faces the camera, ${c[2]} on top.` },
];

interface Props {
  stream: MediaStream;
  expected: State;
  onConfirm: (start: State, means: Lab[], matchesScramble: boolean) => void;
  onBack: () => void;
}

export function ScanStep({ stream, expected, onConfirm, onBack }: Props) {
  const [step, setStep] = useState(0);
  const [samples, setSamples] = useState<(RGB | null)[]>(() => new Array(54).fill(null));
  const [result, setResult] = useState<{ colors: Uint8Array; means: Lab[] } | null>(null);
  const live = useRef<RGB[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const opencv = useOpenCV();
  const detector = useRef<LiveFaceDetector | null>(null);
  if (opencv.cv && !detector.current) detector.current = new LiveFaceDetector(opencv.cv);
  const [auto, setAuto] = useState(true);
  // How many stickers the detector saw (0 = not found); only re-rendered when it changes.
  const [seen, setSeen] = useState(0);
  const seenRef = useRef(0);

  const onFrame = (v: HTMLVideoElement): Overlay | void => {
    video.current = v;
    const img = grabFrame(v, 480);
    if (!img) return;
    const face = auto && detector.current ? detector.current.update(img) : null;
    const n = face ? face.seen : 0;
    if (n !== seenRef.current) setSeen((seenRef.current = n));
    if (face) {
      live.current = face.colors;
      return { face: { corners: face.corners, centers: face.centers, colors: face.colors.map(rgbCss) } };
    }
    // Fallback: fixed guide square in the middle.
    const box = guideBox(v.videoWidth / v.videoHeight);
    live.current = sampleGrid(img, box);
    return { face: { ...squareFace(box), colors: live.current.map(rgbCss), dashed: auto } };
  };

  const capture = () => {
    const grid = live.current;
    if (grid.length !== 9) return;
    const f = ORDER[step].face;
    const next = samples.slice();
    grid.forEach((rgb, k) => (next[f * 9 + k] = rgb));
    setSamples(next);
    if (step === ORDER.length - 1) setResult(toColors(classifyScan(next as RGB[]), expected));
    else setStep(step + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !result) {
        e.preventDefault();
        capture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (result) {
    return (
      <ScanReview
        colors={result.colors}
        samples={samples as RGB[]}
        expected={expected}
        onChange={(colors) => setResult({ ...result, colors })}
        onRescan={() => {
          setResult(null);
          setStep(0);
          setSamples(new Array(54).fill(null));
        }}
        onConfirm={(matches) => onConfirm(result.colors, result.means, matches)}
      />
    );
  }

  const cur = ORDER[step];
  const centerName = (f: number) => COLOR_NAMES[expected[CENTER(f)]];
  const names = FACES.map((_, f) => centerName(f));
  return (
    <section className="panel">
      <p className="eyebrow">Step 2 · Scan face {step + 1} of 6</p>
      <h2>
        Show the <span className={`chip c${expected[CENTER(cur.face)]}`}>{centerName(cur.face)}</span> face
      </h2>
      <p>
        {capitalize(cur.how(names))}{" "}
        {auto
          ? "Hold it up anywhere in view; the purple grid locks onto the face. Then press "
          : "Fill the grid with the face so each dot lands on a sticker, hold still, then press "}
        <kbd>Space</kbd> or Capture.
      </p>
      <p className="small">
        {!auto ? (
          <span className="muted">Using the fixed grid. </span>
        ) : opencv.error ? (
          <span className="error">Face detector failed to load ({opencv.error}); using the fixed grid. </span>
        ) : !opencv.cv ? (
          <span className="muted">Loading the face detector… </span>
        ) : seen ? (
          <span className="good">Face found ✓ ({seen}/9 stickers seen{seen < 9 ? ", rest estimated" : ""}) </span>
        ) : (
          <span className="muted">Looking for the face… if it isn't picked up, hold it inside the dashed square. </span>
        )}
        <button className="link" onClick={() => setAuto(!auto)}>
          {auto ? "Use the fixed grid instead" : "Detect the face automatically"}
        </button>
      </p>
      <div className="scan-layout">
        <CameraStage
          stream={stream}
          onFrame={onFrame}
        />
        <div className="side">
          <CubeNet state={new Array(54).fill(-1)} rawColors={samples.map((s) => (s ? rgbCss(s) : "#2a2f3a"))} size={18} />
          <p className="muted">Captured so far</p>
        </div>
      </div>
      <div className="row center">
        <button className="ghost" onClick={step ? () => setStep(step - 1) : onBack}>Back</button>
        <button className="ghost" onClick={() => video.current && saveFrame(video.current, `scan-${FACES[cur.face]}`)}>
          Save frame
        </button>
        <button className="primary" onClick={capture}>Capture {FACES[cur.face]} face</button>
      </div>
    </section>
  );
}

const capitalize = (t: string) => t[0].toUpperCase() + t.slice(1);

/**
 * classifyScan labels stickers by the face position whose center they match; convert that to
 * color indices using the center colors expected for the scrambling hold (centers never move).
 */
function toColors(r: { colors: Uint8Array; means: Lab[] }, expected: State): { colors: Uint8Array; means: Lab[] } {
  const colorAt = FACES.map((_, f) => expected[CENTER(f)]);
  const means: Lab[] = [];
  colorAt.forEach((c, f) => (means[c] = r.means[f]));
  return { colors: r.colors.map((f) => colorAt[f]), means };
}

function ScanReview({
  colors, samples, expected, onChange, onRescan, onConfirm,
}: {
  colors: Uint8Array;
  samples: RGB[];
  expected: State;
  onChange: (c: Uint8Array) => void;
  onRescan: () => void;
  onConfirm: (matches: boolean) => void;
}) {
  const problem = validateState(colors);
  const diff = new Set<number>();
  for (let i = 0; i < 54; i++) if (colors[i] !== expected[i]) diff.add(i);
  const matches = diff.size === 0;

  return (
    <section className="panel">
      <p className="eyebrow">Step 2 · Confirm the scramble</p>
      <h2>{matches ? "Scramble verified ✓" : "Check the scan"}</h2>
      <div className="row center wrap gap-lg">
        <figure>
          <CubeNet
            state={colors}
            size={24}
            highlight={diff}
            onSticker={(i) => {
              if (i % 9 === 4) return;
              const next = colors.slice();
              next[i] = (next[i] + 1) % 6;
              onChange(next);
            }}
          />
          <figcaption>Scanned — click a sticker to fix its color</figcaption>
        </figure>
        <figure>
          <CubeNet state={expected} size={24} />
          <figcaption>Expected from the scramble</figcaption>
        </figure>
        <figure>
          <CubeNet state={colors} rawColors={samples.map(rgbCss)} size={14} />
          <figcaption>Raw camera colors</figcaption>
        </figure>
      </div>
      {problem && <p className="error center">{problem}</p>}
      {!problem && !matches && (
        <p className="warn center">
          {diff.size} stickers differ from the scramble (outlined). Fix misread stickers by clicking them, re-do the
          scramble and rescan, or continue with the cube as scanned.
        </p>
      )}
      <div className="row center">
        <button className="ghost" onClick={onRescan}>Rescan</button>
        <button className="primary" disabled={!!problem} onClick={() => onConfirm(matches)}>
          {matches ? "Continue to the timer" : "Use scanned state anyway"}
        </button>
      </div>
    </section>
  );
}
