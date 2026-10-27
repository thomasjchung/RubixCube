// Splits a recorded solve into CFOP stages and compares each stage with a better solution.

import {
  applyMoves, CENTER, COLOR_NAMES, invertAlg, isSolved, moveCount, ORIENTATIONS, rotationForDown, simplify, solved, State,
} from "./model";
import {
  bestByErgonomics, crossDistance, isCPSolved, isCrossSolved, isEOSolved, isOLLSolved, OLL_CORNER_ALGS, OLL_EDGE_ALGS,
  PLL_CORNER_ALGS, PLL_EDGE_ALGS, SLOTS, solveCross, solveLLStep, solvePair, solvedSlots,
} from "./solver";

export interface TimedMove {
  move: string;
  /** ms since the timer started */
  t?: number;
}

/** Progress levels: 0 nothing, 1 cross, 2..5 cross + n pairs, 6 EO, 7 OLL, 8 OLL + CP, 9 solved. */
export const LEVEL_NAMES = [
  "Start", "Cross", "F2L pair 1", "F2L pair 2", "F2L pair 3", "F2L pair 4",
  "OLL – edges", "OLL – corners", "PLL – corners", "PLL – edges",
];

export interface Suggestion {
  /** rotation (to the canonical hold) followed by the moves */
  moves: string[];
  /** human readable holding instructions for the rotation-free part */
  hold: string;
  caseName?: string;
}

export interface StageReview {
  title: string;
  levels: number[];
  userMoves: string[];
  /** index into the full user move list where this stage starts */
  startIndex: number;
  userMs?: number;
  suggestion: Suggestion;
  /** moves to replay from solved to the stage's start (scramble + earlier user moves) */
  setup: string[];
  userCount: number;
  suggestedCount: number;
  tips: string[];
}

export interface SolveReview {
  crossColor: number;
  stages: StageReview[];
  /** last level the user actually reached */
  reached: number;
  /** suggestions for stages the tracked solve never reached */
  remaining: StageReview[];
  totalMoves: number;
  example: StageReview[];
  exampleCount: number;
}

const canonRotation = (s: State, crossColor: number) => rotationForDown(s, crossColor, s[CENTER(2)]);
const canon = (s: State, crossColor: number) => applyMoves(s, canonRotation(s, crossColor));

export function levelOf(s: State, crossColor: number): number {
  const c = canon(s, crossColor);
  if (isSolved(c)) return 9;
  if (!isCrossSolved(c)) return 0;
  const n = solvedSlots(c).length;
  if (n < 4) return 1 + n;
  if (!isEOSolved(c)) return 5;
  if (!isOLLSolved(c)) return 6;
  if (!isCPSolved(c)) return 7;
  return 8;
}

function holdText(s: State): string {
  return `Hold ${COLOR_NAMES[s[CENTER(3)]]} on the bottom, ${COLOR_NAMES[s[CENTER(2)]]} in front`;
}

function pairName(s: State, slot: number): string {
  const [a, b] = SLOTS[slot].faces;
  return `${COLOR_NAMES[s[CENTER(a)]]}-${COLOR_NAMES[s[CENTER(b)]]}`;
}

/** Suggested solution for going from level `level - 1` to `level` starting at absolute state `s`. */
function suggestStep(s: State, level: number, crossColor: number, preferSlotColors?: [number, number]): Suggestion {
  if (level === 1) {
    const rot = canonRotation(s, crossColor);
    const c = applyMoves(s, rot);
    return { moves: [...rot, ...bestByErgonomics(solveCross(c))], hold: holdText(c) };
  }
  if (level >= 2 && level <= 5) {
    const c0 = canon(s, crossColor);
    const done = solvedSlots(c0);
    // Pick the slot: the one the user solved if known, else the cheapest.
    let candidates = [0, 1, 2, 3].filter((i) => !done.includes(i));
    if (preferSlotColors) {
      const want = candidates.filter((i) => {
        const cols = SLOTS[i].faces.map((f) => c0[CENTER(f)]);
        return preferSlotColors.every((x) => cols.includes(x));
      });
      if (want.length) candidates = want;
    }
    let best: Suggestion | null = null;
    for (const slot of candidates) {
      // Rotate so this slot is front-right.
      const front = c0[CENTER(SLOTS[slot].faces[0])];
      const rot = rotationForDown(s, crossColor, front);
      const c = applyMoves(s, rot);
      const sol = bestByErgonomics(solvePair(c, 0, solvedSlots(c)));
      const sugg = { moves: [...rot, ...sol], hold: `${holdText(c)} (slot at front-right)`, caseName: `${pairName(c, 0)} pair` };
      if (!best || moveCount(sugg.moves) < moveCount(best.moves)) best = sugg;
    }
    return best!;
  }
  const rot = canonRotation(s, crossColor);
  const c = applyMoves(s, rot);
  const [algs, goal, post] =
    level === 6 ? [OLL_EDGE_ALGS, isEOSolved, false] as const
    : level === 7 ? [OLL_CORNER_ALGS, isOLLSolved, false] as const
    : level === 8 ? [PLL_CORNER_ALGS, isCPSolved, false] as const
    : [PLL_EDGE_ALGS, isSolved, true] as const;
  const step = solveLLStep(c, algs, goal, post);
  if (!step) return { moves: [], hold: holdText(c), caseName: "unrecognized" };
  return { moves: step.moves.length ? [...rot, ...step.moves] : [], hold: holdText(c), caseName: step.case };
}

