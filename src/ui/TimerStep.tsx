import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { TimedMove } from "../cube/analysis";
import { COLOR_HEX, normalizeMove, simplify, State } from "../cube/model";
import { classifyLive, DEFAULT_MEANS, grabFrame, Lab, RGB, sampleGrid } from "../vision/colors";
import { FaceTracker } from "../vision/cubeFinder";
import { HandTimer, STOP_R, TimerMode, TimerPhase } from "../vision/handTimer";
import { DEFAULT_PADS, loadHandLandmarker, loadPads, Pad, Point, readPalms, savePads } from "../vision/hands";
import { LiveFace, LiveFaceDetector, squareFace } from "../vision/stickers";
import { MoveTracker } from "../vision/tracker";
import { CameraStage, Overlay, PadState, PointerKind } from "./CameraStage";
import { formatTime } from "./format";
import { saveFrame } from "./saveFrame";
import { useOpenCV } from "./useOpenCV";

export type MoveSource = "camera" | "smart" | "none";

export interface SolveResult {
  ms: number;
  moves: TimedMove[];
  source: MoveSource;
  trackedSolved: boolean;
}

const STABLE_FRAMES = 3;
const MODE_KEY = "cfop-coach-timer-mode";

interface Props {
  stream: MediaStream;
  start: State;
  means: Lab[] | null;
  onDone: (r: SolveResult) => void;
}

interface SmartPuzzle {
  name(): string | undefined;
  disconnect(): void;
  addAlgLeafListener(l: (e: { latestAlgLeaf: { toString(): string } }) => void): void;
}

function loadMode(): TimerMode {
  try {
    return localStorage.getItem(MODE_KEY) === "pads" ? "pads" : "anywhere";
  } catch {
    return "anywhere";
  }
}

