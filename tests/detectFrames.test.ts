// Runs the OpenCV face detector on a folder of PNG frames and writes annotated copies.
//   npm run detect                      (uses ./frames)
//   FRAMES_DIR=/path/to/pngs npm run detect
// If the folder has a meta.json with a `setup` alg per file (rendered test frames), the detected
// colors are also checked against the expected front face.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { applyMoves, solved } from "../src/cube/model";
import { createRequire } from "node:module";
import { detectFace, sampleAt, whenReady } from "../src/vision/stickers";

const DIR = process.env.FRAMES_DIR ?? "frames";
const run = existsSync(DIR) ? describe : describe.skip;

// cubing.js sticker colors, in our color order (white red green yellow orange blue)
const RENDER_PALETTE = [[255, 255, 255], [255, 0, 0], [0, 255, 0], [255, 255, 0], [255, 160, 0], [40, 110, 255]];
const nearest = (rgb: number[]) =>
  RENDER_PALETTE.map((p, i) => [Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]), i]).sort((a, b) => a[0] - b[0])[0][1];

function drawDot(png: PNG, x: number, y: number, r: number, col: number[]) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= png.width || py >= png.height || dx * dx + dy * dy > r * r) continue;
      png.data.set(col, (py * png.width + px) * 4);
    }
}
function drawLine(png: PNG, a: { x: number; y: number }, b: { x: number; y: number }, col: number[]) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for (let k = 0; k <= n; k++) drawDot(png, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, 1, col);
}

run(`detector on ${DIR}`, () => {
  it("detects faces", async () => {
    const { cv } = await whenReady(createRequire(import.meta.url)("@techstark/opencv-js"));
    const files = readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();
    const meta: { file: string; setup: string }[] = existsSync(join(DIR, "meta.json")) ? JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) : [];
    mkdirSync(join(DIR, "out"), { recursive: true });
    const lines: string[] = [];
    let found = 0, correct = 0, checked = 0;
    for (const f of files) {
      const png = PNG.sync.read(readFileSync(join(DIR, f)));
      // Same processing size as the app (480 px wide).
      const scale = 480 / png.width;
      const small = new PNG({ width: 480, height: Math.round(png.height * scale) });
      for (let y = 0; y < small.height; y++)
        for (let x = 0; x < small.width; x++) {
          const sx = Math.min(png.width - 1, Math.floor(x / scale)), sy = Math.min(png.height - 1, Math.floor(y / scale));
          small.data.set(png.data.subarray((sy * png.width + sx) * 4, (sy * png.width + sx) * 4 + 4), (y * small.width + x) * 4);
        }
      const img = { data: new Uint8ClampedArray(small.data), width: small.width, height: small.height };
      const t0 = performance.now();
      const det = detectFace(cv, img);
      const ms = performance.now() - t0;
      const up = (p: { x: number; y: number }) => ({ x: p.x / scale, y: p.y / scale });
      let note = "";
      if (det) {
        found++;
        det.candidates.forEach((c) => drawDot(png, c.c.x / scale, c.c.y / scale, 3, [255, 0, 255, 255]));
        const cs = det.corners.map(up);
        cs.forEach((c, k) => drawLine(png, c, cs[(k + 1) % 4], [168, 85, 247, 255]));
        det.centers.map(up).forEach((c) => drawDot(png, c.x, c.y, 5, [0, 0, 0, 255]));
        const m = meta.find((x) => x.file.endsWith(f));
        if (m) {
          checked++;
          const expected = Array.from(applyMoves(solved(), m.setup).slice(18, 27));
          const got = sampleAt(img, det.centers, det.stickerSize * 0.25).map(nearest);
          const ok = got.every((c, k) => c === expected[k]);
          if (ok) correct++;
          note = ok ? "colors ✓" : `colors ✗ got ${got.join("")} want ${expected.join("")}`;
        }
      }
      writeFileSync(join(DIR, "out", f), PNG.sync.write(png));
      lines.push(`${f}: ${det ? `face (${det.seen}/9 seen, ${det.candidates.length} candidates)` : "no face"} ${ms.toFixed(0)}ms ${note}`);
    }
    console.log(lines.join("\n") + `\n\nfound ${found}/${files.length}` + (checked ? `, colors correct ${correct}/${checked}` : ""));
    expect(files.length).toBeGreaterThan(0);
  }, 300000);
});
