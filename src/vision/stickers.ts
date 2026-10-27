// Shape-based cube face detection with OpenCV.js.
//
// 1. Edges (Canny) -> closed outlines (contours).
// 2. Keep outlines that look like stickers: compact, roughly square, similar sizes.
// 3. Link stickers that sit one sticker-spacing apart, estimate the face's two grid directions from
//    those links, and give every sticker integer grid coordinates.
// 4. Pick the 3x3 window holding the most stickers and fit an affine map grid -> image, which
//    also predicts stickers that weren't seen (fingers, glare). Handles rotation and mild perspective.
// Colors are never used, so this works before the colors are calibrated.

import type { Img } from "./cubeFinder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

// The OpenCV module object has a `then` method, so it must never be the value a promise resolves
// to (or `await import(...)` of it): the promise would try to adopt it and never settle.
// It's always passed around wrapped as { cv }.
let cvPromise: Promise<{ cv: CV }> | null = null;

/** Wait until an OpenCV.js module object has finished initializing its WebAssembly runtime. */
export function whenReady(m: CV): Promise<{ cv: CV }> {
  return new Promise((resolve) => {
    const poll = () => (m.Mat ? resolve({ cv: m }) : setTimeout(poll, 50));
    poll();
  });
}

/** Load OpenCV.js in the browser as a classic script (about 10 MB, so on demand and only once). */
export function loadOpenCV(): Promise<{ cv: CV }> {
  cvPromise ??= import("@techstark/opencv-js/dist/opencv.js?url").then(
    ({ default: url }) =>
      new Promise<{ cv: CV }>((resolve, reject) => {
        const el = document.createElement("script");
        el.src = url;
        el.async = true;
        el.onload = () => whenReady((window as unknown as { cv: CV }).cv).then(resolve);
        el.onerror = () => reject(new Error("Could not load OpenCV.js"));
        document.head.appendChild(el);
      }),
  );
  return cvPromise;
}

export interface P {
  x: number;
  y: number;
}

export interface Sticker {
  c: P;
  size: number;
  /** short side / long side of the outline's bounding rectangle */
  aspect: number;
  /** rotation of the outline in degrees, folded into [0, 90) */
  angle: number;
}

export interface FaceDetection {
  /** 9 sticker centers, row-major as the camera sees the face, in pixels of the input image */
  centers: P[];
  /** outer corners of the face: top-left, top-right, bottom-right, bottom-left */
  corners: P[];
  /** typical sticker side length in pixels */
  stickerSize: number;
  /** how many of the 9 stickers were actually seen (the rest are predicted) */
  seen: number;
  /** every sticker-like outline found, for debugging overlays */
  candidates: Sticker[];
}

export interface DetectOptions {
  canny?: [number, number];
}

/** Find sticker-like outlines. */
export function findStickers(cv: CV, img: Img, opts: DetectOptions = {}): Sticker[] {
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const out: Sticker[] = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const [lo, hi] = opts.canny ?? [20, 60];
    cv.Canny(gray, edges, lo, hi);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const h = img.height;
    const minSide = h * 0.025;
    const maxSide = h * 0.3;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < minSide * minSide || area > maxSide * maxSide) {
        c.delete();
        continue;
      }
      const r = cv.minAreaRect(c);
      const w = r.size.width, hh = r.size.height;
      const aspect = Math.min(w, hh) / Math.max(w, hh);
      const fill = area / (w * hh);
      // Convex-ish: compare with the hull so star/ragged shapes drop out.
      const hull = new cv.Mat();
      cv.convexHull(c, hull, false, true);
      const solidity = area / Math.max(1, cv.contourArea(hull));
      hull.delete();
      c.delete();
      if (aspect < 0.55 || fill < 0.68 || solidity < 0.88) continue;
      out.push({ c: { x: r.center.x, y: r.center.y }, size: Math.sqrt(area), aspect, angle: ((r.angle % 90) + 90) % 90 });
    }
  } finally {
    [src, gray, edges, contours, hierarchy, kernel].forEach((m) => m.delete());
  }
  return dedupe(out);
}

