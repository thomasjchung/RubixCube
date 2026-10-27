// Random-move scrambles in WCA style (no repeated face, no "R L R" style axis triples).

const FACES = ["U", "D", "R", "L", "F", "B"];
const AXIS: Record<string, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const SUFFIX = ["", "'", "2"];

export function randomScramble(length = 21, rand: () => number = Math.random): string[] {
  const out: string[] = [];
  while (out.length < length) {
    const f = FACES[Math.floor(rand() * 6)];
    const a = out[out.length - 1]?.[0];
    const b = out[out.length - 2]?.[0];
    if (a === f) continue;
    if (a && b && AXIS[a] === AXIS[f] && AXIS[b] === AXIS[f]) continue;
    out.push(f + SUFFIX[Math.floor(rand() * 3)]);
  }
  return out;
}

/**
 * How the cube is held while scrambling, as a rotation from WCA orientation (white top, green front).
 * z2 = white on the bottom, yellow on top, green still in front.
 */
export const SCRAMBLE_HOLD = ["z2"];

/** The moves that take a WCA-oriented solved cube to the scrambled cube, as held. */
export const scrambleSetup = (scramble: string[]) => [...SCRAMBLE_HOLD, ...scramble];
