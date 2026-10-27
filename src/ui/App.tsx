import { useEffect, useMemo, useState } from "react";
import { exampleSolve, generatorFor } from "../cube/analysis";
import { applyMoves, parseAlg, solved, State } from "../cube/model";
import { randomScramble, scrambleSetup } from "../cube/scramble";
import type { Lab } from "../vision/colors";
import { formatTime } from "./format";
import { ReviewStep } from "./ReviewStep";
import { ScanStep } from "./ScanStep";
import { ScrambleStep } from "./ScrambleStep";
import { SolveResult, TimerStep } from "./TimerStep";
import { useCamera } from "./useCamera";

type Phase = "scramble" | "scan" | "timer" | "review";

interface HistoryEntry {
  ms: number;
  moves: number;
  at: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem("cfop-coach-history") ?? "[]");
  } catch {
    return [];
  }
}

/** `?demo` opens the review with a made-up solve (the example solution plus a wasted 8-move detour before the first pair). */
function demo() {
  const scramble = randomScramble();
  const state = applyMoves(solved(), scrambleSetup(scramble));
  const stages = exampleSolve(state, 0);
  const detour = parseAlg("U D' U' D R L' R' L");
  const moves = stages.flatMap((s, i) => (i === 1 ? [...detour, ...s.suggestion.moves] : s.suggestion.moves));
  const result: SolveResult = {
    ms: moves.length * 280,
    moves: moves.map((move, i) => ({ move, t: i * 280 })),
    source: "camera",
    trackedSolved: true,
  };
  return { scramble, start: { state, setup: scrambleSetup(scramble) }, result };
}

export function App() {
  const cam = useCamera();
  const initial = useMemo(() => (new URLSearchParams(location.search).has("demo") ? demo() : null), []);
  const [phase, setPhase] = useState<Phase>(initial ? "review" : "scramble");
  const [scramble, setScramble] = useState(() => initial?.scramble ?? randomScramble());
  const expected = useMemo(() => applyMoves(solved(), scrambleSetup(scramble)), [scramble]);
  const [start, setStart] = useState<{ state: State; setup: string[] } | null>(initial?.start ?? null);
  const [means, setMeans] = useState<Lab[] | null>(null);
  const [result, setResult] = useState<SolveResult | null>(initial?.result ?? null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  useEffect(() => {
    try {
      localStorage.setItem("cfop-coach-history", JSON.stringify(history.slice(-200)));
    } catch {
      /* storage unavailable */
    }
  }, [history]);

  const needsCamera = phase === "scan" || phase === "timer";
  useEffect(() => {
    if (needsCamera) void cam.start();
  }, [needsCamera, cam.start]);

  const next = () => {
    setScramble(randomScramble());
    setStart(null);
    setResult(null);
    setPhase("scramble");
  };

  const steps: [Phase, string][] = [["scramble", "Scramble"], ["scan", "Verify"], ["timer", "Solve"], ["review", "Review"]];

  return (
    <div className="app">
      <header className="top">
        <h1>CFOP Coach</h1>
        <nav className="steps">
          {steps.map(([p, label], i) => (
            <span key={p} className={p === phase ? "cur" : ""}>
              {i + 1}. {label}
            </span>
          ))}
        </nav>
      </header>

      <main>
        {needsCamera && !cam.stream && (
          <section className="panel center">
            {cam.error ? (
              <>
                <p className="error">Camera unavailable: {cam.error}</p>
                <button onClick={cam.start}>Try again</button>
              </>
            ) : (
              <p>Waiting for camera permission…</p>
            )}
          </section>
        )}

        {phase === "scramble" && (
          <ScrambleStep
            scramble={scramble}
            target={expected}
            onNew={() => setScramble(randomScramble())}
            onChange={setScramble}
            onScan={() => setPhase("scan")}
            onSkip={() => {
              setStart({ state: expected, setup: scrambleSetup(scramble) });
              setPhase("timer");
            }}
          />
        )}

        {phase === "scan" && cam.stream && (
          <ScanStep
            stream={cam.stream}
            expected={expected}
            onBack={() => setPhase("scramble")}
            onConfirm={(state, m, matches) => {
              setMeans(m);
              setStart({ state, setup: matches ? scrambleSetup(scramble) : generatorFor(state) });
              setPhase("timer");
            }}
          />
        )}

        {phase === "timer" && cam.stream && start && (
          <TimerStep
            stream={cam.stream}
            start={start.state}
            means={means}
            onDone={(r) => {
              setResult(r);
              setHistory((h) => [...h, { ms: r.ms, moves: r.moves.length, at: Date.now() }]);
              setPhase("review");
            }}
          />
        )}

        {phase === "review" && start && result && (
          <ReviewStep start={start.state} setup={start.setup} result={result} onNext={next} />
        )}
      </main>

      {history.length > 0 && (
        <footer className="history">
          <span className="muted">Recent:</span>
          {history.slice(-12).reverse().map((h) => (
            <span key={h.at} className="mono">{formatTime(h.ms)}</span>
          ))}
          <span className="muted">
            · best {formatTime(Math.min(...history.map((h) => h.ms)))}
            {history.length >= 5 && ` · ao5 ${formatTime(ao5(history))}`}
          </span>
        </footer>
      )}
    </div>
  );
}

function ao5(h: HistoryEntry[]): number {
  const last = h.slice(-5).map((x) => x.ms).sort((a, b) => a - b);
  return (last[1] + last[2] + last[3]) / 3;
}
