import { useState } from "react";
import { CENTER, COLOR_NAMES, parseAlg, State } from "../cube/model";
import { CubeNet } from "./CubeNet";
import { alg } from "./format";

interface Props {
  scramble: string[];
  /** the cube as it should look after scrambling, in the scrambling hold */
  target: State;
  onNew: () => void;
  onChange: (moves: string[]) => void;
  onScan: () => void;
  onSkip: () => void;
}

export function ScrambleStep({ scramble, target, onNew, onChange, onScan, onSkip }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const hold = `${COLOR_NAMES[target[CENTER(3)]]} on the bottom, ${COLOR_NAMES[target[CENTER(2)]]} in front`;

  return (
    <section className="panel">
      <p className="eyebrow">Step 1 · Scramble</p>
      <h2>Hold {hold}, and apply:</h2>
      {editing ? (
        <div className="row">
          <input className="mono grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a scramble" />
          <button
            onClick={() => {
              try {
                const m = parseAlg(text);
                onChange(m);
                setEditing(false);
                setErr(null);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Use
          </button>
        </div>
      ) : (
        <p className="scramble mono">{alg(scramble)}</p>
      )}
      {err && <p className="error">{err}</p>}
      <div className="row center">
        <CubeNet state={target} size={22} />
      </div>
      <p className="muted center">This is what your cube should look like afterwards ({hold}).</p>
      <div className="row center">
        <button className="ghost" onClick={onNew}>New scramble</button>
        <button className="ghost" onClick={() => { setText(alg(scramble)); setEditing(true); }}>Type my own</button>
        <button className="primary" onClick={onScan}>Done — scan to verify</button>
      </div>
      <p className="center">
        <button className="link" onClick={onSkip}>Skip the scan (trust the scramble)</button>
      </p>
    </section>
  );
}
