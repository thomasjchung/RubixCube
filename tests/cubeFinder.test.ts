import { describe, expect, it } from "vitest";
import { findFace } from "../src/vision/cubeFinder";
import { DEFAULT_MEANS } from "../src/vision/colors";

const PALETTE = [[235, 235, 235], [200, 30, 40], [30, 160, 70], [235, 215, 30], [245, 120, 20], [30, 80, 200]];

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** A grey-ish noisy background with a 3x3 face (black gaps) at (fx, fy). */
function scene(w: number, h: number, fx: number, fy: number, side: number, colors: number[], r: () => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 70 + r() * 60;
    data.set([v, v * 0.9, v * 0.8, 255], i * 4);
  }
  const cell = side / 3;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const cx = x / cell, cy = y / cell;
      const gap = cx % 1 < 0.08 || cx % 1 > 0.92 || cy % 1 < 0.08 || cy % 1 > 0.92;
      const k = Math.min(2, Math.floor(cy)) * 3 + Math.min(2, Math.floor(cx));
      const col = gap ? [15, 15, 15] : PALETTE[colors[k]].map((v) => v + (r() - 0.5) * 20);
      data.set([...col, 255], ((fy + y) * w + fx + x) * 4);
    }
  return { data, width: w, height: h };
}

describe("cube finder", () => {
  it("finds a face anywhere in the frame", () => {
    const r = rng(9);
    for (let t = 0; t < 10; t++) {
      const side = Math.round(30 + r() * 60);
      const fx = Math.round(r() * (240 - side));
      const fy = Math.round(r() * (135 - side));
      const colors = Array.from({ length: 9 }, () => Math.floor(r() * 6));
      const t0 = performance.now();
      const box = findFace(scene(240, 135, fx, fy, side, colors, r), DEFAULT_MEANS, { maxDist: 40 });
      const ms = performance.now() - t0;
      expect(box, `trial ${t}`).not.toBeNull();
      expect(Math.abs(box!.x - fx), `x trial ${t} (${ms.toFixed(1)}ms)`).toBeLessThanOrEqual(side * 0.08);
      expect(Math.abs(box!.y - fy)).toBeLessThanOrEqual(side * 0.08);
      expect(Math.abs(box!.side - side)).toBeLessThanOrEqual(side * 0.12);
      expect(ms).toBeLessThan(150);
    }
  });

  it("finds nothing in an empty frame", () => {
    const r = rng(1);
    const img = scene(240, 135, 0, 0, 0, [], r);
    expect(findFace(img, DEFAULT_MEANS, { maxDist: 40 })).toBeNull();
  });

  it("rejects a blank white wall but finds a solved white face", () => {
    const r = rng(2);
    const wall = scene(240, 135, 0, 0, 0, [], r);
    for (let y = 20; y < 120; y++) for (let x = 60; x < 200; x++) wall.data.set([230, 230, 228, 255], (y * 240 + x) * 4);
    expect(findFace(wall, DEFAULT_MEANS, { maxDist: 40 })).toBeNull();
    const solvedFace = scene(240, 135, 100, 30, 66, new Array(9).fill(0), r);
    const box = findFace(solvedFace, DEFAULT_MEANS, { maxDist: 40 });
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 100)).toBeLessThanOrEqual(6);
  });

  it("tolerates a finger over one sticker and tracks with prev", () => {
    const r = rng(4);
    const img = scene(240, 135, 50, 20, 75, [1, 2, 3, 4, 5, 0, 1, 2, 3], r);
    for (let y = 20; y < 45; y++) for (let x = 50; x < 75; x++) img.data.set([200, 150, 120, 255], (y * 240 + x) * 4);
    const t0 = performance.now();
    const box = findFace(img, DEFAULT_MEANS, { maxDist: 40 });
    const full = performance.now() - t0;
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 50)).toBeLessThanOrEqual(6);
    const t1 = performance.now();
    const again = findFace(img, DEFAULT_MEANS, { maxDist: 40, prev: box });
    const near = performance.now() - t1;
    expect(again).not.toBeNull();
    expect([full, near].every((ms) => ms < 60), `full ${full.toFixed(1)}ms near ${near.toFixed(1)}ms`).toBe(true);
  });

  it("ignores the edge of a big colored shape (Chrome's fake webcam)", () => {
    const w = 240, h = 135, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const inWedge = Math.hypot(x - 110, y - 70) < 40 && y > 70;
        data.set(inWedge ? [90, 255, 20, 255] : [30, 130, 0, 255], (y * w + x) * 4);
      }
    expect(findFace({ data, width: w, height: h }, DEFAULT_MEANS, { maxDist: 48 })).toBeNull();
  });
});
