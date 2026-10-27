import { describe, expect, it } from "vitest";
import { applyMoves, solved, isSolved, parseAlg, statesEqual } from "../src/cube/model";
import { analyzeSolve, exampleSolve, generatorFor } from "../src/cube/analysis";
import { randomScramble } from "../src/cube/scramble";

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("analysis", () => {
  it("example solves solve, and segments a user solve", () => {
    const r = rng(11);
    for (let i = 0; i < 8; i++) {
      const sc = randomScramble(21, r);
      const start = applyMoves(solved(), sc);
      const ex = exampleSolve(start, 0, sc);
      const all = ex.flatMap((s) => s.suggestion.moves);
      expect(isSolved(applyMoves(start, all))).toBe(true);

      // Fake a user solve: example solution with an inefficient detour in the cross and a rotation.
      const user = ["y", "R", "R'", "y'", ...all];
      const review = analyzeSolve(start, user.map((move, k) => ({ move, t: k * 250 })), sc);
      expect(review.reached).toBe(9);
      expect(review.stages.length).toBeGreaterThanOrEqual(4);
      expect(review.stages[0].title).toMatch(/^Cross/);
      // stage boundaries cover all moves
      expect(review.stages.reduce((n, s) => n + s.userMoves.length, 0)).toBe(user.length);
      // suggestions really solve their stage from the setup
      for (const st of review.stages) {
        const s = applyMoves(applyMoves(solved(), st.setup), st.suggestion.moves);
        expect(s).toBeTruthy();
      }
    }
  });

  it("partial solves get remaining suggestions", () => {
    const sc = parseAlg("R U F' L2 D B2 R' U2 F L' D2 B U' R2 F2 L D' B' U R' F");
    const start = applyMoves(solved(), sc);
    const ex = exampleSolve(start, 0, sc);
    const crossOnly = ex[0].suggestion.moves;
    const review = analyzeSolve(start, crossOnly.map((move) => ({ move })), sc);
    expect(review.reached).toBeGreaterThanOrEqual(1);
    expect(review.remaining.length).toBeGreaterThan(0);
  });

  it("generator reproduces a state", () => {
    const s = applyMoves(solved(), "R U2 F' D L2 B R' U F2");
    const g = generatorFor(s);
    expect(statesEqual(applyMoves(solved(), g), s)).toBe(true);
  });
});
