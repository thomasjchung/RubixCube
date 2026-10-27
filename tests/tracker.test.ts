import { describe, expect, it } from "vitest";
import { applyMoves, solved, isSolved, applyMove } from "../src/cube/model";
import { exampleSolve } from "../src/cube/analysis";
import { MoveTracker } from "../src/vision/tracker";
import { randomScramble } from "../src/cube/scramble";

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("tracker (simulated camera)", () => {
  it("recovers a solve from front-face observations", () => {
    const r = rng(5);
    let ok = 0;
    const N = 6;
    for (let n = 0; n < N; n++) {
      const sc = randomScramble(21, r);
      const start = applyMoves(solved(), sc);
      const tr = new MoveTracker(start);
      let s = applyMoves(start, ["y"]); // the solver picks it up rotated
      const sol = exampleSolve(s, 0).flatMap((st) => st.suggestion.moves);
      const t0 = performance.now();
      const observe = (st: typeof s, t: number) => {
        // one random sticker hidden by a finger
        const face = Array.from(st.slice(18, 27));
        face[Math.floor(r() * 9)] = -1;
        tr.observe(face, t);
      };
      observe(s, 0);
      const actual = ["y", ...sol];
      for (let i = 0; i < sol.length; i++) {
        s = applyMove(s, sol[i]);
        // sometimes two moves happen between readings
        if (r() < 0.3 && i + 1 < sol.length) { i++; s = applyMove(s, sol[i]); }
        observe(s, i * 200);
      }
      const res = tr.finish(9999);
      const ms = performance.now() - t0;
      console.log(`solve ${n}: ${actual.length} moves, tracked ${res.moves.length}, solved=${res.solved}, ${ms.toFixed(0)}ms total`);
      if (res.solved && isSolved(applyMoves(start, res.moves.map((m) => m.move)))) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(N - 2);
  }, 120000);
});