function suggestGroup(s: State, levels: number[], crossColor: number, slotColors?: [number, number]): { sugg: Suggestion; end: State } {
  const moves: string[] = [];
  const names: string[] = [];
  let hold = "";
  for (const lv of levels) {
    const sg = suggestStep(s, lv, crossColor, levels.length === 1 ? slotColors : undefined);
    if (!hold) hold = sg.hold;
    if (sg.caseName) names.push(sg.caseName);
    moves.push(...sg.moves);
    s = applyMoves(s, sg.moves);
  }
  return { sugg: { moves: simplify(moves), hold, caseName: names.join(" → ") || undefined }, end: s };
}

function groupTitle(levels: number[]): string {
  if (levels.length === 1) return LEVEL_NAMES[levels[0]];
  const first = LEVEL_NAMES[levels[0]];
  const last = LEVEL_NAMES[levels[levels.length - 1]];
  if (levels.every((l) => l >= 2 && l <= 5)) return `F2L pairs ${levels[0] - 1}–${levels[levels.length - 1] - 1} (multislotted)`;
  if (levels.join() === "6,7") return "OLL (1-look!)";
  if (levels.join() === "8,9") return "PLL (1-look!)";
  return `${first} → ${last}`;
}

/** Which cross the solver was building: the first color whose cross gets solved. */
export function detectCrossColor(states: State[]): number {
  for (const s of states) {
    const done = [0, 3, 1, 2, 4, 5].filter((col) => crossDistance(canon(s, col)) === 0);
    if (done.length) return done[0];
  }
  return 0;
}

function crossLengths(s: State): number[] {
  return [0, 1, 2, 3, 4, 5].map((col) => crossDistance(canon(s, col)));
}

/** Rotation that makes WCA-solved look like `target`'s orientation. */
function orientationOf(target: State): string[] {
  for (const seq of ORIENTATIONS) {
    const t = applyMoves(solved(), seq);
    if (t[CENTER(0)] === target[CENTER(0)] && t[CENTER(2)] === target[CENTER(2)]) return seq;
  }
  return [];
}

/** A move sequence that produces `s` from a WCA-oriented solved cube (used for 3D replays). */
export function generatorFor(s: State): string[] {
  const ex = exampleSolve(s, 0);
  const all = ex.flatMap((st) => st.suggestion.moves);
  const end = applyMoves(s, all);
  return [...orientationOf(end), ...invertAlg(all)];
}

export function exampleSolve(start: State, crossColor: number, setupPrefix: string[] = []): StageReview[] {
  const out: StageReview[] = [];
  let s = start;
  const setup = [...setupPrefix];
  let level = levelOf(s, crossColor);
  while (level < 9) {
    const lv = level + 1;
    const { sugg, end } = suggestGroup(s, [lv], crossColor);
    out.push({
      title: LEVEL_NAMES[lv], levels: [lv], userMoves: [], startIndex: 0, suggestion: sugg, setup: setup.slice(),
      userCount: 0, suggestedCount: moveCount(sugg.moves), tips: [],
    });
    setup.push(...sugg.moves);
    s = end;
    const next = levelOf(s, crossColor);
    if (next <= level) break; // safety: should never happen
    level = next;
  }
  return out;
}