/** The inner and outer edge of one sticker give two outlines; keep one per location. */
function dedupe(list: Sticker[]): Sticker[] {
  const sorted = list.slice().sort((a, b) => a.size - b.size);
  const kept: Sticker[] = [];
  for (const s of sorted) {
    const dup = kept.find((k) => Math.hypot(k.c.x - s.c.x, k.c.y - s.c.y) < 0.4 * Math.min(k.size, s.size) + 1);
    if (dup) {
      // Prefer the larger outline (closer to the sticker's true size) when nested.
      if (s.size < dup.size * 1.6) Object.assign(dup, s);
    } else kept.push({ ...s });
  }
  return kept;
}

export function detectFace(cv: CV, img: Img, opts: DetectOptions = {}): FaceDetection | null {
  const candidates = findStickers(cv, img, opts);
  const face = fitGrid(candidates);
  return face && { ...face, candidates };
}

// ---------------------------------------------------------------------------
// Grid fitting (pure JS, no OpenCV).

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: P) => Math.hypot(a.x, a.y);

export function fitGrid(stickers: Sticker[]): Omit<FaceDetection, "candidates"> | null {
  if (stickers.length < 4) return null;

  // Links between stickers that are plausibly direct neighbours on one face.
  const links: [number, number, P][] = [];
  for (let i = 0; i < stickers.length; i++)
    for (let j = i + 1; j < stickers.length; j++) {
      const a = stickers[i], b = stickers[j];
      const ratio = a.size / b.size;
      if (ratio < 0.7 || ratio > 1.43) continue;
      // Stickers on one face look alike; stickers on the next face over are foreshortened differently.
      if (Math.abs(a.aspect - b.aspect) > 0.3) continue;
      const da = Math.abs(a.angle - b.angle);
      if (Math.min(da, 90 - da) > 20) continue;
      const d = sub(b.c, a.c);
      const s = (a.size + b.size) / 2;
      const dl = len(d);
      if (dl < 0.95 * s || dl > 1.75 * s) continue;
      links.push([i, j, d]);
    }

  // Connected groups of linked stickers; try each group with enough members.
  const parent = stickers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [i, j] of links) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  stickers.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });

  let best: Omit<FaceDetection, "candidates"> | null = null;
  for (const members of groups.values()) {
    if (members.length < 4) continue;
    const set = new Set(members);
    const g = fitGroup(stickers, members, links.filter(([i]) => set.has(i)));
    if (g && (!best || g.seen > best.seen || (g.seen === best.seen && g.stickerSize > best.stickerSize))) best = g;
  }
  return best;
}

