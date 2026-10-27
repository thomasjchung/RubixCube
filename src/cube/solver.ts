// CFOP step solvers used to suggest better solutions.
//
// All searches work in a canonical frame: cross color on D. Pieces are tracked by the
// location of one of their stickers (a facelet index), which encodes both position and
// orientation, so a "piece state" is just a small integer.

import {
  applyMoves, CENTER, CORNERS, EDGES, FACE_MOVES, MOVE_PERMS, State, STICKER_FACE,
} from "./model";

// Edge sticker locations 0..23 and corner sticker locations 0..23.
const EDGE_STICKERS = EDGES.flat();
const CORNER_STICKERS = CORNERS.flat();
const EDGE_LOC = new Int8Array(54).fill(-1);
const CORNER_LOC = new Int8Array(54).fill(-1);
EDGE_STICKERS.forEach((s, i) => (EDGE_LOC[s] = i));
CORNER_STICKERS.forEach((s, i) => (CORNER_LOC[s] = i));

/** For each move, where an edge/corner sticker location goes. */
function locTables(moves: string[], stickers: number[], loc: Int8Array): Int8Array[] {
  return moves.map((mv) => {
    const dest = MOVE_PERMS.get(mv)!.dest;
    return Int8Array.from(stickers, (s) => loc[dest[s]]);
  });
}

const ALL_MOVES = FACE_MOVES; // 18
// F2L search never needs D turns (they would only have to be undone).
const F2L_MOVES = FACE_MOVES.filter((m) => m[0] !== "D");

const EDGE_MOVE_ALL = locTables(ALL_MOVES, EDGE_STICKERS, EDGE_LOC);
const CORNER_MOVE_ALL = locTables(ALL_MOVES, CORNER_STICKERS, CORNER_LOC);
const F2L_IDX = F2L_MOVES.map((m) => ALL_MOVES.indexOf(m));

// ---------------------------------------------------------------------------
// Piece lookup in the canonical frame (cross on D, as the state's centers say).

/** Location of the sticker of the piece whose colors are exactly `colors`; returns the location of the sticker with colors[0]. */
function findEdge(s: State, a: number, b: number): number {
  for (const [x, y] of EDGES) {
    if (s[x] === a && s[y] === b) return EDGE_LOC[x];
    if (s[y] === a && s[x] === b) return EDGE_LOC[y];
  }
  throw new Error("edge not found");
}

function findCorner(s: State, a: number, b: number, c: number): number {
  for (const st of CORNERS) {
    const cols = st.map((i) => s[i]);
    const k = cols.indexOf(a);
    if (k >= 0 && cols.includes(b) && cols.includes(c)) return CORNER_LOC[st[k]];
  }
  throw new Error("corner not found");
}

const SIDE_FACES = [2, 1, 5, 4]; // F R B L (clockwise seen from U)

/** Home sticker location (the D-colored sticker for cross edges) of the D-edge under side face f. */
function crossEdgeHome(side: number): number {
  const e = EDGES.find((st) => st.some((i) => STICKER_FACE[i] === 3) && st.some((i) => STICKER_FACE[i] === side))!;
  return EDGE_LOC[e.find((i) => STICKER_FACE[i] === 3)!];
}

export interface Slot {
  /** the two side faces (canonical frame) bounding the slot, clockwise order f1 -> f2 seen from U */
  faces: [number, number];
}
export const SLOTS: Slot[] = [
  { faces: [2, 1] }, // FR
  { faces: [1, 5] }, // BR
  { faces: [5, 4] }, // BL
  { faces: [4, 2] }, // FL
];
export const SLOT_NAMES = ["front-right", "back-right", "back-left", "front-left"];

function slotCornerHome(slot: Slot): number {
  const c = CORNERS.find((st) => [3, ...slot.faces].every((f) => st.some((i) => STICKER_FACE[i] === f)))!;
  return CORNER_LOC[c.find((i) => STICKER_FACE[i] === 3)!];
}
function slotEdgeHome(slot: Slot): number {
  const e = EDGES.find((st) => slot.faces.every((f) => st.some((i) => STICKER_FACE[i] === f)))!;
  return EDGE_LOC[e.find((i) => STICKER_FACE[i] === slot.faces[0])!];
}

