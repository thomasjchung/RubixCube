// Finds the cube face pointed at the camera anywhere in the frame.
//
// Every pixel is labelled with the sticker color it is close to (or none). A face is a square
// whose 3x3 cells are each dominated by a single sticker color, so we search squares of many
// sizes and positions, scoring each cell with per-color integral images (O(1) per cell).
// To reject blank walls and the like, the lines between cells must look like a cube: dark gaps
// between stickers, or different colors on either side (stickerless cubes).
// Faces must be roughly upright (not rolled more than ~15 degrees) and roughly facing the camera.

import { Lab, NBox, rgbToLab } from "./colors";

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A square in pixel coordinates of the image it was found in. */
export interface FaceBox {
  x: number;
  y: number;
  side: number;
  /** how many of the 9 cells were clearly one color */
  cells: number;
}

const NONE = 255;
const NONE_CH = 6; // integral-image channel counting unlabelled pixels
const lutCache = new WeakMap<Lab[], Map<number, Uint8Array>>();

/** 15-bit RGB -> label lookup table for these color means. Lightness counts fully so grey isn't white. */
function lut(means: Lab[], maxDist: number): Uint8Array {
  let byDist = lutCache.get(means);
  if (!byDist) lutCache.set(means, (byDist = new Map()));
  const cached = byDist.get(maxDist);
  if (cached) return cached;
  const t = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const lab = rgbToLab([((k >> 10) << 3) + 4, (((k >> 5) & 31) << 3) + 4, ((k & 31) << 3) + 4]);
    let best = NONE, bd = Infinity, second = Infinity;
    for (let c = 0; c < means.length; c++) {
      const m = means[c];
      const d = Math.hypot(lab[0] - m[0], lab[1] - m[1], lab[2] - m[2]);
      if (d < bd) [second, bd, best] = [bd, d, c];
      else if (d < second) second = d;
    }
    t[k] = bd <= maxDist && bd < second * 0.8 ? best : NONE;
  }
  byDist.set(maxDist, t);
  return t;
}

export function labelImage(img: Img, means: Lab[], maxDist: number): Uint8Array {
  const t = lut(means, maxDist);
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    out[i] = t[((d[k] >> 3) << 10) | ((d[k + 1] >> 3) << 5) | (d[k + 2] >> 3)];
  }
  return out;
}

export interface SearchOptions {
  /** search near this box (from the previous frame) first */
  prev?: FaceBox | null;
  /** limit the search to this pixel region (e.g. around the hands) */
  region?: { x0: number; y0: number; x1: number; y1: number } | null;
  minCells?: number;
  /** color distance tolerance; looser before the colors are calibrated */
  maxDist?: number;
}

export function findFace(img: Img, means: Lab[], opts: SearchOptions = {}): FaceBox | null {
  const { width: w, height: h } = img;
  const labels = labelImage(img, means, opts.maxDist ?? 32);
  const sq = new Squares(integrals(labels, w, h), w, h, opts.minCells ?? 7);

  const tryRange = (sides: number[], x0: number, y0: number, x1: number, y1: number): FaceBox | null => {
    let best: FaceBox | null = null;
    for (const side of sides) {
      const step = Math.max(1, Math.round(side / 14));
      for (let y = Math.max(0, y0); y + side <= Math.min(h, y1); y += step)
        for (let x = Math.max(0, x0); x + side <= Math.min(w, x1); x += step) {
          const cells = sq.score(x, y, side);
          if (cells && (!best || rank(side, cells) > rank(best.side, best.cells))) best = { x, y, side, cells };
        }
    }
    return best;
  };

  const minSide = Math.round(h * 0.16);
  const maxSide = Math.round(h * 0.85);
  const allSides: number[] = [];
  for (let s = minSide; s <= maxSide; s = Math.round(s * 1.1) + 1) allSides.push(s);

  const p = opts.prev;
  if (p) {
    const sides = allSides.filter((s) => s > p.side * 0.75 && s < p.side * 1.33);
    const m = p.side * 0.6;
    const near = tryRange(sides, Math.round(p.x - m), Math.round(p.y - m), Math.round(p.x + p.side + m), Math.round(p.y + p.side + m));
    if (near) return sq.refine(near);
  }
  const r = opts.region ?? { x0: 0, y0: 0, x1: w, y1: h };
  const found = tryRange(allSides, Math.round(r.x0), Math.round(r.y0), Math.round(r.x1), Math.round(r.y1));
  return found && sq.refine(found);
}

