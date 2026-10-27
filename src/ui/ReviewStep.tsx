import { useMemo, useState } from "react";
import { analyzeSolve, LEVEL_NAMES, SolveReview, StageReview, TimedMove } from "../cube/analysis";
import { COLOR_NAMES, parseAlg, simplify, State } from "../cube/model";
import { alg, formatTime } from "./format";
import type { SolveResult } from "./TimerStep";
import { Twisty } from "./Twisty";

interface Props {
  start: State;
  setup: string[];
  result: SolveResult;
  onNext: () => void;
}

export function ReviewStep({ start, setup, result, onNext }: Props) {
  const [moves, setMoves] = useState<TimedMove[]>(result.moves);
  const [text, setText] = useState(alg(simplify(result.moves.map((m) => m.move))));
  const [err, setErr] = useState<string | null>(null);
  const review = useMemo(() => analyzeSolve(start, moves, setup), [start, moves, setup]);

  const reanalyze = () => {
    try {
      const parsed = parseAlg(text);
      // Timestamps only survive if the moves are unchanged.
      const same = parsed.join(" ") === alg(simplify(result.moves.map((m) => m.move)));
      setMoves(same ? result.moves : parsed.map((move) => ({ move })));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const tps = review.totalMoves / (result.ms / 1000);
  const tracked = moves.length > 0;

  return (
    <section className="panel">
      <p className="eyebrow">Step 4 · Review</p>
      <div className="summary">
        <Stat label="Time" value={formatTime(result.ms)} />
        <Stat label="Moves" value={tracked ? String(review.totalMoves) : "—"} />
        <Stat label="TPS" value={tracked ? tps.toFixed(2) : "—"} />
        <Stat label="Cross" value={COLOR_NAMES[review.crossColor]} />
        <Stat label="Example CFOP" value={`${review.exampleCount} moves`} />
      </div>

      {result.source === "camera" && !result.trackedSolved && tracked && (
        <p className="warn">
          The camera tracker lost the cube partway (it reached <b>{LEVEL_NAMES[review.reached]}</b>). Fix the
          reconstruction below and re-analyze to get a full review.
        </p>
      )}
      {!tracked && (
        <p className="warn">No moves were recorded. Type your solution below (like a cstimer reconstruction) to get a review, or study the example solve.</p>
      )}

      <details className="recon" open={!tracked || (result.source === "camera" && !result.trackedSolved)}>
        <summary>Reconstruction ({review.totalMoves} moves) — edit & re-analyze</summary>
        <p className="muted small">Scramble: <span className="mono">{alg(setup)}</span></p>
        <textarea className="mono" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button onClick={reanalyze}>Re-analyze</button>
      </details>

      {review.stages.length > 0 && <h3>Your solve, stage by stage</h3>}
      {review.stages.map((s, i) => (
        <StageCard key={i} stage={s} mine />
      ))}

      {review.remaining.length > 0 && tracked && (
        <>
          <h3>How to finish from where tracking stopped</h3>
          {review.remaining.map((s, i) => (
            <StageCard key={i} stage={s} />
          ))}
        </>
      )}

      <ExampleSolve review={review} />

      <div className="row center">
        <button className="primary" onClick={onNext}>Next scramble</button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-v mono">{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

function StageCard({ stage, mine }: { stage: StageReview; mine?: boolean }) {
  const [show, setShow] = useState<"none" | "better" | "mine">("none");
  const saved = stage.userCount - stage.suggestedCount;
  const verdict = !mine ? "" : saved >= 3 ? "bad" : saved > 0 ? "meh" : "good";
  return (
    <article className={`stage ${verdict}`}>
      <header>
        <h4>{stage.title}</h4>
        {mine && (
          <span className={`badge ${verdict}`}>
            {saved > 0 ? `${saved} moves to save` : "efficient"}
          </span>
        )}
      </header>
      <div className="cols">
        {mine && (
          <div>
            <div className="label">
              You · {stage.userCount} moves{stage.userMs !== undefined ? ` · ${formatTime(stage.userMs)}s` : ""}
            </div>
            <div className="mono algtext">{alg(simplify(stage.userMoves)) || "—"}</div>
          </div>
        )}
        <div>
          <div className="label">
            {mine ? "Better" : "Suggested"} · {stage.suggestedCount} moves
            {stage.suggestion.caseName ? ` · ${stage.suggestion.caseName}` : ""}
          </div>
          <div className="mono algtext">{alg(stage.suggestion.moves) || "(nothing to do)"}</div>
          <div className="muted small">{stage.suggestion.hold}</div>
        </div>
      </div>
      {stage.tips.length > 0 && (
        <ul className="tips">
          {stage.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className={show === "better" ? "on" : "ghost"} onClick={() => setShow(show === "better" ? "none" : "better")}>
          {show === "better" ? "Hide" : "Show me the better way"}
        </button>
        {mine && stage.userMoves.length > 0 && (
          <button className={show === "mine" ? "on" : "ghost"} onClick={() => setShow(show === "mine" ? "none" : "mine")}>
            {show === "mine" ? "Hide" : "Replay mine"}
          </button>
        )}
      </div>
      {show !== "none" && (
        <Twisty setup={alg(stage.setup)} alg={alg(show === "better" ? stage.suggestion.moves : stage.userMoves)} />
      )}
    </article>
  );
}

function ExampleSolve({ review }: { review: SolveReview }) {
  return (
    <details className="example">
      <summary>Example CFOP solve for this scramble ({review.exampleCount} moves, beginner 2-look last layer)</summary>
      {review.example.map((s, i) => (
        <StageCard key={i} stage={s} />
      ))}
    </details>
  );
}