// ---------------------------------------------------------------------------
// Cross: 4 edges, 24^4 states, full BFS distance table.

let crossTable: Uint8Array | null = null;
const crossHomes = SIDE_FACES.map(crossEdgeHome);

function crossIndex(a: number, b: number, c: number, d: number) {
  return ((a * 24 + b) * 24 + c) * 24 + d;
}

function getCrossTable(): Uint8Array {
  if (crossTable) return crossTable;
  const t = new Uint8Array(24 ** 4).fill(255);
  let frontier = [crossHomes.slice()];
  t[crossIndex(crossHomes[0], crossHomes[1], crossHomes[2], crossHomes[3])] = 0;
  for (let depth = 0; frontier.length; depth++) {
    const next: number[][] = [];
    for (const p of frontier)
      for (const mt of EDGE_MOVE_ALL) {
        const q = [mt[p[0]], mt[p[1]], mt[p[2]], mt[p[3]]];
        const k = crossIndex(q[0], q[1], q[2], q[3]);
        if (t[k] === 255) {
          t[k] = depth + 1;
          next.push(q);
        }
      }
    frontier = next;
  }
  crossTable = t;
  return t;
}

function crossPieces(s: State): number[] {
  const d = s[CENTER(3)];
  return SIDE_FACES.map((f) => findEdge(s, d, s[CENTER(f)]));
}

export function crossDistance(s: State): number {
  const p = crossPieces(s);
  return getCrossTable()[crossIndex(p[0], p[1], p[2], p[3])];
}

/** All optimal cross solutions (state must have the cross color on D). */
export function solveCross(s: State, limit = 300): string[][] {
  const t = getCrossTable();
  const out: string[][] = [];
  const rec = (p: number[], path: string[], lastAxisFace: string) => {
    if (out.length >= limit) return;
    const d = t[crossIndex(p[0], p[1], p[2], p[3])];
    if (d === 0) {
      out.push(path.slice());
      return;
    }
    for (let m = 0; m < ALL_MOVES.length; m++) {
      const mv = ALL_MOVES[m];
      if (!allowedAfter(lastAxisFace, mv)) continue;
      const mt = EDGE_MOVE_ALL[m];
      const q = [mt[p[0]], mt[p[1]], mt[p[2]], mt[p[3]]];
      if (t[crossIndex(q[0], q[1], q[2], q[3])] === d - 1) {
        path.push(mv);
        rec(q, path, mv[0]);
        path.pop();
      }
    }
  };
  rec(crossPieces(s), [], "");
  return out;
}

const OPPOSITE: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
// Avoid redundant sequences: same face twice, or opposite faces in non-canonical order.
function allowedAfter(last: string, mv: string): boolean {
  const f = mv[0];
  if (f === last) return false;
  if (OPPOSITE[f] === last && "DLB".includes(f) === false) return false;
  return true;
}

// ---------------------------------------------------------------------------
// F2L: per-slot pair tables (corner x edge = 576 states) plus the cross table,
// combined with max() as an admissible heuristic for IDA*.

const pairTables = new Map<number, Uint8Array>();

function getPairTable(slotIdx: number): Uint8Array {
  const cached = pairTables.get(slotIdx);
  if (cached) return cached;
  const slot = SLOTS[slotIdx];
  const ch = slotCornerHome(slot);
  const eh = slotEdgeHome(slot);
  const t = new Uint8Array(576).fill(255);
  t[ch * 24 + eh] = 0;
  let frontier = [[ch, eh]];
  for (let depth = 0; frontier.length; depth++) {
    const next: number[][] = [];
    for (const [c, e] of frontier)
      for (const m of F2L_IDX) {
        const c2 = CORNER_MOVE_ALL[m][c];
        const e2 = EDGE_MOVE_ALL[m][e];
        if (t[c2 * 24 + e2] === 255) {
          t[c2 * 24 + e2] = depth + 1;
          next.push([c2, e2]);
        }
      }
    frontier = next;
  }
  pairTables.set(slotIdx, t);
  return t;
}