// Bigger squares win (a 3x3 inside one big sticker can also look valid), but clear cells count too.
const rank = (side: number, cells: number) => side * (1 + 0.05 * (cells - 7));

function integrals(labels: Uint8Array, w: number, h: number): Uint32Array[] {
  const W = w + 1;
  const out = Array.from({ length: 7 }, () => new Uint32Array(W * (h + 1)));
  const rowSums = new Uint32Array(7);
  for (let y = 0; y < h; y++) {
    rowSums.fill(0);
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      rowSums[l === NONE ? NONE_CH : l]++;
      for (let c = 0; c < 7; c++) out[c][(y + 1) * W + x + 1] = out[c][y * W + x + 1] + rowSums[c];
    }
  }
  return out;
}

class Squares {
  private dom = new Int8Array(9);
  constructor(private ii: Uint32Array[], private w: number, private h: number, private minCells: number) {}

  private count(c: number, x0: number, y0: number, x1: number, y1: number): number {
    const t = this.ii[c], W = this.w + 1;
    return t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
  }

  /** Cells that are clearly one color, or 0 if the square doesn't look like a cube face. */
  score(x: number, y: number, side: number, minCells = this.minCells): number {
    const cell = side / 3;
    const inset = cell * 0.25;
    let good = 0;
    for (let k = 0; k < 9; k++) {
      const cx = k % 3, cy = Math.floor(k / 3);
      const x0 = Math.round(x + cx * cell + inset), y0 = Math.round(y + cy * cell + inset);
      const x1 = Math.round(x + (cx + 1) * cell - inset), y1 = Math.round(y + (cy + 1) * cell - inset);
      const area = (x1 - x0) * (y1 - y0);
      if (area <= 0) return 0;
      let top = 0, topC = -1;
      for (let c = 0; c < 6; c++) {
        const n = this.count(c, x0, y0, x1, y1);
        if (n > top) [top, topC] = [n, c];
      }
      this.dom[k] = top >= area * 0.65 ? topC : -1;
      if (this.dom[k] >= 0) good++;
      if (good + (8 - k) < minCells) return 0;
    }
    // Gaps or color changes between cells; a single-color face needs clear gaps on (almost) every line.
    const colors = new Set(Array.from(this.dom).filter((c) => c >= 0)).size;
    const lines = this.boundaries(x, y, side);
    return lines >= (colors >= 2 ? 7 : 10) ? good : 0;
  }

