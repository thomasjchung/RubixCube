import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { applyMoves, solved } from "../src/cube/model";
import { detectFace, fitGrid, sampleAt, whenReady } from "../src/vision/stickers";

const DIR = "tests/fixtures/rendered";
const PALETTE = [[255, 255, 255], [255, 0, 0], [0, 255, 0], [255, 255, 0], [255, 160, 0], [40, 110, 255]];
const nearest = (rgb: number[]) =>
  PALETTE.map((p, i) => [Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]), i]).sort((a, b) => a[0] - b[0])[0][1];

describe("sticker detector", () => {
  it("fits a rotated grid with missing stickers", () => {
    const a = (12 * Math.PI) / 180;
    const pts = [];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        if ((i === 1 && j === 2) || (i === 2 && j === 0)) continue; // two hidden stickers
        const x = 30 * i, y = 30 * j;
        pts.push({ c: { x: 100 + x * Math.cos(a) - y * Math.sin(a), y: 80 + x * Math.sin(a) + y * Math.cos(a) }, size: 25, aspect: 1, angle: 12 });
      }
    pts.push({ c: { x: 400, y: 300 }, size: 25, aspect: 1, angle: 0 }); // stray square elsewhere
    const f = fitGrid(pts)!;
    expect(f.seen).toBe(7);
    expect(f.centers[0].x).toBeCloseTo(100, 0);
    expect(f.centers[0].y).toBeCloseTo(80, 0);
    // the hidden top-right sticker is predicted
    expect(f.centers[2].x).toBeCloseTo(100 + 60 * Math.cos(a), 0);
    expect(f.centers[2].y).toBeCloseTo(80 + 60 * Math.sin(a), 0);
  });

  it("reads rendered cube frames", async () => {
    const { cv } = await whenReady(createRequire(import.meta.url)("@techstark/opencv-js"));
    const meta: { file: string; setup: string }[] = JSON.parse(readFileSync(`${DIR}/meta.json`, "utf8"));
    let ok = 0;
    for (const m of meta) {
      const png = PNG.sync.read(readFileSync(`${DIR}/${m.file}`));
      const img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
      const det = detectFace(cv, img);
      if (!det) continue;
      const got = sampleAt(img, det.centers, det.stickerSize * 0.25).map(nearest);
      const want = Array.from(applyMoves(solved(), m.setup).slice(18, 27));
      if (got.every((c, k) => c === want[k])) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(meta.length - 1);
  }, 60000);
});