export function TimerStep({ stream, start, means, onDone }: Props) {
  const [phase, setPhase] = useState<TimerPhase>("idle");
  const [mode, setMode] = useState<TimerMode>(loadMode);
  const [pads, setPads] = useState<Pad[]>(loadPads);
  const [source, setSource] = useState<MoveSource>(means ? "camera" : "none");
  const [handsStatus, setHandsStatus] = useState("Loading hand detection…");
  const [live, setLive] = useState<string[]>([]);
  const [smart, setSmart] = useState<SmartPuzzle | null>(null);
  const timeEl = useRef<HTMLDivElement>(null);

  const lm = useRef<HandLandmarker | null>(null);
  const timer = useRef(new HandTimer(mode, pads));
  const finder = useRef(new FaceTracker());
  const opencv = useOpenCV();
  const detector = useRef<LiveFaceDetector | null>(null);
  if (opencv.cv && !detector.current) detector.current = new LiveFaceDetector(opencv.cv);
  const video = useRef<HTMLVideoElement | null>(null);
  const m = useRef({
    space: false,
    tracker: null as MoveTracker | null,
    smartMoves: [] as TimedMove[],
    lastKey: "",
    stableCount: 0,
    drag: null as null | { pad: number; resize: boolean; dx: number; dy: number },
  });

  useEffect(() => {
    timer.current.mode = mode;
    timer.current.pads = pads;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }, [mode, pads]);

  useEffect(() => {
    loadHandLandmarker()
      .then((l) => {
        lm.current = l;
        setHandsStatus("Hand detection ready");
      })
      .catch((e) => setHandsStatus(`Hand detection unavailable (${e.message ?? e}). Use the space bar instead`));
  }, []);

  const begin = () => {
    const st = m.current;
    st.tracker = source === "camera" ? new MoveTracker(start) : null;
    st.smartMoves = [];
    st.lastKey = "";
    setLive([]);
  };

  const finish = (now: number) => {
    const st = m.current;
    const ms = now - timer.current.startAt;
    let moves: TimedMove[] = [];
    let trackedSolved = false;
    if (source === "camera" && st.tracker) {
      const r = st.tracker.finish(ms);
      moves = r.moves;
      trackedSolved = r.solved;
    } else if (source === "smart") moves = st.smartMoves;
    onDone({ ms, moves, source, trackedSolved });
  };

  // Space bar works like a stackmat too; any key stops a running solve.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (timer.current.phase === "running") {
        e.preventDefault();
        timer.current.stop();
        finish(performance.now());
      } else if (e.code === "Space") {
        e.preventDefault();
        m.current.space = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") m.current.space = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const connectSmart = async () => {
    try {
      const { connectSmartPuzzle } = await import("cubing/bluetooth");
      const p = (await connectSmartPuzzle()) as unknown as SmartPuzzle;
      p.addAlgLeafListener((e) => {
        if (timer.current.phase !== "running") return;
        const mv = normalizeMove(e.latestAlgLeaf.toString());
        if (!mv) return;
        const st = m.current;
        st.smartMoves.push({ move: mv, t: performance.now() - timer.current.startAt });
        setLive(simplify(st.smartMoves.map((x) => x.move)));
      });
      setSmart(p);
      setSource("smart");
    } catch (e) {
      alert(`Could not connect: ${(e as Error).message}`);
    }
  };
  useEffect(() => () => smart?.disconnect(), [smart]);

  // Drag pads to move them; drag the corner dot to resize.
  const onPointer = (kind: PointerKind, p: Point) => {
    const st = m.current;
    if (mode !== "pads" || timer.current.phase === "running") return;
    if (kind === "down") {
      const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.04;
      const i = pads.findIndex((r) => near(p, { x: r.x + r.w, y: r.y + r.h }) || (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h));
      if (i < 0) return;
      const r = pads[i];
      st.drag = { pad: i, resize: near(p, { x: r.x + r.w, y: r.y + r.h }), dx: p.x - r.x, dy: p.y - r.y };
    } else if (kind === "move" && st.drag) {
      const { pad, resize, dx, dy } = st.drag;
      const next = pads.map((r) => ({ ...r }));
      const r = next[pad];
      if (resize) {
        r.w = Math.min(1 - r.x, Math.max(0.08, p.x - r.x));
        r.h = Math.min(1 - r.y, Math.max(0.08, p.y - r.y));
      } else {
        r.x = Math.min(1 - r.w, Math.max(0, p.x - dx));
        r.y = Math.min(1 - r.h, Math.max(0, p.y - dy));
      }
      setPads(next);
    } else if (kind === "up" && st.drag) {
      st.drag = null;
      savePads(pads);
    }
  };

  const onFrame = (v: HTMLVideoElement, now: number): Overlay => {
    video.current = v;
    const st = m.current;
    const t = timer.current;
    t.aspect = v.videoWidth / v.videoHeight;
    let palms: Point[] = [];
    if (lm.current) {
      try {
        palms = readPalms(lm.current, v, now);
      } catch {
        /* a dropped frame is fine */
      }
    }

    const ev = t.update(palms, now, st.space);
    if (ev === "start") begin();
    if (t.phase !== phase) setPhase(t.phase);
    if (ev === "stop") {
      finish(now);
      return {};
    }
    if (timeEl.current) timeEl.current.textContent = formatTime(t.phase === "running" ? now - t.startAt : 0);

    // Camera move tracking: find the cube wherever it is (searching near the hands first).
    let face: Overlay["face"] = null;
    if (source === "camera") {
      const img = grabFrame(v, 480);
      if (img) {
        // Shape-based detector first; the color-based finder (with calibrated colors) as a fallback.
        let geo: Pick<LiveFace, "corners" | "centers"> | null = null;
        let rgbs: RGB[] | null = null;
        const det = detector.current?.update(img) ?? null;
        if (det) [geo, rgbs] = [det, det.colors];
        else {
          const near = palms.length
            ? {
                x0: 1 - Math.max(...palms.map((p) => p.x)) - 0.3,
                x1: 1 - Math.min(...palms.map((p) => p.x)) + 0.3,
                y0: Math.min(...palms.map((p) => p.y)) - 0.45,
                y1: Math.max(...palms.map((p) => p.y)) + 0.3,
              }
            : null;
          const box = finder.current.update(img, means ?? DEFAULT_MEANS, means ? 32 : 45, near);
          if (box) [geo, rgbs] = [squareFace(box), sampleGrid(img, box)];
        }
        if (geo && rgbs) {
          const reading = rgbs.map((rgb) => classifyLive(rgb, means ?? DEFAULT_MEANS));
          face = { ...geo, colors: reading.map((c) => (c >= 0 ? COLOR_HEX[c] : null)) };
          if (t.phase === "running" && st.tracker) {
            const key = reading.join(",");
            st.stableCount = key === st.lastKey ? st.stableCount + 1 : 1;
            st.lastKey = key;
            if (st.stableCount === STABLE_FRAMES) {
              st.tracker.observe(reading, now - t.startAt);
              setLive(st.tracker.liveNotation());
            }
          }
        }
      }
    }

    const armed: PadState = t.phase === "ready" ? "ready" : "on";
    if (mode === "pads") {
      const hit = t.padsHit(palms);
      return {
        face,
        palms,
        pads: pads.map((pad, i) => ({ pad, state: hit[i] || st.space ? armed : "off", editable: t.phase !== "running" })),
      };
    }
    return {
      face,
      palms,
      rest: t.rest && (t.phase === "ready" || t.phase === "running")
        ? t.rest.map((at) => ({ at, r: STOP_R, state: t.phase === "ready" ? "ready" : "off" }))
        : undefined,
    };
  };

  const statusText = {
    idle: mode === "anywhere" ? "Rest both hands anywhere and keep them still (or hold Space)" : "Put both hands on the pads (or hold Space)",
    holding: "Hold…",
    ready: "Ready — lift your hands to start",
    running: mode === "anywhere"
      ? "Solving… put your hands back where they rested (or press any key) to stop"
      : "Solving… put both hands back on the pads (or press any key) to stop",
  }[phase];

  const locked = phase === "running";
  return (
    <section className="panel">
      <p className="eyebrow">Step 3 · Solve</p>
      <div className={`timer ${phase}`}>
        <div ref={timeEl} className="time mono">0.00</div>
        <div className="status">{statusText}</div>
      </div>
      <div className="scan-layout">
        <CameraStage stream={stream} onFrame={onFrame} onPointer={onPointer} />
        <div className="side">
          <h3>Start / stop</h3>
          <div className="seg horizontal">
            <button className={mode === "anywhere" ? "on" : ""} disabled={locked} onClick={() => setMode("anywhere")}>
              Hands anywhere
            </button>
            <button className={mode === "pads" ? "on" : ""} disabled={locked} onClick={() => setMode("pads")}>
              Pads
            </button>
          </div>
          <p className="muted small">
            {mode === "anywhere"
              ? "Wherever your hands rest when the timer turns green becomes the stop spot."
              : "Drag a pad to move it, or drag its white dot to resize. Positions are remembered."}
            {mode === "pads" && (
              <>
                {" "}
                <button className="link" disabled={locked} onClick={() => { const d = DEFAULT_PADS.map((p) => ({ ...p })); setPads(d); savePads(d); }}>
                  Reset pads
                </button>
              </>
            )}
          </p>

          <h3>Move tracking</h3>
          <div className="seg">
            <button className={source === "camera" ? "on" : ""} disabled={locked} onClick={() => setSource("camera")}>
              Camera (experimental)
            </button>
            <button className={source === "smart" ? "on" : ""} disabled={locked} onClick={smart ? () => setSource("smart") : connectSmart}>
              {smart ? `Smart cube: ${smart.name() ?? "connected"}` : "Connect smart cube"}
            </button>
            <button className={source === "none" ? "on" : ""} disabled={locked} onClick={() => setSource("none")}>
              Off — I'll type it
            </button>
          </div>
          {source === "camera" && (
            <p className="muted small">
              The cube is found wherever it is in view (purple grid). Keep one face toward the camera and turn
              deliberately with short pauses. {!means && "Scan the cube first for reliable colors."}
            </p>
          )}
          <p className="muted small">
            {handsStatus}. {opencv.cv ? "Face detector ready." : opencv.error ? "Face detector unavailable." : "Loading face detector…"}{" "}
            <button className="link" onClick={() => video.current && saveFrame(video.current, "solve")}>
              Save frame
            </button>
          </p>
          <div className="live mono">{live.length ? live.join(" ") : <span className="muted">Moves appear here</span>}</div>
          <p className="muted small">{live.filter((x) => !"xyz".includes(x[0])).length} moves</p>
        </div>
      </div>
    </section>
  );
}