  /** How many of the 12 inner cell boundaries show a dark gap or a color change. */
  private boundaries(x: number, y: number, side: number): number {
    const cell = side / 3;
    const half = Math.max(1, cell * 0.15);
    let n = 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const r2 = r + dr, c2 = c + dc;
          if (r2 > 2 || c2 > 2) continue;
          const a = this.dom[r * 3 + c], b = this.dom[r2 * 3 + c2];
          if (a < 0 || b < 0) continue; // only judge lines between two clearly colored cells
          if (a !== b) {
            n++;
            continue;
          }
          // strip along the shared edge, over the middle half of it
          let x0, x1, y0, y1;
          if (dc) {
            const bx = x + (c + 1) * cell;
            [x0, x1] = [bx - half, bx + half];
            [y0, y1] = [y + (r + 0.25) * cell, y + (r + 0.75) * cell];
          } else {
            const by = y + (r + 1) * cell;
            [y0, y1] = [by - half, by + half];
            [x0, x1] = [x + (c + 0.25) * cell, x + (c + 0.75) * cell];
          }
          [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
          const area = (x1 - x0) * (y1 - y0);
          if (area > 0 && this.count(NONE_CH, x0, y0, x1, y1) >= area * 0.35) n++;
        }
      }
    return n;
  }

  /** Sum over cells of how much of the cell (minus a thin border) is its majority color. */
  private fit(x: number, y: number, side: number): number {
    const cell = side / 3;
    const inset = cell * 0.1;
    let sum = 0;
    for (let k = 0; k < 9; k++) {
      const cx = k % 3, cy = Math.floor(k / 3);
      const x0 = Math.round(x + cx * cell + inset), y0 = Math.round(y + cy * cell + inset);
      const x1 = Math.round(x + (cx + 1) * cell - inset), y1 = Math.round(y + (cy + 1) * cell - inset);
      const area = (x1 - x0) * (y1 - y0);
      if (area <= 0) return 0;
      let top = 0;
      for (let c = 0; c < 6; c++) top = Math.max(top, this.count(c, x0, y0, x1, y1));
      sum += top / area;
    }
    return sum;
  }

  /**
   * Squares a bit larger or smaller than the face can still score well, so keep the center and take
   * the middle of the range of sizes that score as well as the best, then nudge the position.
   */
  refine(b: FaceBox): FaceBox {
    const { w, h } = this;
    const cx = b.x + b.side / 2, cy = b.y + b.side / 2;
    const valid: number[] = [];
    for (let side = Math.round(b.side * 0.6); side <= b.side * 1.4; side++) {
      const x = Math.round(cx - side / 2), y = Math.round(cy - side / 2);
      if (x < 0 || y < 0 || x + side > w || y + side > h) continue;
      if (this.score(x, y, side) >= b.cells) valid.push(side);
    }
    const side = valid.length ? valid[valid.length >> 1] : b.side;
    // Nudge position and size to where the cells are most uniformly colored (best alignment).
    let best: FaceBox = b;
    let bestFit = -1;
    const step = Math.max(1, Math.round(side / 40));
    for (let ds = -2; ds <= 2; ds++) {
      const sd = side + ds * step;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const x = Math.round(cx - sd / 2) + dx * step, y = Math.round(cy - sd / 2) + dy * step;
          if (x < 0 || y < 0 || x + sd > w || y + sd > h) continue;
          const f = this.fit(x, y, sd);
          if (f > bestFit) {
            const cells = this.score(x, y, sd, 0);
            if (cells >= this.minCells) [best, bestFit] = [{ x, y, side: sd, cells }, f];
          }
        }
    }
    return best.cells >= this.minCells ? best : b;
  }
}

/** Per-frame face detection with a little memory, for live video. */
export class FaceTracker {
  private prev: FaceBox | null = null;
  private lost = 0;
  private frame = 0;

  /**
   * Returns the face box (as fractions of the frame) or null.
   * `near` optionally limits a fresh search to a region (fractions of the frame), e.g. around the hands.
   */
  update(img: Img, means: Lab[], maxDist: number, near?: { x0: number; y0: number; x1: number; y1: number } | null): NBox | null {
    this.frame++;
    const { width: w, height: h } = img;
    // A fresh full-frame search is the expensive part; when nothing is around, do it every 3rd frame.
    if (!this.prev && this.lost > 0 && this.frame % 3 !== 0) return null;
    const region = near && { x0: near.x0 * w, y0: near.y0 * h, x1: near.x1 * w, y1: near.y1 * h };
    const box = findFace(img, means, { prev: this.prev, region, maxDist });
    if (box) {
      this.prev = box;
      this.lost = 0;
    } else if (++this.lost > 4) this.prev = null;
    const b = box ?? (this.lost <= 4 ? this.prev : null);
    return b && { x: b.x / w, y: b.y / h, w: b.side / w, h: b.side / h };
  }
}