function fitGroup(stickers: Sticker[], members: number[], allLinks: [number, number, P][]): Omit<FaceDetection, "candidates"> | null {
  // Diagonal neighbours are ~1.4x farther than direct ones; drop them so they don't skew the axes.
  const lens = allLinks.map(([, , d]) => len(d)).sort((a, b) => a - b);
  const typical = lens[lens.length >> 1];
  const links = allLinks.filter(([, , d]) => len(d) < 1.22 * typical);
  if (links.length < 3) return null;
  // Split link directions into two families using the doubled angle (so d and -d agree).
  const dirs = links.map(([, , d]) => {
    const t = Math.atan2(d.y, d.x) * 2;
    return { d, u: { x: Math.cos(t), y: Math.sin(t) } };
  });
  // Seed the first family with the most "horizontal" link, refine with a few 2-means rounds.
  let c1 = { x: 1, y: 0 }, c2 = { x: -1, y: 0 };
  for (let it = 0; it < 6; it++) {
    const g1 = dirs.filter((v) => v.u.x * c1.x + v.u.y * c1.y >= v.u.x * c2.x + v.u.y * c2.y);
    const g2 = dirs.filter((v) => !g1.includes(v));
    if (!g1.length || !g2.length) return null;
    const mean = (g: typeof dirs) => {
      const m = g.reduce((s, v) => ({ x: s.x + v.u.x, y: s.y + v.u.y }), { x: 0, y: 0 });
      const l = len(m) || 1;
      return { x: m.x / l, y: m.y / l };
    };
    c1 = mean(g1);
    c2 = mean(g2);
  }
  const axis = (c: P) => {
    const t = Math.atan2(c.y, c.x) / 2;
    return { x: Math.cos(t), y: Math.sin(t) };
  };
  // Average link vector per family, with consistent sign.
  const basis = [c1, c2].map((c) => {
    const ax = axis(c);
    const fam = dirs.filter((v) => Math.abs(v.d.x * ax.x + v.d.y * ax.y) > 0.94 * len(v.d));
    if (!fam.length) return null;
    const m = fam.reduce((s, v) => {
      const sign = v.d.x * ax.x + v.d.y * ax.y >= 0 ? 1 : -1;
      return { x: s.x + sign * v.d.x, y: s.y + sign * v.d.y };
    }, { x: 0, y: 0 });
    return { x: m.x / fam.length, y: m.y / fam.length };
  });
  if (!basis[0] || !basis[1]) return null;
  // Column axis = the more horizontal one, pointing right; row axis pointing down.
  let [col, row] = Math.abs(basis[0].x) >= Math.abs(basis[1].x) ? [basis[0], basis[1]] : [basis[1], basis[0]];
  if (col.x < 0) col = { x: -col.x, y: -col.y };
  if (row.y < 0) row = { x: -row.x, y: -row.y };
  const det = col.x * row.y - col.y * row.x;
  if (Math.abs(det) < 0.4 * len(col) * len(row)) return null; // axes nearly parallel

  // Integer grid coordinates relative to the member closest to the group's centroid.
  const cx = members.reduce((s, i) => s + stickers[i].c.x, 0) / members.length;
  const cy = members.reduce((s, i) => s + stickers[i].c.y, 0) / members.length;
  const root = members.reduce((b, i) => (Math.hypot(stickers[i].c.x - cx, stickers[i].c.y - cy) < Math.hypot(stickers[b].c.x - cx, stickers[b].c.y - cy) ? i : b));
  const cells = new Map<string, { i: number; j: number; p: P; err: number; size: number }>();
  for (const k of members) {
    const d = sub(stickers[k].c, stickers[root].c);
    const fi = (d.x * row.y - d.y * row.x) / det; // along col
    const fj = (col.x * d.y - col.y * d.x) / det; // along row
    const i = Math.round(fi), j = Math.round(fj);
    const err = Math.hypot(fi - i, fj - j);
    if (err > 0.3) continue;
    const key = `${i},${j}`;
    const prev = cells.get(key);
    if (!prev || err < prev.err) cells.set(key, { i, j, p: stickers[k].c, err, size: stickers[k].size });
  }

  // Best 3x3 window.
  const pts = [...cells.values()];
  let win: typeof pts = [];
  let wi = 0, wj = 0;
  const is = new Set(pts.map((p) => p.i)), js = new Set(pts.map((p) => p.j));
  for (const i0 of [...is].flatMap((i) => [i - 2, i - 1, i]))
    for (const j0 of [...js].flatMap((j) => [j - 2, j - 1, j])) {
      const inside = pts.filter((p) => p.i >= i0 && p.i <= i0 + 2 && p.j >= j0 && p.j <= j0 + 2);
      if (inside.length > win.length) [win, wi, wj] = [inside, i0, j0];
    }
  if (win.length < 5) return null;

  // Least-squares affine map (gi, gj) -> (x, y) with gi = col index 0..2, gj = row index 0..2.
  const A = fitAffine(win.map((p) => [p.i - wi, p.j - wj] as [number, number]), win.map((p) => p.p));
  if (!A) return null;
  const map = (gi: number, gj: number): P => ({ x: A[0] + A[1] * gi + A[2] * gj, y: A[3] + A[4] * gi + A[5] * gj });
  // Reject if the seen stickers don't sit where the fitted grid says (not a single flat face).
  const spacing = (len({ x: A[1], y: A[4] }) + len({ x: A[2], y: A[5] })) / 2;
  const resid = win.map((p) => len(sub(map(p.i - wi, p.j - wj), p.p))).sort((a, b) => a - b);
  if (resid[resid.length >> 1] > 0.18 * spacing || resid[resid.length - 1] > 0.45 * spacing) return null;

  const centers: P[] = [];
  for (let gj = 0; gj < 3; gj++) for (let gi = 0; gi < 3; gi++) centers.push(map(gi, gj));
  const corners = [map(-0.5, -0.5), map(2.5, -0.5), map(2.5, 2.5), map(-0.5, 2.5)];
  const sizes = win.map((p) => p.size).sort((a, b) => a - b);
  return { centers, corners, stickerSize: sizes[sizes.length >> 1], seen: win.length };
}