function pairPieces(s: State, slotIdx: number): [number, number] {
  const [f1, f2] = SLOTS[slotIdx].faces;
  const d = s[CENTER(3)];
  const a = s[CENTER(f1)];
  const b = s[CENTER(f2)];
  return [findCorner(s, d, a, b), findEdge(s, a, b)];
}

export function isCrossSolved(s: State): boolean {
  return crossDistance(s) === 0;
}

export function isSlotSolved(s: State, slotIdx: number): boolean {
  const [c, e] = pairPieces(s, slotIdx);
  return getPairTable(slotIdx)[c * 24 + e] === 0;
}

export function solvedSlots(s: State): number[] {
  return [0, 1, 2, 3].filter((i) => isSlotSolved(s, i));
}

export interface F2LSolution {
  slot: number;
  moves: string[];
}

/**
 * Optimal solutions (in canonical frame) that insert the pair for `slotIdx` while keeping the
 * cross and every slot in `keep` solved. Returns up to `limit` solutions of minimal length.
 */
export function solvePair(s: State, slotIdx: number, keep: number[], limit = 60, maxDepth = 14): string[][] {
  const ct = getCrossTable();
  const tables = [slotIdx, ...keep].map(getPairTable);
  const cross0 = crossPieces(s);
  const pairs0 = [slotIdx, ...keep].map((i) => pairPieces(s, i));
  const out: string[][] = [];
  const path: string[] = [];

  const h = (cr: number[], pr: number[][]) => {
    let v = ct[crossIndex(cr[0], cr[1], cr[2], cr[3])];
    for (let i = 0; i < pr.length; i++) {
      const d = tables[i][pr[i][0] * 24 + pr[i][1]];
      if (d > v) v = d;
    }
    return v;
  };

  const dfs = (cr: number[], pr: number[][], g: number, bound: number, last: string): void => {
    const hv = h(cr, pr);
    if (hv === 0) {
      if (g === bound) out.push(path.slice());
      return;
    }
    if (g + hv > bound) return;
    for (const m of F2L_IDX) {
      if (out.length >= limit) return;
      const mv = ALL_MOVES[m];
      if (!allowedAfter(last, mv)) continue;
      const et = EDGE_MOVE_ALL[m];
      const ctb = CORNER_MOVE_ALL[m];
      const cr2 = [et[cr[0]], et[cr[1]], et[cr[2]], et[cr[3]]];
      const pr2 = pr.map(([c, e]) => [ctb[c], et[e]]);
      path.push(mv);
      dfs(cr2, pr2, g + 1, bound, mv[0]);
      path.pop();
    }
  };

  for (let bound = h(cross0, pairs0); bound <= maxDepth && out.length === 0; bound++) dfs(cross0, pairs0, 0, bound, "");
  return out;
}

// ---------------------------------------------------------------------------
// Ergonomics: rank equally short solutions so suggestions favour R/U/F-style algs.

const MOVE_COST: Record<string, number> = { U: 1, R: 1, F: 1.6, L: 1.5, B: 2.4, D: 1.8 };

export function ergonomicCost(moves: string[]): number {
  let cost = 0;
  let prev = "";
  for (const mv of moves) {
    const f = mv[0];
    cost += MOVE_COST[f] ?? 2;
    if (mv.endsWith("2") && f !== "U") cost += 0.3;
    if (prev && prev !== f && prev !== "U" && f !== "U") cost += 0.4; // non-U face to non-U face = regrip-ish
    prev = f;
  }
  return cost;
}

export function bestByErgonomics(solutions: string[][]): string[] {
  return solutions.slice().sort((a, b) => ergonomicCost(a) - ergonomicCost(b))[0] ?? [];
}

