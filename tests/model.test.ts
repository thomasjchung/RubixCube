import { describe, expect, it } from "vitest";
import {
  applyMoves, isSolved, solved, parseAlg, invertAlg, validateState, ORIENTATIONS, stateToString, simplify, applyMove,
} from "../src/cube/model";

describe("model", () => {
  it("move orders", () => {
    for (const m of ["U", "R", "F", "D", "L", "B", "M", "E", "S", "r", "x", "y", "z"]) {
      expect(isSolved(applyMoves(solved(), [m, m, m, m]))).toBe(true);
      expect(isSolved(applyMoves(solved(), [m]))).toBe(m[0] === "x" || m[0] === "y" || m[0] === "z");
    }
  });
  it("sexy move has order 6", () => {
    const s = applyMoves(solved(), "R U R' U' ".repeat(6));
    expect(isSolved(s)).toBe(true);
    expect(isSolved(applyMoves(solved(), "R U R' U' ".repeat(3)))).toBe(false);
  });
  it("R moves F stickers to U (WCA convention)", () => {
    const s = applyMoves(solved(), "R");
    // U9 (front-right of U) now shows green (F color = 2)
    expect(s[8]).toBe(2);
    // U': F top row shows L's (orange=4) color? U moves F->L, so after U, F top shows R color (1)
    const u = applyMoves(solved(), "U");
    expect(u[18]).toBe(1);
    const fp = applyMoves(solved(), "F");
    // F moves U bottom row to R left column
    expect(fp[9]).toBe(0);
  });
  it("wide/slice/rotation identities", () => {
    const eq = (a: string, b: string) =>
      expect(stateToString(applyMoves(solved(), a))).toBe(stateToString(applyMoves(solved(), b)));
    eq("r", "L x");
    eq("M", "L' R x'");
    eq("E", "U D' y'");
    eq("S", "F' B z");
    eq("Rw2", "r2");
    eq("y", "u D'");
    eq("x", "r L'");
  });
  it("inverse", () => {
    const a = parseAlg("R U2 F' D L2 B r M' x y2 S E");
    expect(isSolved(applyMoves(applyMoves(solved(), a), invertAlg(a)))).toBe(true);
  });
  it("24 orientations", () => {
    expect(ORIENTATIONS.length).toBe(24);
  });
  it("validation", () => {
    expect(validateState(applyMoves(solved(), "R U F' D2 L B' M x"))).toBeNull();
    const s = solved();
    [s[7], s[19]] = [s[19], s[7]]; // flip UF edge
    expect(validateState(s)).toMatch(/flipped/);
    const t = applyMoves(solved(), "R");
    const c = solved();
    [c[8], c[9], c[20]] = [c[20], c[8], c[9]];
    expect(validateState(c)).toMatch(/twisted/);
    expect(t).toBeTruthy();
    // swap two edges (UF, UR)
    const p = solved();
    [p[7], p[5]] = [p[5], p[7]];
    [p[19], p[10]] = [p[10], p[19]];
    expect(validateState(p)).toMatch(/swapped/);
  });
  it("simplify", () => {
    expect(simplify(["R", "R", "U", "U'", "F"])).toEqual(["R2", "F"]);
    expect(applyMove(solved(), "R2")).toBeTruthy();
  });
});
