// Facelet model of a 3x3 cube.
//
// A state is 54 color indices in Kociemba order: U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9.
// Color i is the color of face i's center on a solved cube in WCA orientation
// (white top, green front), so the solved state is [0 x9, 1 x9, ..., 5 x9].
//
// Every move (face turns, wide turns, slices, whole-cube rotations) is derived from
// 3D geometry so they are all guaranteed to be consistent with each other.

export type State = Uint8Array;

export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type FaceName = (typeof FACES)[number];

export const COLOR_NAMES = ["white", "red", "green", "yellow", "orange", "blue"];
export const COLOR_HEX = ["#f4f4f4", "#d62828", "#2a9d3c", "#ffd60a", "#f77f00", "#1d4ed8"];

type Vec = [number, number, number];

// Outward normal of each face. x = right, y = up, z = front.
const NORMALS: Record<FaceName, Vec> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

// Position of the cubie that carries facelet (row, col) of each face.
function faceletPos(face: FaceName, r: number, c: number): Vec {
  switch (face) {
    case "U": return [c - 1, 1, r - 1];
    case "R": return [1, 1 - r, 1 - c];
    case "F": return [c - 1, 1 - r, 1];
    case "D": return [c - 1, -1, 1 - r];
    case "L": return [-1, 1 - r, c - 1];
    case "B": return [1 - c, 1 - r, -1];
  }
}

const key = (p: Vec, n: Vec) => `${p.join(",")}|${n.join(",")}`;

const FACELET_POS: Vec[] = [];
const FACELET_NORMAL: Vec[] = [];
const INDEX_OF = new Map<string, number>();
FACES.forEach((f, fi) => {
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const i = fi * 9 + r * 3 + c;
      FACELET_POS[i] = faceletPos(f, r, c);
      FACELET_NORMAL[i] = NORMALS[f];
      INDEX_OF.set(key(FACELET_POS[i], NORMALS[f]), i);
    }
});

/** Rotate v by +90 degrees (right-hand rule) about the given axis, `times` times. */
function rot(v: Vec, axis: number, times: number): Vec {
  let [x, y, z] = v;
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [z, x] = [-x, z];
    else [x, y] = [-y, x];
  }
  return [x, y, z];
}

/**
 * A move as a permutation: after the move, newState[i] = oldState[src[i]].
 * `dest` is the inverse: the sticker at i moves to dest[i].
 */
export interface Perm {
  src: Uint8Array;
  dest: Uint8Array;
}

function permFromLayers(axis: number, layers: number[], quarterTurnsCCW: number): Perm {
  const src = new Uint8Array(54);
  const dest = new Uint8Array(54);
  for (let i = 0; i < 54; i++) {
    const p = FACELET_POS[i];
    let j = i;
    if (layers.includes(p[axis])) {
      j = INDEX_OF.get(key(rot(p, axis, quarterTurnsCCW), rot(FACELET_NORMAL[i], axis, quarterTurnsCCW)))!;
    }
    dest[i] = j;
    src[j] = i;
  }
  return { src, dest };
}

// For each base move: axis, layers, and the sign that makes a single turn clockwise
// when viewed from that move's reference face.
const BASE: Record<string, { axis: number; layers: number[]; sign: number }> = {
  U: { axis: 1, layers: [1], sign: -1 },
  D: { axis: 1, layers: [-1], sign: 1 },
  R: { axis: 0, layers: [1], sign: -1 },
  L: { axis: 0, layers: [-1], sign: 1 },
  F: { axis: 2, layers: [1], sign: -1 },
  B: { axis: 2, layers: [-1], sign: 1 },
  u: { axis: 1, layers: [1, 0], sign: -1 },
  d: { axis: 1, layers: [-1, 0], sign: 1 },
  r: { axis: 0, layers: [1, 0], sign: -1 },
  l: { axis: 0, layers: [-1, 0], sign: 1 },
  f: { axis: 2, layers: [1, 0], sign: -1 },
  b: { axis: 2, layers: [-1, 0], sign: 1 },
  M: { axis: 0, layers: [0], sign: 1 },
  E: { axis: 1, layers: [0], sign: 1 },
  S: { axis: 2, layers: [0], sign: -1 },
  x: { axis: 0, layers: [-1, 0, 1], sign: -1 },
  y: { axis: 1, layers: [-1, 0, 1], sign: -1 },
  z: { axis: 2, layers: [-1, 0, 1], sign: -1 },
};