// ---------------------------------------------------------------------------
// Last layer (beginner 2-look OLL / PLL), canonical frame with LL on U.

export interface LLAlg {
  name: string;
  alg: string;
}

export const OLL_EDGE_ALGS: LLAlg[] = [
  { name: "Line", alg: "F R U R' U' F'" },
  { name: "L-shape", alg: "f R U R' U' f'" },
  { name: "Dot", alg: "F R U R' U' F' f R U R' U' f'" },
];
export const OLL_CORNER_ALGS: LLAlg[] = [
  { name: "Sune", alg: "R U R' U R U2 R'" },
  { name: "Antisune", alg: "R U2 R' U' R U' R'" },
  { name: "H", alg: "R U R' U R U' R' U R U2 R'" },
  { name: "Pi", alg: "R U2 R2 U' R2 U' R2 U2 R" },
  { name: "Headlights (U)", alg: "R2 D R' U2 R D' R' U2 R'" },
  { name: "T", alg: "r U R' U' r' F R F'" },
  { name: "Bowtie (L)", alg: "F' r U R' U' r' F R" },
];
export const PLL_CORNER_ALGS: LLAlg[] = [
  { name: "Headlights → T-perm", alg: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { name: "Diagonal → Y-perm", alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
];
export const PLL_EDGE_ALGS: LLAlg[] = [
  { name: "Ua-perm", alg: "R U' R U R U R U' R' U' R2" },
  { name: "Ub-perm", alg: "R2 U R U R' U' R' U' R' U R'" },
  { name: "H-perm", alg: "M2 U M2 U2 M2 U M2" },
  { name: "Z-perm", alg: "M2 U M2 U M' U2 M2 U2 M' U2" },
];

const U_FACELETS = Array.from({ length: 9 }, (_, i) => i);

export function isF2LSolved(s: State): boolean {
  return isCrossSolved(s) && solvedSlots(s).length === 4;
}

/** LL edges oriented (cross on U face). */
export function isEOSolved(s: State): boolean {
  return [1, 3, 5, 7].every((i) => s[i] === s[4]);
}
export function isOLLSolved(s: State): boolean {
  return U_FACELETS.every((i) => s[i] === s[4]);
}
/** All corners are in place relative to each other (allowing a final AUF). */
export function isCPSolved(s: State): boolean {
  return ["", "U", "U2", "U'"].some((auf) => cornersSolved(auf ? applyMoves(s, auf) : s));
}
function cornersSolved(s: State): boolean {
  return CORNERS.every((st) => st.every((i) => s[i] === s[CENTER(STICKER_FACE[i])]));
}

export interface LLStep {
  case: string;
  /** full move list including AUFs */
  moves: string[];
}

const AUFS = ["", "U", "U'", "U2"];

/** Find which alg from `algs` (with a pre-AUF) reaches `goal`. Optionally allows a post-AUF. */
export function solveLLStep(s: State, algs: LLAlg[], goal: (s: State) => boolean, postAuf = false): LLStep | null {
  if (goal(s)) return { case: "skip", moves: [] };
  if (postAuf) for (const a of AUFS.slice(1)) if (goal(applyMoves(s, a))) return { case: "AUF only", moves: [a] };
  let best: LLStep | null = null;
  for (const a of algs)
    for (const pre of AUFS)
      for (const post of postAuf ? AUFS : [""]) {
        const seq = [pre, a.alg, post].filter(Boolean).join(" ");
        if (goal(applyMoves(s, seq))) {
          const moves = seq.split(/\s+/);
          if (!best || moves.length < best.moves.length) best = { case: a.name, moves };
        }
      }
  return best;
}

export function finalAuf(s: State): string[] {
  for (const a of AUFS) if (isSolvedCube(a ? applyMoves(s, a) : s)) return a ? [a] : [];
  return [];
}

function isSolvedCube(s: State): boolean {
  for (let i = 0; i < 54; i++) if (s[i] !== s[CENTER(STICKER_FACE[i])]) return false;
  return true;
}
