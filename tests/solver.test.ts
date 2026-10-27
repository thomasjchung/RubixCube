import { describe, expect, it } from "vitest";
import { applyMoves, solved, FACE_MOVES, isSolved } from "../src/cube/model";
import {
  solveCross, isCrossSolved, solvePair, solvedSlots, bestByErgonomics, isF2LSolved,
  OLL_EDGE_ALGS, OLL_CORNER_ALGS, PLL_CORNER_ALGS, PLL_EDGE_ALGS, solveLLStep, isEOSolved, isOLLSolved, isCPSolved,
} from "../src/cube/solver";

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
function randomScramble(r: () => number, n = 25) {
  const out: string[] = [];
  while (out.length < n) {
    const m = FACE_MOVES[Math.floor(r() * 18)];
    if (out.length && out[out.length - 1][0] === m[0]) continue;
    out.push(m);
  }
  return out;
}

export function cfopSolve(start: ReturnType<typeof solved>) {
  let s = start;
  const cross = bestByErgonomics(solveCross(s));
  s = applyMoves(s, cross);
  const pairs: string[][] = [];
  while (solvedSlots(s).length < 4) {
    const done = solvedSlots(s);
    let best: string[] | null = null;
    for (const slot of [0, 1, 2, 3].filter((x) => !done.includes(x))) {
      const sol = bestByErgonomics(solvePair(s, slot, done, 20));
      if (!best || sol.length < best.length) best = sol;
    }
    pairs.push(best!);
    s = applyMoves(s, best!);
  }
  const eo = solveLLStep(s, OLL_EDGE_ALGS, isEOSolved)!;
  s = applyMoves(s, eo.moves);
  const co = solveLLStep(s, OLL_CORNER_ALGS, isOLLSolved)!;
  s = applyMoves(s, co.moves);
  const cp = solveLLStep(s, PLL_CORNER_ALGS, isCPSolved)!;
  s = applyMoves(s, cp.moves);
  const ep = solveLLStep(s, PLL_EDGE_ALGS, isSolved, true)!;
  s = applyMoves(s, ep.moves);
  return { s, cross, pairs, ll: [eo, co, cp, ep] };
}

describe("solver", () => {
  it("cross is optimal and solves", () => {
    const r = rng(7);
    for (let i = 0; i < 20; i++) {
      const s = applyMoves(solved(), randomScramble(r));
      const sols = solveCross(s);
      expect(sols.length).toBeGreaterThan(0);
      expect(sols[0].length).toBeLessThanOrEqual(8);
      for (const sol of sols.slice(0, 5)) expect(isCrossSolved(applyMoves(s, sol))).toBe(true);
    }
  });

  it("full CFOP solve on random scrambles", () => {
    const r = rng(42);
    for (let i = 0; i < 15; i++) {
      const sc = randomScramble(r);
      const t0 = performance.now();
      const res = cfopSolve(applyMoves(solved(), sc));
      const ms = performance.now() - t0;
      console.log(i, ms.toFixed(0) + "ms", "cross", res.cross.join(" "), "| pairs", res.pairs.map((p) => p.length).join(","), "| ll", res.ll.map((l) => l.case).join(","));
      expect(isSolved(res.s)).toBe(true);
    }
  }, 120000);

  it("LL algs cover random last layers", () => {
    const r = rng(3);
    const gens = ["R U R' U R U2 R'", "R U R' U' R' F R2 U' R' U' R U R' F'", "F R U R' U' F'", "U", "M2 U M2 U2 M2 U M2", "r U R' U' r' F R F'"];
    for (let i = 0; i < 300; i++) {
      let s = solved();
      for (let k = 0; k < 12; k++) s = applyMoves(s, gens[Math.floor(r() * gens.length)]);
      expect(isF2LSolved(s)).toBe(true);
      const eo = solveLLStep(s, OLL_EDGE_ALGS, isEOSolved);
      expect(eo).not.toBeNull();
      s = applyMoves(s, eo!.moves);
      const co = solveLLStep(s, OLL_CORNER_ALGS, isOLLSolved);
      expect(co).not.toBeNull();
      s = applyMoves(s, co!.moves);
      const cp = solveLLStep(s, PLL_CORNER_ALGS, isCPSolved);
      expect(cp).not.toBeNull();
      s = applyMoves(s, cp!.moves);
      const ep = solveLLStep(s, PLL_EDGE_ALGS, isSolved, true);
      expect(ep).not.toBeNull();
    }
  });
});