export const MOVE_PERMS = new Map<string, Perm>();
for (const [name, b] of Object.entries(BASE)) {
  const variants: [string, number][] = [[name, 1], [name + "2", 2], [name + "'", 3]];
  for (const [mv, n] of variants) MOVE_PERMS.set(mv, permFromLayers(b.axis, b.layers, b.sign * n));
}

export const FACE_MOVES = ["U", "R", "F", "D", "L", "B"].flatMap((f) => [f, f + "2", f + "'"]);
export const ROTATIONS = ["x", "y", "z"].flatMap((f) => [f, f + "2", f + "'"]);

/** Normalize one token of notation (Rw -> r, R2' -> R2, R3 -> R'). Returns null if unknown. */
export function normalizeMove(tok: string): string | null {
  let t = tok.trim().replace(/[’`´]/g, "'");
  if (!t) return null;
  const m = /^([URFDLBurfdlbMESxyz])(w?)(\d*)('?)$/.exec(t);
  if (!m) return null;
  let base = m[1];
  if (m[2]) {
    if (!"URFDLB".includes(base)) return null;
    base = base.toLowerCase();
  }
  let n = m[3] ? parseInt(m[3], 10) : 1;
  if (m[4]) n = -n;
  n = ((n % 4) + 4) % 4;
  if (n === 0) return null;
  return base + (n === 1 ? "" : n === 2 ? "2" : "'");
}

/** Parse a notation string. Comments after // and anything in parentheses grouping are tolerated. */
export function parseAlg(alg: string): string[] {
  const out: string[] = [];
  const cleaned = alg.replace(/\/\/.*$/gm, " ").replace(/[()[\],]/g, " ");
  for (const tok of cleaned.split(/\s+/)) {
    if (!tok) continue;
    const mv = normalizeMove(tok);
    if (!mv) throw new Error(`Unknown move "${tok}"`);
    out.push(mv);
  }
  return out;
}

export function solved(): State {
  const s = new Uint8Array(54);
  for (let i = 0; i < 54; i++) s[i] = Math.floor(i / 9);
  return s;
}

export function applyMove(s: State, mv: string): State {
  const p = MOVE_PERMS.get(mv);
  if (!p) throw new Error(`Unknown move ${mv}`);
  const out = new Uint8Array(54);
  for (let i = 0; i < 54; i++) out[i] = s[p.src[i]];
  return out;
}

export function applyMoves(s: State, moves: string[] | string): State {
  const list = typeof moves === "string" ? parseAlg(moves) : moves;
  for (const mv of list) s = applyMove(s, mv);
  return s;
}

export function invertMove(mv: string): string {
  if (mv.endsWith("2")) return mv;
  if (mv.endsWith("'")) return mv.slice(0, -1);
  return mv + "'";
}

export function invertAlg(moves: string[]): string[] {
  return moves.slice().reverse().map(invertMove);
}

export function stateKey(s: State): string {
  return String.fromCharCode(...s);
}

export function statesEqual(a: State, b: State): boolean {
  for (let i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function isSolved(s: State): boolean {
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) if (s[f * 9 + i] !== s[f * 9 + 4]) return false;
  return true;
}

/** Index of the face (0..5 in URFDLB) whose center has `color`. */
export function faceOfColor(s: State, color: number): number {
  for (let f = 0; f < 6; f++) if (s[f * 9 + 4] === color) return f;
  return -1;
}

export function moveAxis(mv: string): number {
  const b = BASE[mv[0]];
  return b ? b.axis : -1;
}

/** Merge adjacent turns of the same layer(s): R R -> R2, R R' -> (nothing). */
export function simplify(moves: string[]): string[] {
  const out: string[] = [];
  const amount = (m: string) => (m.endsWith("2") ? 2 : m.endsWith("'") ? 3 : 1);
  for (const mv of moves) {
    const last = out[out.length - 1];
    if (last && last[0] === mv[0]) {
      const n = (amount(last) + amount(mv)) % 4;
      out.pop();
      if (n) out.push(mv[0] + (n === 1 ? "" : n === 2 ? "2" : "'"));
    } else out.push(mv);
  }
  return out;
}

/** Move count in HTM, ignoring whole-cube rotations (slices count as 1, matching common usage). */
export function moveCount(moves: string[]): number {
  return moves.filter((m) => !"xyz".includes(m[0])).length;
}

// ---------------------------------------------------------------------------
// Pieces: every edge/corner sticker index, grouped by cubie.

function piecesWithStickerCount(n: number): number[][] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < 54; i++) {
    const p = FACELET_POS[i];
    const nonZero = p.filter((v) => v !== 0).length;
    if (nonZero !== n) continue;
    const k = p.join(",");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  return [...groups.values()];
}

export const EDGES = piecesWithStickerCount(2); // 12 x [a, b]
export const CORNERS = piecesWithStickerCount(3); // 8 x [a, b, c]
export const CENTER = (face: number) => face * 9 + 4;

/** Face index each sticker belongs to. */
export const STICKER_FACE = Array.from({ length: 54 }, (_, i) => Math.floor(i / 9));

/** The 24 whole-cube orientations, as shortest rotation sequences from WCA orientation. */
export const ORIENTATIONS: string[][] = (() => {
  const seen = new Map<string, string[]>();
  let frontier: string[][] = [[]];
  const centers = (moves: string[]) => {
    const s = applyMoves(solved(), moves);
    return FACES.map((_, f) => s[CENTER(f)]).join("");
  };
  seen.set(centers([]), []);
  while (frontier.length) {
    const next: string[][] = [];
    for (const seq of frontier)
      for (const r of ROTATIONS) {
        const s2 = [...seq, r];
        const k = centers(s2);
        if (!seen.has(k)) {
          seen.set(k, s2);
          next.push(s2);
        }
      }
    frontier = next;
  }
  return [...seen.values()];
})();

/** Rotation sequence that brings `upColor` to U and `frontColor` to F. */
export function rotationTo(s: State, upColor: number, frontColor: number): string[] {
  for (const seq of ORIENTATIONS) {
    const t = applyMoves(s, seq);
    if (t[CENTER(0)] === upColor && t[CENTER(2)] === frontColor) return seq;
  }
  throw new Error("No rotation found");
}

/** Rotation that puts `downColor` on D, preferring to keep the current front (or another sensible one). */
export function rotationForDown(s: State, downColor: number, preferFront?: number): string[] {
  let best: string[] | null = null;
  for (const seq of ORIENTATIONS) {
    const t = applyMoves(s, seq);
    if (t[CENTER(3)] !== downColor) continue;
    if (preferFront !== undefined && t[CENTER(2)] === preferFront) return seq;
    if (!best || seq.length < best.length) best = seq;
  }
  return best!;
}

/**
 * Validate a scanned state: 9 of each color, distinct centers, real pieces, and solvable
 * (orientation and permutation parity). Returns null if valid, otherwise a message.
 */
export function validateState(s: State): string | null {
  const counts = new Array(6).fill(0);
  for (const c of s) counts[c]++;
  if (counts.some((n) => n !== 9)) return `Each color must appear 9 times (got ${counts.join(", ")}).`;
  const centers = FACES.map((_, f) => s[CENTER(f)]);
  if (new Set(centers).size !== 6) return "Two faces have the same center color.";

  // Re-express in terms of home faces so piece identities line up with the solved cube.
  const faceOf = new Map(centers.map((c, f) => [c, f]));
  const t = s.map((c) => faceOf.get(c)!);
  const ref = solved();
  const pieceId = (stickers: number[], st: Uint8Array) => stickers.map((i) => st[i]).slice().sort().join("");

  const edgeIds = EDGES.map((e) => pieceId(e, ref));
  const cornerIds = CORNERS.map((c) => pieceId(c, ref));
  const edgePerm: number[] = [];
  let edgeTwist = 0;
  for (const e of EDGES) {
    const id = pieceId(e, t);
    const k = edgeIds.indexOf(id);
    if (k < 0 || edgePerm.includes(k)) return "Some edge pieces are impossible or duplicated — check the colors.";
    edgePerm.push(k);
    // Standard orientation: the piece's U/D color (or F/B for E-slice pieces) should sit on
    // the slot's U/D sticker (or F/B sticker).
    const colors = e.map((i) => t[i]);
    const primaryColor = colors.find((c) => c === 0 || c === 3) ?? colors.find((c) => c === 2 || c === 5)!;
    const refSticker = e.find((i) => STICKER_FACE[i] === 0 || STICKER_FACE[i] === 3) ?? e.find((i) => STICKER_FACE[i] === 2 || STICKER_FACE[i] === 5)!;
    edgeTwist += t[refSticker] === primaryColor ? 0 : 1;
  }
  const cornerPerm: number[] = [];
  let cornerTwist = 0;
  for (const c of CORNERS) {
    const id = pieceId(c, t);
    const k = cornerIds.indexOf(id);
    if (k < 0 || cornerPerm.includes(k)) return "Some corner pieces are impossible or duplicated — check the colors.";
    cornerPerm.push(k);
    const udSticker = c.findIndex((i) => t[i] === 0 || t[i] === 3);
    cornerTwist += cornerTwistOf(c, udSticker);
  }
  if (edgeTwist % 2 !== 0) return "An edge is flipped — this state can't be reached by turning.";
  if (cornerTwist % 3 !== 0) return "A corner is twisted — this state can't be reached by turning.";
  if (parity(edgePerm) !== parity(cornerPerm)) return "Two pieces are swapped — this state can't be reached by turning.";
  return null;
}

// Twist of a corner whose U/D-colored sticker is at position `k` within its sticker list,
// measured clockwise from the slot's own U/D sticker.
function cornerTwistOf(stickers: number[], k: number): number {
  const ud = stickers.findIndex((i) => STICKER_FACE[i] === 0 || STICKER_FACE[i] === 3);
  const order = cwOrder(stickers, ud);
  return (order.indexOf(stickers[k]) + 3) % 3;
}

// Corner stickers listed clockwise (as seen from outside the corner) starting at `start`.
function cwOrder(stickers: number[], start: number): number[] {
  const p = FACELET_POS[stickers[0]];
  const ns = stickers.map((i) => FACELET_NORMAL[i]);
  const a = ns[start];
  // Clockwise around the outward diagonal p: next normal b satisfies (a x b) . p < 0.
  const rest = [0, 1, 2].filter((i) => i !== start);
  const cross = (u: Vec, v: Vec): Vec => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u: Vec, v: Vec) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const next = rest.find((i) => dot(cross(a, ns[i]), p) < 0)!;
  const last = rest.find((i) => i !== next)!;
  return [stickers[start], stickers[next], stickers[last]];
}

function parity(perm: number[]): number {
  let p = 0;
  const seen = new Array(perm.length).fill(false);
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = perm[j]) {
      seen[j] = true;
      len++;
    }
    p += len - 1;
  }
  return p % 2;
}

export function stateToString(s: State): string {
  return Array.from(s, (c) => FACES[c]).join("");
}

export function stateFromString(str: string): State {
  return Uint8Array.from(str, (ch) => FACES.indexOf(ch as FaceName));
}