export function analyzeSolve(start: State, moves: TimedMove[], scrambleSetup: string[]): SolveReview {
  const states: State[] = [start];
  for (const m of moves) states.push(applyMoves(states[states.length - 1], [m.move]));
  const crossColor = detectCrossColor(states);
  const levels = states.map((s) => levelOf(s, crossColor));

  // milestone[k] = number of moves after which level k was first reached
  const milestone: (number | undefined)[] = [];
  for (let k = 1; k <= 9; k++) {
    const i = levels.findIndex((l) => l >= k);
    milestone[k] = i < 0 ? undefined : i;
  }
  const reached = Math.max(...levels);

  const stages: StageReview[] = [];
  let k = Math.max(1, levels[0] + 1);
  let prevEnd = 0;
  while (k <= 9 && milestone[k] !== undefined) {
    const end = milestone[k]!;
    const group = [k];
    while (k + 1 <= 9 && milestone[k + 1] === end) group.push(++k);
    k++;

    const s0 = states[prevEnd];
    const userMoves = moves.slice(prevEnd, end).map((m) => m.move);
    // Which pair did the user insert? (newly solved slot in canonical frame)
    let slotColors: [number, number] | undefined;
    if (group.length === 1 && group[0] >= 2 && group[0] <= 5) {
      const a = canon(s0, crossColor);
      const b = canon(states[end], crossColor);
      const before = solvedSlots(a).map((i) => pairName(a, i));
      const newSlot = solvedSlots(b).find((i) => !before.includes(pairName(b, i)));
      if (newSlot !== undefined) slotColors = SLOTS[newSlot].faces.map((f) => b[CENTER(f)]) as [number, number];
    }
    const { sugg } = suggestGroup(s0, group, crossColor, slotColors);
    const tStart = prevEnd > 0 ? moves[prevEnd - 1].t : 0;
    const tEnd = end > 0 ? moves[end - 1].t : 0;
    const stage: StageReview = {
      title: groupTitle(group),
      levels: group,
      userMoves,
      startIndex: prevEnd,
      userMs: tStart !== undefined && tEnd !== undefined ? tEnd - tStart : undefined,
      suggestion: sugg,
      setup: [...scrambleSetup, ...moves.slice(0, prevEnd).map((m) => m.move)],
      userCount: moveCount(simplify(userMoves)),
      suggestedCount: moveCount(sugg.moves),
      tips: [],
    };
    stage.tips = tipsFor(stage, s0, crossColor);
    stages.push(stage);
    prevEnd = end;
  }

  // Stages the tracked solve didn't reach: continue with suggestions from where tracking ended.
  const last = states[states.length - 1];
  const remaining = reached < 9 ? exampleSolve(last, crossColor, [...scrambleSetup, ...moves.map((m) => m.move)]) : [];

  const example = exampleSolve(start, crossColor, scrambleSetup);
  return {
    crossColor,
    stages,
    reached,
    remaining,
    totalMoves: moveCount(simplify(moves.map((m) => m.move))),
    example,
    exampleCount: example.reduce((n, s) => n + s.suggestedCount, 0),
  };
}

function tipsFor(stage: StageReview, s0: State, crossColor: number): string[] {
  const tips: string[] = [];
  const extra = stage.userCount - stage.suggestedCount;
  const rotations = stage.userMoves.filter((m) => "xyz".includes(m[0])).length;
  const lv = stage.levels[0];

  if (lv === 1) {
    if (extra >= 2)
      tips.push(`An optimal cross here takes ${stage.suggestedCount} moves; you used ${stage.userCount}. Try to plan all four edges during inspection instead of one at a time.`);
    if (stage.userCount > 8) tips.push("Every cross can be solved in 8 moves or fewer — a long cross usually means edges were solved and then disturbed.");
    const lens = crossLengths(s0);
    const best = lens.indexOf(Math.min(...lens));
    if (lens[best] + 2 <= lens[crossColor])
      tips.push(`The ${COLOR_NAMES[best]} cross was only ${lens[best]} moves (vs ${lens[crossColor]} for ${COLOR_NAMES[crossColor]}). Practising color neutrality pays off on scrambles like this.`);
  } else if (lv <= 5) {
    if (extra >= 3)
      tips.push(`This pair can be solved in ${stage.suggestedCount} moves. Look for the corner and edge first, set them up as a connected pair (or a split pair) using U turns, then insert.`);
    if (stage.levels.length === 1) {
      const cheapest = suggestStep(s0, lv, crossColor);
      const n = moveCount(cheapest.moves);
      if (n + 2 <= stage.suggestedCount)
        tips.push(`The ${cheapest.caseName} was easier at this point (${n} moves): ${cheapest.moves.join(" ")}. Scan for the easiest pair before committing.`);
    }
    if (rotations >= 2) tips.push(`You used ${rotations} cube rotations. Try solving back slots with L/B moves or by re-orienting with y once before the pair.`);
    if (stage.userMoves.some((m) => m[0] === "D")) tips.push("D turns during F2L usually break the cross and cost moves to fix.");
  } else {
    if (extra >= 4) tips.push(`Recognize the case (${stage.suggestion.caseName}) and apply the algorithm directly — you used ${extra} more moves than needed.`);
    if (stage.levels.length > 1) tips.push("Nice — you did this step in a single look!");
  }
  if (extra <= 0 && stage.userCount > 0) tips.push("Efficient — as short as (or shorter than) the suggestion.");
  return tips;
}