/** Solve x = a0 + a1*i + a2*j and y = b0 + b1*i + b2*j by least squares. */
function fitAffine(ij: [number, number][], p: P[]): number[] | null {
  // Normal equations for [1, i, j].
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0], by = [0, 0, 0];
  ij.forEach(([i, j], k) => {
    const v = [1, i, j];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) M[r][c] += v[r] * v[c];
      bx[r] += v[r] * p[k].x;
      by[r] += v[r] * p[k].y;
    }
  });
  const sx = solve3(M, bx), sy = solve3(M, by);
  return sx && sy ? [...sx, ...sy] : null;
}

function solve3(M: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M);
  if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((k) => det(M.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / d);
}

/** Median color in a small square around each point. */
export function sampleAt(img: Img, pts: P[], radius: number): [number, number, number][] {
  const rad = Math.max(1, Math.round(radius));
  return pts.map(({ x, y }) => {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        const px = Math.min(img.width - 1, Math.max(0, Math.round(x + dx)));
        const py = Math.min(img.height - 1, Math.max(0, Math.round(y + dy)));
        const k = (py * img.width + px) * 4;
        rs.push(img.data[k]);
        gs.push(img.data[k + 1]);
        bs.push(img.data[k + 2]);
      }
    const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
    return [med(rs), med(gs), med(bs)];
  });
}

export interface LiveFace {
  /** sticker centers and outer corners as fractions of the frame (raw, unmirrored) */
  centers: P[];
  corners: P[];
  colors: [number, number, number][];
  seen: number;
  /** sampling radius in pixels of the processed image */
  radius: number;
}

/** Turn a fixed square (fractions of the frame) into face geometry, for the fallback grid. */
export function squareFace(box: { x: number; y: number; w: number; h: number }): Pick<LiveFace, "centers" | "corners"> {
  const at = (gi: number, gj: number): P => ({ x: box.x + (box.w * (gi + 0.5)) / 3, y: box.y + (box.h * (gj + 0.5)) / 3 });
  const centers: P[] = [];
  for (let gj = 0; gj < 3; gj++) for (let gi = 0; gi < 3; gi++) centers.push(at(gi, gj));
  return { centers, corners: [at(-0.5, -0.5), at(2.5, -0.5), at(2.5, 2.5), at(-0.5, 2.5)] };
}

/**
 * Detection for live video: remembers the last face for a few frames so a single missed
 * frame (motion blur, a finger passing) doesn't make the grid flicker.
 */
export class LiveFaceDetector {
  private last: LiveFace | null = null;
  private missed = 0;

  constructor(private cv: CV) {}

  update(img: Img): LiveFace | null {
    const det = detectFace(this.cv, img);
    if (det) {
      const norm = (p: P) => ({ x: p.x / img.width, y: p.y / img.height });
      this.last = {
        centers: det.centers.map(norm),
        corners: det.corners.map(norm),
        colors: sampleAt(img, det.centers, det.stickerSize * 0.25),
        seen: det.seen,
        radius: det.stickerSize * 0.25,
      };
      this.missed = 0;
      return this.last;
    }
    if (++this.missed > 4) this.last = null;
    if (!this.last) return null;
    const px = this.last.centers.map((p) => ({ x: p.x * img.width, y: p.y * img.height }));
    return { ...this.last, colors: sampleAt(img, px, this.last.radius) };
  }
}
