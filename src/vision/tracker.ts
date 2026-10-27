// Camera move tracker (experimental).
//
// The camera only sees the face pointed at it, so moves can't be read directly. Instead we keep
// a set of hypotheses (cube state + the moves that led there) and, every time the visible face
// settles on a new reading, extend each hypothesis by 0–2 moves (sometimes 3) and keep the ones
// whose predicted front face best matches what the camera sees. Moves that are invisible at the
// time (e.g. B) get "discovered" later when their effect shows up on the front face.

import { applyMove, isSolved, MOVE_PERMS, ORIENTATIONS, State, stateKey, applyMoves, simplify } from "../cube/model";
import type { TimedMove } from "../cube/analysis";

const BASES = ["U", "R", "F", "D", "L", "B", "r", "l", "u", "d", "f", "b", "M", "E", "S", "x", "y", "z"];
const MOVES = BASES.flatMap((b) => [b, b + "'", b + "2"]);
const CHEAP_MOVES = MOVES.filter((m) => "URFDLBxyz".includes(m[0]));
const MOVE_COST = (m: string) => ("xyz".includes(m[0]) ? 1.1 : "MES".includes(m[0]) ? 1.6 : m[0] === m[0].toLowerCase() ? 1.4 : 1);
const MISMATCH_COST = 2.5;
const FRONT = [18, 19, 20, 21, 22, 23, 24, 25, 26];
const MAX_HYPS = 40;

interface Seq {
  moves: string[];
  cost: number;
  /** composite: newState[i] = old[src[i]] for the 9 front stickers only */
  front: Uint8Array;
}

// Precompute 0-, 1- and 2-move sequences and where their front stickers come from.
const SEQS: Seq[] = (() => {
  const out: Seq[] = [{ moves: [], cost: 0, front: Uint8Array.from(FRONT) }];
  for (const a of MOVES) {
    const pa = MOVE_PERMS.get(a)!.src;
    out.push({ moves: [a], cost: MOVE_COST(a), front: Uint8Array.from(FRONT, (i) => pa[i]) });
    for (const b of MOVES) {
      if (a[0] === b[0]) continue;
      const pb = MOVE_PERMS.get(b)!.src;
      out.push({ moves: [a, b], cost: MOVE_COST(a) + MOVE_COST(b), front: Uint8Array.from(FRONT, (i) => pa[pb[i]]) });
    }
  }
  return out;
})();

interface Hyp {
  state: State;
  moves: TimedMove[];
  cost: number;
}

export class MoveTracker {
  private hyps: Hyp[];
  private lastObs = "";

  constructor(start: State) {
    // The solver can pick the cube up in any orientation.
    this.hyps = ORIENTATIONS.map((rot) => ({
      state: applyMoves(start, rot),
      moves: rot.map((move) => ({ move, t: 0 })),
      cost: rot.length * 0.01,
    }));
  }

  /** Feed a stable reading of the camera-facing face (9 colors, -1 = unknown). */
  observe(face: number[], t: number): void {
    const known = face.filter((c) => c >= 0).length;
    if (known < 6) return;
    const key = face.join(",");
    if (key === this.lastObs) return;
    this.lastObs = key;

    const mismatch = (s: State, src: Uint8Array) => {
      let m = 0;
      for (let k = 0; k < 9; k++) if (face[k] >= 0 && s[src[k]] !== face[k]) m++;
      return m;
    };

    type Cand = { hyp: Hyp; seq: string[]; cost: number; mis: number };
    let cands: Cand[] = [];
    const cutoff = this.hyps[0].cost + 14;
    for (const h of this.hyps)
      for (const sq of SEQS) {
        const mis = mismatch(h.state, sq.front);
        const cost = h.cost + sq.cost + mis * MISMATCH_COST;
        if (cost <= cutoff) cands.push({ hyp: h, seq: sq.moves, cost, mis });
      }
    if (!cands.length) return;
    cands.sort((a, b) => a.cost - b.cost);

    // If nothing within two moves explains the reading well, try three (face turns and rotations only).
    if (cands[0].mis > 1) {
      for (const h of this.hyps.slice(0, 5))
        for (const a of CHEAP_MOVES) {
          const s1 = applyMove(h.state, a);
          for (const b of CHEAP_MOVES) {
            if (a[0] === b[0]) continue;
            const s2 = applyMove(s1, b);
            for (const c of CHEAP_MOVES) {
              if (b[0] === c[0]) continue;
              const src = MOVE_PERMS.get(c)!.src;
              const mis = mismatch(s2, Uint8Array.from(FRONT, (i) => src[i]));
              const cost = h.cost + MOVE_COST(a) + MOVE_COST(b) + MOVE_COST(c) + mis * MISMATCH_COST;
              if (cost < cands[cands.length - 1].cost) cands.push({ hyp: h, seq: [a, b, c], cost, mis });
            }
          }
        }
      cands.sort((p, q) => p.cost - q.cost);
    }

    const next: Hyp[] = [];
    const seen = new Set<string>();
    for (const c of cands) {
      if (next.length >= MAX_HYPS) break;
      const state = applyMoves(c.hyp.state, c.seq);
      const k = stateKey(state);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push({ state, moves: [...c.hyp.moves, ...c.seq.map((move) => ({ move, t }))], cost: c.cost });
    }
    // Keep costs bounded so they stay comparable.
    const base = next[0].cost;
    for (const h of next) h.cost -= base;
    cands = [];
    this.hyps = next;
  }

  best(): Hyp {
    return this.hyps[0];
  }

  /** Live notation of the best hypothesis, merging same-layer turns. */
  liveNotation(): string[] {
    return simplify(this.best().moves.map((m) => m.move));
  }

  /**
   * Finish the solve: prefer a hypothesis that is solved (or solved after one more move) if it's
   * not much less likely than the best one.
   */
  finish(t: number): { moves: TimedMove[]; solved: boolean } {
    const slack = 8;
    for (const h of this.hyps) {
      if (h.cost - this.hyps[0].cost > slack) break;
      if (isSolved(h.state)) return { moves: h.moves, solved: true };
      for (const m of CHEAP_MOVES)
        if (isSolved(applyMove(h.state, m))) return { moves: [...h.moves, { move: m, t }], solved: true };
    }
    return { moves: this.hyps[0].moves, solved: isSolved(this.hyps[0].state) };
  }
}
